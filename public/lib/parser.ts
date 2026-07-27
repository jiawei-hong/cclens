import type { Session, MemoryEntry, MemoryEntryType } from '../../src/types'
import { parseRawJsonl, attachSubagents, subagentParentId } from '../../src/parseCore'
import {
  readSessionCache, writeSessionCache, readMemoryCache, writeMemoryCache,
  PARSER_VERSION, type CachedSession, type CachedMemory,
} from './db'
import { parseInWorker, workerAvailable } from './workerClient'

export async function parseSessionFile(file: File): Promise<Session | null> {
  const raw = await file.text()
  const sessionId = file.name.replace('.jsonl', '')
  return parseRawJsonl(raw, sessionId, '/')
}

export async function parseSessionFiles(files: FileList | File[]): Promise<Session[]> {
  // Bare file drops carry no directory structure, so subagent transcripts
  // (agent-*.jsonl) can't be attached to their parent — skip them rather than
  // presenting them as fake sessions. Folder mode handles them properly.
  const arr = Array.from(files).filter(f => f.name.endsWith('.jsonl') && !f.name.startsWith('agent-'))
  const results = await Promise.all(arr.map(f => parseSessionFile(f).catch(() => null)))
  return results
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// Cache-aware variant: only re-parses files whose (lastModified, size) has
// changed since the last walk. Returns parsed Session[] and reports how many
// came from cache so the UI can surface it.

export type CachedParseResult<T> = { items: T[]; fromCache: number; reparsed: number }

export type ParseProgress = (done: number, total: number) => void

export async function parseSessionFilesCached(
  tracked: TrackedFile[],
  onProgress?: ParseProgress,
): Promise<CachedParseResult<Session>> {
  const jsonl = tracked.filter(t => t.file.name.endsWith('.jsonl'))
  const cache = await readSessionCache().catch(() => new Map<string, CachedSession>())

  const keepPaths = new Set(jsonl.map(t => t.path))
  const toWrite: CachedSession[] = []
  const pairs: { path: string; session: Session }[] = []
  const total = jsonl.length
  let done = 0
  let fromCache = 0
  let reparsed = 0

  type Miss = { path: string; file: File; lastModified: number; size: number }
  const misses: Miss[] = []

  // Cheap pass: harvest cache hits on the main thread, queue misses for the worker.
  for (const t of jsonl) {
    const cached = cache.get(t.path)
    if (cached && cached.lastModified === t.file.lastModified && cached.size === t.file.size
        && cached.parserVersion === PARSER_VERSION) {
      fromCache++
      done++
      pairs.push({ path: t.path, session: cached.session })
    } else {
      misses.push({ path: t.path, file: t.file, lastModified: t.file.lastModified, size: t.file.size })
    }
  }
  if (onProgress && done > 0) onProgress(done, total)

  if (misses.length > 0) {
    const progressFromWorker = (workerDone: number) => {
      if (onProgress) onProgress(fromCache + workerDone, total)
    }
    if (workerAvailable()) {
      try {
        const out = await parseInWorker(misses, workerDone => progressFromWorker(workerDone))
        for (const r of out) {
          if (r.session) {
            reparsed++
            pairs.push({ path: r.path, session: r.session })
            toWrite.push({ path: r.path, lastModified: r.lastModified, size: r.size, parserVersion: PARSER_VERSION, session: r.session })
          }
        }
        done = fromCache + misses.length
      } catch {
        // Fall through to main-thread parsing if the worker failed to spawn.
        await parseOnMain(misses)
      }
    } else {
      await parseOnMain(misses)
    }
  }

  async function parseOnMain(items: Miss[]) {
    for (const m of items) {
      try {
        const session = await parseSessionFile(m.file)
        if (session) {
          reparsed++
          pairs.push({ path: m.path, session })
          toWrite.push({ path: m.path, lastModified: m.lastModified, size: m.size, parserVersion: PARSER_VERSION, session })
        }
      } catch { /* skip */ }
      done++
      onProgress?.(done, total)
    }
  }

  // Best-effort cache write; don't block UI on quota errors. Sessions are
  // cached WITHOUT the subagents aggregate — attachment is recomputed per load.
  writeSessionCache(
    toWrite.map(c => ({ ...c, session: { ...c.session, subagents: undefined } })),
    keepPaths,
  ).catch(() => { /* quota / corruption */ })

  // Fold subagent transcripts (<sessionId>/subagents/agent-*.jsonl) into their
  // parent sessions; they are not sessions of their own.
  const childrenByParent = new Map<string, Session[]>()
  const parents: Session[] = []
  for (const { path, session } of pairs) {
    const parentId = subagentParentId(path)
    if (parentId) {
      const list = childrenByParent.get(parentId) ?? []
      list.push(session)
      childrenByParent.set(parentId, list)
    } else {
      parents.push(session)
    }
  }
  for (const p of parents) {
    p.subagents = undefined  // recompute — a stale cached value must not survive
    attachSubagents(p, childrenByParent.get(p.id) ?? [])
  }

  const items = parents.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return { items, fromCache, reparsed }
}

// ── Memory file parsing ───────────────────────────────────────────────────────

const KNOWN_MEMORY_TYPES = new Set<MemoryEntryType>(['user', 'feedback', 'project', 'reference'])

function projectNameFromSlug(slug: string): string {
  const parts = slug.split('-').filter(Boolean)
  return parts[parts.length - 1] ?? slug
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: raw }
  const block = raw.slice(3, end).replace(/^\r?\n/, '')
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const meta: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1]!.trim()
    let val = m[2]!.trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }
  return { meta, body }
}

export type TrackedFile = { file: File; path: string }

export async function parseMemoryFiles(tracked: TrackedFile[]): Promise<MemoryEntry[]> {
  const mdFiles = tracked.filter(t => {
    if (!t.file.name.endsWith('.md')) return false
    const segments = t.path.split('/')
    // Must live under `<projectSlug>/memory/...`
    const memIdx = segments.indexOf('memory')
    return memIdx >= 1 && memIdx === segments.length - 2  // direct child of memory/ only
  })

  const entries = await Promise.all(mdFiles.map(async t => {
    try {
      const raw = await t.file.text()
      const { meta, body } = parseFrontmatter(raw)
      const segments = t.path.split('/')
      const projectSlug = segments[0] ?? ''
      const fileName = t.file.name
      const rawType = (meta['type'] ?? '').toLowerCase() as MemoryEntryType
      const type: MemoryEntryType = KNOWN_MEMORY_TYPES.has(rawType) ? rawType : 'other'
      const entry: MemoryEntry = {
        projectSlug,
        projectName: projectNameFromSlug(projectSlug),
        fileName,
        isIndex: fileName === 'MEMORY.md',
        name: meta['name'] || undefined,
        description: meta['description'] || undefined,
        type,
        body,
        lastModified: t.file.lastModified,
      }
      return entry
    } catch {
      return null
    }
  }))

  return entries.filter((e): e is MemoryEntry => e !== null)
    .sort((a, b) => {
      // Index first within a project, then by name
      if (a.projectSlug !== b.projectSlug) return a.projectName.localeCompare(b.projectName)
      if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
      return (a.name ?? a.fileName).localeCompare(b.name ?? b.fileName)
    })
}

export async function parseMemoryFilesCached(tracked: TrackedFile[]): Promise<CachedParseResult<MemoryEntry>> {
  const mdTracked = tracked.filter(t => {
    if (!t.file.name.endsWith('.md')) return false
    const segments = t.path.split('/')
    const memIdx = segments.indexOf('memory')
    return memIdx >= 1 && memIdx === segments.length - 2
  })

  const cache = await readMemoryCache().catch(() => new Map<string, CachedMemory>())
  const keepPaths = new Set(mdTracked.map(t => t.path))
  const toWrite: CachedMemory[] = []
  let fromCache = 0
  let reparsed = 0

  const entries = await Promise.all(mdTracked.map(async t => {
    const cached = cache.get(t.path)
    if (cached && cached.lastModified === t.file.lastModified && cached.size === t.file.size) {
      fromCache++
      return cached.entry
    }
    try {
      const raw = await t.file.text()
      const { meta, body } = parseFrontmatter(raw)
      const segments = t.path.split('/')
      const projectSlug = segments[0] ?? ''
      const fileName = t.file.name
      const rawType = (meta['type'] ?? '').toLowerCase() as MemoryEntryType
      const type: MemoryEntryType = KNOWN_MEMORY_TYPES.has(rawType) ? rawType : 'other'
      const entry: MemoryEntry = {
        projectSlug,
        projectName: projectNameFromSlug(projectSlug),
        fileName,
        isIndex: fileName === 'MEMORY.md',
        name: meta['name'] || undefined,
        description: meta['description'] || undefined,
        type,
        body,
        lastModified: t.file.lastModified,
      }
      reparsed++
      toWrite.push({ path: t.path, lastModified: t.file.lastModified, size: t.file.size, entry })
      return entry
    } catch {
      return null
    }
  }))

  writeMemoryCache(toWrite, keepPaths).catch(() => { /* quota / corruption */ })

  const items = entries.filter((e): e is MemoryEntry => e !== null)
    .sort((a, b) => {
      if (a.projectSlug !== b.projectSlug) return a.projectName.localeCompare(b.projectName)
      if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
      return (a.name ?? a.fileName).localeCompare(b.name ?? b.fileName)
    })
  return { items, fromCache, reparsed }
}

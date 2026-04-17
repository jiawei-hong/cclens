import type { Session, MemoryEntry, MemoryEntryType } from '../../src/types'
import { parseRawJsonl } from '../../src/parseCore'

export async function parseSessionFile(file: File): Promise<Session | null> {
  const raw = await file.text()
  const sessionId = file.name.replace('.jsonl', '')
  return parseRawJsonl(raw, sessionId, '/')
}

export async function parseSessionFiles(files: FileList | File[]): Promise<Session[]> {
  const arr = Array.from(files).filter(f => f.name.endsWith('.jsonl'))
  const results = await Promise.all(arr.map(f => parseSessionFile(f).catch(() => null)))
  return results
    .filter((s): s is Session => s !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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

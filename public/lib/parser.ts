import type { Session, Turn, ToolCall, ContentBlock, RawEntry, AggregatedUsage, MemoryEntry, MemoryEntryType } from '../../src/types'

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n')
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter(b => b.type === 'tool_use')
    .map(b => {
      const block = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      return { id: block.id, name: block.name, input: block.input }
    })
}

function extractThinkingCount(content: ContentBlock[]): number {
  return content.filter(b => b.type === 'thinking').length
}

function projectNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export async function parseSessionFile(file: File): Promise<Session | null> {
  const raw = await file.text()
  const lines = raw.trim().split('\n').filter(Boolean)

  const entries: RawEntry[] = []
  for (const line of lines) {
    try { entries.push(JSON.parse(line)) } catch { /* skip */ }
  }

  const messageEntries = entries.filter(e => e.type === 'user' || e.type === 'assistant')
  if (messageEntries.length === 0) return null

  // Build tool result map (include the tool_result entry's timestamp for durations)
  const toolResults: Record<string, { text: string; isError: boolean; resultAt: string }> = {}
  for (const entry of messageEntries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result') {
        const b = block as { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
        const text = typeof b.content === 'string' ? b.content : extractText(b.content)
        toolResults[b.tool_use_id] = { text: text.slice(0, 500), isError: b.is_error === true, resultAt: entry.timestamp }
      }
    }
  }

  const turns: Turn[] = []
  for (const entry of messageEntries) {
    if (!entry.message) continue
    const { role, content } = entry.message
    const text = extractText(content)
    const toolCalls = Array.isArray(content) ? extractToolCalls(content) : []
    const thinkingBlocks = Array.isArray(content) ? extractThinkingCount(content) : 0
    for (const tc of toolCalls) {
      const r = toolResults[tc.id]
      if (r) {
        tc.result = r.text
        tc.isError = r.isError
        const dur = new Date(r.resultAt).getTime() - new Date(entry.timestamp).getTime()
        if (dur >= 0) tc.durationMs = dur
      }
    }
    if (!text && toolCalls.length === 0) continue
    turns.push({
      uuid: entry.uuid,
      role,
      timestamp: entry.timestamp,
      text: text.slice(0, 2000),
      toolCalls,
      thinkingBlocks,
    })
  }

  if (turns.length === 0) return null

  const timestamps = turns.map(t => t.timestamp).sort()
  const startedAt = timestamps[0] ?? new Date().toISOString()
  const endedAt = timestamps[timestamps.length - 1] ?? startedAt

  // Active duration: sum only gaps < 5 min between consecutive turns.
  // Gaps ≥ 5 min are treated as idle (user away / claude --resume after a break).
  const IDLE_THRESHOLD_MS = 5 * 60 * 1000
  let durationMs = 0
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1]!
    const curr = timestamps[i]!
    const gap = new Date(curr).getTime() - new Date(prev).getTime()
    if (gap < IDLE_THRESHOLD_MS) durationMs += gap
  }

  const cwdEntry = entries.find(e => e.cwd)
  const projectPath = cwdEntry?.cwd ?? '/'

  const toolBreakdown: Record<string, number> = {}
  let totalTextLength = 0
  let toolCallCount = 0
  for (const turn of turns) {
    totalTextLength += turn.text.length
    for (const tc of turn.toolCalls) {
      toolCallCount++
      toolBreakdown[tc.name] = (toolBreakdown[tc.name] ?? 0) + 1
    }
  }

  const usage: AggregatedUsage = { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }
  const modelUsage: Record<string, AggregatedUsage> = {}
  let peakContextTokens = 0
  let has1MContext = false
  for (const entry of messageEntries) {
    if (entry.type !== 'assistant') continue
    const u = entry.message?.usage
    if (!u) continue
    const input  = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    const ccIn   = u.cache_creation_input_tokens ?? 0
    const crIn   = u.cache_read_input_tokens ?? 0
    usage.inputTokens       += input
    usage.outputTokens      += output
    usage.cacheCreateTokens += ccIn
    usage.cacheReadTokens   += crIn
    const model = entry.message?.model ?? 'unknown'
    if (model.includes('[1m]')) has1MContext = true
    const m = modelUsage[model] ?? (modelUsage[model] = { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 })
    m.inputTokens       += input
    m.outputTokens      += output
    m.cacheCreateTokens += ccIn
    m.cacheReadTokens   += crIn
    // Context window size seen by the model on this turn — the sum of all input-side tokens.
    const contextThisTurn = input + ccIn + crIn
    if (contextThisTurn > peakContextTokens) peakContextTokens = contextThisTurn
  }

  // Derive session ID from filename
  const sessionId = file.name.replace('.jsonl', '')

  return {
    id: sessionId,
    project: projectNameFromPath(projectPath),
    projectPath,
    startedAt,
    endedAt,
    durationMs,
    turns,
    stats: {
      userTurns: turns.filter(t => t.role === 'user').length,
      assistantTurns: turns.filter(t => t.role === 'assistant').length,
      toolCallCount,
      toolBreakdown,
      totalTextLength,
      usage,
      modelUsage,
      peakContextTokens,
      contextLimit: has1MContext ? 1_000_000 : 200_000,
      totalThinkingBlocks: turns.reduce((sum, t) => sum + t.thinkingBlocks, 0),
    },
  }
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

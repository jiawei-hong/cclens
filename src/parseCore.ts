import type { RawEntry, Session, Turn, ToolCall, ContentBlock, AggregatedUsage } from './types'

// ── Content helpers ───────────────────────────────────────────────────────────

export function extractText(content: string | ContentBlock[]): string {
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

export function projectNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// ── Active duration ───────────────────────────────────────────────────────────
// Sums only gaps < 5 min between consecutive turns; longer gaps are idle time.

const IDLE_THRESHOLD_MS = 5 * 60 * 1000

export function activeDurationMs(sortedTimestamps: string[]): number {
  let total = 0
  for (let i = 1; i < sortedTimestamps.length; i++) {
    const gap = new Date(sortedTimestamps[i]!).getTime() - new Date(sortedTimestamps[i - 1]!).getTime()
    if (gap < IDLE_THRESHOLD_MS) total += gap
  }
  return total
}

// ── Core parser ───────────────────────────────────────────────────────────────

export function parseRawJsonl(rawText: string, sessionId: string, projectPath: string): Session | null {
  const entries: RawEntry[] = []
  for (const line of rawText.trim().split('\n')) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }

  const messageEntries = entries.filter(e => e.type === 'user' || e.type === 'assistant')
  if (messageEntries.length === 0) return null

  // Build tool result map — captures error flag and timestamp for duration
  const toolResults: Record<string, { text: string; isError: boolean; resultAt: string }> = {}
  for (const entry of messageEntries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      const b = block as { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
      const text = typeof b.content === 'string' ? b.content : extractText(b.content)
      toolResults[b.tool_use_id] = { text: text.slice(0, 500), isError: b.is_error === true, resultAt: entry.timestamp }
    }
  }

  // Build turns
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
    turns.push({ uuid: entry.uuid, role, timestamp: entry.timestamp, text: text.slice(0, 2000), toolCalls, thinkingBlocks })
  }

  if (turns.length === 0) return null

  const timestamps = turns.map(t => t.timestamp).sort()
  const startedAt = timestamps[0]!
  const endedAt = timestamps[timestamps.length - 1]!
  const durationMs = activeDurationMs(timestamps)

  // Use cwd from first entry that has it
  const cwd = entries.find(e => e.cwd)?.cwd
  const resolvedPath = cwd ?? projectPath
  const gitBranch = entries.find(e => e.gitBranch)?.gitBranch

  // Breakdown
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

  // Usage + context series
  const usage: AggregatedUsage = { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }
  const modelUsage: Record<string, AggregatedUsage> = {}
  let peakContextTokens = 0
  let has1MContext = false
  const contextSeries: { ts: string; tokens: number }[] = []

  for (const entry of messageEntries) {
    if (entry.type !== 'assistant') continue
    const u = entry.message?.usage
    if (!u) continue
    const input = u.input_tokens ?? 0
    const output = u.output_tokens ?? 0
    const ccIn = u.cache_creation_input_tokens ?? 0
    const crIn = u.cache_read_input_tokens ?? 0
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
    const ctx = input + ccIn + crIn
    if (ctx > peakContextTokens) peakContextTokens = ctx
    contextSeries.push({ ts: entry.timestamp, tokens: ctx })
  }

  return {
    id: sessionId,
    project: projectNameFromPath(resolvedPath),
    projectPath: resolvedPath,
    gitBranch,
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
      contextSeries,
      totalThinkingBlocks: turns.reduce((sum, t) => sum + t.thinkingBlocks, 0),
    },
  }
}

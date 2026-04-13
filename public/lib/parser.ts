import type { Session, Turn, ToolCall, ContentBlock, RawEntry } from '../../src/types'

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

  // Build tool result map
  const toolResults: Record<string, string> = {}
  for (const entry of messageEntries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result') {
        const b = block as { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[] }
        const text = typeof b.content === 'string' ? b.content : extractText(b.content)
        toolResults[b.tool_use_id] = text.slice(0, 500)
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
    for (const tc of toolCalls) tc.result = toolResults[tc.id]
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
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime()

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

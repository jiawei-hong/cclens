import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RawEntry, Session, Turn, ToolCall, ContentBlock, AggregatedUsage } from './types'

const CLAUDE_DIR = join(process.env.HOME ?? '~', '.claude', 'projects')

export async function listProjectDirs(): Promise<string[]> {
  const entries = await readdir(CLAUDE_DIR)
  return entries
}

function projectPathFromDir(dir: string): string {
  return '/' + dir.replace(/^-/, '').replace(/-/g, '/')
}

function projectNameFromPath(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

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
      return { id: block.id, name: block.name, input: block.input, toolCalls: [] }
    })
}

function extractThinkingCount(content: ContentBlock[]): number {
  return content.filter(b => b.type === 'thinking').length
}

export async function parseSession(projectDir: string, filename: string): Promise<Session | null> {
  const filePath = join(CLAUDE_DIR, projectDir, filename)
  const raw = await readFile(filePath, 'utf-8')
  const lines = raw.trim().split('\n').filter(Boolean)

  const entries: RawEntry[] = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      // skip malformed lines
    }
  }

  const messageEntries = entries.filter(e => e.type === 'user' || e.type === 'assistant')
  if (messageEntries.length === 0) return null

  // Build tool result map: tool_use_id → result text
  const toolResults: Record<string, string> = {}
  for (const entry of messageEntries) {
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result') {
        const b = block as { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[] }
        const text = typeof b.content === 'string' ? b.content : extractText(b.content)
        toolResults[b.tool_use_id] = text.slice(0, 500) // cap result size
      }
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

    // Attach results to tool calls
    for (const tc of toolCalls) {
      tc.result = toolResults[tc.id]
    }

    // Skip pure meta/system messages
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

  // Stats
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

  // Use cwd from first entry that has it; fall back to parsing dir name
  const cwdEntry = entries.find(e => e.cwd)
  const projectPath = cwdEntry?.cwd ?? projectPathFromDir(projectDir)

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
    const contextThisTurn = input + ccIn + crIn
    if (contextThisTurn > peakContextTokens) peakContextTokens = contextThisTurn
  }

  return {
    id: filename.replace('.jsonl', ''),
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
    },
  }
}

export async function loadAllSessions(): Promise<Session[]> {
  const projectDirs = await listProjectDirs()
  const sessions: Session[] = []

  await Promise.all(
    projectDirs.map(async dir => {
      const dirPath = join(CLAUDE_DIR, dir)
      let files: string[]
      try {
        files = await readdir(dirPath)
      } catch {
        return
      }

      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
      await Promise.all(
        jsonlFiles.map(async f => {
          const session = await parseSession(dir, f).catch(() => null)
          if (session) sessions.push(session)
        })
      )
    })
  )

  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

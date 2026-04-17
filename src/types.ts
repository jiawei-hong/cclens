export type EntryType = 'user' | 'assistant' | 'permission-mode' | 'file-history-snapshot' | 'attachment'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string }

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export type RawEntry = {
  uuid: string
  parentUuid: string | null
  type: EntryType
  timestamp: string
  sessionId: string
  cwd?: string
  version?: string
  message?: {
    role: 'user' | 'assistant'
    model?: string
    content: string | ContentBlock[]
    usage?: TokenUsage
  }
}

// Parsed, enriched types used by the frontend

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  durationMs?: number
}

export type Turn = {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: string
  text: string
  toolCalls: ToolCall[]
  thinkingBlocks: number
}

export type Session = {
  id: string
  project: string
  projectPath: string
  startedAt: string
  endedAt: string
  durationMs: number
  turns: Turn[]
  stats: SessionStats
}

export type AggregatedUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
}

export type SessionStats = {
  userTurns: number
  assistantTurns: number
  toolCallCount: number
  toolBreakdown: Record<string, number>  // tool name → count
  totalTextLength: number
  usage: AggregatedUsage
  modelUsage: Record<string, AggregatedUsage>  // model name → usage
}

export type ProjectSummary = {
  project: string
  projectPath: string
  sessionCount: number
  lastActiveAt: string
  totalToolCalls: number
  topTools: { name: string; count: number }[]
}

export type SearchResult = {
  sessionId: string
  project: string
  turnUuid: string
  role: 'user' | 'assistant'
  timestamp: string
  snippet: string       // surrounding text with match highlighted
  matchIndex: number
}

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference' | 'other'

export type MemoryEntry = {
  projectSlug: string     // folder name as-is, e.g. "-Users-jiawei-Developers-cclens"
  projectName: string     // derived display name, last slug segment
  fileName: string        // e.g. "MEMORY.md" or "feedback_foo.md"
  isIndex: boolean        // true when fileName === "MEMORY.md"
  name?: string           // from frontmatter
  description?: string    // from frontmatter
  type: MemoryEntryType   // from frontmatter; "other" when unknown / missing
  body: string            // markdown body (without frontmatter)
  lastModified: number    // ms epoch, from File.lastModified
}

export type EntryType = 'user' | 'assistant' | 'permission-mode' | 'file-history-snapshot' | 'attachment'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[] }
  | { type: 'thinking'; thinking: string }

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
    content: string | ContentBlock[]
  }
}

// Parsed, enriched types used by the frontend

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
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

export type SessionStats = {
  userTurns: number
  assistantTurns: number
  toolCallCount: number
  toolBreakdown: Record<string, number>  // tool name → count
  totalTextLength: number
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

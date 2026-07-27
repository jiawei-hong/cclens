export type EntryType =
  | 'user' | 'assistant' | 'system' | 'permission-mode' | 'file-history-snapshot' | 'attachment'
  | 'last-prompt' | 'mode' | 'ai-title' | 'queue-operation' | 'pr-link' | 'agent-name'
  | 'frame-link' | 'file-history-delta'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'fallback'; from?: { model?: string }; to?: { model?: string } }

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  speed?: string          // 'standard' | 'fast' — fast mode bills 2×
  service_tier?: string
}

export type PromptSource = 'typed' | 'system' | 'sdk' | 'suggestion_accepted' | 'queued'

export type RawEntry = {
  uuid: string
  parentUuid: string | null
  type: EntryType
  subtype?: string
  timestamp: string
  sessionId: string
  sessionKind?: string    // e.g. 'bg' for background sessions
  cwd?: string
  gitBranch?: string
  version?: string
  isSidechain?: boolean
  requestId?: string
  effort?: string         // assistant entries: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // user-entry provenance
  promptId?: string
  promptSource?: PromptSource
  origin?: { kind?: string }
  isMeta?: boolean
  interruptedMessageId?: string   // present when this user entry interrupted a running turn
  toolDenialKind?: string         // 'user-rejected' | 'permission-rule' | 'automode-blocked'
  // assistant-entry flags
  isApiErrorMessage?: boolean
  isAbortedMidStream?: boolean
  attributionSkill?: string
  attributionMcpServer?: string
  attributionPlugin?: string
  // system-entry payloads
  durationMs?: number      // subtype 'turn_duration'
  messageCount?: number
  compactMetadata?: { trigger: 'auto' | 'manual'; preTokens: number }
  // sidecar entry payloads
  aiTitle?: string         // type 'ai-title'
  lastPrompt?: string      // type 'last-prompt'
  agentName?: string       // type 'agent-name'
  prNumber?: number        // type 'pr-link'
  prUrl?: string
  prRepository?: string
  permissionMode?: string  // type 'permission-mode' entries and user entries
  message?: {
    role: 'user' | 'assistant'
    id?: string            // API message id — repeats across entries of one response; dedupe usage on it
    model?: string
    content: string | ContentBlock[]
    usage?: TokenUsage
    stop_reason?: string | null
    isCompactSummary?: boolean
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
  // assistant-turn extras (optional — absent on sessions parsed by older versions)
  model?: string
  effort?: string
  stopReason?: string
  apiError?: boolean
  // user-turn extras
  promptSource?: PromptSource
  isMeta?: boolean
  interrupted?: boolean    // this user turn interrupted a running assistant turn
}

// Aggregated stats for the subagent transcripts under
// <project>/<sessionId>/subagents/agent-*.jsonl — attached to the parent session.
export type SubagentStats = {
  count: number            // number of subagent transcripts
  toolCallCount: number
  usage: AggregatedUsage
  modelUsage: Record<string, AggregatedUsage>
}

export type Session = {
  id: string
  project: string
  projectPath: string
  gitBranch?: string
  title?: string           // from 'ai-title' sidecar entry
  agentName?: string       // from 'agent-name' sidecar entry
  sessionKind?: string     // e.g. 'bg' for background sessions
  prLinks?: { number: number; url: string; repository: string }[]
  startedAt: string
  endedAt: string
  durationMs: number
  turns: Turn[]
  stats: SessionStats
  subagents?: SubagentStats
}

export type AggregatedUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number   // total cache-creation tokens (5m + 1h)
  cacheCreate1hTokens: number // portion of cacheCreateTokens billed at 2× (1h TTL), 0 if unknown
  cacheReadTokens: number
}

export type CompactionEvent = {
  timestamp: string
  trigger: 'auto' | 'manual'
  preTokens: number
}

export type OverEditingStats = {
  editWithoutReadCount: number  // edits to files not read in same/prior assistant turn
  rapidIterationFiles: number   // files edited 3+ times within 5 min window
  editToReadRatio: number       // (Edit+Write) / max(1, Read+Grep+Glob)
}

export type SessionStats = {
  userTurns: number
  assistantTurns: number
  apiTurns?: number           // unique API responses (deduped by message.id) — assistantTurns counts JSONL entries
  toolCallCount: number
  toolBreakdown: Record<string, number>  // tool name → count
  totalTextLength: number
  usage: AggregatedUsage
  modelUsage: Record<string, AggregatedUsage>  // model name → usage; fast-mode usage keyed as `<model>[fast]`
  peakContextTokens: number   // max (input + cache_read + cache_create) across assistant turns
  contextLimit: number        // 1M if a [1m] model was used or observed context exceeded 200K, else 200K
  contextSeries: { ts: string; tokens: number }[]  // per-API-response context size (deduped)
  totalThinkingBlocks: number // sum of thinkingBlocks across all assistant turns
  compactionEvents: CompactionEvent[]
  overEditing: OverEditingStats
  // optional — absent on sessions parsed by older versions
  effortCounts?: Record<string, number>  // effort level → unique API responses at that level
  apiErrorCount?: number      // assistant entries flagged isApiErrorMessage
  interruptCount?: number     // user entries with interruptedMessageId (plus legacy text markers)
  toolDenialCount?: number    // user entries with toolDenialKind
  apiDurationMsTotal?: number // sum of system/turn_duration durationMs
  modelFallbackCount?: number // system model_*fallback events
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

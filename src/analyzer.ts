import type { Session, ProjectSummary, AggregatedUsage } from './types'

export function summarizeProjects(sessions: Session[]): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>()

  for (const s of sessions) {
    const existing = map.get(s.project)
    const toolBreakdown = s.stats.toolBreakdown

    if (!existing) {
      map.set(s.project, {
        project: s.project,
        projectPath: s.projectPath,
        sessionCount: 1,
        lastActiveAt: s.endedAt,
        totalToolCalls: s.stats.toolCallCount,
        topTools: topN(toolBreakdown, 5),
      })
    } else {
      existing.sessionCount++
      existing.totalToolCalls += s.stats.toolCallCount
      if (s.endedAt > existing.lastActiveAt) existing.lastActiveAt = s.endedAt

      // Merge tool breakdown
      for (const [tool, count] of Object.entries(toolBreakdown)) {
        const found = existing.topTools.find(t => t.name === tool)
        if (found) found.count += count
        else existing.topTools.push({ name: tool, count })
      }
      existing.topTools = topN(
        Object.fromEntries(existing.topTools.map(t => [t.name, t.count])),
        5
      )
    }
  }

  return [...map.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
}

export function globalToolStats(sessions: Session[]): { name: string; count: number }[] {
  const totals: Record<string, number> = {}
  for (const s of sessions) {
    for (const [tool, count] of Object.entries(s.stats.toolBreakdown)) {
      totals[tool] = (totals[tool] ?? 0) + count
    }
  }
  return topN(totals, 20)
}

export function activityByDay(sessions: Session[]): { date: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const s of sessions) {
    const date = s.startedAt.slice(0, 10) // YYYY-MM-DD
    counts[date] = (counts[date] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function activityByHour(sessions: Session[]): { hour: number; count: number }[] {
  const counts: Record<number, number> = {}
  for (let h = 0; h < 24; h++) counts[h] = 0
  for (const s of sessions) {
    const hour = new Date(s.startedAt).getHours()
    counts[hour] = (counts[hour] ?? 0) + 1
  }
  return Object.entries(counts).map(([h, count]) => ({ hour: Number(h), count }))
}

export type SessionDepthStats = {
  avgDurationMs: number
  avgToolCalls: number
  avgTurns: number
  longestSession: Session | null
  deepestSession: Session | null  // most turns
}

export function sessionDepthStats(sessions: Session[]): SessionDepthStats {
  if (sessions.length === 0) {
    return { avgDurationMs: 0, avgToolCalls: 0, avgTurns: 0, longestSession: null, deepestSession: null }
  }
  const avgDurationMs = sessions.reduce((s, x) => s + x.durationMs, 0) / sessions.length
  const avgToolCalls = sessions.reduce((s, x) => s + x.stats.toolCallCount, 0) / sessions.length
  const avgTurns = sessions.reduce((s, x) => s + x.turns.length, 0) / sessions.length
  const longestSession = sessions.reduce((a, b) => a.durationMs > b.durationMs ? a : b)
  const deepestSession = sessions.reduce((a, b) => a.turns.length > b.turns.length ? a : b)
  return { avgDurationMs, avgToolCalls, avgTurns, longestSession, deepestSession }
}


export type SessionType = 'coding' | 'debugging' | 'research' | 'exploration' | 'conversation'

export function classifySession(session: Session): SessionType {
  const tools = session.stats.toolBreakdown
  const total = session.stats.toolCallCount
  if (total < 3) return 'conversation'

  const pct = (name: string) => ((tools[name] ?? 0) / total) * 100
  const webScore   = pct('WebSearch') + pct('WebFetch')
  const editScore  = pct('Edit') + pct('Write')
  const bashScore  = pct('Bash')
  const readScore  = pct('Read') + pct('Grep') + pct('Glob')

  if (webScore  > 20) return 'research'
  if (bashScore > 25 && readScore > 15) return 'debugging'
  if (editScore > 25) return 'coding'
  if (readScore > 40) return 'exploration'
  return 'conversation'
}

export function taskBreakdown(sessions: Session[]): { type: SessionType; count: number }[] {
  const counts: Record<SessionType, number> = { coding: 0, debugging: 0, research: 0, exploration: 0, conversation: 0 }
  for (const s of sessions) counts[classifySession(s)]++
  return (Object.entries(counts) as [SessionType, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }))
}

export type MonthStats = {
  sessions: number
  toolCalls: number
  activeDays: number
  avgDurationMs: number
  contextWasteChars: number
  skillInvocations: number
  costUSD: number
}
export type TrendStats  = { thisMonth: MonthStats; lastMonth: MonthStats; label: string; lastLabel: string }

const ANTI_PATTERN_IDS = new Set(['grep', 'find', 'cat', 'ls', 'echo_write', 'sed', 'awk'])
const ANTI_PATTERN_REGEXES = [
  /^\s*(grep|rg|ripgrep)\s/,
  /^\s*find\s/,
  /^\s*(cat|head|tail)\s/,
  /^\s*ls(\s|$)/,
  /^\s*echo\s+.*>>?/,
  /^\s*sed\s/,
  /^\s*awk\s/,
]
const BUILT_IN_CMD_SET = new Set([
  '/clear', '/exit', '/compact', '/help', '/init', '/plugin', '/reload-plugins',
  '/status', '/doctor', '/model', '/fast', '/memory', '/config', '/resume',
  '/bug', '/login', '/logout', '/pr-comments', '/vim', '/terminal-setup',
  '/cost', '/diff', '/review', '/settings',
])

function sessionContextWasteChars(s: Session): number {
  let chars = 0
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== 'Bash') continue
      const cmd = (tc.input['command'] as string | undefined) ?? ''
      const lines = cmd.split(/\n|&&|\|/).map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        if (ANTI_PATTERN_REGEXES.some(r => r.test(line))) {
          chars += tc.result?.length ?? 0
          break
        }
      }
    }
  }
  return chars
}

function sessionSkillInvocations(s: Session): number {
  let count = 0
  for (const turn of s.turns) {
    if (turn.role !== 'user') continue
    const matches = [...turn.text.matchAll(/<command-name>([^<]+)<\/command-name>/g)]
    for (const m of matches) {
      const cmd = m[1]?.trim() ?? ''
      if (cmd && !BUILT_IN_CMD_SET.has(cmd)) count++
    }
  }
  return count
}

export function trendStats(sessions: Session[]): TrendStats {
  const now = new Date()
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)

  const thisMonthSessions = sessions.filter(s => s.startedAt.slice(0, 10) >= thisStart)
  const lastMonthSessions = sessions.filter(s => {
    const d = s.startedAt.slice(0, 10)
    return d >= lastStart && d < thisStart
  })

  const toStats = (ss: Session[]): MonthStats => ({
    sessions: ss.length,
    toolCalls: ss.reduce((sum, s) => sum + s.stats.toolCallCount, 0),
    activeDays: new Set(ss.map(s => s.startedAt.slice(0, 10))).size,
    avgDurationMs: ss.length === 0 ? 0 : ss.reduce((sum, s) => sum + s.durationMs, 0) / ss.length,
    contextWasteChars: ss.reduce((sum, s) => sum + sessionContextWasteChars(s), 0),
    skillInvocations: ss.reduce((sum, s) => sum + sessionSkillInvocations(s), 0),
    costUSD: ss.reduce((sum, s) => sum + sessionCostUSD(s), 0),
  })

  const monthLabel = (offset: number) =>
    new Date(now.getFullYear(), now.getMonth() + offset, 1)
      .toLocaleString('en-US', { month: 'long' })

  return {
    thisMonth: toStats(thisMonthSessions),
    lastMonth: toStats(lastMonthSessions),
    label: monthLabel(0),
    lastLabel: monthLabel(-1),
  }
}


function topN(map: Record<string, number>, n: number): { name: string; count: number }[] {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

// ── Bash anti-pattern analysis ────────────────────────────────────────────────

export type BashAntiPattern = {
  id: string
  bashCmd: string          // what they typed (display label)
  betterTool: string       // recommended dedicated tool
  tip: string              // one-line explanation
  count: number
  totalResultChars: number // total chars dumped into context by these calls
  avgResultChars: number   // average chars per call
}

const ANTI_PATTERN_DEFS: { id: string; regex: RegExp; bashCmd: string; betterTool: string; tip: string }[] = [
  { id: 'grep', regex: /^\s*(grep|rg|ripgrep)\s/, bashCmd: 'grep / rg', betterTool: 'Grep', tip: 'Grep returns only matching lines; bash grep often returns full-file noise' },
  { id: 'find', regex: /^\s*find\s/, bashCmd: 'find', betterTool: 'Glob', tip: 'Glob returns a structured list; bash find output includes paths, permissions, verbose errors' },
  { id: 'cat', regex: /^\s*(cat|head|tail)\s/, bashCmd: 'cat / head / tail', betterTool: 'Read', tip: 'Read supports offset/limit — cat dumps the entire file into context every time' },
  { id: 'ls', regex: /^\s*ls(\s|$)/, bashCmd: 'ls', betterTool: 'Glob', tip: 'Glob returns clean paths; ls includes colors, permissions, and formatting noise' },
  { id: 'echo_write', regex: /^\s*echo\s+.*>>?/, bashCmd: 'echo >', betterTool: 'Write / Edit', tip: 'Write tool creates files without echoing content back into context' },
  { id: 'sed', regex: /^\s*sed\s/, bashCmd: 'sed', betterTool: 'Edit', tip: 'Edit does targeted replacement with no result output; sed echoes the whole file' },
  { id: 'awk', regex: /^\s*awk\s/, bashCmd: 'awk', betterTool: 'Read + logic', tip: 'Read the file first, then process inline — awk outputs unpredictable result sizes' },
]

function bashLines(cmd: string): string[] {
  return cmd.split(/\n|&&|\|/).map(l => l.trim()).filter(Boolean)
}

export function bashAntiPatterns(sessions: Session[]): BashAntiPattern[] {
  const counts: Record<string, number> = {}
  const resultChars: Record<string, number> = {}
  for (const p of ANTI_PATTERN_DEFS) { counts[p.id] = 0; resultChars[p.id] = 0 }

  for (const s of sessions) {
    for (const turn of s.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.name !== 'Bash') continue
        const cmd = (tc.input['command'] as string | undefined) ?? ''
        for (const line of bashLines(cmd)) {
          for (const p of ANTI_PATTERN_DEFS) {
            if (p.regex.test(line)) {
              counts[p.id] = (counts[p.id] ?? 0) + 1
              resultChars[p.id] = (resultChars[p.id] ?? 0) + (tc.result?.length ?? 0)
              break
            }
          }
        }
      }
    }
  }

  return ANTI_PATTERN_DEFS
    .map(p => ({
      id: p.id, bashCmd: p.bashCmd, betterTool: p.betterTool, tip: p.tip,
      count: counts[p.id] ?? 0,
      totalResultChars: resultChars[p.id] ?? 0,
      avgResultChars: (counts[p.id] ?? 0) > 0 ? Math.round((resultChars[p.id] ?? 0) / (counts[p.id] ?? 1)) : 0,
    }))
    .filter(p => p.count > 0)
    .sort((a, b) => b.totalResultChars - a.totalResultChars)
}

// ── Bash command category breakdown ──────────────────────────────────────────

export type BashCategory = { label: string; count: number }

const BASH_CATEGORY_DEFS: { label: string; regex: RegExp }[] = [
  { label: 'git',             regex: /^\s*git\s/ },
  { label: 'npm/yarn/pnpm/bun', regex: /^\s*(npm|yarn|pnpm|bun)\s/ },
  { label: 'docker',          regex: /^\s*(docker|docker-compose|docker compose)\s/ },
  { label: 'test runners',    regex: /^\s*(jest|vitest|pytest|go test|cargo test|mocha|phpunit)\b/ },
  { label: 'curl/wget',       regex: /^\s*(curl|wget)\s/ },
  { label: 'make/cmake',      regex: /^\s*(make|cmake)\b/ },
  { label: 'file search',     regex: /^\s*(grep|rg|find|ls)\s/ },
  { label: 'file read',       regex: /^\s*(cat|head|tail|sed|awk)\s/ },
]

export function bashCommandBreakdown(sessions: Session[]): BashCategory[] {
  const counts: Record<string, number> = { other: 0 }
  for (const c of BASH_CATEGORY_DEFS) counts[c.label] = 0

  for (const s of sessions) {
    for (const turn of s.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.name !== 'Bash') continue
        const cmd = (tc.input['command'] as string | undefined) ?? ''
        for (const line of bashLines(cmd)) {
          let matched = false
          for (const c of BASH_CATEGORY_DEFS) {
            if (c.regex.test(line)) { counts[c.label] = (counts[c.label] ?? 0) + 1; matched = true; break }
          }
          if (!matched) counts['other'] = (counts['other'] ?? 0) + 1
        }
      }
    }
  }

  return [
    ...BASH_CATEGORY_DEFS.map(c => ({ label: c.label, count: counts[c.label] ?? 0 })),
    { label: 'other', count: counts['other'] ?? 0 },
  ]
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
}

// ── Skills & Agents analysis ──────────────────────────────────────────────────

// Built-in Claude Code commands that are not user-invocable skills
const BUILT_IN_COMMANDS = new Set([
  '/clear', '/exit', '/compact', '/help', '/init', '/plugin', '/reload-plugins',
  '/status', '/doctor', '/model', '/fast', '/memory', '/config', '/resume',
  '/bug', '/login', '/logout', '/pr-comments', '/vim', '/terminal-setup',
  '/cost', '/diff', '/review', '/settings',
])

export type SkillUsage = {
  name: string       // e.g. 'retro', 'create-pr'
  count: number
  projectCount: number
}

export function skillUsageStats(sessions: Session[]): SkillUsage[] {
  const counts: Record<string, number> = {}
  const projectSets: Record<string, Set<string>> = {}

  for (const s of sessions) {
    for (const turn of s.turns) {
      if (turn.role !== 'user') continue
      const matches = [...turn.text.matchAll(/<command-name>([^<]+)<\/command-name>/g)]
      for (const m of matches) {
        const cmd = m[1]?.trim() ?? ''
        if (!cmd) continue
        if (BUILT_IN_COMMANDS.has(cmd)) continue
        counts[cmd] = (counts[cmd] ?? 0) + 1
        if (!projectSets[cmd]) projectSets[cmd] = new Set()
        projectSets[cmd].add(s.project)
      }
    }
  }

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count, projectCount: projectSets[name]?.size ?? 0 }))
    .sort((a, b) => b.count - a.count)
}

// ── Skill gap detection ───────────────────────────────────────────────────────

export type SkillGap = {
  skill: string         // e.g. '/commit'
  description: string   // what the skill does
  howToUse: string      // short usage hint
  evidence: string      // why we're recommending it
  signalCount: number   // strength of signal
}

function countBashMatches(sessions: Session[], pattern: RegExp): number {
  let n = 0
  for (const s of sessions)
    for (const turn of s.turns)
      for (const tc of turn.toolCalls)
        if (tc.name === 'Bash' && pattern.test((tc.input['command'] as string) ?? ''))
          n++
  return n
}

function countTextMatches(sessions: Session[], pattern: RegExp): number {
  let n = 0
  for (const s of sessions)
    for (const turn of s.turns)
      if (turn.role === 'user' && pattern.test(turn.text))
        n++
  return n
}

export function skillGaps(sessions: Session[], usedSkills: SkillUsage[]): SkillGap[] {
  const usedNames = new Set(usedSkills.map(s => s.name))
  const usedCount = (skill: string) => usedSkills.find(s => s.name === skill)?.count ?? 0
  const gaps: SkillGap[] = []

  // /commit — manual git commit via bash
  const gitCommits = countBashMatches(sessions, /git\s+commit/)
  if (gitCommits > 5 && usedCount('commit') === 0) {
    gaps.push({
      skill: '/commit',
      description: 'Stages files and creates a well-formatted commit message automatically',
      howToUse: 'Type /commit at the end of a coding session',
      evidence: `${gitCommits} manual git commit calls detected, /commit never used`,
      signalCount: gitCommits,
    })
  }

  // /create-pr — manual git push + PR workflow
  const gitPush = countBashMatches(sessions, /git\s+push/)
  const prUsed = usedCount('create-pr')
  if (gitPush > prUsed * 3 + 3) {
    gaps.push({
      skill: '/create-pr',
      description: 'Creates a GitHub PR with structured title, summary, and test plan',
      howToUse: 'Type /create-pr after pushing a branch',
      evidence: `${gitPush} git push calls vs /create-pr used ${prUsed}×`,
      signalCount: gitPush,
    })
  }

  // /pr-review — PR review discussions without using the skill
  const prMentions = countTextMatches(sessions, /pull request|review this|LGTM|lgtm|code review/i)
  const reviewUsed = usedCount('pr-review')
  if (prMentions > reviewUsed * 2 + 2) {
    gaps.push({
      skill: '/pr-review',
      description: 'Runs a structured code review on the current PR or diff',
      howToUse: 'Type /pr-review <PR number or URL>',
      evidence: `${prMentions} review-related messages, /pr-review used ${reviewUsed}×`,
      signalCount: prMentions,
    })
  }

  // /simplify — heavy edit iteration (many Edits per session) without simplify
  const heavyEditSessions = sessions.filter(s => (s.stats.toolBreakdown['Edit'] ?? 0) > 15).length
  if (heavyEditSessions > 2 && !usedNames.has('simplify')) {
    gaps.push({
      skill: '/simplify',
      description: 'Reviews changed code for reuse, quality, and efficiency, then fixes issues',
      howToUse: 'Type /simplify after a round of heavy edits',
      evidence: `${heavyEditSessions} sessions with 15+ Edit calls, /simplify never used`,
      signalCount: heavyEditSessions,
    })
  }

  // /retro — retro-related text without using the skill
  const retroMentions = countTextMatches(sessions, /retrospective|weekly review|retro\b|monthly review/i)
  if (retroMentions > 1 && !usedNames.has('retro')) {
    gaps.push({
      skill: '/retro',
      description: 'Generates weekly/monthly/quarterly retrospective documents from your daily notes',
      howToUse: 'Type /retro to generate a retrospective for a time period',
      evidence: `${retroMentions} retro-related messages, /retro never used`,
      signalCount: retroMentions,
    })
  }

  return gaps.sort((a, b) => b.signalCount - a.signalCount)
}

// ── Agent breakdown ───────────────────────────────────────────────────────────

export type AgentTypeUsage = { type: string; count: number }

export function agentBreakdown(sessions: Session[]): AgentTypeUsage[] {
  const counts: Record<string, number> = {}
  for (const s of sessions)
    for (const turn of s.turns)
      for (const tc of turn.toolCalls)
        if (tc.name === 'Agent') {
          const type = (tc.input['subagent_type'] as string | undefined) ?? 'general-purpose'
          counts[type] = (counts[type] ?? 0) + 1
        }

  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
}

// ── Hot files ─────────────────────────────────────────────────────────────────

export type HotFile = {
  path: string
  fileName: string
  dir: string          // last 2 path segments before filename
  editCount: number
  writeCount: number
  totalOps: number
  sessionCount: number
  projectCount: number
}

export function hotFiles(sessions: Session[], limit = 15): HotFile[] {
  type Acc = { editCount: number; writeCount: number; sessions: Set<string>; projects: Set<string> }
  const map = new Map<string, Acc>()

  for (const s of sessions) {
    for (const turn of s.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.name !== 'Edit' && tc.name !== 'Write') continue
        const path = tc.input['file_path'] as string | undefined
        if (!path) continue
        let acc = map.get(path)
        if (!acc) { acc = { editCount: 0, writeCount: 0, sessions: new Set(), projects: new Set() }; map.set(path, acc) }
        if (tc.name === 'Edit') acc.editCount++
        else acc.writeCount++
        acc.sessions.add(s.id)
        acc.projects.add(s.project)
      }
    }
  }

  return [...map.entries()]
    .map(([path, acc]) => {
      const parts = path.split('/')
      const fileName = parts.pop() ?? path
      const dir = parts.slice(-2).join('/')
      return {
        path, fileName, dir,
        editCount: acc.editCount,
        writeCount: acc.writeCount,
        totalOps: acc.editCount + acc.writeCount,
        sessionCount: acc.sessions.size,
        projectCount: acc.projects.size,
      }
    })
    .sort((a, b) => b.totalOps - a.totalOps)
    .slice(0, limit)
}

// ── Cost & token usage ────────────────────────────────────────────────────────
// Public list prices per 1M tokens. Cache write = 1.25× input, cache read = 0.1× input.
// These are estimates — the displayed $ is a rough approximation, not the billed amount.
export type ModelPrice = { input: number; output: number; cacheCreate: number; cacheRead: number }
export const PRICING: Record<'opus' | 'sonnet' | 'haiku' | 'default', ModelPrice> = {
  opus:    { input: 15,   output: 75,   cacheCreate: 18.75, cacheRead: 1.5  },
  sonnet:  { input: 3,    output: 15,   cacheCreate: 3.75,  cacheRead: 0.3  },
  haiku:   { input: 0.8,  output: 4,    cacheCreate: 1.0,   cacheRead: 0.08 },
  default: { input: 3,    output: 15,   cacheCreate: 3.75,  cacheRead: 0.3  },
}

export function priceFor(model: string): ModelPrice {
  const m = model.toLowerCase()
  if (m.includes('opus'))   return PRICING.opus
  if (m.includes('haiku'))  return PRICING.haiku
  if (m.includes('sonnet')) return PRICING.sonnet
  return PRICING.default
}

export function costOfUsage(u: AggregatedUsage, model: string): number {
  const p = priceFor(model)
  return (
    (u.inputTokens       * p.input       +
     u.outputTokens      * p.output      +
     u.cacheCreateTokens * p.cacheCreate +
     u.cacheReadTokens   * p.cacheRead) / 1_000_000
  )
}

function sessionCostUSD(s: Session): number {
  let total = 0
  for (const [model, u] of Object.entries(s.stats.modelUsage)) total += costOfUsage(u, model)
  return total
}

export type TotalUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUSD: number
  cacheHitRate: number  // 0..1; cache_read / (cache_read + cache_create + input)
}

export function totalUsage(sessions: Session[]): TotalUsage {
  let input = 0, output = 0, cc = 0, cr = 0, cost = 0
  for (const s of sessions) {
    input  += s.stats.usage.inputTokens
    output += s.stats.usage.outputTokens
    cc     += s.stats.usage.cacheCreateTokens
    cr     += s.stats.usage.cacheReadTokens
    cost   += sessionCostUSD(s)
  }
  const denom = cr + cc + input
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreateTokens: cc,
    cacheReadTokens: cr,
    totalTokens: input + output + cc + cr,
    costUSD: cost,
    cacheHitRate: denom === 0 ? 0 : cr / denom,
  }
}

export type ModelUsageRow = {
  model: string
  shortLabel: string   // opus / sonnet / haiku / other — for color mapping
  versionLabel: string // e.g. "opus 4.7", "sonnet 4.5" — for display
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUSD: number
}

function shortModelLabel(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('opus'))   return 'opus'
  if (m.includes('haiku'))  return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  return 'other'
}

// Parses model IDs like "claude-opus-4-7", "claude-sonnet-4-5-20250219",
// "claude-opus-4-7[1m]" → "opus 4.7", "sonnet 4.5", "opus 4.7".
// Falls back to shortModelLabel when no version digits are present.
export function modelVersionLabel(model: string): string {
  const m = model.toLowerCase()
  const match = m.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/)
  if (match) return `${match[1]} ${match[2]}.${match[3]}`
  return shortModelLabel(model)
}

export function usageByModel(sessions: Session[]): ModelUsageRow[] {
  const map = new Map<string, AggregatedUsage>()
  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.stats.modelUsage)) {
      const acc = map.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }
      acc.inputTokens       += u.inputTokens
      acc.outputTokens      += u.outputTokens
      acc.cacheCreateTokens += u.cacheCreateTokens
      acc.cacheReadTokens   += u.cacheReadTokens
      map.set(model, acc)
    }
  }
  return [...map.entries()]
    .map(([model, u]) => ({
      model,
      shortLabel: shortModelLabel(model),
      versionLabel: modelVersionLabel(model),
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheCreateTokens: u.cacheCreateTokens,
      cacheReadTokens: u.cacheReadTokens,
      totalTokens: u.inputTokens + u.outputTokens + u.cacheCreateTokens + u.cacheReadTokens,
      costUSD: costOfUsage(u, model),
    }))
    .sort((a, b) => b.costUSD - a.costUSD)
}

export function dailyCost(sessions: Session[], days = 30): { date: string; costUSD: number }[] {
  const byDate = new Map<string, number>()
  for (const s of sessions) {
    const date = s.startedAt.slice(0, 10)
    byDate.set(date, (byDate.get(date) ?? 0) + sessionCostUSD(s))
  }
  const end = new Date()
  const out: { date: string; costUSD: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ date: key, costUSD: byDate.get(key) ?? 0 })
  }
  return out
}

// ── Tool error rates ──────────────────────────────────────────────────────────

export type ToolErrorRow = {
  name: string
  total: number
  errors: number
  errorRate: number  // 0..1
}

export type ToolErrorStats = {
  totalCalls: number
  totalErrors: number
  overallRate: number
  rows: ToolErrorRow[]   // only tools with at least one error, sorted by error count
}

export function toolErrorRates(sessions: Session[], minCalls = 3): ToolErrorStats {
  const totals: Record<string, { total: number; errors: number }> = {}
  for (const s of sessions) {
    for (const turn of s.turns) {
      for (const tc of turn.toolCalls) {
        const acc = totals[tc.name] ?? (totals[tc.name] = { total: 0, errors: 0 })
        acc.total++
        if (tc.isError) acc.errors++
      }
    }
  }
  const totalCalls = Object.values(totals).reduce((s, v) => s + v.total, 0)
  const totalErrors = Object.values(totals).reduce((s, v) => s + v.errors, 0)
  const rows: ToolErrorRow[] = Object.entries(totals)
    .filter(([, v]) => v.errors > 0 && v.total >= minCalls)
    .map(([name, v]) => ({ name, total: v.total, errors: v.errors, errorRate: v.errors / v.total }))
    .sort((a, b) => b.errors - a.errors)
  return {
    totalCalls,
    totalErrors,
    overallRate: totalCalls === 0 ? 0 : totalErrors / totalCalls,
    rows,
  }
}

// ── Activity calendar (zero-filled) ───────────────────────────────────────────

export type HeatmapCell = { date: string; count: number; dow: number; weekIndex: number }

/** Returns a zero-filled grid oldest→newest. `weeks` weeks back, ending on the
 *  Saturday of the current week so the last column is the "current" one. */
export function activityHeatmap(sessions: Session[], weeks = 14): HeatmapCell[] {
  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = s.startedAt.slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // End cell: Saturday of current week (dow 6); go forward to the end-of-week.
  const daysUntilSat = (6 - today.getDay() + 7) % 7
  const end = new Date(today)
  end.setDate(end.getDate() + daysUntilSat)
  const totalDays = weeks * 7
  const start = new Date(end)
  start.setDate(start.getDate() - (totalDays - 1))
  const out: HeatmapCell[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    out.push({
      date: key,
      count: counts.get(key) ?? 0,
      dow: d.getDay(),
      weekIndex: Math.floor(i / 7),
    })
  }
  return out
}


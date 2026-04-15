import type { Session, ProjectSummary } from './types'

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

export type MonthStats = { sessions: number; toolCalls: number; activeDays: number }
export type TrendStats  = { thisMonth: MonthStats; lastMonth: MonthStats; label: string; lastLabel: string }

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
              counts[p.id]++
              resultChars[p.id] += tc.result?.length ?? 0
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
      count: counts[p.id],
      totalResultChars: resultChars[p.id],
      avgResultChars: counts[p.id] > 0 ? Math.round(resultChars[p.id] / counts[p.id]) : 0,
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
            if (c.regex.test(line)) { counts[c.label]++; matched = true; break }
          }
          if (!matched) counts['other']++
        }
      }
    }
  }

  return [
    ...BASH_CATEGORY_DEFS.map(c => ({ label: c.label, count: counts[c.label] })),
    { label: 'other', count: counts['other'] },
  ]
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
}

import type { Session } from './types'
import { classifySession, sessionCostUSD, costOfUsage, type SessionType } from './analyzer'
import { sessionRecommendations } from './recommendations'

// ── User habits ─────────────────────────────────────────────────────────────
// The recommendations engine fires per-session. This module flips the lens
// onto the *user*: across all sessions, what fraction exhibit a bad habit?
// Each habit is a clear rate (badRate = 0..1) plus a one-line action hint,
// so the UI can render a traffic-light row per habit.

const SONNET_MODEL_ID = 'claude-sonnet-4-6'
const SOFT_TASK_TYPES: SessionType[] = ['conversation', 'exploration', 'research']

export type HabitStatus = 'good' | 'ok' | 'bad'

export type HabitBreakdownRow = {
  label: string
  value: string
  tone: 'danger' | 'warning' | 'neutral'
}

export type Habit = {
  id: 'model-discipline' | 'context-discipline' | 'commit-hygiene' | 'retry-discipline'
  title: string
  headline: string
  actionHint: string
  badRate: number
  sampleSize: number
  status: HabitStatus
  penaltyUSD?: number
  breakdown?: HabitBreakdownRow[]
}

export type HabitReport = {
  habits: Habit[]
  totalSessions: number
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusFromRate(badRate: number, sampleSize: number): HabitStatus {
  if (sampleSize < 3) return 'good'  // too few to judge
  if (badRate < 0.1) return 'good'
  if (badRate < 0.3) return 'ok'
  return 'bad'
}

function dominantModel(s: Session): string | null {
  let best: { model: string; tokens: number } | null = null
  for (const [model, u] of Object.entries(s.stats.modelUsage)) {
    const tokens = u.inputTokens + u.outputTokens + u.cacheCreateTokens + u.cacheReadTokens
    if (!best || tokens > best.tokens) best = { model, tokens }
  }
  return best?.model ?? null
}

function pctStr(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

function sessionInvokedSkill(s: Session, skill: string): boolean {
  const needle = `<command-name>${skill}</command-name>`
  for (const turn of s.turns) {
    if (turn.role === 'user' && turn.text.includes(needle)) return true
  }
  return false
}

function sessionHasBashMatch(s: Session, re: RegExp): boolean {
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== 'Bash') continue
      const cmd = (tc.input['command'] as string | undefined) ?? ''
      if (re.test(cmd)) return true
    }
  }
  return false
}

// ── Habit builders ──────────────────────────────────────────────────────────

function modelDiscipline(sessions: Session[]): Habit {
  const eligible = sessions.filter(s => SOFT_TASK_TYPES.includes(classifySession(s)))
  type Entry = { total: number; opus: number; penalty: number }
  const perType = new Map<SessionType, Entry>()
  let opusCount = 0
  let penaltyUSD = 0

  for (const s of eligible) {
    const tt = classifySession(s)
    const entry = perType.get(tt) ?? { total: 0, opus: 0, penalty: 0 }
    entry.total++
    const dom = dominantModel(s)
    if (dom && /opus/i.test(dom)) {
      entry.opus++
      opusCount++
      const current = sessionCostUSD(s)
      let sonnetCost = 0
      for (const u of Object.values(s.stats.modelUsage)) {
        sonnetCost += costOfUsage(u, SONNET_MODEL_ID)
      }
      const save = Math.max(0, current - sonnetCost)
      entry.penalty += save
      penaltyUSD += save
    }
    perType.set(tt, entry)
  }

  const badRate = eligible.length === 0 ? 0 : opusCount / eligible.length
  const breakdown: HabitBreakdownRow[] = []
  for (const tt of SOFT_TASK_TYPES) {
    const entry = perType.get(tt)
    if (!entry || entry.total === 0) continue
    const p = entry.opus / entry.total
    const label = `${tt[0]!.toUpperCase()}${tt.slice(1)}`
    const penaltyStr = entry.penalty >= 0.01 ? ` · ~$${entry.penalty.toFixed(2)} penalty` : ''
    breakdown.push({
      label,
      value: `Opus in ${entry.opus}/${entry.total} (${pctStr(entry.opus, entry.total)})${penaltyStr}`,
      tone: p >= 0.5 ? 'danger' : p >= 0.25 ? 'warning' : 'neutral',
    })
  }

  return {
    id: 'model-discipline',
    title: 'Model discipline',
    headline: eligible.length === 0
      ? 'No soft-task sessions yet'
      : opusCount === 0
        ? `You picked the right model size for all ${eligible.length} soft-task sessions`
        : `Opus on ${opusCount}/${eligible.length} soft-task sessions (${pctStr(opusCount, eligible.length)})`,
    actionHint: 'Run /model sonnet before conversation, exploration, or research sessions — Opus reasoning is overkill there.',
    badRate,
    sampleSize: eligible.length,
    status: statusFromRate(badRate, eligible.length),
    penaltyUSD: penaltyUSD > 0 ? penaltyUSD : undefined,
    breakdown: breakdown.length > 0 ? breakdown : undefined,
  }
}

function contextDiscipline(sessions: Session[]): Habit {
  const withLimit = sessions.filter(s => s.stats.contextLimit > 0)
  const hot = withLimit.filter(s => s.stats.peakContextTokens / s.stats.contextLimit > 0.8)
  const badRate = withLimit.length === 0 ? 0 : hot.length / withLimit.length

  return {
    id: 'context-discipline',
    title: 'Context discipline',
    headline: withLimit.length === 0
      ? 'No context data yet'
      : hot.length === 0
        ? `All ${withLimit.length} sessions stayed well under the context limit`
        : `${hot.length}/${withLimit.length} sessions ran past 80% of the limit (${pctStr(hot.length, withLimit.length)})`,
    actionHint: 'When peak context climbs past ~70%, split the work into a new session — cache warms faster from a fresh prefix.',
    badRate,
    sampleSize: withLimit.length,
    status: statusFromRate(badRate, withLimit.length),
  }
}

function commitHygiene(sessions: Session[]): Habit {
  type Bucket = { manual: boolean; skill: boolean }
  const committers: Bucket[] = []
  for (const s of sessions) {
    const manual = sessionHasBashMatch(s, /git\s+commit/)
    const skill = sessionInvokedSkill(s, 'commit') || sessionInvokedSkill(s, '/commit')
    if (manual || skill) committers.push({ manual, skill })
  }
  const manualOnly = committers.filter(b => b.manual && !b.skill).length
  const skillUsed  = committers.filter(b => b.skill).length
  const badRate = committers.length === 0 ? 0 : manualOnly / committers.length

  const breakdown: HabitBreakdownRow[] = committers.length > 0
    ? [
        { label: 'Manual `git commit`', value: `${manualOnly}/${committers.length}`, tone: manualOnly > committers.length / 2 ? 'danger' : 'warning' },
        { label: '/commit skill',       value: `${skillUsed}/${committers.length}`,  tone: 'neutral' },
      ]
    : []

  return {
    id: 'commit-hygiene',
    title: 'Commit hygiene',
    headline: committers.length === 0
      ? 'No commits detected in recent sessions'
      : manualOnly === 0
        ? `All ${committers.length} committing sessions used /commit`
        : `${manualOnly}/${committers.length} committing sessions went manual (${pctStr(manualOnly, committers.length)})`,
    actionHint: 'Type /commit at the end of a coding session — it stages, writes the message, and handles hook failures.',
    badRate,
    sampleSize: committers.length,
    status: statusFromRate(badRate, committers.length),
    breakdown: breakdown.length > 0 ? breakdown : undefined,
  }
}

function retryDiscipline(sessions: Session[]): Habit {
  const relevant = sessions.filter(s => s.stats.toolCallCount >= 5)
  const thrashers = relevant.filter(s =>
    sessionRecommendations(s).recommendations.some(r => r.id === 'thrashing')
  )
  const badRate = relevant.length === 0 ? 0 : thrashers.length / relevant.length

  return {
    id: 'retry-discipline',
    title: 'Retry discipline',
    headline: relevant.length === 0
      ? 'No tool-heavy sessions yet'
      : thrashers.length === 0
        ? `No retry-thrashing detected across ${relevant.length} sessions`
        : `${thrashers.length}/${relevant.length} sessions thrashed on a failing call (${pctStr(thrashers.length, relevant.length)})`,
    actionHint: 'When a tool call fails twice with the same input, stop and re-read the error before a third try.',
    badRate,
    sampleSize: relevant.length,
    status: statusFromRate(badRate, relevant.length),
  }
}

// ── Public entry ────────────────────────────────────────────────────────────

export function userHabits(sessions: Session[]): HabitReport {
  return {
    habits: [
      modelDiscipline(sessions),
      contextDiscipline(sessions),
      commitHygiene(sessions),
      retryDiscipline(sessions),
    ],
    totalSessions: sessions.length,
  }
}

// ── Trend: last N days vs prior N days ──────────────────────────────────────
// Tracks whether each habit's bad-rate is improving, worsening, or stable so
// the UI can reinforce adoption ("you went from 60% to 30% in 14 days").

export type HabitTrendDirection = 'improving' | 'worsening' | 'stable' | 'insufficient-data'

export type HabitTrend = {
  direction: HabitTrendDirection
  recentBadRate: number
  baselineBadRate: number
  recentSampleSize: number
  baselineSampleSize: number
  deltaPp: number        // recent - baseline, in percentage points
}

export type HabitWithTrend = Habit & { trend?: HabitTrend }

export type HabitReportWithTrend = {
  habits: HabitWithTrend[]
  totalSessions: number
  recentWindowDays: number
  baselineWindowDays: number
}

const RECENT_WINDOW_DAYS = 14
const BASELINE_WINDOW_DAYS = 14
const MIN_TREND_SAMPLE = 3
const MIN_TREND_DELTA_PP = 10  // < 10 percentage points = stable

export function userHabitsTrend(sessions: Session[], now: Date = new Date()): HabitReportWithTrend {
  const nowMs = now.getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const recentCutoff   = nowMs - RECENT_WINDOW_DAYS * dayMs
  const baselineCutoff = nowMs - (RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS) * dayMs

  const recentSessions: Session[] = []
  const baselineSessions: Session[] = []
  for (const s of sessions) {
    const t = new Date(s.startedAt).getTime()
    if (t >= recentCutoff) recentSessions.push(s)
    else if (t >= baselineCutoff) baselineSessions.push(s)
  }

  const current = userHabits(sessions).habits
  const recent   = userHabits(recentSessions).habits
  const baseline = userHabits(baselineSessions).habits

  const withTrend: HabitWithTrend[] = current.map(h => {
    const r = recent.find(x => x.id === h.id)
    const b = baseline.find(x => x.id === h.id)
    if (!r || !b) return h
    const deltaPp = (r.badRate - b.badRate) * 100
    let direction: HabitTrendDirection
    if (r.sampleSize < MIN_TREND_SAMPLE || b.sampleSize < MIN_TREND_SAMPLE) {
      direction = 'insufficient-data'
    } else if (Math.abs(deltaPp) < MIN_TREND_DELTA_PP) {
      direction = 'stable'
    } else if (deltaPp < 0) {
      direction = 'improving'
    } else {
      direction = 'worsening'
    }
    return {
      ...h,
      trend: {
        direction,
        recentBadRate: r.badRate,
        baselineBadRate: b.badRate,
        recentSampleSize: r.sampleSize,
        baselineSampleSize: b.sampleSize,
        deltaPp,
      },
    }
  })

  return {
    habits: withTrend,
    totalSessions: sessions.length,
    recentWindowDays: RECENT_WINDOW_DAYS,
    baselineWindowDays: BASELINE_WINDOW_DAYS,
  }
}

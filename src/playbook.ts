import type { Session } from './types'
import { classifySession, sessionCostUSD, type SessionType } from './analyzer'

// ── Task-type playbook ──────────────────────────────────────────────────────
// For each task type, rank the user's own sessions by a quality score, then
// compare the top 20% against the bottom 20%. The biggest gaps become tips:
// "top coding sessions cache 78% vs 31% for bottom — keep the prefix stable."
// This lets users learn from their own best work instead of generic advice.

const MIN_SAMPLE = 5          // fewer than this → no meaningful top/bottom split
const BUCKET_FRACTION = 0.2   // top/bottom 20%
const MIN_BUCKET = 1          // ensures at least 1 session per bucket
const MAX_TIPS_PER_TYPE = 3   // biggest deltas only

export type PlaybookMetricId =
  | 'cache-hit'
  | 'cost-per-turn'
  | 'error-rate'
  | 'context-peak'
  | 'tool-per-turn'

type MetricDef = {
  id: PlaybookMetricId
  label: string
  unit: '%' | '$' | 'calls'
  higherIsBetter: boolean
  action: string
  format: (v: number) => string
  extract: (s: Session) => number | null    // null = skip this session for this metric
}

const fmtPct     = (v: number) => `${Math.round(v * 100)}%`
const fmtUSD4    = (v: number) => v >= 0.1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`
const fmtCalls   = (v: number) => v.toFixed(1)

const METRICS: MetricDef[] = [
  {
    id: 'cache-hit',
    label: 'Cache hit',
    unit: '%',
    higherIsBetter: true,
    action: 'Keep the stable prefix (CLAUDE.md, system prompt, project docs) at the top and avoid editing it mid-session.',
    format: fmtPct,
    extract: (s) => {
      const { inputTokens, cacheCreateTokens, cacheReadTokens } = s.stats.usage
      const denom = inputTokens + cacheCreateTokens + cacheReadTokens
      return denom < 5000 ? null : cacheReadTokens / denom
    },
  },
  {
    id: 'cost-per-turn',
    label: 'Cost/turn',
    unit: '$',
    higherIsBetter: false,
    action: 'Split large tasks into smaller sessions and pick Sonnet for soft-task work — Opus reasoning is overkill for exploration and chat.',
    format: fmtUSD4,
    extract: (s) => {
      const turns = s.turns.length
      return turns === 0 ? null : sessionCostUSD(s) / turns
    },
  },
  {
    id: 'error-rate',
    label: 'Error rate',
    unit: '%',
    higherIsBetter: false,
    action: 'Stop and re-read the error before retrying. If a tool call fails twice with the same args, inspect it — do not chain a third try.',
    format: fmtPct,
    extract: (s) => {
      let total = 0, errors = 0
      for (const t of s.turns) for (const tc of t.toolCalls) {
        total++
        if (tc.isError) errors++
      }
      return total < 5 ? null : errors / total
    },
  },
  {
    id: 'context-peak',
    label: 'Context peak',
    unit: '%',
    higherIsBetter: false,
    action: 'When peak context climbs past ~70%, split the work into a new session — the cache warms faster from a fresh prefix.',
    format: fmtPct,
    extract: (s) => {
      if (s.stats.contextLimit <= 0) return null
      return s.stats.peakContextTokens / s.stats.contextLimit
    },
  },
  {
    id: 'tool-per-turn',
    label: 'Tool calls/turn',
    unit: 'calls',
    higherIsBetter: false,
    action: 'Prefer Grep + targeted Read over listing whole files. Fewer tool calls per turn usually means tighter prompts.',
    format: fmtCalls,
    extract: (s) => {
      const turns = s.turns.length
      return turns === 0 ? null : s.stats.toolCallCount / turns
    },
  },
]

export type PlaybookTip = {
  metricId: PlaybookMetricId
  label: string           // metric label, e.g. "Cache hit"
  unit: '%' | '$' | 'calls'
  topValue: number        // average across top bucket
  bottomValue: number     // average across bottom bucket
  topDisplay: string      // formatted
  bottomDisplay: string   // formatted
  headline: string        // one-liner for the UI
  action: string          // what to do about it
}

export type TaskTypePlaybook = {
  type: SessionType
  sampleSize: number      // sessions of this type
  topSize: number
  bottomSize: number
  tips: PlaybookTip[]
}

export type PlaybookReport = {
  playbooks: TaskTypePlaybook[]
  minSampleSize: number
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

// Quality score: 0..1, higher is better. Normalizes cost/turn within the
// same task-type bucket so the ranking reflects "good for this kind of work"
// rather than "cheap overall" (a 20-turn debug session costs more than a
// 3-turn chat, and that's fine).
function qualityScore(s: Session, maxCostPerTurn: number): number {
  const { inputTokens, cacheCreateTokens, cacheReadTokens } = s.stats.usage
  const cacheDenom = inputTokens + cacheCreateTokens + cacheReadTokens
  const cacheHit = cacheDenom === 0 ? 0 : cacheReadTokens / cacheDenom

  let total = 0, errors = 0
  for (const t of s.turns) for (const tc of t.toolCalls) {
    total++
    if (tc.isError) errors++
  }
  const errorRate = total === 0 ? 0 : errors / total

  const turns = s.turns.length || 1
  const costPerTurn = sessionCostUSD(s) / turns
  const costBonus = maxCostPerTurn === 0 ? 1 : 1 - Math.min(1, costPerTurn / maxCostPerTurn)

  return 0.4 * cacheHit + 0.4 * costBonus + 0.2 * (1 - errorRate)
}

function buildPlaybookFor(type: SessionType, sessions: Session[]): TaskTypePlaybook | null {
  if (sessions.length < MIN_SAMPLE) return null

  const maxCostPerTurn = Math.max(
    ...sessions.map(s => sessionCostUSD(s) / Math.max(1, s.turns.length)),
    0.0001,
  )
  const ranked = sessions
    .map(s => ({ s, score: qualityScore(s, maxCostPerTurn) }))
    .sort((a, b) => b.score - a.score)

  const bucketSize = Math.max(MIN_BUCKET, Math.floor(sessions.length * BUCKET_FRACTION))
  const top    = ranked.slice(0, bucketSize).map(r => r.s)
  const bottom = ranked.slice(-bucketSize).map(r => r.s)
  if (top.length === 0 || bottom.length === 0) return null

  type Candidate = PlaybookTip & { magnitude: number }
  const candidates: Candidate[] = []

  for (const metric of METRICS) {
    const topVals    = top   .map(s => metric.extract(s)).filter((v): v is number => v !== null)
    const bottomVals = bottom.map(s => metric.extract(s)).filter((v): v is number => v !== null)
    if (topVals.length === 0 || bottomVals.length === 0) continue

    const topVal = avg(topVals)
    const botVal = avg(bottomVals)
    const denom = Math.max(Math.abs(botVal), Math.abs(topVal), 0.0001)
    const magnitude = Math.abs(botVal - topVal) / denom

    // Only surface if top is actually the "better" side by a meaningful margin.
    const topIsBetter = metric.higherIsBetter ? topVal > botVal : topVal < botVal
    if (!topIsBetter) continue
    if (magnitude < 0.2) continue   // <20% relative gap = not worth calling out

    const headline = metric.higherIsBetter
      ? `Top ${type} sessions reach ${metric.format(topVal)} (bottom: ${metric.format(botVal)})`
      : `Top ${type} sessions hold ${metric.label.toLowerCase()} to ${metric.format(topVal)} (bottom: ${metric.format(botVal)})`

    candidates.push({
      metricId: metric.id,
      label: metric.label,
      unit: metric.unit,
      topValue: topVal,
      bottomValue: botVal,
      topDisplay: metric.format(topVal),
      bottomDisplay: metric.format(botVal),
      headline,
      action: metric.action,
      magnitude,
    })
  }

  const tips = candidates
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, MAX_TIPS_PER_TYPE)
    .map(({ magnitude: _m, ...tip }) => tip)

  if (tips.length === 0) return null
  return { type, sampleSize: sessions.length, topSize: top.length, bottomSize: bottom.length, tips }
}

// ── Public entry ────────────────────────────────────────────────────────────

export function taskTypePlaybook(sessions: Session[]): PlaybookReport {
  const byType = new Map<SessionType, Session[]>()
  for (const s of sessions) {
    const t = classifySession(s)
    const bucket = byType.get(t) ?? []
    bucket.push(s)
    byType.set(t, bucket)
  }

  const order: SessionType[] = ['coding', 'debugging', 'research', 'exploration', 'conversation']
  const playbooks: TaskTypePlaybook[] = []
  for (const type of order) {
    const list = byType.get(type)
    if (!list) continue
    const pb = buildPlaybookFor(type, list)
    if (pb) playbooks.push(pb)
  }

  return { playbooks, minSampleSize: MIN_SAMPLE }
}

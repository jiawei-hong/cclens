import type { Session } from './types'
import { sessionCostUSD } from './analyzer'

// ── Session quality score ───────────────────────────────────────────────────
// A single 0..100 grade per session, derived from four absolute signals:
//   Cache discipline (25pt) · Cost efficiency (25pt) ·
//   Error discipline (25pt) · Context discipline (25pt)
// Thresholds are absolute (not corpus-normalized) so the same session keeps
// the same grade across filter changes — users can compare apples to apples.
// Sessions too small to meaningfully grade return { rated: false }.

const MIN_TURNS = 10
const MIN_TOOL_CALLS = 5

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export type QualityFactor = {
  id: 'cache' | 'cost' | 'errors' | 'context'
  label: string
  points: number          // awarded out of maxPoints
  maxPoints: number
  displayValue: string    // e.g. "47% hit", "$0.12/turn"
  tone: 'good' | 'ok' | 'bad'
}

export type SessionQuality = {
  rated: boolean
  score: number                 // 0..100; 0 if rated === false
  grade: QualityGrade           // 'F' if rated === false
  factors: QualityFactor[]      // empty when rated === false
  weakest: QualityFactor | null // lowest-scoring factor (for postmortem callouts)
}

const UNRATED: SessionQuality = {
  rated: false,
  score: 0,
  grade: 'F',
  factors: [],
  weakest: null,
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x <= x0) return y0
  if (x >= x1) return y1
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
}

function toneFromRatio(ratio: number): QualityFactor['tone'] {
  if (ratio >= 0.8) return 'good'
  if (ratio >= 0.4) return 'ok'
  return 'bad'
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

export function sessionQualityScore(s: Session): SessionQuality {
  const turns = s.turns.length
  const toolCalls = s.stats.toolCallCount
  if (turns < MIN_TURNS || toolCalls < MIN_TOOL_CALLS) return UNRATED

  const factors: QualityFactor[] = []

  // Cache: 25pt at 50% hit-rate, 0pt at 0%.
  const { inputTokens, cacheCreateTokens, cacheReadTokens } = s.stats.usage
  const cacheDenom = inputTokens + cacheCreateTokens + cacheReadTokens
  const cacheHit = cacheDenom === 0 ? 0 : cacheReadTokens / cacheDenom
  const cachePts = Math.min(25, cacheHit * 50)
  factors.push({
    id: 'cache',
    label: 'Cache discipline',
    points: cachePts,
    maxPoints: 25,
    displayValue: `${Math.round(cacheHit * 100)}% hit`,
    tone: toneFromRatio(cachePts / 25),
  })

  // Cost: 25pt at $0.02/turn or less, 0pt at $0.50/turn.
  const costPerTurn = sessionCostUSD(s) / turns
  const costPts = lerp(costPerTurn, 0.02, 0.50, 25, 0)
  factors.push({
    id: 'cost',
    label: 'Cost efficiency',
    points: costPts,
    maxPoints: 25,
    displayValue: costPerTurn < 0.1 ? `$${costPerTurn.toFixed(3)}/turn` : `$${costPerTurn.toFixed(2)}/turn`,
    tone: toneFromRatio(costPts / 25),
  })

  // Errors: 25pt at 0% errors, 0pt at 10%+.
  let totalCalls = 0, errorCalls = 0
  for (const t of s.turns) for (const tc of t.toolCalls) {
    totalCalls++
    if (tc.isError) errorCalls++
  }
  const errorRate = totalCalls === 0 ? 0 : errorCalls / totalCalls
  const errorPts = lerp(errorRate, 0, 0.10, 25, 0)
  factors.push({
    id: 'errors',
    label: 'Error discipline',
    points: errorPts,
    maxPoints: 25,
    displayValue: `${(errorRate * 100).toFixed(1)}% err`,
    tone: toneFromRatio(errorPts / 25),
  })

  // Context: 25pt at ≤60% peak, 0pt at 95%+. Sessions without a known
  // context limit get full credit (we can't judge what we can't measure).
  const hasLimit = s.stats.contextLimit > 0
  const peakPct = hasLimit ? s.stats.peakContextTokens / s.stats.contextLimit : 0
  const ctxPts = hasLimit ? lerp(peakPct, 0.60, 0.95, 25, 0) : 25
  factors.push({
    id: 'context',
    label: 'Context discipline',
    points: ctxPts,
    maxPoints: 25,
    displayValue: hasLimit ? `${Math.round(peakPct * 100)}% peak` : 'n/a',
    tone: hasLimit ? toneFromRatio(ctxPts / 25) : 'good',
  })

  const score = Math.round(factors.reduce((sum, f) => sum + f.points, 0))
  const weakest = factors.reduce((min, f) => f.points / f.maxPoints < min.points / min.maxPoints ? f : min, factors[0]!)

  return {
    rated: true,
    score,
    grade: gradeFromScore(score),
    factors,
    weakest,
  }
}

// ── Grade tone helpers (UI use) ─────────────────────────────────────────────

export const GRADE_TONE: Record<QualityGrade, 'success' | 'primary' | 'warning' | 'danger'> = {
  A: 'success',
  B: 'primary',
  C: 'warning',
  D: 'warning',
  F: 'danger',
}

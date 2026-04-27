import type { Session } from './types'
import {
  classifySession, priceFor, costOfUsage, sessionCostUSD,
  goldStandardSessions,
} from './analyzer'

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecCategory = 'cost' | 'context' | 'skill' | 'workflow'
export type RecSeverity = 'high' | 'medium' | 'low'

export type Savings =
  | { kind: 'usd';        amount: number; detail?: string }  // dollars saved if fix applied
  | { kind: 'tokens';     amount: number; detail?: string }  // tokens kept out of context
  | { kind: 'pctContext'; amount: number; detail?: string }  // 0..1 share of the context limit
  | { kind: 'count';      amount: number; detail?: string }  // issue count, no clean $ model

export type Recommendation = {
  id: string               // rule id, stable per (rule × session)
  category: RecCategory
  severity: RecSeverity
  title: string
  evidence: string
  savings?: Savings
  actionHint: string
  turnUuids?: string[]     // turns to spotlight in the UI
}

export type SessionRecommendations = {
  sessionId: string
  recommendations: Recommendation[]
  totalSavingsUSD: number  // sum of all `usd` savings on this session
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SONNET_MODEL_ID = 'claude-sonnet-4-6'
const MIN_USD_SAVINGS = 0.02  // hide sub-two-cent suggestions as noise
const MIN_SESSION_TOKENS = 20_000  // skip cache/cost analysis on tiny sessions

function dominantModel(s: Session): string | null {
  let best: { model: string; tokens: number } | null = null
  for (const [model, u] of Object.entries(s.stats.modelUsage)) {
    const tokens = u.inputTokens + u.outputTokens + u.cacheCreateTokens + u.cacheReadTokens
    if (!best || tokens > best.tokens) best = { model, tokens }
  }
  return best?.model ?? null
}

function totalWorkTokens(s: Session): number {
  const u = s.stats.usage
  return u.inputTokens + u.cacheCreateTokens + u.cacheReadTokens
}

// ── Rule: wrong-model-for-task ────────────────────────────────────────────────
// Opus used for conversation/exploration/research — Sonnet would have sufficed.

function ruleWrongModel(s: Session): Recommendation | null {
  const taskType = classifySession(s)
  if (taskType !== 'conversation' && taskType !== 'exploration' && taskType !== 'research') return null
  const dom = dominantModel(s)
  if (!dom || !/opus/i.test(dom)) return null

  const current = sessionCostUSD(s)
  let sonnetCost = 0
  for (const u of Object.values(s.stats.modelUsage)) {
    sonnetCost += costOfUsage(u, SONNET_MODEL_ID)
  }
  const savings = Math.max(0, current - sonnetCost)
  if (savings < MIN_USD_SAVINGS) return null

  return {
    id: 'wrong-model-for-task',
    category: 'cost',
    severity: savings > 1 ? 'high' : savings > 0.25 ? 'medium' : 'low',
    title: `Opus ran a ${taskType} task — Sonnet would have sufficed`,
    evidence: `Session cost $${current.toFixed(2)} on Opus. Same token mix on Sonnet: $${sonnetCost.toFixed(2)}. ${taskType} tasks rarely need Opus-level reasoning.`,
    savings: { kind: 'usd', amount: savings, detail: 'vs Sonnet at current token mix' },
    actionHint: 'Run /model sonnet before starting similar sessions.',
  }
}

// ── Rule: 1h-cache-misused ────────────────────────────────────────────────────
// Used the 2× 1h cache TTL but session was short — standard 5m TTL would cost half.

function rule1hCacheMisused(s: Session): Recommendation | null {
  const oneHourTokens = s.stats.usage.cacheCreate1hTokens
  if (oneHourTokens < 1_000) return null

  const ONE_HOUR_MS = 60 * 60 * 1000
  if (s.durationMs >= ONE_HOUR_MS * 0.75) return null  // long session: 1h TTL justified

  const dom = dominantModel(s) ?? SONNET_MODEL_ID
  const p = priceFor(dom)
  // Moving from 1h TTL (2× input) to 5m TTL (1.25× input) saves 0.75× input per token.
  const savings = oneHourTokens * (p.cacheCreate1h - p.cacheCreate) / 1_000_000
  if (savings < MIN_USD_SAVINGS) return null

  const durMin = Math.round(s.durationMs / 60_000)
  return {
    id: '1h-cache-misused',
    category: 'cost',
    severity: savings > 0.5 ? 'high' : 'medium',
    title: `1h cache TTL on a ${durMin}-minute session`,
    evidence: `${oneHourTokens.toLocaleString()} tokens were written at the 2× 1h cache rate, but the session ended in ~${durMin} min — the default 5m TTL (1.25×) would have been fine.`,
    savings: { kind: 'usd', amount: savings, detail: 'switching 1h TTL → 5m TTL' },
    actionHint: 'Only set cache_control.ttl=\'1h\' when you expect the cached prefix to be reused >5 minutes later.',
  }
}

// ── Rule: low-cache-hit ───────────────────────────────────────────────────────
// Long session with low cache-read share — prompt structure likely not cache-friendly.

function ruleLowCacheHit(s: Session): Recommendation | null {
  const tot = totalWorkTokens(s)
  if (tot < MIN_SESSION_TOKENS * 3) return null  // need enough volume to draw a conclusion

  const rate = s.stats.usage.cacheReadTokens / tot
  if (rate >= 0.3) return null

  const TARGET_RATE = 0.7
  const extra = Math.max(0, tot * TARGET_RATE - s.stats.usage.cacheReadTokens)
  const dm = dominantModel(s) ?? SONNET_MODEL_ID
  const p = priceFor(dm)
  const savings = extra * (p.input - p.cacheRead) / 1_000_000
  if (savings < MIN_USD_SAVINGS * 2) return null

  return {
    id: 'low-cache-hit',
    category: 'cost',
    severity: rate < 0.1 ? 'high' : 'medium',
    title: `Low cache hit rate (${Math.round(rate * 100)}%)`,
    evidence: `Cache reads were ${Math.round(rate * 100)}% of input-side tokens on a ${Math.round(tot / 1_000)}k-token session. Healthy sessions typically sit above 70%.`,
    savings: { kind: 'usd', amount: savings, detail: 'if cache hit rate reached 70%' },
    actionHint: 'Prefer /resume over new sessions, and keep system prompts stable so they stay cached.',
  }
}

// ── Rule: peak-near-compact ───────────────────────────────────────────────────
// Session brushed up against the context limit — risks mid-task /compact.

function rulePeakNearCompact(s: Session): Recommendation | null {
  const { peakContextTokens, contextLimit } = s.stats
  if (contextLimit === 0) return null
  const pct = peakContextTokens / contextLimit
  if (pct < 0.8) return null

  return {
    id: 'peak-near-compact',
    category: 'context',
    severity: pct >= 0.95 ? 'high' : pct >= 0.9 ? 'medium' : 'low',
    title: `Peak context hit ${Math.round(pct * 100)}% of the ${Math.round(contextLimit / 1000)}k limit`,
    evidence: `Claude Code auto-compacts near 95% — this session reached ${peakContextTokens.toLocaleString()} tokens.`,
    savings: { kind: 'pctContext', amount: pct, detail: 'peak context share' },
    actionHint: 'Split long tasks or /clear once a milestone is done to avoid losing context to compaction.',
  }
}

// ── Rule: linear-context-growth ───────────────────────────────────────────────
// contextSeries monotonically grows, ending ≥ 3× its start — a /compact would have helped.

function ruleLinearContextGrowth(s: Session): Recommendation | null {
  const series = s.stats.contextSeries
  if (series.length < 8) return null
  const first = series[0]!.tokens
  const last = series[series.length - 1]!.tokens
  if (first < 5_000) return null  // low starting point → ratio is noisy
  if (last < first * 3) return null

  // Require "mostly monotonic" — at least 80% of steps non-decreasing.
  let upOrFlat = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i]!.tokens >= series[i - 1]!.tokens) upOrFlat++
  }
  if (upOrFlat / (series.length - 1) < 0.8) return null

  const growth = last - first
  return {
    id: 'linear-context-growth',
    category: 'context',
    severity: growth > 100_000 ? 'high' : 'medium',
    title: `Context grew ${Math.round(last / first)}× without a /compact`,
    evidence: `Context started at ${first.toLocaleString()} and ended at ${last.toLocaleString()} tokens, growing in nearly every turn.`,
    savings: { kind: 'tokens', amount: growth, detail: 'tokens accumulated over the session' },
    actionHint: 'Run /compact after a logical milestone to summarize history and reclaim context.',
  }
}

// ── Rule: redundant-reads ─────────────────────────────────────────────────────
// Same file read ≥ 3 times in one session — the file probably didn't change between reads.

function ruleRedundantReads(s: Session): Recommendation | null {
  const counts = new Map<string, { count: number; turnUuids: string[] }>()
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== 'Read') continue
      const path = tc.input['file_path'] as string | undefined
      if (!path) continue
      const acc = counts.get(path) ?? { count: 0, turnUuids: [] }
      acc.count++
      acc.turnUuids.push(turn.uuid)
      counts.set(path, acc)
    }
  }
  const offenders = [...counts.entries()].filter(([, v]) => v.count >= 3)
  if (offenders.length === 0) return null

  const totalExtra = offenders.reduce((sum, [, v]) => sum + (v.count - 1), 0)
  const worst = offenders.sort((a, b) => b[1].count - a[1].count)[0]!
  return {
    id: 'redundant-reads',
    category: 'context',
    severity: totalExtra >= 8 ? 'high' : totalExtra >= 4 ? 'medium' : 'low',
    title: `${totalExtra} redundant Read${totalExtra === 1 ? '' : 's'} of the same file`,
    evidence: `${offenders.length} file${offenders.length === 1 ? ' was' : 's were'} read 3+ times. Worst offender: ${worst[0].split('/').pop()} (${worst[1].count}×).`,
    savings: { kind: 'count', amount: totalExtra, detail: 'avoidable Read calls' },
    actionHint: 'Keep a mental map of what\'s been read; use Grep for targeted lookups instead of re-reading.',
    turnUuids: worst[1].turnUuids.slice(-3),
  }
}

// ── Rule: bash-antipatterns ───────────────────────────────────────────────────
// Bash cat/grep/find/ls/sed/awk dumps — each one pushes raw output into context.

const BASH_ANTI_REGEXES = [
  /^\s*(grep|rg|ripgrep)\s/,
  /^\s*find\s/,
  /^\s*(cat|head|tail)\s/,
  /^\s*ls(\s|$)/,
  /^\s*echo\s+.*>>?/,
  /^\s*sed\s/,
  /^\s*awk\s/,
]

function ruleBashAntipatterns(s: Session): Recommendation | null {
  let count = 0
  const turnUuids: string[] = []
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== 'Bash') continue
      const cmd = (tc.input['command'] as string | undefined) ?? ''
      const lines = cmd.split(/\n|&&|\|/).map(l => l.trim()).filter(Boolean)
      if (lines.some(l => BASH_ANTI_REGEXES.some(r => r.test(l)))) {
        count++
        turnUuids.push(turn.uuid)
      }
    }
  }
  if (count < 3) return null

  return {
    id: 'bash-antipatterns',
    category: 'workflow',
    severity: count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low',
    title: `${count} Bash calls that shadow a native tool`,
    evidence: `grep/find/cat/ls/sed/awk invocations dump raw output into context. Read/Grep/Glob are scoped by default.`,
    savings: { kind: 'count', amount: count, detail: 'Bash → native swaps available' },
    actionHint: 'Swap these for Read (offset/limit), Grep, Glob, or Edit — same work, no context spam.',
    turnUuids: turnUuids.slice(0, 5),
  }
}

// ── Rule: thrashing ───────────────────────────────────────────────────────────
// Same tool+key repeated many times — likely a loop or retry spiral.

function toolKey(tc: { name: string; input: Record<string, unknown> }): string {
  const fp = tc.input['file_path'] as string | undefined
  if (fp) return fp
  const cmd = tc.input['command'] as string | undefined
  if (cmd) return cmd.trim().slice(0, 80)
  const pat = tc.input['pattern'] as string | undefined
  if (pat) return pat.slice(0, 80)
  return ''
}

function ruleThrashing(s: Session): Recommendation | null {
  const counts = new Map<string, { count: number; turnUuids: string[] }>()
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      const key = `${tc.name}\x00${toolKey(tc)}`
      if (!toolKey(tc)) continue
      const acc = counts.get(key) ?? { count: 0, turnUuids: [] }
      acc.count++
      acc.turnUuids.push(turn.uuid)
      counts.set(key, acc)
    }
  }
  const worst = [...counts.entries()]
    .filter(([, v]) => v.count >= 4)
    .sort((a, b) => b[1].count - a[1].count)[0]
  if (!worst) return null

  const [key, info] = worst
  const [tool, target] = key.split('\x00') as [string, string]
  const label = target.split('/').pop() ?? target
  return {
    id: 'thrashing',
    category: 'workflow',
    severity: info.count >= 8 ? 'high' : 'medium',
    title: `${tool} called ${info.count}× on the same target`,
    evidence: `The ${tool} tool hit "${label}" ${info.count} times in this session — likely a loop, retry spiral, or missing abstraction.`,
    savings: { kind: 'count', amount: info.count, detail: 'repeated calls on one target' },
    actionHint: 'Look at what changed between attempts — are the retries converging, or just repeating?',
    turnUuids: info.turnUuids.slice(-3),
  }
}

// ── Rule: high-error-rate ─────────────────────────────────────────────────────
// This session had a high ratio of tool errors.

function ruleHighErrorRate(s: Session): Recommendation | null {
  let total = 0
  let errors = 0
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      total++
      if (tc.isError) errors++
    }
  }
  if (total < 8 || errors < 3) return null
  const rate = errors / total
  if (rate < 0.2) return null

  return {
    id: 'high-error-rate',
    category: 'workflow',
    severity: rate >= 0.4 ? 'high' : 'medium',
    title: `${Math.round(rate * 100)}% of tool calls failed`,
    evidence: `${errors} of ${total} tool calls in this session returned an error.`,
    savings: { kind: 'count', amount: errors, detail: 'failed tool calls' },
    actionHint: 'Scan the errors for a common root cause — often one permission or path issue cascades into many failures.',
  }
}

// ── Rule: skill-gap-commit ────────────────────────────────────────────────────
// Session ran many manual `git commit` calls but never used /commit.

function countBashLineMatches(s: Session, re: RegExp): { count: number; turnUuids: string[] } {
  let count = 0
  const turnUuids: string[] = []
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.name !== 'Bash') continue
      const cmd = (tc.input['command'] as string | undefined) ?? ''
      if (re.test(cmd)) { count++; turnUuids.push(turn.uuid) }
    }
  }
  return { count, turnUuids }
}

function sessionInvokedSkill(s: Session, skill: string): boolean {
  const needle = `<command-name>${skill}</command-name>`
  for (const turn of s.turns) {
    if (turn.role === 'user' && turn.text.includes(needle)) return true
  }
  return false
}

function ruleSkillGapCommit(s: Session): Recommendation | null {
  const { count, turnUuids } = countBashLineMatches(s, /git\s+commit/)
  if (count < 2) return null
  if (sessionInvokedSkill(s, 'commit') || sessionInvokedSkill(s, '/commit')) return null

  return {
    id: 'skill-gap-commit',
    category: 'skill',
    severity: count >= 5 ? 'medium' : 'low',
    title: `${count} manual git commits without /commit`,
    evidence: `Running git commit by hand each time re-derives the commit message and stages files individually. /commit does both in one shot.`,
    savings: { kind: 'count', amount: count, detail: 'commit flows that /commit would handle' },
    actionHint: 'Type /commit at the end of a coding session — it writes the message and stages in one go.',
    turnUuids: turnUuids.slice(-3),
  }
}

function ruleSkillGapCreatePR(s: Session): Recommendation | null {
  const push = countBashLineMatches(s, /git\s+push/)
  if (push.count < 1) return null
  if (sessionInvokedSkill(s, 'create-pr') || sessionInvokedSkill(s, '/create-pr')) return null
  // Only surface if there's also some PR-ish signal (ghcli PR create or the word "pull request")
  const { count: prish } = countBashLineMatches(s, /gh\s+pr\s+create|pull\s+request/i)
  if (prish < 1) return null

  return {
    id: 'skill-gap-create-pr',
    category: 'skill',
    severity: 'low',
    title: `Manual PR creation without /create-pr`,
    evidence: `This session pushed a branch and touched PR workflows manually. /create-pr writes a structured title, summary, and test plan.`,
    savings: { kind: 'count', amount: push.count, detail: 'push/PR cycles' },
    actionHint: 'Type /create-pr after pushing — it drafts a well-formed PR description from the diff.',
    turnUuids: push.turnUuids.slice(-2),
  }
}

// ── Rule: over-editing ────────────────────────────────────────────────────────
// Edit:read ratio > 2 — editing without researching first. Research shows this
// pattern correlates with duplicate/broken code and multiple re-edits.

function ruleOverEditing(s: Session): Recommendation | null {
  if (!s.stats.overEditing) return null
  const { editToReadRatio, editWithoutReadCount, rapidIterationFiles } = s.stats.overEditing
  if (editToReadRatio < 2 && rapidIterationFiles === 0) return null
  const issues: string[] = []
  if (editToReadRatio >= 2) issues.push(`edit:read ratio ${editToReadRatio.toFixed(1)}× (ideal < 1.5×)`)
  if (editWithoutReadCount > 0) issues.push(`${editWithoutReadCount} edit${editWithoutReadCount > 1 ? 's' : ''} to unread files`)
  if (rapidIterationFiles > 0) issues.push(`${rapidIterationFiles} file${rapidIterationFiles > 1 ? 's' : ''} edited 3+ times within 5 min`)
  return {
    id: 'over-editing',
    category: 'workflow',
    severity: editToReadRatio >= 3 || rapidIterationFiles >= 2 ? 'high' : 'medium',
    title: 'Over-editing pattern detected',
    evidence: issues.join('; '),
    savings: { kind: 'count', amount: editWithoutReadCount + rapidIterationFiles, detail: 'blind edits + rapid iteration files' },
    actionHint: 'Ask Claude to read and grep relevant files before making changes. Add "research first, then edit" to your CLAUDE.md.',
  }
}

// ── Rule: frequent compaction ─────────────────────────────────────────────────
// Auto-compacted 2+ times — session outgrew context repeatedly. Lossy compaction
// can cause Claude to forget rules/decisions made earlier.

function ruleFrequentCompaction(s: Session): Recommendation | null {
  const autoEvents = s.stats.compactionEvents.filter(e => e.trigger === 'auto')
  if (autoEvents.length < 2) return null
  const avgPre = autoEvents.reduce((sum, e) => sum + e.preTokens, 0) / autoEvents.length
  return {
    id: 'frequent-compaction',
    category: 'context',
    severity: autoEvents.length >= 3 ? 'high' : 'medium',
    title: `Auto-compacted ${autoEvents.length}× — context overflow`,
    evidence: `Session triggered auto-compaction ${autoEvents.length} times (avg ${Math.round(avgPre / 1000)}k tokens at trigger). Each compaction loses ~70% of context detail.`,
    savings: { kind: 'tokens', amount: Math.round(avgPre * autoEvents.length * 0.7), detail: 'tokens lost to lossy compaction' },
    actionHint: 'Run `/compact` manually when context reaches ~60% to produce a cleaner summary, or split long sessions into focused sub-tasks.',
  }
}

// ── Ordering ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<RecSeverity, number> = { high: 0, medium: 1, low: 2 }
const CATEGORY_ORDER: Record<RecCategory, number> = { cost: 0, context: 1, workflow: 2, skill: 3 }

function compareRecs(a: Recommendation, b: Recommendation): number {
  const sv = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  if (sv !== 0) return sv
  const aUsd = a.savings?.kind === 'usd' ? a.savings.amount : 0
  const bUsd = b.savings?.kind === 'usd' ? b.savings.amount : 0
  if (aUsd !== bUsd) return bUsd - aUsd
  return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
}

// ── Entry points ──────────────────────────────────────────────────────────────

const RULES: ((s: Session) => Recommendation | null)[] = [
  ruleWrongModel,
  rule1hCacheMisused,
  ruleLowCacheHit,
  rulePeakNearCompact,
  ruleLinearContextGrowth,
  ruleRedundantReads,
  ruleBashAntipatterns,
  ruleThrashing,
  ruleHighErrorRate,
  ruleSkillGapCommit,
  ruleSkillGapCreatePR,
  ruleOverEditing,
  ruleFrequentCompaction,
]

export function sessionRecommendations(s: Session): SessionRecommendations {
  const recs: Recommendation[] = []
  for (const rule of RULES) {
    const r = rule(s)
    if (r) recs.push(r)
  }
  recs.sort(compareRecs)
  const totalSavingsUSD = recs.reduce((sum, r) => sum + (r.savings?.kind === 'usd' ? r.savings.amount : 0), 0)
  return { sessionId: s.id, recommendations: recs, totalSavingsUSD }
}

// ── Trend over time ──────────────────────────────────────────────────────────
// Per-rule monthly occurrence counts for the last N months. Lets the UI show
// whether the same issues keep recurring or are fading out — i.e. turns the
// recommendations surface from a static scorecard into a feedback loop.

export type RuleTrendDirection = 'improving' | 'worsening' | 'stable' | 'new'

export type RuleTrend = {
  id: string
  title: string
  category: RecCategory
  severity: RecSeverity   // worst seen
  months: number[]        // oldest → newest, length === RecTrend.monthKeys.length
  totalCount: number
  latestCount: number     // most recent month
  direction: RuleTrendDirection
}

export type RecTrend = {
  monthKeys:   string[]   // 'YYYY-MM', oldest → newest
  monthLabels: string[]   // 'Apr 26' etc, oldest → newest
  rules:       RuleTrend[]
}

const TREND_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${TREND_MONTH_NAMES[Number(m) - 1]} ${y!.slice(2)}`
}

function classifyDirection(months: number[]): RuleTrendDirection {
  const nonZero = months.filter(c => c > 0)
  if (nonZero.length === 0)  return 'stable'
  if (nonZero.length === 1 && months[months.length - 1]! > 0) return 'new'

  // Split the window in two and compare halves. Simple and robust with sparse data.
  const mid   = Math.floor(months.length / 2)
  const older = months.slice(0, mid).reduce((a, b) => a + b, 0)
  const newer = months.slice(mid).reduce((a, b) => a + b, 0)
  if (older === 0 && newer > 0) return 'worsening'
  if (newer === 0 && older > 0) return 'improving'
  if (older === 0 && newer === 0) return 'stable'
  const delta = (newer - older) / older
  if (delta <= -0.33) return 'improving'
  if (delta >=  0.33) return 'worsening'
  return 'stable'
}

export function recommendationTrend(sessions: Session[], monthsBack = 6, now = new Date()): RecTrend {
  // Build the rolling month window (oldest → newest).
  const monthKeys: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthKeys.push(monthKey(d))
  }
  const idx = new Map(monthKeys.map((k, i) => [k, i]))

  // rule id → metadata + month-indexed counts
  const byRuleMeta = new Map<string, {
    id: string
    titleSample: string   // first title seen, number-normalised
    category: RecCategory
    worstSeverity: RecSeverity
    months: number[]
  }>()

  for (const s of sessions) {
    const d = new Date(s.startedAt)
    if (isNaN(d.getTime())) continue
    const key = monthKey(d)
    const mIdx = idx.get(key)
    if (mIdx === undefined) continue  // outside window

    const recs = sessionRecommendations(s).recommendations
    for (const r of recs) {
      let entry = byRuleMeta.get(r.id)
      if (!entry) {
        entry = {
          id: r.id,
          titleSample: r.title.replace(/\b\d[\d,.]*\b/g, 'N'),
          category: r.category,
          worstSeverity: r.severity,
          months: new Array(monthKeys.length).fill(0),
        }
        byRuleMeta.set(r.id, entry)
      }
      entry.months[mIdx]!++
      if (SEVERITY_ORDER[r.severity] < SEVERITY_ORDER[entry.worstSeverity]) {
        entry.worstSeverity = r.severity
      }
    }
  }

  const rules: RuleTrend[] = []
  for (const e of byRuleMeta.values()) {
    const total = e.months.reduce((a, b) => a + b, 0)
    if (total === 0) continue
    rules.push({
      id: e.id,
      title: e.titleSample,
      category: e.category,
      severity: e.worstSeverity,
      months: e.months,
      totalCount: total,
      latestCount: e.months[e.months.length - 1] ?? 0,
      direction: classifyDirection(e.months),
    })
  }

  // Sort: worsening/new first, then by latest count desc — surface things to act on.
  const DIR_ORDER: Record<RuleTrendDirection, number> = { worsening: 0, new: 1, stable: 2, improving: 3 }
  rules.sort((a, b) =>
    DIR_ORDER[a.direction] - DIR_ORDER[b.direction]
    || b.latestCount - a.latestCount
    || b.totalCount - a.totalCount
  )

  return {
    monthKeys,
    monthLabels: monthKeys.map(monthLabel),
    rules,
  }
}

export type RecAggregate = {
  totalSavingsUSD: number
  sessionCount: number              // sessions with at least one recommendation
  byCategory: Record<RecCategory, { count: number; savingsUSD: number }>
  byRule: { id: string; title: string; count: number; savingsUSD: number; severity: RecSeverity; category: RecCategory }[]
  topSessions: { sessionId: string; project: string; startedAt: string; savingsUSD: number; count: number }[]
}

export function aggregateRecommendations(sessions: Session[], limit = 10): RecAggregate {
  const byCategory: Record<RecCategory, { count: number; savingsUSD: number }> = {
    cost:     { count: 0, savingsUSD: 0 },
    context:  { count: 0, savingsUSD: 0 },
    workflow: { count: 0, savingsUSD: 0 },
    skill:    { count: 0, savingsUSD: 0 },
  }
  const byRule = new Map<string, { id: string; title: string; count: number; savingsUSD: number; severity: RecSeverity; category: RecCategory }>()
  const perSession: { sessionId: string; project: string; startedAt: string; savingsUSD: number; count: number }[] = []
  let totalSavingsUSD = 0
  let sessionCount = 0

  for (const s of sessions) {
    const r = sessionRecommendations(s)
    if (r.recommendations.length === 0) continue
    sessionCount++
    totalSavingsUSD += r.totalSavingsUSD
    perSession.push({
      sessionId: s.id,
      project: s.project,
      startedAt: s.startedAt,
      savingsUSD: r.totalSavingsUSD,
      count: r.recommendations.length,
    })

    for (const rec of r.recommendations) {
      byCategory[rec.category].count++
      if (rec.savings?.kind === 'usd') byCategory[rec.category].savingsUSD += rec.savings.amount

      const existing = byRule.get(rec.id)
      const usd = rec.savings?.kind === 'usd' ? rec.savings.amount : 0
      if (existing) {
        existing.count++
        existing.savingsUSD += usd
        // Keep the worst severity seen for this rule
        if (SEVERITY_ORDER[rec.severity] < SEVERITY_ORDER[existing.severity]) existing.severity = rec.severity
      } else {
        byRule.set(rec.id, {
          id: rec.id,
          title: rec.title.replace(/\b\d[\d,.]*\b/g, 'N'),  // strip session-specific numbers for roll-up
          count: 1,
          savingsUSD: usd,
          severity: rec.severity,
          category: rec.category,
        })
      }
    }
  }

  return {
    totalSavingsUSD,
    sessionCount,
    byCategory,
    byRule: [...byRule.values()].sort((a, b) => b.savingsUSD - a.savingsUSD || b.count - a.count),
    topSessions: perSession.sort((a, b) => b.savingsUSD - a.savingsUSD || b.count - a.count).slice(0, limit),
  }
}

// ── Per-project health score ─────────────────────────────────────────────────
// One 0..100 composite per project. Four equal-weight factors:
//   1. cache hit rate (25) — how efficiently the project uses the prompt cache
//   2. 1 − error rate (25) — reliability of tool calls
//   3. gold-ratio   (25) — share of substantive sessions that qualify as gold
//   4. 1 − recs/sess scaled (25) — fewer opportunities per session = higher
// The goal is a single number the user can watch move over time, not a formal
// correctness metric. Projects with very few sessions are flagged separately.

export type ProjectHealth = {
  project: string
  sessionCount: number
  score: number             // 0..100
  cacheHitRate: number      // 0..1
  errorRate: number         // 0..1
  goldCount: number
  goldRatio: number         // 0..1
  recsPerSession: number    // average
  totalSavingsUSD: number   // rolled up from recs
  lowConfidence: boolean    // true when sessionCount < 3 (score is noisy)
}

const MIN_CONFIDENT_SESSIONS = 3

export function projectHealth(sessions: Session[]): ProjectHealth[] {
  // Pre-compute gold sessions once across the whole corpus, then bucket by project.
  const goldIds = new Set(goldStandardSessions(sessions, 1_000_000).map(g => g.sessionId))

  const byProject = new Map<string, Session[]>()
  for (const s of sessions) {
    const list = byProject.get(s.project) ?? []
    list.push(s)
    byProject.set(s.project, list)
  }

  const out: ProjectHealth[] = []
  for (const [project, list] of byProject) {
    let cacheIn = 0, cacheHit = 0
    let toolCalls = 0, errorCalls = 0
    let goldCount = 0
    let recsTotal = 0, savingsUSD = 0

    for (const s of list) {
      const u = s.stats.usage
      cacheIn  += u.inputTokens + u.cacheCreateTokens + u.cacheReadTokens
      cacheHit += u.cacheReadTokens
      for (const t of s.turns) {
        for (const tc of t.toolCalls) {
          toolCalls++
          if (tc.isError) errorCalls++
        }
      }
      if (goldIds.has(s.id)) goldCount++
      const recs = sessionRecommendations(s)
      recsTotal  += recs.recommendations.length
      savingsUSD += recs.totalSavingsUSD
    }

    const cacheHitRate   = cacheIn === 0 ? 0 : cacheHit / cacheIn
    const errorRate      = toolCalls === 0 ? 0 : errorCalls / toolCalls
    const goldRatio      = list.length === 0 ? 0 : goldCount / list.length
    const recsPerSession = list.length === 0 ? 0 : recsTotal / list.length

    // Bound recs/sess factor so projects with ≥2 recs per session collapse to 0.
    const recFactor = Math.max(0, 1 - recsPerSession / 2)
    const score =
      cacheHitRate        * 25 +
      (1 - errorRate)     * 25 +
      goldRatio           * 25 +
      recFactor           * 25

    out.push({
      project,
      sessionCount: list.length,
      score: Math.round(score),
      cacheHitRate,
      errorRate,
      goldCount,
      goldRatio,
      recsPerSession,
      totalSavingsUSD: savingsUSD,
      lowConfidence: list.length < MIN_CONFIDENT_SESSIONS,
    })
  }

  return out.sort((a, b) => b.score - a.score || b.sessionCount - a.sessionCount)
}

// ── Recent regression detector ───────────────────────────────────────────────
// Compare the trailing 7-day window against the prior 14-to-7-day baseline on a
// handful of high-signal metrics. Surface only those where things got notably
// worse so the user has a single "what changed for the worse" entry point.

export type RegressionMetric =
  | 'avgCostPerSession'
  | 'cacheHitRate'
  | 'toolErrorRate'
  | 'recsPerSession'

export type Regression = {
  metric: RegressionMetric
  label: string
  recent: number
  baseline: number
  changePct: number        // positive number, magnitude of worsening in percent
  direction: 'worse'
  fmt: 'usd' | 'pct' | 'count'
  recentSessions: number
  baselineSessions: number
}

export type RegressionReport = {
  regressions: Regression[]
  recentSessions: number
  baselineSessions: number
  recentWindowDays: number
  baselineWindowDays: number
  confident: boolean       // true when both buckets have ≥3 sessions
}

const REGRESSION_MIN_SESSIONS = 3
const REGRESSION_MIN_CHANGE_PCT = 15

function bucketMetrics(sessions: Session[]) {
  let cacheIn = 0, cacheHit = 0
  let toolCalls = 0, errorCalls = 0
  let totalCost = 0, totalRecs = 0
  for (const s of sessions) {
    const u = s.stats.usage
    cacheIn  += u.inputTokens + u.cacheCreateTokens + u.cacheReadTokens
    cacheHit += u.cacheReadTokens
    for (const t of s.turns) {
      for (const tc of t.toolCalls) {
        toolCalls++
        if (tc.isError) errorCalls++
      }
    }
    totalCost += sessionCostUSD(s)
    totalRecs += sessionRecommendations(s).recommendations.length
  }
  const n = sessions.length
  return {
    avgCostPerSession: n === 0 ? 0 : totalCost / n,
    cacheHitRate:      cacheIn === 0 ? 0 : cacheHit / cacheIn,
    toolErrorRate:     toolCalls === 0 ? 0 : errorCalls / toolCalls,
    recsPerSession:    n === 0 ? 0 : totalRecs / n,
  }
}

export function recentRegressions(sessions: Session[], now = new Date()): RegressionReport {
  const recentDays = 7
  const baselineDays = 7
  const nowMs = now.getTime()
  const recentCutoff   = nowMs - recentDays * 24 * 60 * 60 * 1000
  const baselineCutoff = nowMs - (recentDays + baselineDays) * 24 * 60 * 60 * 1000

  const recent: Session[]   = []
  const baseline: Session[] = []
  for (const s of sessions) {
    const t = new Date(s.startedAt).getTime()
    if (t >= recentCutoff)                             recent.push(s)
    else if (t >= baselineCutoff && t < recentCutoff)  baseline.push(s)
  }

  const confident = recent.length >= REGRESSION_MIN_SESSIONS && baseline.length >= REGRESSION_MIN_SESSIONS
  if (!confident) {
    return {
      regressions: [],
      recentSessions: recent.length,
      baselineSessions: baseline.length,
      recentWindowDays: recentDays,
      baselineWindowDays: baselineDays,
      confident: false,
    }
  }

  const r = bucketMetrics(recent)
  const b = bucketMetrics(baseline)

  // For each metric, define the direction that counts as "worse" and its formatter.
  const checks: { metric: RegressionMetric; label: string; higherIsWorse: boolean; recent: number; baseline: number; fmt: 'usd' | 'pct' | 'count' }[] = [
    { metric: 'avgCostPerSession', label: 'Avg cost / session',   higherIsWorse: true,  recent: r.avgCostPerSession, baseline: b.avgCostPerSession, fmt: 'usd' },
    { metric: 'cacheHitRate',      label: 'Cache hit rate',       higherIsWorse: false, recent: r.cacheHitRate,      baseline: b.cacheHitRate,      fmt: 'pct' },
    { metric: 'toolErrorRate',     label: 'Tool error rate',      higherIsWorse: true,  recent: r.toolErrorRate,     baseline: b.toolErrorRate,     fmt: 'pct' },
    { metric: 'recsPerSession',    label: 'Recommendations / session', higherIsWorse: true, recent: r.recsPerSession, baseline: b.recsPerSession, fmt: 'count' },
  ]

  const regressions: Regression[] = []
  for (const c of checks) {
    if (c.baseline === 0) continue  // no denominator, skip
    const delta = c.recent - c.baseline
    const worse = c.higherIsWorse ? delta > 0 : delta < 0
    if (!worse) continue
    const changePct = Math.abs(delta / c.baseline) * 100
    if (changePct < REGRESSION_MIN_CHANGE_PCT) continue
    regressions.push({
      metric: c.metric,
      label: c.label,
      recent: c.recent,
      baseline: c.baseline,
      changePct,
      direction: 'worse',
      fmt: c.fmt,
      recentSessions: recent.length,
      baselineSessions: baseline.length,
    })
  }

  regressions.sort((a, b) => b.changePct - a.changePct)

  return {
    regressions,
    recentSessions: recent.length,
    baselineSessions: baseline.length,
    recentWindowDays: recentDays,
    baselineWindowDays: baselineDays,
    confident: true,
  }
}

import React, { useState } from 'react'
import { summarizeProjects, globalToolStats, activityByHour, sessionDepthStats, taskBreakdown, trendStats, bashAntiPatterns, bashCommandBreakdown, skillUsageStats, skillGaps, agentBreakdown, hotFiles, multiFileSessions, thrashingSessions, totalUsage, usageByModel, dailyCost, toolErrorRates, activityHeatmap, slowestToolCalls, mcpUsageStats, contextWindowHotspots, costByTaskType, thinkingStats, sessionCacheRanking, interruptStats, monthlyCostForecast, goldStandardSessions, costOfUsage, classifySession, sessionCostUSD } from '../../src/analyzer'
import type { SessionType, BashAntiPattern, BashCategory, SkillUsage, SkillGap, AgentTypeUsage, HotFile, MultiFileSession, ThrashSession, TotalUsage, ModelUsageRow, ToolErrorStats, HeatmapCell, SlowToolCall, McpServerUsage, ContextHotspotStats, CostByTaskRow, ThinkingStats, SessionCacheStats, InterruptStats, MonthlyForecast, GoldStandardSession } from '../../src/analyzer'
import { aggregateRecommendations, recommendationTrend, projectHealth, recentRegressions, type RecAggregate, type RecCategory, type RecSeverity, type RecTrend, type RuleTrend, type RuleTrendDirection, type ProjectHealth, type RegressionReport, type Regression } from '../../src/recommendations'
import { userHabitsTrend, type HabitWithTrend, type HabitStatus, type HabitTrendDirection } from '../../src/habits'
import { taskTypePlaybook, type PlaybookReport, type TaskTypePlaybook, type PlaybookTip } from '../../src/playbook'
import { sessionQualityScore } from '../../src/quality'
import { generateProjectClaudeMd, claudeMdRules, claudeMdDiff, claudeMdViolations, CLAUDE_MD_SECTION_ORDER, type ClaudeMdRule, type ClaudeMdViolationReport } from '../../src/claudeMd'
import { search } from '../../src/searcher'
import type { SearchResult } from '../../src/types'
import type { Session, ProjectSummary } from '../../src/types'
import { fmt, fmtDuration, fmtPace, fmtToolDuration, fmtTokenCount, fmtUSD, fmtChars, fmtTokensFromChars } from '../lib/format'
import { toolColor, toolTickColor, taskTypeColor, taskTypeBar, TASK_DESCRIPTIONS } from '../lib/colors'
import { exportInsightsAsMarkdown, exportDailyCostCSV, exportSessionsCSV } from '../lib/exports'
import { Tooltip, FileIcon } from '../lib/ui'
import { Button, Card, Tab, TabGroup, Stat, StatStrip, EmptyState, Badge } from '../lib/ds'
import { ToolDeepDiveModal } from '../components/ToolDeepDive'

// ── Workflow Insight Cards ────────────────────────────────────────────────────

const BASH_CATEGORY_COLORS: Record<string, string> = {
  'git':               'bg-orange-500',
  'npm/yarn/pnpm/bun': 'bg-emerald-500',
  'docker':            'bg-sky-500',
  'test runners':      'bg-violet-500',
  'curl/wget':         'bg-amber-500',
  'make/cmake':        'bg-teal-500',
  'file search':       'bg-rose-500',
  'file read':         'bg-blue-500',
  'other':             'bg-gray-400',
}

function CostByTaskCard({ rows }: { rows: CostByTaskRow[] }) {
  const maxAvg = Math.max(...rows.map(r => r.avgCostUSD), 0.0001)
  const totalCost = rows.reduce((s, r) => s + r.totalCostUSD, 0)
  const mostExpensive = [...rows].sort((a, b) => b.avgCostUSD - a.avgCostUSD)[0]
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cost by Task Type</h3>
        {mostExpensive && (
          <span className="text-[10px] text-gray-400 dark:text-gray-600">
            <span className="font-medium text-gray-500 dark:text-gray-400">{mostExpensive.type}</span> costs the most per session ({fmtUSD(mostExpensive.avgCostUSD)})
          </span>
        )}
      </div>

      {/* Share-of-spend stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-4">
        {rows.map(r => (
          <div key={r.type} className={taskTypeBar(r.type)} style={{ width: `${r.share * 100}%` }}
            title={`${r.type}: ${fmtUSD(r.totalCostUSD)} (${(r.share * 100).toFixed(1)}%)`} />
        ))}
      </div>

      {/* Per-type rows */}
      <div className="flex flex-col gap-2.5">
        {rows.map(r => (
          <div key={r.type} className="flex items-center gap-3">
            <Tooltip content={<span className="text-[11px] text-gray-600 dark:text-gray-400">{TASK_DESCRIPTIONS[r.type]}</span>}>
              <span className={`text-xs px-2 py-0.5 rounded-md w-24 text-center shrink-0 font-medium cursor-default ${taskTypeColor(r.type)}`}>{r.type}</span>
            </Tooltip>
            <span className="text-[11px] text-gray-500 dark:text-gray-500 tabular-nums w-16 shrink-0">{r.sessionCount} sess</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${taskTypeBar(r.type)}`} style={{ width: `${(r.avgCostUSD / maxAvg) * 100}%` }} />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-20 text-right shrink-0">avg {fmtUSD(r.avgCostUSD)}</span>
            <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums w-16 text-right font-medium shrink-0">{fmtUSD(r.totalCostUSD)}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums w-10 text-right shrink-0">{(r.share * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-4 leading-relaxed">
        Sessions are classified by tool-mix heuristics (hover a label for the rule). Spend total: {fmtUSD(totalCost)}.
      </p>
    </Card>
  )
}

const MODEL_BADGE: Record<string, string> = {
  opus:   'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  sonnet: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  haiku:  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  other:  'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
}

function CacheEfficiencyCard({ rows, onOpenSession }: { rows: SessionCacheStats[]; onOpenSession: (id: string) => void }) {
  if (rows.length === 0) return null
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cache Efficiency by Session</h3>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">cache_read / (input + cache_create + cache_read) · sessions with &gt;5k input tokens</p>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-600">{rows.length} sessions</span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(r => {
          const pct = Math.round(r.cacheHitRate * 100)
          const isHigh = r.cacheHitRate >= 0.6
          const isMid = r.cacheHitRate >= 0.3
          const barColor = isHigh ? 'bg-emerald-500' : isMid ? 'bg-amber-400' : 'bg-rose-400'
          const textColor = isHigh ? 'text-emerald-600 dark:text-emerald-400' : isMid ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500 dark:text-rose-400'
          return (
            <button key={r.sessionId} onClick={() => onOpenSession(r.sessionId)}
              className="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full group">
              <span className={`text-xs font-bold tabular-nums w-10 shrink-0 text-right ${textColor}`}>{pct}%</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{r.project}</span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(r.startedAt)}</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span className="text-[11px] text-gray-400 dark:text-gray-600 tabular-nums shrink-0 font-mono w-20 text-right">
                {(r.cacheReadTokens / 1000).toFixed(0)}k / {(r.totalInputTokens / 1000).toFixed(0)}k
              </span>
              <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors shrink-0">→</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function MonthlyForecastCard({ forecast }: { forecast: MonthlyForecast }) {
  if (!forecast.hasData) {
    return (
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{forecast.thisMonthLabel} Forecast</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">No sessions recorded this month yet.</p>
      </Card>
    )
  }

  const pct = forecast.deltaVsLastMonthPct
  const trending: 'up' | 'down' | 'flat' | null = pct === null ? null : pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat'
  const trendColor =
    trending === 'up'   ? 'text-rose-500 dark:text-rose-400' :
    trending === 'down' ? 'text-emerald-600 dark:text-emerald-400' :
                          'text-gray-500 dark:text-gray-400'
  const trendArrow = trending === 'up' ? '↑' : trending === 'down' ? '↓' : '→'
  const progressPct = (forecast.daysElapsed / forecast.daysInMonth) * 100
  const spentPct = forecast.projectedThisMonth > 0 ? (forecast.spentThisMonth / forecast.projectedThisMonth) * 100 : 0

  return (
    <Card>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{forecast.thisMonthLabel} Forecast</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(forecast.projectedThisMonth)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">projected end-of-month</span>
          </div>
          {pct !== null && (
            <div className="mt-1.5 flex items-center gap-2 text-[11px]">
              <span className={`font-medium ${trendColor}`}>
                {trendArrow} {Math.abs(pct).toFixed(0)}% vs {forecast.lastMonthLabel}
              </span>
              <span className="text-gray-400 dark:text-gray-600">({fmtUSD(forecast.spentLastMonth)} last month)</span>
            </div>
          )}
          {pct === null && (
            <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-600">No {forecast.lastMonthLabel} data for comparison.</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-right shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400">Spent so far</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Daily avg</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Days left</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(forecast.spentThisMonth)}</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(forecast.dailyAvgThisMonth)}</span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{forecast.daysRemaining}</span>
        </div>
      </div>

      {/* Month progress bar: grey = elapsed-so-far as % of month; green = spent as % of projected */}
      <div className="mt-4 relative h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full" style={{ width: `${spentPct}%` }} />
        <div className="absolute inset-y-0 border-r-2 border-gray-400 dark:border-gray-600" style={{ left: `${progressPct}%` }} title={`Day ${forecast.daysElapsed} / ${forecast.daysInMonth}`} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-600">
        <span>Day 1</span>
        <span className="font-medium text-gray-500 dark:text-gray-500">Day {forecast.daysElapsed} of {forecast.daysInMonth}</span>
        <span>Day {forecast.daysInMonth}</span>
      </div>
      <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-600 leading-relaxed">
        Projected = current daily average × days in month. Linear extrapolation, so a quiet weekend pushes the number down.
      </p>
    </Card>
  )
}

function CostPanel({ usage, modelRows, dailySeries, maxDailyCost, hasData, dailySeriesDays, costByTask, thinking, sessions, forecast }: {
  usage: TotalUsage
  modelRows: ModelUsageRow[]
  dailySeries: { date: string; costUSD: number }[]
  maxDailyCost: number
  hasData: boolean
  dailySeriesDays: number
  costByTask: CostByTaskRow[]
  thinking: ThinkingStats
  sessions: Session[]
  forecast: MonthlyForecast
}) {
  if (!hasData) {
    return (
      <EmptyState
        title="No token usage data found in these sessions."
        description="Only sessions recorded by newer Claude Code versions include per-turn usage — older sessions will be skipped."
      />
    )
  }

  const totalCacheIn = usage.cacheReadTokens + usage.cacheCreateTokens + usage.inputTokens
  const tokenSegments = [
    { label: 'Cache Read',   value: usage.cacheReadTokens,   className: 'bg-emerald-500' },
    { label: 'Cache Create', value: usage.cacheCreateTokens, className: 'bg-amber-500'   },
    { label: 'Input',        value: usage.inputTokens,       className: 'bg-sky-500'     },
    { label: 'Output',       value: usage.outputTokens,      className: 'bg-indigo-500'  },
  ]
  const tokenTotal = tokenSegments.reduce((s, x) => s + x.value, 0) || 1
  const topModelCost = Math.max(...modelRows.map(m => m.costUSD), 0.0001)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={() => exportDailyCostCSV(dailySeries)}>↓ Daily cost CSV</Button>
        <Button size="sm" onClick={() => exportSessionsCSV(sessions)}>↓ Per-session CSV</Button>
      </div>
      {thinking.totalBlocks > 0 && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl px-4 py-3 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
          <strong>Cost is under-reported for sessions with extended thinking.</strong>{' '}
          Detected <span className="font-mono font-semibold">{thinking.totalBlocks.toLocaleString()}</span> thinking
          block{thinking.totalBlocks === 1 ? '' : 's'} across{' '}
          <span className="font-mono font-semibold">{thinking.sessionsWithThinking}</span> session{thinking.sessionsWithThinking === 1 ? '' : 's'}.
          Anthropic bills for these tokens but they don't appear in the session JSONL's <code className="font-mono">usage.output_tokens</code>.
          Your actual bill may be meaningfully higher than the estimate below.
        </div>
      )}
      <MonthlyForecastCard forecast={forecast} />

      {/* 4 stat cards */}
      <div className="grid grid-cols-4 gap-5">
        <Card><Stat label="Est. Cost" value={fmtUSD(usage.costUSD)} sub={`${fmtTokenCount(usage.totalTokens)} tokens total`} /></Card>
        <Card><Stat label="Input" value={fmtTokenCount(usage.inputTokens)} sub="fresh input tokens" /></Card>
        <Card><Stat label="Output" value={fmtTokenCount(usage.outputTokens)} sub="generated tokens" /></Card>
        <Card><Stat label="Cache Hit Rate" value={`${(usage.cacheHitRate * 100).toFixed(1)}%`} sub={`${fmtTokenCount(usage.cacheReadTokens)} read / ${fmtTokenCount(totalCacheIn)} eligible`} /></Card>
      </div>

      {/* Token composition + Per-model breakdown */}
      <div className="grid grid-cols-2 gap-5">
        <Card>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Token Composition</h3>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-4">
            {tokenSegments.map(s => (
              <div key={s.label} className={s.className} style={{ width: `${(s.value / tokenTotal) * 100}%` }} title={`${s.label}: ${fmtTokenCount(s.value)}`} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {tokenSegments.map(s => (
              <div key={s.label} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-sm ${s.className}`} />
                <span className="text-xs text-gray-600 dark:text-gray-400 flex-1">{s.label}</span>
                <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums font-medium">{fmtTokenCount(s.value)}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums w-10 text-right">{((s.value / tokenTotal) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-4 leading-relaxed">
            Cache reads are ~10× cheaper than fresh input. A high cache-read share is good.
          </p>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Cost by Model</h3>
          <div className="flex flex-col gap-2.5">
            {modelRows.map(m => (
              <div key={m.model} className="flex items-center gap-3">
                <span title={m.model} className={`text-[11px] px-2 py-0.5 rounded font-mono w-24 text-center shrink-0 truncate ${MODEL_BADGE[m.shortLabel] ?? MODEL_BADGE.other}`}>{m.versionLabel}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(m.costUSD / topModelCost) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-16 text-right">{fmtTokenCount(m.totalTokens)}</span>
                <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums w-14 text-right font-medium">{fmtUSD(m.costUSD)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-4 leading-relaxed">
            Estimates use public list prices per 1M tokens. Actual billing may differ (subscriptions, volume discounts, cache-write TTL, fast mode — Opus 4.6 fast-mode calls bill 6× standard and aren't distinguishable in the JSONL).
          </p>
        </Card>
      </div>

      {/* Cost by task type */}
      {costByTask.length > 0 && <CostByTaskCard rows={costByTask} />}

      {/* Daily cost */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Daily Cost <span className="font-normal text-gray-400">— last {dailySeriesDays} days</span></h3>
          <span className="text-xs text-gray-400 dark:text-gray-600">{fmtUSD(dailySeries.reduce((s, d) => s + d.costUSD, 0))} total</span>
        </div>
        <div className="relative h-20 flex items-end gap-px">
          {dailySeries.map(d => {
            const heightPx = Math.max(2, Math.round((d.costUSD / maxDailyCost) * 80))
            return (
              <div key={d.date} className="group relative flex-1">
                <div className="w-full bg-indigo-500/70 rounded-sm hover:bg-indigo-400 transition-colors cursor-default" style={{ height: `${heightPx}px` }} />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                  {d.date}: {fmtUSD(d.costUSD)}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Cost projection */}
      <CostProjectionCard dailySeries={dailySeries} dailySeriesDays={dailySeriesDays} />
    </div>
  )
}

function CostProjectionCard({ dailySeries, dailySeriesDays }: { dailySeries: { date: string; costUSD: number }[]; dailySeriesDays: number }) {
  const totalRecent = dailySeries.reduce((s, d) => s + d.costUSD, 0)
  const avgDaily = dailySeriesDays > 0 ? totalRecent / dailySeriesDays : 0
  if (avgDaily === 0) return null
  return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Cost Projection <span className="font-normal text-gray-400">— if the last {dailySeriesDays} days continue</span></h3>
      <div className="grid grid-cols-3 gap-4">
        <Stat size="md" label="Avg / Day"         value={fmtUSD(avgDaily)} />
        <Stat size="md" label="Projected / Month" value={fmtUSD(avgDaily * 30)} />
        <Stat size="md" label="Projected / Year"  value={fmtUSD(avgDaily * 365)} />
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Linear extrapolation from the calendar-day average. Does not account for thinking-mode underreporting or fast-mode pricing.
      </p>
    </Card>
  )
}

// ── Model Mix Trend Card ──────────────────────────────────────────────────────

const MODEL_BAR_COLOR: Record<string, string> = {
  opus:   'bg-purple-500',
  sonnet: 'bg-sky-500',
  haiku:  'bg-teal-500',
  other:  'bg-gray-400',
}
const MODEL_TEXT_COLOR: Record<string, string> = {
  opus:   'text-purple-600 dark:text-purple-400',
  sonnet: 'text-sky-600 dark:text-sky-400',
  haiku:  'text-teal-600 dark:text-teal-400',
  other:  'text-gray-500 dark:text-gray-400',
}
const FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'other'] as const

function modelFamily(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('opus'))   return 'opus'
  if (m.includes('haiku'))  return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  return 'other'
}

function ModelMixTrendCard({ sessions }: { sessions: Session[] }) {
  const weeks = React.useMemo(() => {
    type Bucket = { key: string; label: string; opus: number; sonnet: number; haiku: number; other: number }
    const map = new Map<string, Bucket>()
    for (const s of sessions) {
      const date = new Date(s.startedAt)
      const key = getWeekKey(date)
      const b = map.get(key) ?? { key, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), opus: 0, sonnet: 0, haiku: 0, other: 0 }
      for (const [model, usage] of Object.entries(s.stats.modelUsage)) {
        const cost = costOfUsage(usage, model)
        const fam = modelFamily(model) as 'opus' | 'sonnet' | 'haiku' | 'other'
        b[fam] += cost
      }
      map.set(key, b)
    }
    return [...map.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-16) // last 16 weeks max
  }, [sessions])

  if (weeks.length < 2) return null

  // Only interesting if >1 family appears
  const families = FAMILY_ORDER.filter(f => weeks.some(w => w[f] > 0))
  if (families.length < 2) return null

  const maxTotal = Math.max(...weeks.map(w => families.reduce((s, f) => s + w[f], 0)), 0.0001)

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Model Mix Over Time</h3>
        <div className="flex items-center gap-3">
          {families.map(f => (
            <span key={f} className={`flex items-center gap-1 text-[10px] font-medium ${MODEL_TEXT_COLOR[f]}`}>
              <span className={`w-2 h-2 rounded-sm inline-block ${MODEL_BAR_COLOR[f]}`} />
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-[3px] h-20">
        {weeks.map(w => {
          const total = families.reduce((s, f) => s + w[f], 0)
          const heightPct = total / maxTotal
          return (
            <div key={w.key} className="group relative flex-1 flex flex-col justify-end" style={{ height: '100%' }}>
              <div className="flex flex-col-reverse rounded-sm overflow-hidden w-full" style={{ height: `${heightPct * 100}%` }}>
                {families.map(f => {
                  const frac = total > 0 ? w[f] / total : 0
                  if (frac === 0) return null
                  return <div key={f} className={`${MODEL_BAR_COLOR[f]} w-full flex-shrink-0`} style={{ height: `${frac * 100}%` }} />
                })}
              </div>
              <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-[10px] text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                <div className="font-medium mb-0.5">{w.label}</div>
                {families.filter(f => w[f] > 0).map(f => (
                  <div key={f} className={MODEL_TEXT_COLOR[f]}>{f}: {fmtUSD(w[f])}</div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400 dark:text-gray-700">{weeks[0]!.label}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-700">{weeks[weeks.length - 1]!.label}</span>
      </div>
    </Card>
  )
}

const CLAUDE_MD_RULES: Record<string, string> = {
  grep:       'NEVER use `bash grep` or `bash rg` to search file contents — use the Grep tool instead.',
  find:       'NEVER use `bash find` to locate files — use the Glob tool instead.',
  cat:        'NEVER use `bash cat`, `bash head`, or `bash tail` to read files — use the Read tool with offset/limit parameters to fetch only what is needed.',
  ls:         'NEVER use `bash ls` to list files — use the Glob tool instead.',
  echo_write: 'NEVER use `bash echo >` or `bash echo >>` to write files — use the Write or Edit tool instead.',
  sed:        'NEVER use `bash sed` to edit files — use the Edit tool for targeted replacements.',
  awk:        'NEVER use `bash awk` to process file content — read the file with Read, then reason over the content directly.',
}

function generateClaudeMd(antiPatterns: BashAntiPattern[]): string {
  const rules = antiPatterns
    .filter(p => CLAUDE_MD_RULES[p.id])
    .map(p => `- ${CLAUDE_MD_RULES[p.id]}`)
    .join('\n')
  return `## Tool Usage Rules\n\n${rules}\n`
}

function EfficiencyPanel({ breakdown, antiPatterns }: { breakdown: BashCategory[]; antiPatterns: BashAntiPattern[] }) {
  const total = breakdown.reduce((s, c) => s + c.count, 0)
  const maxBreak = Math.max(...breakdown.map(c => c.count), 1)
  const totalCalls = antiPatterns.reduce((s, p) => s + p.count, 0)
  const totalChars = antiPatterns.reduce((s, p) => s + p.totalResultChars, 0)
  const maxChars = Math.max(...antiPatterns.map(p => p.totalResultChars), 1)
  const [showSnippet, setShowSnippet] = useState(false)
  const [copied, setCopied] = useState(false)
  const snippet = React.useMemo(() => generateClaudeMd(antiPatterns), [antiPatterns])
  const copy = () => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  return (
    <Card padding="none" className="flex overflow-hidden">
      {/* Left: Bash breakdown */}
      <div className="w-72 shrink-0 p-5 flex flex-col gap-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Bash Usage</h3>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">{total.toLocaleString()} lines total</p>
        </div>
        <div className="flex flex-col gap-2.5">
          {breakdown.slice(0, 8).map(({ label, count }) => {
            const pct = Math.round((count / total) * 100)
            const barColor = BASH_CATEGORY_COLORS[label] ?? 'bg-gray-400'
            return (
              <div key={label} className="flex items-center gap-2.5">
                <span className="text-xs text-gray-600 dark:text-gray-400 w-32 shrink-0 truncate font-mono">{label}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${(count / maxBreak) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-600 w-10 text-right shrink-0 tabular-nums">{pct}%</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-gray-100 dark:bg-gray-800 self-stretch" />

      {/* Right: Context Waste */}
      <div className="flex-1 p-5 flex flex-col gap-3.5 min-w-0">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Context Waste</h3>
            {totalChars > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">
                {totalCalls} calls · <span className="text-rose-500 dark:text-rose-400 font-medium">{fmtChars(totalChars)} chars</span> dumped into context
              </p>
            )}
          </div>
          {totalChars > 0 && (
            <span className="text-sm font-bold font-mono text-rose-500 dark:text-rose-400 shrink-0 ml-2">~{fmtTokensFromChars(totalChars)} tok</span>
          )}
        </div>

        {antiPatterns.length === 0 ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No context waste detected</p>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {antiPatterns.map(p => (
                <div key={p.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-rose-600 dark:text-rose-400 shrink-0">{p.bashCmd}</span>
                    <span className="text-gray-400 dark:text-gray-600 text-xs">→</span>
                    <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">{p.betterTool}</span>
                    <span className="ml-auto text-xs text-gray-400 tabular-nums shrink-0">{p.count}× · {fmtChars(p.avgResultChars)} avg</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                      <div className="h-1 rounded-full bg-rose-400/70" style={{ width: `${(p.totalResultChars / maxChars) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 dark:text-gray-600 tabular-nums w-10 text-right shrink-0">{fmtChars(p.totalResultChars)}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-600 leading-relaxed">{p.tip}</p>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowSnippet(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-600/10 hover:bg-indigo-100 dark:hover:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 transition-colors text-left"
              >
                <span className="text-xs font-semibold">Fix with CLAUDE.md</span>
                <span className="text-xs text-indigo-500 dark:text-indigo-400">{showSnippet ? '▾ hide' : '▸ generate'}</span>
              </button>
              {showSnippet && (
                <div className="mt-2 flex flex-col gap-2">
                  <pre className="text-[11px] font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-3 whitespace-pre-wrap leading-relaxed overflow-x-auto">{snippet}</pre>
                  <div className="flex items-center gap-2">
                    <button onClick={copy} className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${copied ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <span className="text-[11px] text-gray-400 dark:text-gray-600">Paste into <code className="text-gray-500">~/.claude/CLAUDE.md</code></span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function InterruptCard({ stats, onOpenSession }: { stats: InterruptStats; onOpenSession: (id: string) => void }) {
  if (stats.totalInterrupts === 0) return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Interrupt / Abort Rate</h3>
      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No interrupted sessions found.</p>
    </Card>
  )

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Interrupt / Abort Rate</h3>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">
            <span className="text-amber-600 dark:text-amber-400 font-medium">{stats.interruptedSessions}</span> sessions interrupted
            · {(stats.interruptRate * 100).toFixed(0)}% of total
            · {stats.totalInterrupts} abort{stats.totalInterrupts === 1 ? '' : 's'} total
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* By task type */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">By task type</p>
          <div className="flex flex-col gap-2">
            {stats.byTaskType.map(r => (
              <div key={r.type} className="flex items-center gap-2">
                <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium w-20 text-center shrink-0 ${taskTypeBar(r.type as SessionType)}`}>{r.type}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${r.rate * 100}%` }} />
                </div>
                <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 w-12 text-right shrink-0">
                  {r.interrupted}/{r.total} <span className="text-gray-400 dark:text-gray-600">({(r.rate * 100).toFixed(0)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top interrupted sessions */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">Most interrupted sessions</p>
          <div className="flex flex-col gap-1.5">
            {stats.topSessions.slice(0, 6).map(s => (
              <button key={s.sessionId} onClick={() => onOpenSession(s.sessionId)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full group">
                <span className="text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400 w-4 shrink-0">{s.count}×</span>
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{s.project}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(s.startedAt)}</span>
                <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors shrink-0">→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

function ThrashCard({ sessions, onOpenSession }: { sessions: ThrashSession[]; onOpenSession: (id: string) => void }) {
  if (sessions.length === 0) return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Loop / Thrash Detection</h3>
      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No thrashing detected — no tool called 3+ times with the same argument.</p>
    </Card>
  )
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Loop / Thrash Detection</h3>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">Sessions where the same tool call repeated ≥3× on the same target</p>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-600">{sessions.length} sessions</span>
      </div>
      <div className="flex flex-col gap-2">
        {sessions.map(s => (
          <button key={s.sessionId} onClick={() => onOpenSession(s.sessionId)}
            className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full group">
            <span className="text-sm font-bold tabular-nums text-rose-500 dark:text-rose-400 w-8 shrink-0 text-center leading-tight mt-0.5">
              {s.thrashScore}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{s.project}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(s.startedAt)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.patterns.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 text-[11px] bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 rounded px-1.5 py-0.5">
                    <span className={`font-mono px-1 rounded text-[10px] ${toolColor(p.tool)}`}>{p.tool}</span>
                    <span className="truncate max-w-[120px]">{p.key}</span>
                    <span className="font-semibold tabular-nums">×{p.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors shrink-0 mt-0.5">→</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function ToolErrorsCard({ stats }: { stats: ToolErrorStats }) {
  const maxErrors = Math.max(...stats.rows.map(r => r.errors), 1)
  const overallPct = (stats.overallRate * 100).toFixed(1)
  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tool Error Rate</h3>
          {stats.totalCalls > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-0.5">
              <span className={stats.overallRate > 0.05 ? 'text-rose-500 dark:text-rose-400 font-medium' : stats.overallRate > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'}>
                {stats.totalErrors.toLocaleString()} failed
              </span>
              {' / '}
              {stats.totalCalls.toLocaleString()} calls · {overallPct}%
            </p>
          )}
        </div>
        {stats.rows.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-600 shrink-0">Tools with ≥3 calls</span>
        )}
      </div>

      {stats.totalCalls === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-500">No tool calls recorded.</p>
      ) : stats.rows.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No failing tools — everything returned clean.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {stats.rows.map(r => {
            const ratePct = (r.errorRate * 100).toFixed(r.errorRate >= 0.1 ? 0 : 1)
            const isHigh = r.errorRate >= 0.2
            return (
              <div key={r.name} className="flex items-center gap-3">
                <span title={r.name} className={`text-xs px-2 py-0.5 rounded font-mono w-24 text-center shrink-0 truncate ${toolColor(r.name)}`}>{r.name}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${isHigh ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${(r.errors / maxErrors) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-24 text-right shrink-0">
                  {r.errors} / {r.total}
                </span>
                <span className={`text-xs font-medium tabular-nums w-12 text-right shrink-0 ${isHigh ? 'text-rose-500 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {ratePct}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function ToolLearningCurveCard({ sessions }: { sessions: Session[] }) {
  const data = React.useMemo(() => {
    if (sessions.length < 10) return null

    const weekMap = new Map<string, { label: string; byTool: Map<string, { total: number; errors: number }> }>()
    for (const s of sessions) {
      const date = new Date(s.startedAt)
      const key  = getWeekKey(date)
      const entry = weekMap.get(key) ?? {
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        byTool: new Map(),
      }
      for (const turn of s.turns) {
        for (const tc of turn.toolCalls) {
          const t = entry.byTool.get(tc.name) ?? { total: 0, errors: 0 }
          t.total++
          if (tc.isError) t.errors++
          entry.byTool.set(tc.name, t)
        }
      }
      weekMap.set(key, entry)
    }

    const weeks = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
    if (weeks.length < 4) return null

    // Overall error rate per week
    const overallRates = weeks.map(w => {
      let total = 0, errors = 0
      for (const v of w.byTool.values()) { total += v.total; errors += v.errors }
      return { label: w.label, rate: total > 0 ? errors / total : 0 }
    })

    // Per-tool trends — need ≥4 weeks with ≥3 calls each
    const allTools = new Set<string>()
    for (const w of weeks) for (const t of w.byTool.keys()) allTools.add(t)

    const toolTrends: { name: string; recentRate: number; priorRate: number; delta: number; totalCalls: number }[] = []
    for (const name of allTools) {
      const qualified = weeks.map(w => w.byTool.get(name)).filter((p): p is NonNullable<typeof p> => !!p && p.total >= 3)
      if (qualified.length < 4) continue
      const half = Math.floor(qualified.length / 2)
      const recent = qualified.slice(-Math.min(3, half + 1))
      const prior  = qualified.slice(0,  Math.min(3, half))
      const recentRate = recent.reduce((s, p) => s + p.errors, 0) / Math.max(1, recent.reduce((s, p) => s + p.total, 0))
      const priorRate  = prior.reduce((s, p) => s + p.errors, 0) / Math.max(1, prior.reduce((s, p) => s + p.total, 0))
      const totalCalls = qualified.reduce((s, p) => s + p.total, 0)
      // Only include tools where there's a meaningful error rate to track (skip perfectly clean tools)
      if (priorRate === 0 && recentRate === 0) continue
      toolTrends.push({ name, recentRate, priorRate, delta: recentRate - priorRate, totalCalls })
    }

    toolTrends.sort((a, b) => b.delta - a.delta)
    return { overallRates, toolTrends }
  }, [sessions])

  if (!data) return null
  if (data.toolTrends.length === 0 && data.overallRates.every(r => r.rate === 0)) return null

  const improving = data.toolTrends.filter(t => t.delta < -0.005).slice(0, 4)
  const worsening = data.toolTrends.filter(t => t.delta >  0.005).slice(0, 4)

  // SVG sparkline for overall error rate
  const maxRate = Math.max(...data.overallRates.map(r => r.rate), 0.01)
  const W = 120, H = 32
  const pts = data.overallRates
  const toX = (i: number) => (i / (pts.length - 1)) * W
  const toY = (r: number) => H - (r / maxRate) * H
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.rate).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`
  const lastRate = data.overallRates.at(-1)?.rate ?? 0
  const firstRate = data.overallRates[0]?.rate ?? 0
  const overallDelta = lastRate - firstRate
  const overallColor = overallDelta > 0.01 ? 'text-rose-500 dark:text-rose-400' : overallDelta < -0.01 ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-600'

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Tool Learning Curve</h3>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">error rate by tool over time · prior 3 weeks vs recent 3 weeks</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-gray-400 dark:text-gray-600">overall {data.overallRates.length}w trend</span>
            <span className={`text-xs font-semibold tabular-nums ${overallColor}`}>
              {(lastRate * 100).toFixed(1)}% err {overallDelta > 0.01 ? '↑' : overallDelta < -0.01 ? '↓' : '→'}
            </span>
          </div>
          <svg width={W} height={H} className="shrink-0">
            <defs>
              <linearGradient id="lcgrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={overallDelta > 0.01 ? '#f43f5e' : '#10b981'} stopOpacity={0.25} />
                <stop offset="100%" stopColor={overallDelta > 0.01 ? '#f43f5e' : '#10b981'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#lcgrad)" />
            <path d={linePath} fill="none" stroke={overallDelta > 0.01 ? '#f43f5e' : overallDelta < -0.01 ? '#10b981' : '#6b7280'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {(improving.length > 0 || worsening.length > 0) ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">↓ Most improved</p>
            {improving.length === 0
              ? <p className="text-[11px] text-gray-400 dark:text-gray-600 italic">None this period</p>
              : <div className="flex flex-col gap-1.5">
                  {improving.map(t => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono shrink-0 max-w-[96px] truncate ${toolColor(t.name)}`} title={t.name}>{t.name}</span>
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {(t.priorRate * 100).toFixed(1)}% → {(t.recentRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
            }
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">↑ Watch out</p>
            {worsening.length === 0
              ? <p className="text-[11px] text-gray-400 dark:text-gray-600 italic">None this period</p>
              : <div className="flex flex-col gap-1.5">
                  {worsening.map(t => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono shrink-0 max-w-[96px] truncate ${toolColor(t.name)}`} title={t.name}>{t.name}</span>
                      <span className="text-xs text-rose-600 dark:text-rose-400 tabular-nums">
                        {(t.priorRate * 100).toFixed(1)}% → {(t.recentRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">All tools stable — no significant error rate movement between periods.</p>
      )}
    </Card>
  )
}

function SessionLifecycleCard({ sessions }: { sessions: Session[] }) {
  const data = React.useMemo(() => {
    if (sessions.length < 5) return null

    const durations = sessions.map(s => s.durationMs / 60_000).sort((a, b) => a - b)
    const costs     = sessions.map(s => sessionCostUSD(s)).sort((a, b) => a - b)
    const turns     = sessions.map(s => s.turns.length).sort((a, b) => a - b)

    const p = (arr: number[], pct: number) => arr[Math.floor(arr.length * pct)] ?? 0

    const durationBuckets = [
      { label: '<2m',    min: 0,   max: 2          },
      { label: '2-5m',   min: 2,   max: 5          },
      { label: '5-15m',  min: 5,   max: 15         },
      { label: '15-30m', min: 15,  max: 30         },
      { label: '30-60m', min: 30,  max: 60         },
      { label: '>1h',    min: 60,  max: Infinity   },
    ].map(b => ({ ...b, count: durations.filter(d => d >= b.min && d < b.max).length }))

    const costBuckets = [
      { label: '<1¢',    min: 0,    max: 0.01      },
      { label: '1-5¢',   min: 0.01, max: 0.05      },
      { label: '5-20¢',  min: 0.05, max: 0.20      },
      { label: '20¢-$1', min: 0.20, max: 1.00      },
      { label: '>$1',    min: 1.00, max: Infinity   },
    ].map(b => ({ ...b, count: costs.filter(c => c >= b.min && c < b.max).length }))

    return {
      total: sessions.length,
      medianDuration: p(durations, 0.5),
      p75Duration: p(durations, 0.75),
      medianCost: p(costs, 0.5),
      p75Cost: p(costs, 0.75),
      medianTurns: Math.round(p(turns, 0.5)),
      durationBuckets,
      costBuckets,
    }
  }, [sessions])

  if (!data) return null

  const maxDur  = Math.max(...data.durationBuckets.map(b => b.count), 1)
  const maxCost = Math.max(...data.costBuckets.map(b => b.count), 1)
  const fmtMin = (m: number) => m < 1 ? `${Math.round(m * 60)}s` : `${Math.round(m)}m`

  const Histogram = ({ buckets, max, color }: { buckets: { label: string; count: number }[]; max: number; color: string }) => (
    <div className="flex items-end gap-1 h-14">
      {buckets.map(b => {
        const h = Math.max(b.count > 0 ? 2 : 0, Math.round((b.count / max) * 56))
        return (
          <div key={b.label} className="group relative flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full flex flex-col justify-end" style={{ height: '56px' }}>
              <div className={`w-full rounded-t-sm transition-colors cursor-default ${color}`} style={{ height: `${h}px` }} />
            </div>
            <span className="text-[9px] text-gray-400 dark:text-gray-600 truncate w-full text-center">{b.label}</span>
            {b.count > 0 && (
              <div className="absolute bottom-full mb-5 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                {b.count} sessions ({Math.round((b.count / data.total) * 100)}%)
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Session Lifecycle</h3>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">{data.total} sessions — duration &amp; cost distribution</p>
        </div>
        <div className="flex items-center gap-5 shrink-0 text-xs">
          {[
            { label: 'median duration', val: fmtMin(data.medianDuration) },
            { label: 'p75 duration',    val: fmtMin(data.p75Duration)    },
            { label: 'median cost',     val: fmtUSD(data.medianCost)     },
            { label: 'p75 cost',        val: fmtUSD(data.p75Cost)        },
            { label: 'median turns',    val: String(data.medianTurns)    },
          ].map(({ label, val }) => (
            <div key={label} className="text-right">
              <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">{label}</p>
              <p className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{val}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">By duration</p>
          <Histogram buckets={data.durationBuckets} max={maxDur} color="bg-indigo-500/60 hover:bg-indigo-500/80" />
        </div>
        <div>
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide mb-2">By cost</p>
          <Histogram buckets={data.costBuckets} max={maxCost} color="bg-emerald-500/60 hover:bg-emerald-500/80" />
        </div>
      </div>
    </Card>
  )
}

// ── Opportunities (aggregate recommendations) ───────────────────────────────

const REC_SEVERITY_TONE: Record<RecSeverity, 'danger' | 'warning' | 'neutral'> = {
  high:   'danger',
  medium: 'warning',
  low:    'neutral',
}

const REC_CATEGORY_LABEL: Record<RecCategory, string> = {
  cost:     'Cost',
  context:  'Context',
  skill:    'Skill',
  workflow: 'Workflow',
}

const REC_CATEGORY_TONE: Record<RecCategory, 'success' | 'primary' | 'warning' | 'neutral'> = {
  cost:     'success',
  context:  'primary',
  skill:    'warning',
  workflow: 'neutral',
}

const REC_CATEGORY_ORDER: RecCategory[] = ['cost', 'context', 'workflow', 'skill']

function RecommendationTrendCard({ trend }: { trend: RecTrend }) {
  if (trend.rules.length === 0) {
    return (
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Trend Over Time</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">No recommendations recorded in the last {trend.monthKeys.length} months.</p>
      </Card>
    )
  }

  const maxCount = Math.max(...trend.rules.flatMap(r => r.months), 1)
  const dirStyle: Record<RuleTrendDirection, { icon: string; color: string; label: string }> = {
    improving: { icon: '↓', color: 'text-emerald-600 dark:text-emerald-400', label: 'improving' },
    worsening: { icon: '↑', color: 'text-rose-500 dark:text-rose-400',      label: 'worsening' },
    stable:    { icon: '→', color: 'text-gray-400 dark:text-gray-600',      label: 'stable'    },
    new:       { icon: '●', color: 'text-amber-500 dark:text-amber-400',    label: 'new'       },
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Trend Over Time</h3>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">Same rules, tracked month-by-month — are things getting better?</p>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">last {trend.monthKeys.length} months</span>
      </div>

      {/* Column header row — mini month labels */}
      <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-600 px-2 mb-1">
        <span className="w-16" />                    {/* direction column */}
        <span className="flex-1" />                   {/* title column */}
        <div className="flex items-end gap-0.5">
          {trend.monthLabels.map((lbl, i) => (
            <span key={i} className="w-5 text-center tabular-nums">{lbl.slice(0, 3)}</span>
          ))}
        </div>
        <span className="w-10 text-right">total</span>
      </div>

      <div className="flex flex-col gap-1">
        {trend.rules.map(r => {
          const style = dirStyle[r.direction]
          return (
            <div key={r.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
              <span className={`text-[11px] font-medium tabular-nums w-16 shrink-0 ${style.color}`} title={`Trend: ${style.label}`}>
                <span className="mr-1">{style.icon}</span>{style.label}
              </span>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <Badge tone={REC_CATEGORY_TONE[r.category]} size="sm">{REC_CATEGORY_LABEL[r.category]}</Badge>
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{r.title}</span>
              </div>
              <div className="flex items-end gap-0.5 shrink-0" title={trend.monthLabels.map((lbl, i) => `${lbl}: ${r.months[i]}`).join(' · ')}>
                {r.months.map((count, i) => {
                  const heightPx = count === 0 ? 2 : Math.max(3, Math.round((count / maxCount) * 20))
                  const isLatest = i === r.months.length - 1
                  const fill = count === 0
                    ? 'bg-gray-200 dark:bg-gray-800'
                    : isLatest
                      ? 'bg-indigo-500'
                      : 'bg-indigo-400/60 dark:bg-indigo-500/50'
                  return (
                    <div key={i} className="w-5 h-5 flex items-end justify-center">
                      <div className={`w-4 rounded-sm ${fill}`} style={{ height: `${heightPx}px` }} />
                    </div>
                  )
                })}
              </div>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 tabular-nums w-10 text-right shrink-0">{r.totalCount}</span>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Each bar is the number of sessions that triggered this rule in that month. Direction compares the older half of the window vs the newer half.
      </p>
    </Card>
  )
}

function GoldStandardCard({ sessions, onOpenSession }: { sessions: GoldStandardSession[]; onOpenSession: (id: string) => void }) {
  if (sessions.length === 0) {
    return (
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Gold-Standard Sessions</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing qualifies yet — gold sessions need ≥10 turns, ≥10 tool calls, {'<'}2% error rate.
        </p>
      </Card>
    )
  }
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Gold-Standard Sessions</h3>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">Substantive sessions with hot cache, no errors, low $/turn — learn from these</p>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex flex-col gap-1">
        {sessions.map(s => (
          <button
            key={s.sessionId}
            onClick={() => onOpenSession(s.sessionId)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left group"
          >
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums w-10 shrink-0">
              {(s.score * 100).toFixed(0)}
            </span>
            <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{s.project}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0">{s.turns} turns</span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums w-20 text-right shrink-0" title="Cache hit rate">
              {(s.cacheHitRate * 100).toFixed(0)}% cache
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0" title="Cost per turn">
              {fmtUSD(s.costPerTurn)}/turn
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(s.startedAt)}</span>
            <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors shrink-0">→</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function RuleCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-[10px] px-2 py-1 rounded-md font-medium tabular-nums transition-colors ${
        copied
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
      title="Copy this one rule to clipboard — paste it into your existing CLAUDE.md"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

function ClaudeMdGeneratorCard({ sessions, antiPatterns, skillGaps, onOpenSession }: {
  sessions: Session[]
  antiPatterns: BashAntiPattern[]
  skillGaps: SkillGap[]
  onOpenSession: (id: string, turnId?: string) => void
}) {
  const [allCopied, setAllCopied] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [existingMd, setExistingMd] = useState('')
  const rules = React.useMemo(
    () => claudeMdRules({ sessions, antiPatterns, skillGaps }),
    [sessions, antiPatterns, skillGaps]
  )
  const content = React.useMemo(
    () => generateProjectClaudeMd({ sessions, antiPatterns, skillGaps }),
    [sessions, antiPatterns, skillGaps]
  )

  const grouped = React.useMemo(() => {
    const m = new Map<ClaudeMdRule['section'], ClaudeMdRule[]>()
    for (const r of rules) {
      const list = m.get(r.section) ?? []
      list.push(r)
      m.set(r.section, list)
    }
    return m
  }, [rules])

  const diff = React.useMemo(() => {
    if (!existingMd.trim()) return null
    return claudeMdDiff(existingMd, rules)
  }, [existingMd, rules])

  const violations: ClaudeMdViolationReport | null = React.useMemo(() => {
    if (!existingMd.trim()) return null
    return claudeMdViolations(existingMd, rules, sessions)
  }, [existingMd, rules, sessions])

  const download = () => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'CLAUDE.md'
    a.click()
    URL.revokeObjectURL(url)
  }
  const copyAll = () => {
    navigator.clipboard.writeText(content)
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 2000)
  }

  const totalSavings = rules.reduce((s, r) => s + r.savingsUSD, 0)

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Personalised CLAUDE.md</h3>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Copy individual rules to paste into your existing CLAUDE.md, or grab the whole file.
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1">
            {rules.length === 0
              ? 'Nothing actionable yet — your sessions are tracking well.'
              : `${rules.length} rule${rules.length === 1 ? '' : 's'} across ${grouped.size} section${grouped.size === 1 ? '' : 's'}${totalSavings >= 0.01 ? ` · up to ${fmtUSD(totalSavings)} in savings` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={copyAll}>{allCopied ? 'Copied ✓' : 'Copy all'}</Button>
          <Button size="sm" onClick={download}>↓ Download</Button>
        </div>
      </div>

      {rules.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          {CLAUDE_MD_SECTION_ORDER.map(section => {
            const list = grouped.get(section)
            if (!list || list.length === 0) return null
            const missingIds = diff ? new Set(diff.missing.map(r => r.id)) : null
            return (
              <div key={section}>
                <h4 className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">{section}</h4>
                <div className="flex flex-col gap-1.5">
                  {list.map(r => {
                    const status: 'covered' | 'missing' | 'untracked' =
                      !missingIds ? 'untracked'
                      : missingIds.has(r.id) ? 'missing'
                      : 'covered'
                    return (
                      <div
                        key={r.id}
                        className={`flex items-start gap-3 px-3 py-2 rounded-lg border transition-colors ${
                          status === 'covered'
                            ? 'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/30'
                            : status === 'missing'
                              ? 'bg-amber-50/70 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40'
                              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            {status === 'covered' && <Badge tone="success" size="sm">already in CLAUDE.md</Badge>}
                            {status === 'missing' && <Badge tone="warning" size="sm">missing — add this</Badge>}
                            {r.userPattern && <Badge tone="primary" size="sm">personalised</Badge>}
                          </div>
                          <p className={`text-xs leading-relaxed ${status === 'covered' ? 'text-gray-500 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                            {r.text.replace(/^- /, '')}
                          </p>
                          {r.userPattern && (
                            <p className="text-[11px] italic text-indigo-700 dark:text-indigo-300 mt-1 leading-snug">
                              Your data: {r.userPattern}
                            </p>
                          )}
                          <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1 tabular-nums">{r.evidence}</p>
                        </div>
                        <RuleCopyButton text={r.text} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={() => setDiffOpen(v => !v)}
          className="flex items-center gap-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <span>{diffOpen ? '▾' : '▸'}</span>
          <span>Compare with your existing CLAUDE.md</span>
          {diff && (
            <span className="ml-1 text-[10px] normal-case tracking-normal">
              <Badge tone="success" size="sm">{diff.covered.length} covered</Badge>{' '}
              <Badge tone="warning" size="sm">{diff.missing.length} missing</Badge>
            </span>
          )}
        </button>
        {diffOpen && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
              Paste the content of your project's <code className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">CLAUDE.md</code> (or <code className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">~/.claude/CLAUDE.md</code>) below. Rules already covered will be dimmed; missing rules stay highlighted so you can copy them one by one.
            </p>
            <textarea
              value={existingMd}
              onChange={e => setExistingMd(e.target.value)}
              placeholder="Paste existing CLAUDE.md content here…"
              className="w-full h-40 text-xs font-mono bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-3 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-y"
              spellCheck={false}
            />
            {existingMd.trim() && diff && (
              <p className="text-[11px] text-gray-600 dark:text-gray-400">
                {diff.missing.length === 0
                  ? `Your CLAUDE.md already covers all ${rules.length} suggested rule${rules.length === 1 ? '' : 's'}.`
                  : `${diff.missing.length} of ${rules.length} suggested rule${rules.length === 1 ? '' : 's'} are not yet in your CLAUDE.md.`}
              </p>
            )}

            {violations && violations.violations.length > 0 && (
              <div className="mt-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5 px-3 py-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h5 className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-wide">
                    Rules violated despite being in CLAUDE.md
                  </h5>
                  <span className="text-[10px] text-rose-600/70 dark:text-rose-400/70 tabular-nums">
                    last {violations.windowDays}d · {violations.recentSessionCount} recent sessions
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">
                  These rules are already in your pasted CLAUDE.md but recent sessions still triggered them — worth a closer look.
                </p>
                <div className="flex flex-col gap-2">
                  {violations.violations.map(v => (
                    <div key={v.rule.id} className="flex flex-col gap-1 px-2 py-2 rounded-md bg-white dark:bg-gray-900 border border-rose-100 dark:border-rose-500/20">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-gray-800 dark:text-gray-200 leading-snug flex-1">
                          {v.rule.text.replace(/^- /, '')}
                        </p>
                        <Badge tone="danger" size="sm">{v.sessions.length} violation{v.sessions.length === 1 ? '' : 's'}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600">Jump to</span>
                        {v.sessions.slice(0, 6).map((s, i) => (
                          <button
                            key={s.sessionId + i}
                            onClick={() => onOpenSession(s.sessionId, s.turnUuid)}
                            title={`${s.project} · ${fmt(s.startedAt)} — ${s.evidence}`}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-gray-600 dark:text-gray-300 hover:text-indigo-700 dark:hover:text-indigo-300 font-mono"
                          >
                            {s.project}/{fmt(s.startedAt)}
                          </button>
                        ))}
                        {v.sessions.length > 6 && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-600">+{v.sessions.length - 6} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {violations && violations.violations.length === 0 && diff && diff.covered.length > 0 && (
              <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 px-3 py-2">
                <p className="text-xs text-emerald-800 dark:text-emerald-200 font-medium">
                  No violations in the last {violations.windowDays} days — your CLAUDE.md is working.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

function OpportunitiesView({ agg, trend, totalSessions, sessions, antiPatterns, skillGaps, gold, onOpenSession }: { agg: RecAggregate; trend: RecTrend; totalSessions: number; sessions: Session[]; antiPatterns: BashAntiPattern[]; skillGaps: SkillGap[]; gold: GoldStandardSession[]; onOpenSession: (id: string, turnId?: string) => void }) {
  if (agg.sessionCount === 0) {
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <EmptyState
            title="No opportunities found"
            description="Every session in the current range looks efficient — no cost, context, skill, or workflow recommendations to act on."
          />
        </Card>
        <RecommendationTrendCard trend={trend} />
        <GoldStandardCard sessions={gold} onOpenSession={onOpenSession} />
      </div>
    )
  }

  const maxCatCount = Math.max(...REC_CATEGORY_ORDER.map(c => agg.byCategory[c].count), 1)
  const maxRuleSavings = Math.max(...agg.byRule.map(r => r.savingsUSD), 0.0001)

  return (
    <div className="flex flex-col gap-5">
      {/* ── Banner ── */}
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Potential Savings</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {fmtUSD(agg.totalSavingsUSD)}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">across {agg.sessionCount} of {totalSessions} sessions</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1.5 max-w-xl leading-relaxed">
              Estimated savings if every flagged suggestion were applied. Numbers compare current spend against the same token mix on a cheaper model, shorter cache TTL, or removed redundant reads.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sessions flagged</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{agg.sessionCount}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Distinct rules</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums">{agg.byRule.length}</span>
          </div>
        </div>
      </Card>

      {/* ── By category ── */}
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">By Category</h3>
        <div className="grid grid-cols-4 gap-4">
          {REC_CATEGORY_ORDER.map(cat => {
            const c = agg.byCategory[cat]
            const pct = (c.count / maxCatCount) * 100
            return (
              <div key={cat} className="flex flex-col gap-2">
                <Badge tone={REC_CATEGORY_TONE[cat]} size="sm">{REC_CATEGORY_LABEL[cat]}</Badge>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{c.count}</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-500">issues</span>
                </div>
                <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className="h-1 bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                {c.savingsUSD > 0.01 && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">save {fmtUSD(c.savingsUSD)}</span>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* ── By rule (ranked) ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Top Issues</h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">ranked by potential savings</span>
        </div>
        <div className="flex flex-col gap-2">
          {agg.byRule.map(r => {
            const barPct = r.savingsUSD > 0 ? (r.savingsUSD / maxRuleSavings) * 100 : 0
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800">
                <Badge tone={REC_SEVERITY_TONE[r.severity]} size="sm">{r.severity}</Badge>
                <Badge tone={REC_CATEGORY_TONE[r.category]} size="sm">{REC_CATEGORY_LABEL[r.category]}</Badge>
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{r.title}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-500 tabular-nums w-20 text-right shrink-0">{r.count}× sessions</span>
                <div className="w-24 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0">
                  <div className="h-1 bg-emerald-500 rounded-full" style={{ width: `${barPct}%` }} />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100 tabular-nums w-16 text-right shrink-0">
                  {r.savingsUSD > 0.01 ? fmtUSD(r.savingsUSD) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      <RecommendationTrendCard trend={trend} />

      {/* ── Top sessions ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Top Sessions to Review</h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">highest potential savings first</span>
        </div>
        <div className="flex flex-col gap-1">
          {agg.topSessions.map(s => (
            <button
              key={s.sessionId}
              onClick={() => onOpenSession(s.sessionId)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left group"
            >
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums w-16 shrink-0">
                {s.savingsUSD > 0.01 ? fmtUSD(s.savingsUSD) : '—'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-12 shrink-0">{s.count} issue{s.count === 1 ? '' : 's'}</span>
              <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{s.project}</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(s.startedAt)}</span>
              <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors shrink-0">→</span>
            </button>
          ))}
        </div>
      </Card>

      <GoldStandardCard sessions={gold} onOpenSession={onOpenSession} />

      <ClaudeMdGeneratorCard sessions={sessions} antiPatterns={antiPatterns} skillGaps={skillGaps} onOpenSession={onOpenSession} />
    </div>
  )
}

function BashBreakdownCard({ breakdown }: { breakdown: BashCategory[] }) {
  const total = breakdown.reduce((s, c) => s + c.count, 0)
  const max = Math.max(...breakdown.map(c => c.count), 1)
  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">
        Bash Usage  <span className="text-gray-400 dark:text-gray-600 normal-case font-normal">{total} lines</span>
      </h3>
      <div className="flex flex-col gap-2.5">
        {breakdown.slice(0, 8).map(({ label, count }) => {
          const pct = Math.round((count / total) * 100)
          const barColor = BASH_CATEGORY_COLORS[label] ?? 'bg-gray-400'
          return (
            <div key={label} className="flex items-center gap-3">
              <span className="text-xs text-gray-600 dark:text-gray-400 w-36 shrink-0 truncate font-mono">{label}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-500 w-20 text-right shrink-0">{count} ({pct}%)</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function WorkflowTipsCard({ antiPatterns }: { antiPatterns: BashAntiPattern[] }) {
  const totalCalls = antiPatterns.reduce((s, p) => s + p.count, 0)
  const totalChars = antiPatterns.reduce((s, p) => s + p.totalResultChars, 0)
  const maxChars = Math.max(...antiPatterns.map(p => p.totalResultChars), 1)
  const [showSnippet, setShowSnippet] = useState(false)
  const [copied, setCopied] = useState(false)

  const snippet = React.useMemo(() => generateClaudeMd(antiPatterns), [antiPatterns])

  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Context Waste
        </h3>
        {totalChars > 0 && (
          <span className="text-xs font-mono font-semibold text-rose-500 dark:text-rose-400">
            ~{fmtTokensFromChars(totalChars)} tokens
          </span>
        )}
      </div>

      {antiPatterns.length === 0 ? (
        <div className="flex flex-col gap-2 mt-4">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">No context waste detected</p>
          <p className="text-xs text-gray-500 dark:text-gray-600">You're using dedicated tools where they're available.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-600 mb-4">
            {totalCalls} Bash calls dumped <span className="text-rose-500 dark:text-rose-400 font-medium">{fmtChars(totalChars)} chars</span> of verbose output into context
          </p>
          <div className="flex flex-col gap-3.5">
            {antiPatterns.map(p => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-rose-600 dark:text-rose-400 shrink-0">{p.bashCmd}</span>
                  <span className="text-gray-400 dark:text-gray-600 text-xs">→</span>
                  <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">{p.betterTool}</span>
                  <span className="ml-auto text-xs text-gray-500 tabular-nums shrink-0">{p.count}× · {fmtChars(p.avgResultChars)} avg</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                    <div className="h-1 rounded-full bg-rose-400/70" style={{ width: `${(p.totalResultChars / maxChars) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-400 dark:text-gray-600 tabular-nums w-12 text-right shrink-0">{fmtChars(p.totalResultChars)}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-600">{p.tip}</p>
              </div>
            ))}
          </div>

          {/* CLAUDE.md generator */}
          <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => setShowSnippet(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-600/10 hover:bg-indigo-100 dark:hover:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 transition-colors text-left"
            >
              <span className="text-xs font-semibold">Fix with CLAUDE.md</span>
              <span className="text-xs text-indigo-500 dark:text-indigo-400">{showSnippet ? '▾ hide' : '▸ generate'}</span>
            </button>

            {showSnippet && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="relative">
                  <pre className="text-[11px] font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-3 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {snippet}
                  </pre>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copy}
                    className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${copied ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <span className="text-[11px] text-gray-400 dark:text-gray-600">
                    Paste into <code className="text-gray-500">~/.claude/CLAUDE.md</code>
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

// ── Skills & Agents Cards ─────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  'Explore':          'bg-cyan-500',
  'general-purpose':  'bg-indigo-500',
  'Plan':             'bg-violet-500',
  'pr-reviewer':      'bg-rose-500',
  'create-pr':        'bg-emerald-500',
  'retro-agent':      'bg-amber-500',
  'statusline-setup': 'bg-sky-500',
  'claude-code-guide':'bg-orange-500',
}

// ── Progress Dashboard ────────────────────────────────────────────────────────

const SOFT_TASKS = new Set(['conversation', 'exploration', 'research'])
const BUILTIN_CMDS = new Set([
  '/clear','/exit','/compact','/help','/init','/plugin','/reload-plugins',
  '/status','/doctor','/model','/fast','/memory','/config','/resume',
  '/bug','/login','/logout','/pr-comments','/vim','/terminal-setup',
  '/cost','/diff','/review','/settings',
])

function sessionSkills(s: Session): number {
  let n = 0
  for (const t of s.turns) {
    if (t.role !== 'user') continue
    for (const m of t.text.matchAll(/<command-name>([^<]+)<\/command-name>/g)) {
      const cmd = m[1]?.trim() ?? ''
      if (cmd && !BUILTIN_CMDS.has(cmd)) n++
    }
  }
  return n
}

function dominantModelFamily(s: Session): string {
  let best = '', bestTokens = 0
  for (const [model, u] of Object.entries(s.stats.modelUsage)) {
    const total = u.inputTokens + u.outputTokens + u.cacheCreateTokens + u.cacheReadTokens
    if (total > bestTokens) { bestTokens = total; best = model }
  }
  return modelFamily(best)
}

type ProgressPoint = { label: string; value: number }
type ProgressLine  = { key: string; color: string; points: ProgressPoint[] }
type ProgressMetric = {
  id: string
  title: string
  points: ProgressPoint[]
  lines?: ProgressLine[]   // multi-line override
  currentLabel: string
  trend: 'improving' | 'worsening' | 'stable' | 'insufficient'
  trendLabel: string
  higherIsBetter: boolean
}

function MiniSparkline({ points, trend, higherIsBetter }: { points: ProgressPoint[]; trend: ProgressMetric['trend']; higherIsBetter: boolean }) {
  if (points.length < 2) return <div className="flex-1 h-8 bg-gray-50 dark:bg-gray-900 rounded" />
  const vals = points.map(p => p.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 120, H = 32, PAD = 4
  const iw = W - PAD * 2, ih = H - PAD * 2
  const x = (i: number) => PAD + (i / (points.length - 1)) * iw
  const y = (v: number) => PAD + ih - ((v - min) / range) * ih
  const pts = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const area = `M${x(0)},${PAD + ih} L${points.map((p, i) => `${x(i)},${y(p.value)}`).join(' L')} L${x(points.length - 1)},${PAD + ih} Z`
  const color = trend === 'insufficient' ? '#9ca3af'
    : (trend === 'improving') === higherIsBetter ? '#10b981' : trend === 'stable' ? '#6366f1' : '#f43f5e'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 h-8" preserveAspectRatio="none">
      <path d={area} fill={color} fillOpacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function MultiMiniSparkline({ lines }: { lines: ProgressLine[] }) {
  const allVals = lines.flatMap(l => l.points.map(p => p.value))
  if (allVals.length === 0) return <div className="w-full h-8 bg-gray-50 dark:bg-gray-900 rounded" />
  const maxLen = Math.max(...lines.map(l => l.points.length))
  if (maxLen < 2) return <div className="w-full h-8 bg-gray-50 dark:bg-gray-900 rounded" />
  const W = 120, H = 32, PAD = 4
  const iw = W - PAD * 2, ih = H - PAD * 2
  // Fixed 0–100 scale (cost share %)
  const y = (v: number) => PAD + ih - (v / 100) * ih
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" preserveAspectRatio="none">
      {lines.map(line => {
        if (line.points.length < 2) return null
        const n = line.points.length
        const x = (i: number) => PAD + (i / (n - 1)) * iw
        const pts = line.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
        return <polyline key={line.key} points={pts} fill="none" stroke={line.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      })}
    </svg>
  )
}

function ProgressDashboardCard({ sessions }: { sessions: Session[] }) {
  const metrics = React.useMemo((): ProgressMetric[] => {
    if (sessions.length === 0) return []

    type Bucket = {
      label: string
      qualityTotal: number; qualityCount: number
      cacheIn: number; cacheRead: number
      modelCost: Record<string, number>   // family → cost
      skillTotal: number; sessCount: number
    }
    const map = new Map<string, Bucket>()

    for (const s of sessions) {
      const date = new Date(s.startedAt)
      const key = getWeekKey(date)
      const b = map.get(key) ?? {
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        qualityTotal: 0, qualityCount: 0,
        cacheIn: 0, cacheRead: 0,
        modelCost: { opus: 0, sonnet: 0, haiku: 0, other: 0 },
        skillTotal: 0, sessCount: 0,
      }

      const q = sessionQualityScore(s)
      if (q.rated) { b.qualityTotal += q.score; b.qualityCount++ }

      const u = s.stats.usage
      b.cacheIn += u.inputTokens + u.cacheCreateTokens + u.cacheReadTokens
      b.cacheRead += u.cacheReadTokens

      for (const [model, u] of Object.entries(s.stats.modelUsage)) {
        const fam = modelFamily(model) as 'opus' | 'sonnet' | 'haiku' | 'other'
        b.modelCost[fam] = (b.modelCost[fam] ?? 0) + costOfUsage(u, model)
      }

      b.skillTotal += sessionSkills(s)
      b.sessCount++

      map.set(key, b)
    }

    const weeks = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => b)

    if (weeks.length < 2) return []

    function trendDir(pts: number[], higher: boolean): ProgressMetric['trend'] {
      if (pts.length < 4) return 'insufficient'
      const half = Math.floor(pts.length / 2)
      const recent = pts.slice(-Math.min(3, half + 1))
      const prior  = pts.slice(0, Math.min(3, half))
      const rAvg = recent.reduce((s, v) => s + v, 0) / recent.length
      const pAvg = prior.reduce((s, v) => s + v, 0) / prior.length
      if (pAvg === 0) return 'insufficient'
      const delta = (rAvg - pAvg) / pAvg
      if (Math.abs(delta) < 0.03) return 'stable'
      const improving = higher ? delta > 0 : delta < 0
      return improving ? 'improving' : 'worsening'
    }

    function trendLabel(t: ProgressMetric['trend']): string {
      return t === 'improving' ? '↑ improving' : t === 'worsening' ? '↓ worsening' : t === 'stable' ? '→ stable' : '···'
    }

    const qualityPts = weeks
      .filter(b => b.qualityCount > 0)
      .map(b => ({ label: b.label, value: b.qualityTotal / b.qualityCount }))
    const cachePts = weeks
      .filter(b => b.cacheIn > 0)
      .map(b => ({ label: b.label, value: (b.cacheRead / b.cacheIn) * 100 }))
    // Per-model cost share (%) per week
    const modelLines: ProgressLine[] = (['opus', 'sonnet', 'haiku'] as const)
      .filter(f => weeks.some(b => (b.modelCost[f] ?? 0) > 0))
      .map(f => ({
        key: f,
        color: f === 'opus' ? '#a855f7' : f === 'sonnet' ? '#0ea5e9' : '#14b8a6',
        points: weeks.map(b => {
          const total = Object.values(b.modelCost).reduce((s, v) => s + v, 0)
          return { label: b.label, value: total > 0 ? ((b.modelCost[f] ?? 0) / total) * 100 : 0 }
        }),
      }))

    // For trend: is Opus share going down? (good)
    const opusLine = modelLines.find(l => l.key === 'opus')
    const modelPts = opusLine?.points ?? []
    const skillPts = weeks
      .map(b => ({ label: b.label, value: b.sessCount > 0 ? b.skillTotal / b.sessCount : 0 }))

    const lastQ = qualityPts.at(-1)
    const lastC = cachePts.at(-1)
    const lastWeekCost = weeks.at(-1)?.modelCost ?? {}
    const lastTotal = Object.values(lastWeekCost).reduce((s, v) => s + v, 0)
    const lastM = modelLines.length > 0 && lastTotal > 0
      ? modelLines
          .map(l => ({ key: l.key, pct: Math.round(((lastWeekCost[l.key as keyof typeof lastWeekCost] ?? 0) / lastTotal) * 100) }))
          .filter(x => x.pct > 0)
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 3)
          .map(x => `${x.key[0]!.toUpperCase()}${x.key.slice(1)} ${x.pct}%`)
          .join(' · ')
      : null

    // Suppress Opus trend when it's negligible (<3% consistently)
    const opusMaxPct = opusLine ? Math.max(...opusLine.points.map(p => p.value)) : 0
    const lastS = skillPts.at(-1)

    const qTrend = trendDir(qualityPts.map(p => p.value), true)
    const cTrend = trendDir(cachePts.map(p => p.value), true)
    const mTrend = trendDir(modelPts.map(p => p.value), false)
    const sTrend = trendDir(skillPts.map(p => p.value), true)

    return [
      {
        id: 'quality', title: 'Session quality', points: qualityPts, higherIsBetter: true,
        currentLabel: lastQ ? `${scoreToGrade(lastQ.value)} avg (${Math.round(lastQ.value)}/100)` : '—',
        trend: qTrend, trendLabel: trendLabel(qTrend),
      },
      {
        id: 'cache', title: 'Cache hit rate', points: cachePts, higherIsBetter: true,
        currentLabel: lastC ? `${Math.round(lastC.value)}%` : '—',
        trend: cTrend, trendLabel: trendLabel(cTrend),
      },
      {
        id: 'model', title: 'Model mix', points: modelPts, lines: modelLines, higherIsBetter: false,
        currentLabel: lastM ?? '—',
        trend: opusMaxPct < 3 ? 'insufficient' : mTrend,
        trendLabel: opusMaxPct < 3 ? 'No Opus' : `Opus ${trendLabel(mTrend)}`,
      },
      {
        id: 'skills', title: 'Skills / session', points: skillPts, higherIsBetter: true,
        currentLabel: lastS ? `${lastS.value.toFixed(1)}` : '—',
        trend: sTrend, trendLabel: trendLabel(sTrend),
      },
    ]
  }, [sessions])

  if (metrics.length === 0) return null

  const trendColor = (t: ProgressMetric['trend'], higher: boolean) => {
    if (t === 'insufficient' || t === 'stable') return 'text-gray-400 dark:text-gray-600'
    return (t === 'improving') === higher
      ? 'text-emerald-500 dark:text-emerald-400'
      : 'text-rose-500 dark:text-rose-400'
  }

  return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
        Am I Improving?
        <span className="font-normal normal-case ml-2 text-gray-400">weekly trend across key habits</span>
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {metrics.map(m => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
                {m.title}
                {m.lines && m.lines.map(l => (
                  <span key={l.key} className="flex items-center gap-0.5 text-[9px] font-medium" style={{ color: l.color }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: l.color }} />{l.key}
                  </span>
                ))}
              </span>
              <span className={`text-[10px] font-medium ${trendColor(m.trend, m.higherIsBetter)}`}>{m.trendLabel}</span>
            </div>
            {m.lines ? (
              <div className="flex flex-col gap-0.5">
                <MultiMiniSparkline lines={m.lines} />
                <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">{m.currentLabel}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MiniSparkline points={m.points} trend={m.trend} higherIsBetter={m.higherIsBetter} />
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 tabular-nums shrink-0 w-24 text-right">{m.currentLabel}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-gray-400 dark:text-gray-600">Trend compares last 3 weeks vs. prior 3 weeks. Needs ≥4 weeks of data.</p>
    </Card>
  )
}

function SkillsCard({ skillUsage, agents }: { skillUsage: SkillUsage[]; agents: AgentTypeUsage[] }) {
  const totalAgentCalls = agents.reduce((s, a) => s + a.count, 0)
  const maxAgent = Math.max(...agents.map(a => a.count), 1)

  return (
    <Card className="flex flex-col gap-5">
      {/* Skills used */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
          Skills Used
        </h3>
        {skillUsage.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-600">No skill invocations found in your sessions.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {skillUsage.map(s => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400 w-40 truncate shrink-0">{s.name}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-indigo-500"
                    style={{ width: `${(s.count / (skillUsage[0]?.count ?? 1)) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-500 tabular-nums w-28 text-right shrink-0">
                  {s.count}× · {s.projectCount} {s.projectCount === 1 ? 'project' : 'projects'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent breakdown */}
      {agents.length > 0 && (
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
            Agents  <span className="text-gray-400 dark:text-gray-600 normal-case font-normal">{totalAgentCalls} calls</span>
          </h3>
          <div className="flex flex-col gap-2">
            {agents.map(a => {
              const barColor = AGENT_COLORS[a.type] ?? 'bg-gray-400'
              return (
                <div key={a.type} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-600 dark:text-gray-400 w-40 truncate shrink-0">{a.type}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${barColor}`}
                      style={{ width: `${(a.count / maxAgent) * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums w-8 text-right shrink-0">{a.count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function SkillGapsCard({ gaps }: { gaps: SkillGap[] }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Skill Gaps
        </h3>
        {gaps.length > 0 && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{gaps.length} opportunity{gaps.length > 1 ? 'ies' : ''}</span>
        )}
      </div>

      {gaps.length === 0 ? (
        <div className="flex flex-col gap-2 mt-4">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Skills look well-utilised</p>
          <p className="text-xs text-gray-500 dark:text-gray-600">No obvious gaps detected based on your workflow patterns.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 mt-3">
          {gaps.map(g => (
            <div key={g.skill} className="flex flex-col gap-1.5 pb-4 border-b border-gray-100 dark:border-gray-800 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold text-amber-600 dark:text-amber-400">{g.skill}</span>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300">{g.description}</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-600 italic">{g.evidence}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600">Usage:</span>
                <span className="text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded">{g.howToUse}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Usage Persona Card ────────────────────────────────────────────────────────

function UsagePersonaCard({
  sessions,
  tasks,
  skillUsage,
  modelRows,
}: {
  sessions: Session[]
  tasks: { type: SessionType; count: number }[]
  skillUsage: SkillUsage[]
  modelRows: ModelUsageRow[]
}) {
  const stats = React.useMemo(() => {
    if (sessions.length === 0) return null

    // Sessions/week intensity
    const dates = sessions.map(s => new Date(s.startedAt).getTime())
    const oldest = Math.min(...dates)
    const newest = Math.max(...dates)
    const rangeWeeks = Math.max(1, (newest - oldest) / (7 * 24 * 60 * 60 * 1000))
    const perWeek = sessions.length / rangeWeeks
    const intensity = perWeek >= 7 ? 'Power user' : perWeek >= 3 ? 'Active' : perWeek >= 1 ? 'Regular' : 'Occasional'

    // Avg quality
    const scored = sessions.map(s => sessionQualityScore(s)).filter(q => q.rated)
    const avgScore = scored.length > 0 ? scored.reduce((s, q) => s + q.score, 0) / scored.length : null
    const avgGrade = avgScore === null ? null : avgScore >= 85 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 55 ? 'C' : avgScore >= 40 ? 'D' : 'F'

    // Skills per session
    const totalSkills = skillUsage.reduce((s, u) => s + u.count, 0)
    const skillsPerSession = sessions.length > 0 ? totalSkills / sessions.length : 0

    // Primary task
    const top = tasks[0]
    const primaryType = top ? top.type : null
    const primaryPct = top ? Math.round((top.count / sessions.length) * 100) : 0

    // Dominant model (by cost)
    const topModel = modelRows.length > 0 ? modelRows[0]! : null

    return { perWeek, intensity, avgScore, avgGrade, scored: scored.length, skillsPerSession, primaryType, primaryPct, topModel }
  }, [sessions, tasks, skillUsage, modelRows])

  if (!stats) return null

  const gradeColor: Record<string, string> = {
    A: 'text-emerald-600 dark:text-emerald-400',
    B: 'text-blue-600 dark:text-blue-400',
    C: 'text-amber-500 dark:text-amber-400',
    D: 'text-orange-500 dark:text-orange-400',
    F: 'text-rose-500 dark:text-rose-400',
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Primary use',
      value: stats.primaryType
        ? <span><span className={`font-semibold capitalize ${taskTypeColor(stats.primaryType)}`}>{stats.primaryType}</span> <span className="text-gray-400 dark:text-gray-600">· {stats.primaryPct}% of sessions</span></span>
        : <span className="text-gray-400">—</span>,
    },
    {
      label: 'Intensity',
      value: <span><span className="font-semibold text-gray-800 dark:text-gray-200">{stats.intensity}</span> <span className="text-gray-400 dark:text-gray-600">· {stats.perWeek.toFixed(1)} sessions/week</span></span>,
    },
    {
      label: 'Quality',
      value: stats.avgGrade
        ? <span><span className={`font-semibold ${gradeColor[stats.avgGrade]}`}>Grade {stats.avgGrade}</span> <span className="text-gray-400 dark:text-gray-600">· avg {Math.round(stats.avgScore!)}/100 across {stats.scored} rated sessions</span></span>
        : <span className="text-gray-400">Not enough data</span>,
    },
    {
      label: 'Skills',
      value: <span><span className="font-semibold text-gray-800 dark:text-gray-200">{stats.skillsPerSession.toFixed(1)}</span> <span className="text-gray-400 dark:text-gray-600">/session</span></span>,
    },
    {
      label: 'Top model',
      value: stats.topModel
        ? <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono text-[11px]">{stats.topModel.versionLabel}</span>
        : <span className="text-gray-400">—</span>,
    },
  ]

  return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Your Profile</h3>
      <div className="grid grid-cols-1 gap-2.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-baseline gap-3">
            <span className="text-[11px] text-gray-400 dark:text-gray-600 w-20 shrink-0">{label}</span>
            <span className="text-xs">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Quality Distribution Card ─────────────────────────────────────────────────

function QualityDistributionCard({ sessions }: { sessions: Session[] }) {
  const dist = React.useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
    let rated = 0
    for (const s of sessions) {
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      counts[q.grade] = (counts[q.grade] ?? 0) + 1
      rated++
    }
    return { counts, rated, total: sessions.length }
  }, [sessions])

  if (dist.rated === 0) return null

  const grades = ['A', 'B', 'C', 'D', 'F'] as const
  const gradeColors: Record<string, { bar: string; text: string; bg: string }> = {
    A: { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
    B: { bar: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20' },
    C: { bar: 'bg-amber-400',   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20' },
    D: { bar: 'bg-orange-400',  text: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-50 dark:bg-orange-900/20' },
    F: { bar: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-900/20' },
  }

  // Top grade by count for summary
  const topGrade = grades.reduce((a, b) => ((dist.counts[a] ?? 0) >= (dist.counts[b] ?? 0) ? a : b))

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Quality Distribution</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
          {dist.rated} of {dist.total} sessions rated
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {grades.map(g => {
          const count = dist.counts[g] ?? 0
          const pct = dist.rated > 0 ? (count / dist.rated) * 100 : 0
          const colors = gradeColors[g]!
          return (
            <div key={g} className="flex items-center gap-3">
              <span className={`text-xs font-bold w-4 shrink-0 ${colors.text}`}>{g}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                <div className={`h-2 rounded-full ${colors.bar} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right tabular-nums">
                {count} ({Math.round(pct)}%)
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-600">
        Most sessions grade <span className={`font-semibold ${gradeColors[topGrade]!.text}`}>{topGrade}</span>
        {' '}· A = ≥85, B = ≥70, C = ≥55, D = ≥40, F &lt; 40
      </p>
    </Card>
  )
}

// ── Quality Trend Card ────────────────────────────────────────────────────────

function getWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function QualityTrendCard({ sessions }: { sessions: Session[] }) {
  const weeks = React.useMemo(() => {
    const map = new Map<string, { total: number; count: number; label: string }>()
    for (const s of sessions) {
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      const date = new Date(s.startedAt)
      const key = getWeekKey(date)
      const e = map.get(key) ?? { total: 0, count: 0, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
      e.total += q.score
      e.count++
      map.set(key, e)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { total, count, label }]) => ({ avg: total / count, count, label }))
  }, [sessions])

  if (weeks.length < 2) return null

  const W = 600
  const H = 80
  const PAD = { top: 8, right: 12, bottom: 8, left: 12 }
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom

  const yScale = (v: number) => PAD.top + ih - (v / 100) * ih
  const xScale = (i: number) => PAD.left + (i / (weeks.length - 1)) * iw

  const points = weeks.map((w, i) => `${xScale(i)},${yScale(w.avg)}`).join(' ')
  const areaBottom = PAD.top + ih
  const areaPath = `M${xScale(0)},${areaBottom} L${weeks.map((w, i) => `${xScale(i)},${yScale(w.avg)}`).join(' L')} L${xScale(weeks.length - 1)},${areaBottom} Z`

  // Trend: last 3 weeks vs prior 3 weeks
  const half = Math.floor(weeks.length / 2)
  const recent = weeks.slice(-Math.min(3, half + 1))
  const prior  = weeks.slice(0, Math.min(3, half))
  const recentAvg = recent.reduce((s, w) => s + w.avg, 0) / recent.length
  const priorAvg  = prior.length > 0 ? prior.reduce((s, w) => s + w.avg, 0) / prior.length : recentAvg
  const delta = recentAvg - priorAvg
  const trendColor = delta > 3 ? '#10b981' : delta < -3 ? '#f43f5e' : '#6366f1'
  const trendLabel = delta > 3 ? `↑ ${delta.toFixed(0)}pt improving` : delta < -3 ? `↓ ${Math.abs(delta).toFixed(0)}pt worsening` : '→ stable'
  const trendTextColor = delta > 3 ? 'text-emerald-500' : delta < -3 ? 'text-rose-400' : 'text-gray-400 dark:text-gray-600'

  const THRESHOLDS = [
    { score: 85, label: 'A', color: '#10b981' },
    { score: 70, label: 'B', color: '#3b82f6' },
    { score: 55, label: 'C', color: '#f59e0b' },
    { score: 40, label: 'D', color: '#f97316' },
  ]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Quality Trend</h3>
        <span className={`text-[10px] font-medium tabular-nums ${trendTextColor}`}>{trendLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
        <defs>
          <linearGradient id="qt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {THRESHOLDS.map(t => {
          const y = yScale(t.score)
          if (y < PAD.top || y > PAD.top + ih) return null
          return (
            <g key={t.label}>
              <line x1={PAD.left} y1={y} x2={PAD.left + iw} y2={y}
                stroke={t.color} strokeWidth="0.75" strokeDasharray="3 4" opacity="0.4" />
              <text x={PAD.left - 2} y={y + 3} fontSize="7" fill={t.color} opacity="0.6" textAnchor="end">{t.label}</text>
            </g>
          )
        })}
        <path d={areaPath} fill="url(#qt-fill)" />
        <polyline points={points} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {weeks.map((w, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(w.avg)} r="2.5" fill={trendColor} opacity="0.8">
            <title>{w.label} · avg {Math.round(w.avg)}/100 ({w.count} session{w.count === 1 ? '' : 's'})</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400 dark:text-gray-700">{weeks[0]!.label}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-700">{weeks[weeks.length - 1]!.label}</span>
      </div>
    </Card>
  )
}

// ── Activity & Performance Cards ──────────────────────────────────────────────

function heatmapCellColor(count: number, max: number): string {
  if (count === 0) return 'bg-gray-100 dark:bg-gray-800'
  const ratio = max === 0 ? 0 : count / max
  if (ratio > 0.75) return 'bg-indigo-700 dark:bg-indigo-300'
  if (ratio > 0.5)  return 'bg-indigo-500 dark:bg-indigo-400'
  if (ratio > 0.25) return 'bg-indigo-400 dark:bg-indigo-600'
  return 'bg-indigo-200 dark:bg-indigo-900'
}

function qualityCellColor(score: number | undefined): string {
  if (score === undefined) return 'bg-gray-100 dark:bg-gray-800'
  if (score >= 85) return 'bg-emerald-500 dark:bg-emerald-400'
  if (score >= 70) return 'bg-blue-500 dark:bg-blue-400'
  if (score >= 55) return 'bg-amber-400 dark:bg-amber-400'
  if (score >= 40) return 'bg-orange-400 dark:bg-orange-400'
  return 'bg-rose-500 dark:bg-rose-400'
}

function scoreToGrade(score: number): string {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

function ActivityHeatmapCard({ cells, qualityByDate }: { cells: HeatmapCell[]; qualityByDate?: Map<string, number> }) {
  const [mode, setMode] = React.useState<'count' | 'quality'>('count')
  const max = Math.max(...cells.map(c => c.count), 1)
  const totalSessions = cells.reduce((s, c) => s + c.count, 0)
  const activeDays = cells.filter(c => c.count > 0).length
  const hasQuality = qualityByDate && qualityByDate.size > 0

  const weeks: HeatmapCell[][] = []
  for (const c of cells) {
    const col = weeks[c.weekIndex] ?? (weeks[c.weekIndex] = [])
    col.push(c)
  }

  const monthLabels: { weekIndex: number; label: string }[] = []
  let lastMonth = -1
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i]
    const firstDay = w?.[0]
    if (!firstDay) continue
    const m = new Date(firstDay.date).getMonth()
    if (m !== lastMonth) {
      monthLabels.push({ weekIndex: i, label: new Date(firstDay.date).toLocaleString('en-US', { month: 'short' }) })
      lastMonth = m
    }
  }

  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Activity <span className="font-normal text-gray-400">— last {weeks.length} weeks</span>
        </h3>
        <div className="flex items-center gap-3">
          {hasQuality && (
            <div className="flex items-center gap-1 text-[10px]">
              <button
                onClick={() => setMode('count')}
                className={`px-1.5 py-0.5 rounded ${mode === 'count' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'}`}
              >
                Frequency
              </button>
              <button
                onClick={() => setMode('quality')}
                className={`px-1.5 py-0.5 rounded ${mode === 'quality' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'}`}
              >
                Quality
              </button>
            </div>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
            {totalSessions} sessions · {activeDays} active days
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col gap-[3px] pt-4 text-[9px] text-gray-400 dark:text-gray-600 font-medium">
          {dowLabels.map((l, i) => (
            <div key={i} className="h-[11px] leading-[11px]">{i % 2 === 1 ? l : ''}</div>
          ))}
        </div>
        <div className="flex-1">
          <div className="relative h-3 mb-1 text-[9px] text-gray-400 dark:text-gray-600 font-medium">
            {monthLabels.map(({ weekIndex, label }) => (
              <span key={weekIndex} className="absolute" style={{ left: `calc(${weekIndex} * (11px + 3px))` }}>
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map(c => {
                  const qs = mode === 'quality' ? qualityByDate?.get(c.date) : undefined
                  const cellColor = mode === 'quality'
                    ? qualityCellColor(c.count > 0 ? qs : undefined)
                    : heatmapCellColor(c.count, max)
                  const tooltip = c.count === 0
                    ? `No sessions · ${c.date}`
                    : mode === 'quality' && qs !== undefined
                      ? `${c.count} session${c.count === 1 ? '' : 's'} · avg grade ${scoreToGrade(qs)} (${Math.round(qs)}) · ${c.date}`
                      : `${c.count} session${c.count === 1 ? '' : 's'} · ${c.date}`
                  return (
                    <div key={c.date} className="group relative">
                      <div
                        className={`w-[11px] h-[11px] rounded-[2px] ${cellColor} hover:ring-2 hover:ring-indigo-400 hover:ring-offset-0 transition-shadow cursor-default`}
                      />
                      <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-[11px] text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                        {tooltip}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {mode === 'count' ? (
            <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-gray-400 dark:text-gray-600">
              <span>Less</span>
              {[0, 0.2, 0.4, 0.7, 1].map(r => (
                <div key={r} className={`w-[11px] h-[11px] rounded-[2px] ${heatmapCellColor(Math.ceil(r * max), max)}`} />
              ))}
              <span>More</span>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-gray-400 dark:text-gray-600">
              {(['A', 'B', 'C', 'D', 'F'] as const).map((g, i) => {
                const scores = { A: 90, B: 75, C: 62, D: 42, F: 20 }
                return (
                  <React.Fragment key={g}>
                    <div className={`w-[11px] h-[11px] rounded-[2px] ${qualityCellColor(scores[g])}`} />
                    <span>{g}</span>
                  </React.Fragment>
                )
              })}
              <span className="ml-1 text-gray-300 dark:text-gray-700">avg grade</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function SlowestToolsCard({ calls, onOpenSession }: { calls: SlowToolCall[]; onOpenSession: (id: string, turnId?: string) => void }) {
  if (calls.length === 0) return null
  const max = Math.max(...calls.map(c => c.durationMs), 1)
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Slowest Tool Calls</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">click to jump</span>
      </div>
      <div className="flex flex-col gap-2">
        {calls.map((c, i) => (
          <button key={i}
            onClick={() => onOpenSession(c.sessionId, c.turnUuid)}
            className="flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg px-2 py-1.5 -mx-2 transition-colors">
            <span className={`text-xs px-2 py-0.5 rounded font-mono w-20 text-center shrink-0 truncate ${toolColor(c.toolName)}`}>{c.toolName}</span>
            <span className="flex-1 text-xs text-gray-600 dark:text-gray-400 font-mono truncate">{c.preview || <span className="text-gray-400 dark:text-gray-600">—</span>}</span>
            <div className="w-24 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 shrink-0">
              <div className={`h-1.5 rounded-full ${c.isError ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${(c.durationMs / max) * 100}%` }} />
            </div>
            <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums font-medium w-14 text-right shrink-0">{fmtToolDuration(c.durationMs)}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Duration = time between the tool call and its result. Long runs usually mean long-running Bash, large WebFetch, or nested Agent work.
      </p>
    </Card>
  )
}

function ThinkingDepthCard({ stats, onOpenSession }: { stats: ThinkingStats; onOpenSession: (id: string, turnId?: string) => void }) {
  if (stats.deepest.length === 0) return null
  const max = Math.max(...stats.deepest.map(r => r.thinkingBlocks), 1)
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deepest Thinking Sessions</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">
          {stats.totalBlocks.toLocaleString()} blocks · {stats.sessionsWithThinking} sessions
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {stats.deepest.map(r => {
          const density = r.assistantTurns > 0 ? r.thinkingBlocks / r.assistantTurns : 0
          return (
            <button key={r.sessionId}
              onClick={() => onOpenSession(r.sessionId)}
              className="flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg px-2 py-1.5 -mx-2 transition-colors">
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate w-40 shrink-0">{r.project}</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-500 font-mono w-20 shrink-0 tabular-nums">{fmt(r.startedAt)}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${(r.thinkingBlocks / max) * 100}%` }} />
              </div>
              <span className="text-[11px] text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0">{density.toFixed(1)}/turn</span>
              <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums font-medium w-12 text-right shrink-0">🧠 {r.thinkingBlocks}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Claude 4.x emits thinking blocks during multi-step reasoning. These tokens are <em>billed by Anthropic</em> but are <strong>not</strong> included in the session's reported <code className="font-mono">usage.output_tokens</code> — cclens's cost estimate is low for these sessions. See <a className="text-indigo-400 hover:underline" href="https://github.com/anthropics/claude-code/issues/31143" target="_blank" rel="noreferrer">anthropics/claude-code#31143</a>.
      </p>
    </Card>
  )
}

function ContextHotspotsCard({ stats, onOpenSession }: { stats: ContextHotspotStats; onOpenSession: (id: string, turnId?: string) => void }) {
  if (stats.rows.length === 0) return null
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Context Window Hotspots</h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-400 dark:text-gray-600">
            avg peak {fmtTokenCount(stats.avgPeakTokens)} · p90 {fmtTokenCount(stats.p90PeakTokens)}
          </span>
          {stats.nearCompactCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300">
              {stats.nearCompactCount} near auto-compact
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {stats.rows.map(r => {
          const pct = Math.min(1, r.pctOfLimit)
          const tone =
            pct >= 0.9 ? 'bg-rose-500' :
            pct >= 0.7 ? 'bg-amber-500' :
                         'bg-emerald-500'
          const limitLabel = r.contextLimit >= 1_000_000 ? '1M' : '200k'
          return (
            <button key={r.sessionId}
              onClick={() => onOpenSession(r.sessionId)}
              className="flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg px-2 py-1.5 -mx-2 transition-colors">
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate w-40 shrink-0">{r.project}</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-500 font-mono w-20 shrink-0 tabular-nums">{fmt(r.startedAt)}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 relative">
                <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${pct * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-20 text-right shrink-0 font-mono">
                {fmtTokenCount(r.peakContextTokens)}/{limitLabel}
              </span>
              <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums font-medium w-10 text-right shrink-0">{Math.round(pct * 100)}%</span>
            </button>
          )
        })}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Peak = max of <span className="font-mono">input + cache_read + cache_create</span> across assistant turns — the closest the session ever got to its context limit. Claude Code auto-compacts near ~95%.
      </p>
    </Card>
  )
}

function McpServersCard({ servers }: { servers: McpServerUsage[] }) {
  if (servers.length === 0) {
    return (
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">MCP Servers</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">No MCP tool calls found in this range.</p>
      </Card>
    )
  }
  const total = servers.reduce((s, v) => s + v.count, 0)
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">MCP Servers</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">{total} calls · {servers.length} server{servers.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex flex-col gap-3">
        {servers.map(s => (
          <div key={s.server} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100 font-mono truncate">{s.server}</span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                <div className="bg-fuchsia-500 h-1.5 rounded-full" style={{ width: `${(s.count / total) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-16 text-right shrink-0">{s.count} × {s.sessionCount}s</span>
            </div>
            <div className="flex flex-wrap gap-1 pl-1">
              {s.tools.map(t => (
                <span key={t.name} className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 font-mono">
                  {t.name} ×{t.count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function MultiFileSessionsCard({ sessions, onOpenSession }: { sessions: MultiFileSession[]; onOpenSession: (id: string) => void }) {
  if (sessions.length === 0) return null
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Most Files Touched</h3>
        <span className="text-xs text-gray-400 dark:text-gray-600">by session</span>
      </div>
      <div className="flex flex-col gap-2">
        {sessions.map(s => (
          <button key={s.sessionId} onClick={() => onOpenSession(s.sessionId)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full group">
            <span className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400 w-8 shrink-0 text-center leading-none">
              {s.fileCount}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{s.project}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(s.startedAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {s.topFiles.map(f => (
                  <span key={f.path} className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                    <FileIcon path={f.path} size={11} />
                    {f.fileName}
                  </span>
                ))}
                {s.fileCount > 4 && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-600">+{s.fileCount - 4} more</span>
                )}
              </div>
            </div>
            <span className="text-gray-400 dark:text-gray-600 text-xs ml-1 group-hover:text-indigo-400 transition-colors shrink-0">→</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function RegressionAlertCard({ report }: { report: RegressionReport }) {
  if (!report.confident || report.regressions.length === 0) return null

  const fmtMetric = (r: Regression, v: number) => {
    if (r.fmt === 'usd')   return fmtUSD(v)
    if (r.fmt === 'pct')   return `${(v * 100).toFixed(1)}%`
    return v.toFixed(1)
  }

  return (
    <Card className="border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-500/5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-rose-700 dark:text-rose-300 uppercase tracking-wide">
          Trending worse · last {report.recentWindowDays}d vs prior {report.baselineWindowDays}d
        </h3>
        <span className="text-[10px] text-rose-600/70 dark:text-rose-400/70 tabular-nums">
          {report.recentSessions} recent · {report.baselineSessions} baseline
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {report.regressions.map(r => (
          <div key={r.metric} className="flex items-center gap-3 text-xs">
            <span className="text-gray-700 dark:text-gray-300 w-48 shrink-0">{r.label}</span>
            <span className="tabular-nums text-gray-500 dark:text-gray-500 w-20 text-right">{fmtMetric(r, r.baseline)}</span>
            <span className="text-gray-400">→</span>
            <span className="tabular-nums text-gray-900 dark:text-gray-100 w-20 text-right font-medium">{fmtMetric(r, r.recent)}</span>
            <Badge tone="danger" size="sm">+{r.changePct.toFixed(0)}% worse</Badge>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70 mt-3 leading-relaxed">
        Check the Opportunities tab for session-level breakdowns, or filter Sessions by the most recent 7 days to see what changed.
      </p>
    </Card>
  )
}

// ── Your Habits ─────────────────────────────────────────────────────────────
// Flips the lens from "what Claude did wrong" to "what *you* do" — model
// picks, context splitting, commit hygiene, retry discipline. Each row shows
// a quantified bad-rate, a one-line fix, and an optional breakdown.

const HABIT_STATUS_DOT: Record<HabitStatus, string> = {
  good: 'bg-emerald-500',
  ok:   'bg-amber-500',
  bad:  'bg-rose-500',
}

const HABIT_STATUS_LABEL: Record<HabitStatus, string> = {
  good: 'good',
  ok:   'watch',
  bad:  'fix',
}

const HABIT_STATUS_BADGE: Record<HabitStatus, 'success' | 'warning' | 'danger'> = {
  good: 'success',
  ok:   'warning',
  bad:  'danger',
}

const BREAKDOWN_TONE: Record<'danger' | 'warning' | 'neutral', string> = {
  danger:  'text-rose-700 dark:text-rose-300',
  warning: 'text-amber-700 dark:text-amber-300',
  neutral: 'text-gray-600 dark:text-gray-400',
}

const TREND_GLYPH: Record<HabitTrendDirection, string> = {
  improving: '↓',
  worsening: '↑',
  stable:    '→',
  'insufficient-data': '·',
}

const TREND_TONE: Record<HabitTrendDirection, string> = {
  improving: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30',
  worsening: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/30',
  stable:    'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
  'insufficient-data': 'text-gray-400 dark:text-gray-600 bg-transparent border-transparent',
}

function HabitTrendChip({ trend, windowDays }: { trend: NonNullable<HabitWithTrend['trend']>; windowDays: number }) {
  if (trend.direction === 'insufficient-data') return null
  const absPp = Math.abs(trend.deltaPp)
  const label = trend.direction === 'stable'
    ? `steady (${windowDays}d)`
    : `${Math.round(absPp)}pp ${trend.direction === 'improving' ? 'better' : 'worse'}`
  return (
    <span
      title={`Last ${windowDays}d: ${(trend.recentBadRate * 100).toFixed(0)}% · prior ${windowDays}d: ${(trend.baselineBadRate * 100).toFixed(0)}%`}
      className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium tabular-nums ${TREND_TONE[trend.direction]}`}
    >
      <span>{TREND_GLYPH[trend.direction]}</span>
      <span>{label}</span>
    </span>
  )
}

function HabitRow({ habit, windowDays }: { habit: HabitWithTrend; windowDays: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`w-2 h-2 rounded-full ${HABIT_STATUS_DOT[habit.status]}`} />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{habit.title}</span>
        <Badge tone={HABIT_STATUS_BADGE[habit.status]} size="sm">{HABIT_STATUS_LABEL[habit.status]}</Badge>
        {habit.trend && <HabitTrendChip trend={habit.trend} windowDays={windowDays} />}
        {habit.penaltyUSD != null && habit.penaltyUSD >= 0.01 && (
          <Badge tone="neutral" size="sm">~{fmtUSD(habit.penaltyUSD)} penalty</Badge>
        )}
      </div>
      <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug">{habit.headline}</p>
      {habit.status !== 'good' && (
        <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-snug">
          <span className="font-medium text-gray-600 dark:text-gray-400">Try: </span>{habit.actionHint}
        </p>
      )}
      {habit.breakdown && habit.breakdown.length > 0 && (
        <ul className="flex flex-col gap-0.5 mt-1">
          {habit.breakdown.map((b, i) => (
            <li key={i} className="flex items-center gap-2 text-[11px]">
              <span className="text-gray-500 dark:text-gray-500 w-28 shrink-0">{b.label}</span>
              <span className={BREAKDOWN_TONE[b.tone]}>{b.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function YourHabitsCard({ sessions }: { sessions: Session[] }) {
  const [project, setProject] = React.useState<string>('all')

  // Projects with ≥5 sessions — anything smaller can't meaningfully pass the
  // MIN_TREND_SAMPLE threshold inside userHabitsTrend, so don't offer them.
  const projectOptions = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions) counts.set(s.project, (counts.get(s.project) ?? 0) + 1)
    return [...counts.entries()]
      .filter(([, n]) => n >= 5)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [sessions])

  const scoped = React.useMemo(
    () => project === 'all' ? sessions : sessions.filter(s => s.project === project),
    [sessions, project],
  )
  const report = React.useMemo(() => userHabitsTrend(scoped), [scoped])

  // If the selected project dropped below threshold after a global filter
  // change, snap back to "all" so the card doesn't silently empty out.
  React.useEffect(() => {
    if (project !== 'all' && !projectOptions.some(p => p.name === project)) {
      setProject('all')
    }
  }, [project, projectOptions])

  if (report.totalSessions < 5) return null
  const bad = report.habits.filter(h => h.status === 'bad').length
  const ok  = report.habits.filter(h => h.status === 'ok').length
  const good = report.habits.filter(h => h.status === 'good').length

  const scopeLabel = project === 'all' ? 'across' : `in ${project}, across`

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Your Habits
          </h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">what *you* do, {scopeLabel} {report.totalSessions} sessions · trend = last {report.recentWindowDays}d vs prior {report.baselineWindowDays}d</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {projectOptions.length >= 2 && (
            <select
              value={project}
              onChange={e => setProject(e.target.value)}
              className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500"
              aria-label="Scope habits by project"
            >
              <option value="all">All projects ({sessions.length})</option>
              {projectOptions.map(p => <option key={p.name} value={p.name}>{p.name} ({p.count})</option>)}
            </select>
          )}
          {good > 0 && <Badge tone="success" size="sm">{good} good</Badge>}
          {ok   > 0 && <Badge tone="warning" size="sm">{ok} watch</Badge>}
          {bad  > 0 && <Badge tone="danger"  size="sm">{bad} fix</Badge>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {report.habits.map(h => <HabitRow key={h.id} habit={h} windowDays={report.recentWindowDays} />)}
      </div>
    </Card>
  )
}

// ── Task-type playbook ──────────────────────────────────────────────────────
// For each task type with enough samples, compare the user's own top-20% vs
// bottom-20% sessions on cost-efficiency signals. The biggest deltas surface
// as "here is what separates your best X sessions from your worst" tips.

function PlaybookTipRow({ tip }: { tip: PlaybookTip }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-500 dark:text-gray-500 w-28 shrink-0 font-medium uppercase tracking-wide">{tip.label}</span>
        <span className="tabular-nums text-xs font-medium text-emerald-700 dark:text-emerald-300">{tip.topDisplay}</span>
        <span className="text-gray-300 dark:text-gray-600">vs</span>
        <span className="tabular-nums text-xs text-rose-700 dark:text-rose-400">{tip.bottomDisplay}</span>
      </div>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug pl-[7.5rem]">{tip.action}</p>
    </div>
  )
}

function TaskPlaybookRow({ pb }: { pb: TaskTypePlaybook }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${taskTypeColor(pb.type)}`}>{pb.type}</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-500 tabular-nums">
          top {pb.topSize} · bottom {pb.bottomSize} of {pb.sampleSize}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {pb.tips.map(tip => <PlaybookTipRow key={tip.metricId} tip={tip} />)}
      </div>
    </div>
  )
}

function TaskPlaybookCard({ report }: { report: PlaybookReport }) {
  if (report.playbooks.length === 0) return null
  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Your Playbook
          </h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">what separates your top-20% sessions from your bottom-20%, per task type</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {report.playbooks.map(pb => <TaskPlaybookRow key={pb.type} pb={pb} />)}
      </div>
    </Card>
  )
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function ProjectHealthCard({ health, sessions, onSelect }: { health: ProjectHealth[]; sessions?: Session[]; onSelect?: (project: string) => void }) {
  const qualityByProject = React.useMemo(() => {
    if (!sessions) return new Map<string, { avg: number; grade: string }>()
    const acc = new Map<string, { total: number; count: number }>()
    for (const s of sessions) {
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      const e = acc.get(s.project) ?? { total: 0, count: 0 }
      e.total += q.score
      e.count++
      acc.set(s.project, e)
    }
    const result = new Map<string, { avg: number; grade: string }>()
    for (const [project, { total, count }] of acc) {
      const avg = total / count
      const grade = avg >= 85 ? 'A' : avg >= 70 ? 'B' : avg >= 55 ? 'C' : avg >= 40 ? 'D' : 'F'
      result.set(project, { avg, grade })
    }
    return result
  }, [sessions])

  const costByProject = React.useMemo(() => {
    const acc = new Map<string, number>()
    for (const s of sessions ?? []) acc.set(s.project, (acc.get(s.project) ?? 0) + sessionCostUSD(s))
    return acc
  }, [sessions])

  if (health.length === 0) {
    return (
      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Project Health</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">No sessions in the current range.</p>
      </Card>
    )
  }

  // Baseline: median across projects with enough sessions to be trustworthy.
  // Falls back to all projects if nothing is confident yet.
  const confident = health.filter(h => !h.lowConfidence)
  const pool = confident.length > 0 ? confident : health
  const medianScore = median(pool.map(h => h.score))
  const medianCache = median(pool.map(h => h.cacheHitRate))
  const medianError = median(pool.map(h => h.errorRate))
  const medianGold  = median(pool.map(h => h.goldCount))
  const medianRecs  = median(pool.map(h => h.recsPerSession))
  const showBaseline = pool.length >= 2  // one project = nothing to compare against

  const scoreTone = (s: number) =>
    s >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
    s >= 60 ? 'text-lime-600   dark:text-lime-400'    :
    s >= 40 ? 'text-amber-600  dark:text-amber-400'   :
              'text-rose-500   dark:text-rose-400'
  const barFill = (s: number) =>
    s >= 80 ? 'bg-emerald-500' :
    s >= 60 ? 'bg-lime-500'    :
    s >= 40 ? 'bg-amber-500'   :
              'bg-rose-500'

  // Up/down indicator vs median. `higherIsBetter=true` means above median is good.
  const marker = (value: number, baseline: number, higherIsBetter: boolean): { glyph: string; tone: string } => {
    if (!showBaseline || baseline === 0) return { glyph: '', tone: '' }
    const diff = value - baseline
    // Ignore near-zero deltas: within 5% of median (absolute, since metrics vary in scale).
    const threshold = Math.max(Math.abs(baseline) * 0.05, 0.005)
    if (Math.abs(diff) < threshold) return { glyph: '·', tone: 'text-gray-400 dark:text-gray-600' }
    const good = higherIsBetter ? diff > 0 : diff < 0
    return {
      glyph: diff > 0 ? '▲' : '▼',
      tone: good ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400',
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Project Health</h3>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">0–100 composite: cache hit · 1 − error · gold-ratio · 1 − recs/session</p>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">{health.length} project{health.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-600 px-2 mb-1">
        <span className="w-10 text-right shrink-0">score</span>
        <span className="flex-1">project</span>
        <span className="w-16 text-right shrink-0">sessions</span>
        <span className="w-20 text-right shrink-0">cost</span>
        <span className="w-16 text-right shrink-0">cache</span>
        <span className="w-16 text-right shrink-0">errors</span>
        <span className="w-14 text-right shrink-0">gold</span>
        <span className="w-16 text-right shrink-0">recs/sess</span>
        {onSelect && <span className="w-4 shrink-0" />}
      </div>

      {showBaseline && (
        <div
          className="flex items-center gap-3 px-2 py-1.5 mb-1 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400"
          title={`Median across ${pool.length} project${pool.length === 1 ? '' : 's'}${confident.length === 0 ? ' (no confident projects yet)' : ''}`}
        >
          <span className="tabular-nums w-10 text-right shrink-0 font-medium">{medianScore.toFixed(0)}</span>
          <span className="flex-1 italic">your median{confident.length === 0 && ' (low-conf)'}</span>
          <span className="tabular-nums w-16 text-right shrink-0">—</span>
          <span className="tabular-nums w-20 text-right shrink-0">—</span>
          <span className="tabular-nums w-16 text-right shrink-0">{(medianCache * 100).toFixed(0)}%</span>
          <span className="tabular-nums w-16 text-right shrink-0">{(medianError * 100).toFixed(1)}%</span>
          <span className="tabular-nums w-14 text-right shrink-0">{medianGold.toFixed(medianGold < 1 ? 1 : 0)}</span>
          <span className="tabular-nums w-16 text-right shrink-0">{medianRecs.toFixed(1)}</span>
          {onSelect && <span className="w-4 shrink-0" />}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {health.map(h => {
          const mCache = marker(h.cacheHitRate, medianCache, true)
          const mError = marker(h.errorRate,    medianError, false)
          const mGold  = marker(h.goldCount,    medianGold,  true)
          const mRecs  = marker(h.recsPerSession, medianRecs, false)
          const cost = costByProject.get(h.project) ?? 0
          return (
          <div
            key={h.project}
            className={`flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors group ${onSelect ? 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer' : 'hover:bg-gray-50 dark:hover:bg-gray-900/50'}`}
            onClick={() => onSelect?.(h.project)}
          >
            <span className={`text-sm font-semibold tabular-nums w-10 text-right shrink-0 ${scoreTone(h.score)}`}>{h.score}</span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{h.project}</span>
                  {(() => {
                    const qp = qualityByProject.get(h.project)
                    if (!qp) return null
                    const gc: Record<string, string> = { A: 'text-emerald-600 dark:text-emerald-400', B: 'text-blue-500 dark:text-blue-400', C: 'text-amber-500 dark:text-amber-400', D: 'text-orange-500 dark:text-orange-400', F: 'text-rose-500 dark:text-rose-400' }
                    return <span className={`text-[10px] font-bold shrink-0 ${gc[qp.grade] ?? ''}`} title={`Avg session quality: ${Math.round(qp.avg)}/100`}>{qp.grade}</span>
                  })()}
                </div>
                <div className="h-1 mt-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className={`h-1 rounded-full ${barFill(h.score)}`} style={{ width: `${h.score}%` }} />
                </div>
              </div>
              {h.lowConfidence && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0" title="Score is noisy with fewer than 3 sessions">low-conf</span>
              )}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0">{h.sessionCount}</span>
            <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-20 text-right shrink-0">{cost > 0 ? fmtUSD(cost) : '—'}</span>
            <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0">
              {mCache.glyph && <span className={`mr-1 ${mCache.tone}`}>{mCache.glyph}</span>}
              {(h.cacheHitRate * 100).toFixed(0)}%
            </span>
            <span className={`text-xs tabular-nums w-16 text-right shrink-0 ${h.errorRate > 0.05 ? 'text-rose-500 dark:text-rose-400' : 'text-gray-500 dark:text-gray-500'}`}>
              {mError.glyph && <span className={`mr-1 ${mError.tone}`}>{mError.glyph}</span>}
              {(h.errorRate * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-14 text-right shrink-0">
              {mGold.glyph && <span className={`mr-1 ${mGold.tone}`}>{mGold.glyph}</span>}
              {h.goldCount}
            </span>
            <span className={`text-xs tabular-nums w-16 text-right shrink-0 ${h.recsPerSession > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500'}`}>
              {mRecs.glyph && <span className={`mr-1 ${mRecs.tone}`}>{mRecs.glyph}</span>}
              {h.recsPerSession.toFixed(1)}
            </span>
            {onSelect && <span className="text-xs text-gray-300 dark:text-gray-700 group-hover:text-indigo-400 transition-colors w-4 text-right shrink-0">→</span>}
          </div>
          )
        })}
      </div>
    </Card>
  )
}

function HotFilesCard({ files }: { files: HotFile[] }) {
  const max = Math.max(...files.map(f => f.totalOps), 1)
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Most Edited Files</h3>
        <span className="text-xs text-gray-400 dark:text-gray-600">{files.length} files</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {files.map(f => (
          <div key={f.path} className="flex items-center gap-3">
            <div className="shrink-0"><FileIcon path={f.path} size={14} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-xs font-mono font-medium text-gray-800 dark:text-gray-200 truncate">{f.fileName}</span>
                {f.dir && <span className="text-[11px] text-gray-400 dark:text-gray-600 truncate shrink-0">{f.dir}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1">
                  <div className="h-1 rounded-full bg-indigo-500" style={{ width: `${(f.totalOps / max) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs text-gray-500 tabular-nums">
              {f.editCount > 0 && <span className="text-amber-600 dark:text-amber-400">{f.editCount}E</span>}
              {f.writeCount > 0 && <span className="text-emerald-600 dark:text-emerald-400">{f.writeCount}W</span>}
              <span className="text-gray-400 dark:text-gray-600">·</span>
              <span>{f.sessionCount} {f.sessionCount === 1 ? 'session' : 'sessions'}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Project Detail ────────────────────────────────────────────────────────────

function ProjectDetailView({ project, sessions, onBack, onOpenSession }: {
  project: string
  sessions: Session[]
  onBack: () => void
  onOpenSession: (id: string) => void
}) {
  const projectSessions = React.useMemo(
    () => sessions.filter(s => s.project === project).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [sessions, project]
  )
  const sessionMetrics = React.useMemo(() => projectSessions.map(s => ({
    session: s,
    cost: sessionCostUSD(s),
    quality: sessionQualityScore(s),
    cls: classifySession(s),
  })), [projectSessions])
  const projectFiles = React.useMemo(() => hotFiles(projectSessions), [projectSessions])
  const projectTools = React.useMemo(() => globalToolStats(projectSessions).slice(0, 6), [projectSessions])
  const projectRecs = React.useMemo(() => aggregateRecommendations(projectSessions), [projectSessions])
  const totalCost = sessionMetrics.reduce((sum, m) => sum + m.cost, 0)
  const rated = sessionMetrics.filter(m => m.quality.rated)
  const avgQuality = rated.length === 0 ? 0 : rated.reduce((sum, m) => sum + m.quality.score, 0) / rated.length
  const maxTool = Math.max(...projectTools.map(t => t.count), 1)
  const gradeColor: Record<string, string> = {
    A: 'text-green-600 dark:text-green-400',
    B: 'text-blue-500 dark:text-blue-400',
    C: 'text-amber-500 dark:text-amber-400',
    D: 'text-orange-500 dark:text-orange-400',
    F: 'text-red-500 dark:text-red-400',
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors shrink-0">← All Projects</button>
        <span className="text-gray-300 dark:text-gray-700">/</span>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{project}</h2>
        <div className="ml-auto flex items-center gap-5 text-sm shrink-0">
          <span className="text-gray-500 dark:text-gray-400"><span className="font-semibold text-gray-900 dark:text-gray-100">{projectSessions.length}</span> sessions</span>
          <span className="text-gray-500 dark:text-gray-400"><span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(totalCost)}</span> total</span>
          {rated.length > 0 && (
            <span className="text-gray-500 dark:text-gray-400">avg grade <span className={`font-semibold ${gradeColor[scoreToGrade(avgQuality)] ?? ''}`}>{scoreToGrade(avgQuality)}</span></span>
          )}
        </div>
      </div>

      <Card>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Sessions</h3>
        {sessionMetrics.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-600">No sessions in current range.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sessionMetrics.map(({ session: s, cost, quality: q, cls }) => (
              <button key={s.id} onClick={() => onOpenSession(s.id)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left group">
                <span className="text-xs text-gray-500 dark:text-gray-500 w-24 shrink-0 tabular-nums">{fmt(s.startedAt)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-md w-20 text-center shrink-0 font-medium ${taskTypeColor(cls)}`}>{cls}</span>
                <span className="text-xs text-gray-400 dark:text-gray-600 w-14 shrink-0 tabular-nums">{fmtDuration(s.durationMs)}</span>
                <span className="text-xs text-gray-400 dark:text-gray-600 w-14 shrink-0 tabular-nums">{s.stats.toolCallCount} tools</span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">{fmtUSD(cost)}</span>
                {q.rated ? (
                  <span className={`text-xs font-bold shrink-0 w-5 ${gradeColor[q.grade] ?? ''}`}>{q.grade}</span>
                ) : <span className="w-5 shrink-0" />}
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-600 group-hover:text-indigo-400 transition-colors shrink-0">→</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {projectRecs.byRule.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Opportunities</h3>
            <span className="text-[10px] text-gray-400 dark:text-gray-600">{projectRecs.sessionCount} of {projectSessions.length} sessions affected</span>
          </div>
          <div className="flex flex-col gap-2">
            {projectRecs.byRule.slice(0, 5).map(r => {
              const tone: Record<string, 'danger' | 'warning' | 'neutral'> = { high: 'danger', medium: 'warning', low: 'neutral' }
              return (
                <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
                  <Badge tone={tone[r.severity] ?? 'neutral'} size="sm">{r.count}×</Badge>
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{r.title}</span>
                  {r.savingsUSD > 0.01 && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">save {fmtUSD(r.savingsUSD)}</span>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {(projectTools.length > 0 || projectFiles.length > 0) && (
        <div className="grid grid-cols-2 gap-5">
          {projectTools.length > 0 && (
            <Card>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Top Tools</h3>
              <div className="flex flex-col gap-2">
                {projectTools.map(tool => (
                  <div key={tool.name} className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono w-24 text-center shrink-0 truncate ${toolColor(tool.name)}`}>{tool.name}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                      <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right tabular-nums">{tool.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {projectFiles.length > 0 && <HotFilesCard files={projectFiles} />}
        </div>
      )}
    </div>
  )
}

// ── Project Tree ──────────────────────────────────────────────────────────────

type ProjectGroup = {
  parentDir: string
  parentLabel: string
  projects: ProjectSummary[]
  totalSessions: number
  totalToolCalls: number
}

function groupByParent(projects: ProjectSummary[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const p of projects) {
    const parts = p.projectPath.split('/').filter(Boolean)
    const parentParts = parts.slice(0, -1)
    const parentDir = '/' + parentParts.join('/')
    const parentLabel = parentParts[parentParts.length - 1] ?? '/'
    const existing = map.get(parentDir)
    if (existing) {
      existing.projects.push(p)
      existing.totalSessions += p.sessionCount
      existing.totalToolCalls += p.totalToolCalls
    } else {
      map.set(parentDir, { parentDir, parentLabel, projects: [p], totalSessions: p.sessionCount, totalToolCalls: p.totalToolCalls })
    }
  }
  return [...map.values()].sort((a, b) => b.totalSessions - a.totalSessions)
}

function ProjectTree({ projects, sessions, onOpenSession }: {
  projects: ProjectSummary[]
  sessions: Session[]
  onOpenSession: (id: string, turnId?: string) => void
}) {
  const groups = groupByParent(projects)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const toggleGroup = (dir: string) => setCollapsedGroups(prev => {
    const next = new Set(prev); next.has(dir) ? next.delete(dir) : next.add(dir); return next
  })
  const toggleProject = (name: string) => setExpandedProjects(prev => {
    const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
  })

  return (
    <div className="flex flex-col gap-1">
      {groups.map(group => {
        const isCollapsed = collapsedGroups.has(group.parentDir)
        return (
          <div key={group.parentDir}>
            <button onClick={() => toggleGroup(group.parentDir)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
              <span className="text-gray-500 text-xs w-3 shrink-0">{isCollapsed ? '▶' : '▼'}</span>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.parentLabel}</span>
              <span className="text-xs text-gray-500 dark:text-gray-600 truncate">{group.parentDir}</span>
              <div className="ml-auto flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">{group.projects.length} projects</span>
                <span className="text-xs text-gray-500">{group.totalSessions} sessions</span>
                <span className="text-xs text-gray-500">{group.totalToolCalls} calls</span>
              </div>
            </button>

            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 ml-5 pl-3 border-l border-gray-200 dark:border-gray-800">
                {group.projects.map(p => {
                  const isExpanded = expandedProjects.has(p.project)
                  const projectSessions = sessions.filter(s => s.project === p.project)
                  return (
                    <div key={p.project}>
                      <button onClick={() => toggleProject(p.project)}
                        className="w-full flex items-center gap-4 py-2 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                        <span className="text-gray-500 dark:text-gray-600 text-xs w-3 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{p.project}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-gray-500">{p.sessionCount} sessions</span>
                          <span className="text-xs text-gray-500">{p.totalToolCalls} calls</span>
                          <div className="flex gap-1">
                            {p.topTools.slice(0, 3).map(t => (
                              <span key={t.name} className={`text-xs px-1.5 py-0.5 rounded font-mono ${toolColor(t.name)}`}>{t.name}</span>
                            ))}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-600">{fmt(p.lastActiveAt)}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="ml-5 pl-3 border-l border-gray-200/60 dark:border-gray-800/60 flex flex-col gap-0.5 mb-1">
                          {projectSessions.length === 0 && (
                            <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-700">No sessions found</p>
                          )}
                          {projectSessions.map(s => {
                            const cost = sessionCostUSD(s)
                            const q = sessionQualityScore(s)
                            const qGradeColor: Record<string, string> = { A: 'text-green-600 dark:text-green-400', B: 'text-blue-500 dark:text-blue-400', C: 'text-amber-500 dark:text-amber-400', D: 'text-orange-500 dark:text-orange-400', F: 'text-red-500 dark:text-red-400' }
                            return (
                              <button key={s.id} onClick={() => onOpenSession(s.id)}
                                className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-indigo-600/10 transition-colors text-left group">
                                <span className="text-xs text-gray-500 group-hover:text-indigo-400 shrink-0">{fmt(s.startedAt)}</span>
                                <span className="text-xs text-gray-500 dark:text-gray-600">·</span>
                                <span className="text-xs text-gray-500 shrink-0">{s.stats.toolCallCount} calls</span>
                                <span className="text-xs text-gray-500 dark:text-gray-600">·</span>
                                <span className="text-xs text-gray-500 shrink-0">{fmtDuration(s.durationMs)}</span>
                                <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400 shrink-0">{fmtUSD(cost)}</span>
                                {q.rated && <span className={`text-xs font-bold shrink-0 ${qGradeColor[q.grade] ?? ''}`}>{q.grade}</span>}
                                <span className="ml-auto text-xs text-gray-400 dark:text-gray-700 group-hover:text-indigo-500">→</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Insights Tab ──────────────────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | 'all'
const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

function filterByRange(sessions: Session[], range: DateRange): Session[] {
  if (range === 'all') return sessions
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range])
  const cutoffISO = cutoff.toISOString()
  return sessions.filter(s => s.startedAt >= cutoffISO)
}

function RangePicker({ range, setRange }: { range: DateRange; setRange: (r: DateRange) => void }) {
  const options: { label: string; value: DateRange }[] = [
    { label: '7d', value: '7d' },
    { label: '30d', value: '30d' },
    { label: '90d', value: '90d' },
    { label: 'All', value: 'all' },
  ]
  return (
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => setRange(o.value)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            range === o.value
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Accordion Section ─────────────────────────────────────────────────────────

function LastSessionPill({ session, onOpen }: { session: Session | null; onOpen: (id: string) => void }) {
  if (!session) return null
  const cost = sessionCostUSD(session)
  const q = sessionQualityScore(session)
  const d = new Date(session.startedAt)
  const now = new Date()
  const todayStr = now.toDateString()
  const yesterdayStr = new Date(now.getTime() - 86_400_000).toDateString()
  const dateLabel = d.toDateString() === todayStr ? 'Today' : d.toDateString() === yesterdayStr ? 'Yesterday' : d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  const timeLabel = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  const projectName = session.projectPath.split('/').filter(Boolean).slice(-2).join('/')
  const gradeColor: Record<string, string> = {
    A: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    B: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    C: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    D: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
    F: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  }
  return (
    <Card>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Last Session</h3>
      <button
        onClick={() => onOpen(session.id)}
        className="w-full flex items-center gap-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left group"
      >
        <div className="flex flex-col items-center min-w-[44px]">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{dateLabel}</span>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">{timeLabel}</span>
        </div>
        <div className="w-px h-8 bg-gray-200 dark:bg-gray-800 shrink-0" />
        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate flex-1">{projectName || session.project}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-600">{session.turns.length} turns</span>
          <span className="text-xs text-gray-400 dark:text-gray-600">{fmtDuration(session.durationMs)}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtUSD(cost)}</span>
          {q.rated && (
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${gradeColor[q.grade]}`}>{q.grade}</span>
          )}
          <span className="text-gray-400 dark:text-gray-600 text-xs group-hover:text-indigo-400 transition-colors">→</span>
        </div>
      </button>
    </Card>
  )
}

function HomeRecommendationsCard({ agg, onViewAll }: { agg: RecAggregate; onViewAll: () => void }) {
  if (agg.byRule.length === 0) return null
  const top3 = agg.byRule.slice(0, 3)
  const severityTone: Record<string, 'danger' | 'warning' | 'neutral'> = { high: 'danger', medium: 'warning', low: 'neutral' }
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Top Opportunities</h3>
        {agg.byRule.length > 3 && (
          <button onClick={onViewAll} className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors">
            +{agg.byRule.length - 3} more in Analytics →
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {top3.map(r => (
          <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50">
            <Badge tone={severityTone[r.severity] ?? 'neutral'} size="sm">{r.count}×</Badge>
            <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{r.title}</span>
            {r.savingsUSD > 0.01 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">save {fmtUSD(r.savingsUSD)}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function ThisWeekCard({ sessions, onViewProject }: { sessions: Session[]; onViewProject?: (p: string) => void }) {
  const now = Date.now()
  const DAY = 86_400_000
  const thisWeek  = sessions.filter(s => now - new Date(s.startedAt).getTime() <  7 * DAY)
  const priorWeek = sessions.filter(s => {
    const age = now - new Date(s.startedAt).getTime()
    return age >= 7 * DAY && age < 14 * DAY
  })
  if (thisWeek.length === 0) return null

  const thisActiveDays  = new Set(thisWeek.map(s  => s.startedAt.slice(0, 10))).size
  const priorActiveDays = new Set(priorWeek.map(s => s.startedAt.slice(0, 10))).size
  const thisCost  = thisWeek.reduce((s, x) => s + sessionCostUSD(x), 0)
  const priorCost = priorWeek.reduce((s, x) => s + sessionCostUSD(x), 0)

  const qualGrades = thisWeek.map(s => sessionQualityScore(s)).filter(q => q.rated)
  const avgScore = qualGrades.length > 0 ? qualGrades.reduce((s, q) => s + q.score, 0) / qualGrades.length : null
  const bestGrade = qualGrades.length > 0 ? qualGrades.reduce((best, q) => q.score > best.score ? q : best).grade : null

  const projectCounts = new Map<string, number>()
  for (const s of thisWeek) projectCounts.set(s.project, (projectCounts.get(s.project) ?? 0) + 1)
  const topProject = [...projectCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topProjectName = topProject ? topProject[0].split('/').filter(Boolean).slice(-1)[0] ?? topProject[0] : null

  function Delta({ curr, prev, lowerBetter = false }: { curr: number; prev: number; lowerBetter?: boolean }) {
    if (prev === 0) return null
    const pct = Math.round(((curr - prev) / prev) * 100)
    if (pct === 0) return null
    const up = pct > 0
    const good = lowerBetter ? !up : up
    return (
      <span className={`text-[10px] font-medium ${good ? 'text-emerald-500' : 'text-rose-400'}`}>
        {up ? '↑' : '↓'}{Math.abs(pct)}%
      </span>
    )
  }

  const gradeColor: Record<string, string> = {
    A: 'text-emerald-600 dark:text-emerald-400',
    B: 'text-sky-600 dark:text-sky-400',
    C: 'text-amber-600 dark:text-amber-400',
    D: 'text-orange-600 dark:text-orange-400',
    F: 'text-rose-600 dark:text-rose-400',
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">This Week</h3>
        {topProject && onViewProject && (
          <button onClick={() => onViewProject(topProject[0])} className="text-[10px] text-indigo-500 hover:text-indigo-400 shrink-0">
            {topProjectName} ({topProject[1]} sess) →
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">Sessions</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{thisWeek.length}</p>
          <Delta curr={thisWeek.length} prev={priorWeek.length} />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">Active Days</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{thisActiveDays}</p>
          <Delta curr={thisActiveDays} prev={priorActiveDays} />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">Est. Cost</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{fmtUSD(thisCost)}</p>
          <Delta curr={thisCost} prev={priorCost} lowerBetter />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">Best Grade</p>
          {bestGrade
            ? <p className={`text-xl font-bold tabular-nums leading-tight ${gradeColor[bestGrade] ?? 'text-gray-500'}`}>{bestGrade}</p>
            : <p className="text-xl font-bold text-gray-400 dark:text-gray-600 leading-tight">—</p>
          }
          {avgScore !== null && <span className="text-[10px] text-gray-400 dark:text-gray-600">avg {Math.round(avgScore)}</span>}
        </div>
      </div>
    </Card>
  )
}

function SnippetHighlight({ snippet, query, isRegex }: { snippet: string; query: string; isRegex: boolean }) {
  let re: RegExp | null = null
  try { re = new RegExp(isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') } catch { re = null }
  if (!re) return <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{snippet}</span>

  const parts: { text: string; match: boolean }[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), match: false })
    parts.push({ text: m[0], match: true })
    last = m.index + m[0].length
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false })

  return (
    <span className="font-mono text-xs text-gray-600 dark:text-gray-400 leading-relaxed break-words">
      {parts.map((p, i) => p.match
        ? <mark key={i} className="bg-amber-200 dark:bg-amber-500/40 text-amber-900 dark:text-amber-100 not-italic rounded px-0.5">{p.text}</mark>
        : <span key={i}>{p.text}</span>
      )}
    </span>
  )
}

function SearchView({ sessions, onOpenSession }: {
  sessions: Session[]
  onOpenSession: (id: string, turnId?: string) => void
}) {
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const results = React.useMemo(
    () => debouncedQuery.trim() ? search(sessions, debouncedQuery, { regex: useRegex }) : [],
    [sessions, debouncedQuery, useRegex]
  )

  const bySession = React.useMemo(() => {
    const map = new Map<string, SearchResult[]>()
    for (const r of results) {
      const arr = map.get(r.sessionId) ?? []
      arr.push(r)
      map.set(r.sessionId, arr)
    }
    return [...map.entries()].map(([id, hits]) => ({
      sessionId: id,
      project: hits[0]!.project,
      firstTs: hits[0]!.timestamp,
      hits,
    }))
  }, [results])

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none" className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg text-gray-400 dark:text-gray-600 leading-none">⌕</span>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search all session text…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
            autoFocus
          />
          {query && (
            <button onClick={() => { setQuery(''); setDebouncedQuery('') }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none shrink-0">
            <input type="checkbox" checked={useRegex} onChange={e => setUseRegex(e.target.checked)} className="rounded" />
            Regex
          </label>
        </div>
      </Card>

      {!debouncedQuery && (
        <EmptyState title="Search session text" description="Searches user and assistant turns across all sessions. Supports plain text or regex." />
      )}

      {debouncedQuery && results.length === 0 && (
        <EmptyState title="No matches" description={`Nothing matched "${debouncedQuery}"`} />
      )}

      {results.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {results.length} hit{results.length === 1 ? '' : 's'} across {bySession.length} session{bySession.length === 1 ? '' : 's'}
          {results.length === 200 && ' (capped at 200 — refine query for more precise results)'}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {bySession.map(({ sessionId, project, hits }) => (
          <Card key={sessionId}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                  {project.split('/').filter(Boolean).slice(-2).join('/')}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600">{fmt(hits[0]!.timestamp)}</span>
              </div>
              <button
                onClick={() => onOpenSession(sessionId)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 ml-4"
              >
                Open session →
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {hits.slice(0, 5).map(hit => (
                <button
                  key={hit.turnUuid}
                  onClick={() => onOpenSession(hit.sessionId, hit.turnUuid)}
                  className="text-left p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge tone={hit.role === 'user' ? 'primary' : 'neutral'} size="sm">{hit.role}</Badge>
                    <span className="text-[10px] text-gray-400 dark:text-gray-600">{fmt(hit.timestamp)}</span>
                  </div>
                  <SnippetHighlight snippet={hit.snippet} query={debouncedQuery} isRegex={useRegex} />
                </button>
              ))}
              {hits.length > 5 && (
                <button
                  onClick={() => onOpenSession(sessionId)}
                  className="text-xs text-gray-400 dark:text-gray-600 hover:text-indigo-500 dark:hover:text-indigo-400 text-center py-1"
                >
                  +{hits.length - 5} more in this session →
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function AccordionSection({ id, title, badge, open, onToggle, children }: {
  id: string; title: string; badge?: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded-full">{badge}</span>
          )}
        </span>
        <span className={`text-gray-400 dark:text-gray-600 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="flex flex-col gap-5 p-5">
          {children}
        </div>
      )}
    </div>
  )
}

export function InsightsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string, turnId?: string) => void }) {
  const [range, setRange] = useState<DateRange>('all')
  const [deepDiveTool, setDeepDiveTool] = useState<string | null>(null)
  const filtered = React.useMemo(() => filterByRange(sessions, range), [sessions, range])

  const topTools = globalToolStats(filtered)
  const hourActivity = activityByHour(filtered)
  const depth = sessionDepthStats(filtered)
  const tasks = taskBreakdown(filtered)
  const trend = trendStats(sessions)  // monthly comparison — always uses full history
  const projects = React.useMemo(() => summarizeProjects(filtered), [filtered])
  const antiPatterns = React.useMemo(() => bashAntiPatterns(filtered), [filtered])
  const bashBreakdown = React.useMemo(() => bashCommandBreakdown(filtered), [filtered])
  const skillUsage = React.useMemo(() => skillUsageStats(filtered), [filtered])
  const gaps = React.useMemo(() => skillGaps(filtered, skillUsage), [filtered, skillUsage])
  const agents = React.useMemo(() => agentBreakdown(filtered), [filtered])
  const files = React.useMemo(() => hotFiles(filtered), [filtered])
  const multiFileSess = React.useMemo(() => multiFileSessions(filtered), [filtered])
  const usage = React.useMemo(() => totalUsage(filtered), [filtered])
  const modelRows = React.useMemo(() => usageByModel(filtered), [filtered])
  const costSeriesDays = range === 'all' ? 30 : RANGE_DAYS[range]
  const dailyCostSeries = React.useMemo(() => dailyCost(filtered, costSeriesDays), [filtered, costSeriesDays])
  const errorStats = React.useMemo(() => toolErrorRates(filtered), [filtered])
  const thrashSess = React.useMemo(() => thrashingSessions(filtered), [filtered])
  const interrupts = React.useMemo(() => interruptStats(filtered), [filtered])
  const slowCalls = React.useMemo(() => slowestToolCalls(filtered, 10), [filtered])
  const mcpServers = React.useMemo(() => mcpUsageStats(filtered), [filtered])
  const contextHotspots = React.useMemo(() => contextWindowHotspots(filtered, 10), [filtered])
  const costByTask = React.useMemo(() => costByTaskType(filtered), [filtered])
  const thinking = React.useMemo(() => thinkingStats(filtered, 10), [filtered])
  const cacheRanking = React.useMemo(() => sessionCacheRanking(filtered), [filtered])
  const heatmap = React.useMemo(() => activityHeatmap(sessions, 14), [sessions])  // fixed 14-week view
  const qualityByDate = React.useMemo(() => {
    const acc = new Map<string, { total: number; count: number }>()
    for (const s of sessions) {
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      const date = s.startedAt.slice(0, 10)
      const e = acc.get(date) ?? { total: 0, count: 0 }
      e.total += q.score
      e.count += 1
      acc.set(date, e)
    }
    return new Map([...acc.entries()].map(([d, { total, count }]) => [d, total / count]))
  }, [sessions])
  const forecast = React.useMemo(() => monthlyCostForecast(sessions), [sessions])  // full history — month-over-month
  const recAgg = React.useMemo(() => aggregateRecommendations(filtered), [filtered])
  const recTrend = React.useMemo(() => recommendationTrend(sessions), [sessions])  // full history — month-over-month
  const gold = React.useMemo(() => goldStandardSessions(filtered), [filtered])
  const health = React.useMemo(() => projectHealth(filtered), [filtered])
  const regressions = React.useMemo(() => recentRegressions(sessions), [sessions])  // full history — last 7d vs prior 7d
  const playbook = React.useMemo(() => taskTypePlaybook(filtered), [filtered])
  const hasUsageData = usage.totalTokens > 0
  const maxHour = Math.max(...hourActivity.map(h => h.count), 1)
  const maxTool = Math.max(...topTools.map(t => t.count), 1)
  const maxDailyCost = Math.max(...dailyCostSeries.map(d => d.costUSD), 0.0001)

  const qualityByHour = React.useMemo(() => {
    const acc = Array.from({ length: 24 }, () => ({ total: 0, count: 0 }))
    for (const s of filtered) {
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      const hour = new Date(s.startedAt).getHours()
      acc[hour]!.total += q.score
      acc[hour]!.count++
    }
    return acc.map((e, hour) => ({ hour, avg: e.count > 0 ? e.total / e.count : null, ratedCount: e.count }))
  }, [filtered])

  const qualityByDow = React.useMemo(() => {
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const acc = Array.from({ length: 7 }, () => ({ total: 0, rated: 0, sessions: 0 }))
    for (const s of filtered) {
      const d = new Date(s.startedAt).getDay()
      acc[d]!.sessions++
      const q = sessionQualityScore(s)
      if (!q.rated) continue
      acc[d]!.total += q.score
      acc[d]!.rated++
    }
    return acc.map((e, d) => ({ label: dow[d]!, sessions: e.sessions, avg: e.rated > 0 ? e.total / e.rated : null, ratedCount: e.rated }))
  }, [filtered])

  const hasHourQuality = qualityByHour.some(h => h.avg !== null)
  const hasDowQuality  = qualityByDow.some(d => d.avg !== null)

  const [insightTab, setInsightTab] = useState<'home' | 'analytics' | 'projects' | 'search'>('home')
  const [analyticsOpen, setAnalyticsOpen] = useState(() => new Set(['cost', 'quality']))
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [hourMode, setHourMode] = useState<'count' | 'quality'>('count')
  const totalToolCalls = topTools.reduce((s, t) => s + t.count, 0)

  const toggleAnalytics = (id: string) => setAnalyticsOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="flex flex-col gap-5">

      {/* ── Compact stat strip ── */}
      <Card className="px-6 py-4" padding="none">
        <StatStrip items={[
          { label: 'Sessions',     value: filtered.length.toLocaleString() },
          { label: 'Projects',     value: projects.length.toLocaleString() },
          { label: 'Tool Calls',   value: totalToolCalls.toLocaleString() },
          { label: 'Avg Duration', value: fmtDuration(depth.avgDurationMs) },
          { label: 'Avg Tools',    value: depth.avgToolCalls.toFixed(1) },
          { label: 'Avg Turns',    value: depth.avgTurns.toFixed(1) },
          { label: 'Pace',         value: fmtPace(depth.avgDurationMs, depth.avgToolCalls) },
        ]} />
      </Card>

      {/* ── Sub-tab nav + range picker + export ── */}
      <div className="flex items-center justify-between gap-2">
        <TabGroup value={insightTab} onChange={setInsightTab} variant="subtle">
          <Tab value="home">Home</Tab>
          <Tab value="analytics" badge={recAgg.sessionCount > 0 ? recAgg.sessionCount : undefined}>Analytics</Tab>
          <Tab value="projects">Projects</Tab>
          <Tab value="search">Search</Tab>
        </TabGroup>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            title="Download the current insights view as a Markdown report"
            onClick={() => exportInsightsAsMarkdown({
              rangeLabel: range === 'all' ? 'All time' : `Last ${RANGE_DAYS[range]} days`,
              sessionCount: filtered.length,
              projectCount: projects.length,
              totalToolCalls,
              depth,
              topTools,
              tasks,
              usage,
              modelRows,
              antiPatterns,
              slowCalls,
              skillUsage,
              gaps,
              mcpServers,
              hotFiles: files,
              errorStats,
              forecast,
              recAgg,
              recTrend,
              gold,
              regressions,
            })}
          >
            ↓ Report
          </Button>
          <RangePicker range={range} setRange={setRange} />
        </div>
      </div>

      {/* ── Home ── */}
      {insightTab === 'home' && (
        <div className="flex flex-col gap-5">
          <ThisWeekCard sessions={sessions} onViewProject={p => { setSelectedProject(p); setInsightTab('projects') }} />
          <RegressionAlertCard report={regressions} />
          <ProgressDashboardCard sessions={filtered} />
          <LastSessionPill session={sessions[0] ?? null} onOpen={onOpenSession} />
          <HomeRecommendationsCard agg={recAgg} onViewAll={() => setInsightTab('analytics')} />
          <UsagePersonaCard sessions={filtered} tasks={tasks} skillUsage={skillUsage} modelRows={modelRows} />
          <YourHabitsCard sessions={filtered} />
        </div>
      )}

      {/* ── Analytics ── */}
      {insightTab === 'analytics' && (
        <div className="flex flex-col gap-3">

          <AccordionSection id="opportunities" title="Opportunities" badge={recAgg.sessionCount} open={analyticsOpen.has('opportunities')} onToggle={() => toggleAnalytics('opportunities')}>
            <OpportunitiesView agg={recAgg} trend={recTrend} totalSessions={filtered.length} sessions={filtered} antiPatterns={antiPatterns} skillGaps={gaps} gold={gold} onOpenSession={onOpenSession} />
          </AccordionSection>

          <AccordionSection id="cost" title="Cost" open={analyticsOpen.has('cost')} onToggle={() => toggleAnalytics('cost')}>
            <CostPanel usage={usage} modelRows={modelRows} dailySeries={dailyCostSeries} maxDailyCost={maxDailyCost} hasData={hasUsageData} dailySeriesDays={costSeriesDays} costByTask={costByTask} thinking={thinking} sessions={filtered} forecast={forecast} />
            <ModelMixTrendCard sessions={filtered} />
            <CacheEfficiencyCard rows={cacheRanking} onOpenSession={id => onOpenSession(id)} />
          </AccordionSection>

          <AccordionSection id="quality" title="Quality" open={analyticsOpen.has('quality')} onToggle={() => toggleAnalytics('quality')}>
            <QualityDistributionCard sessions={filtered} />
            <QualityTrendCard sessions={filtered} />
            <ContextHotspotsCard stats={contextHotspots} onOpenSession={onOpenSession} />
          </AccordionSection>

          <AccordionSection id="workflow" title="Workflow" open={analyticsOpen.has('workflow')} onToggle={() => toggleAnalytics('workflow')}>
            <ToolLearningCurveCard sessions={filtered} />
            <ToolErrorsCard stats={errorStats} />
            <EfficiencyPanel breakdown={bashBreakdown} antiPatterns={antiPatterns} />
            <SlowestToolsCard calls={slowCalls} onOpenSession={onOpenSession} />
            <ThinkingDepthCard stats={thinking} onOpenSession={onOpenSession} />
            <InterruptCard stats={interrupts} onOpenSession={id => onOpenSession(id)} />
            <ThrashCard sessions={thrashSess} onOpenSession={id => onOpenSession(id)} />
          </AccordionSection>

          <AccordionSection id="patterns" title="Patterns" open={analyticsOpen.has('patterns')} onToggle={() => toggleAnalytics('patterns')}>
            <SessionLifecycleCard sessions={filtered} />
            <ActivityHeatmapCard cells={heatmap} qualityByDate={qualityByDate} />
            <div className="grid grid-cols-2 gap-5">
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">By Hour of Day</h3>
                  {hasHourQuality && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <button onClick={() => setHourMode('count')} className={`px-1.5 py-0.5 rounded ${hourMode === 'count' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'}`}>Count</button>
                      <button onClick={() => setHourMode('quality')} className={`px-1.5 py-0.5 rounded ${hourMode === 'quality' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 font-semibold' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'}`}>Quality</button>
                    </div>
                  )}
                </div>
                <div className="relative h-16 flex items-end gap-px">
                  {hourActivity.map((h, i) => {
                    const qh = qualityByHour[i]!
                    const heightPx = Math.max(h.count > 0 ? 3 : 0, Math.round((h.count / maxHour) * 64))
                    const barColor = hourMode === 'quality' && qh.avg !== null
                      ? qualityCellColor(qh.avg).replace('bg-', 'bg-').replace(' dark:bg-', ' dark:bg-')
                      : 'bg-violet-500/60 hover:bg-violet-400'
                    const tooltip = hourMode === 'quality' && qh.avg !== null
                      ? `${String(h.hour).padStart(2, '0')}:00 · avg ${scoreToGrade(qh.avg)} (${Math.round(qh.avg)}) · ${h.count} sessions`
                      : `${String(h.hour).padStart(2, '0')}:00 · ${h.count} sessions`
                    return (
                      <div key={h.hour} className="group relative flex-1">
                        <div className={`w-full rounded-sm transition-colors cursor-default ${barColor}`} style={{ height: `${heightPx}px` }} />
                        {h.count > 0 && (
                          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                            {tooltip}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-400 dark:text-gray-700">0h</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-700">12h</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-700">23h</span>
                </div>
              </Card>

              <Card>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">By Day of Week</h3>
                <div className="flex items-end gap-1 h-14">
                  {qualityByDow.map((d, i) => {
                    const maxSess = Math.max(...qualityByDow.map(x => x.sessions), 1)
                    const heightPx = Math.max(d.sessions > 0 ? 3 : 0, Math.round((d.sessions / maxSess) * 56))
                    const barColor = hasDowQuality && d.avg !== null
                      ? qualityCellColor(d.avg)
                      : 'bg-violet-500/60'
                    const tooltip = d.avg !== null
                      ? `${d.label} · avg ${scoreToGrade(d.avg)} (${Math.round(d.avg)}) · ${d.sessions} sessions`
                      : `${d.label} · ${d.sessions} sessions`
                    return (
                      <div key={i} className="group relative flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex flex-col justify-end" style={{ height: '56px' }}>
                          <div className={`w-full rounded-sm cursor-default ${barColor}`} style={{ height: `${heightPx}px` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 dark:text-gray-600">{d.label.slice(0, 2)}</span>
                        {d.sessions > 0 && (
                          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                            {tooltip}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <Card>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Task Types</h3>
                <div className="flex flex-col gap-3">
                  {tasks.map(({ type, count }) => {
                    const pct = Math.round((count / sessions.length) * 100)
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <Tooltip content={<span className="text-[11px] text-gray-600 dark:text-gray-400">{TASK_DESCRIPTIONS[type]}</span>}>
                          <span className={`text-xs px-2 py-0.5 rounded-md w-24 text-center shrink-0 font-medium cursor-default ${taskTypeColor(type)}`}>{type}</span>
                        </Tooltip>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${taskTypeBar(type)}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-14 text-right tabular-nums">{count} ({pct}%)</span>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Top Tools</h3>
                <div className="flex flex-col gap-2">
                  {topTools.slice(0, 8).map(tool => (
                    <div key={tool.name} className="flex items-center gap-3">
                      <Tooltip content={<span className="text-[11px] font-mono text-gray-700 dark:text-gray-300">{tool.name} — click to see every call</span>}>
                        <button
                          onClick={() => setDeepDiveTool(tool.name)}
                          className={`text-xs px-2 py-0.5 rounded font-mono w-24 text-center shrink-0 truncate cursor-pointer hover:ring-2 hover:ring-indigo-400/50 ${toolColor(tool.name)}`}
                        >
                          {tool.name}
                        </button>
                      </Tooltip>
                      <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-10 text-right tabular-nums">{tool.count}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {range === 'all' && (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Monthly Trend</h3>
                  <span className="text-xs text-gray-400 dark:text-gray-600">{trend.label}</span>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                  {([
                    { label: 'Sessions',      thisVal: trend.thisMonth.sessions           ?? 0, lastVal: trend.lastMonth.sessions           ?? 0, fmt: (n: number) => n.toLocaleString(),  lowerIsBetter: false },
                    { label: 'Tool Calls',    thisVal: trend.thisMonth.toolCalls           ?? 0, lastVal: trend.lastMonth.toolCalls           ?? 0, fmt: (n: number) => n.toLocaleString(),  lowerIsBetter: false },
                    { label: 'Active Days',   thisVal: trend.thisMonth.activeDays          ?? 0, lastVal: trend.lastMonth.activeDays          ?? 0, fmt: (n: number) => n.toLocaleString(),  lowerIsBetter: false },
                    { label: 'Avg Duration',  thisVal: trend.thisMonth.avgDurationMs       ?? 0, lastVal: trend.lastMonth.avgDurationMs       ?? 0, fmt: (n: number) => fmtDuration(n),      lowerIsBetter: false },
                    { label: 'Est. Cost',     thisVal: trend.thisMonth.costUSD              ?? 0, lastVal: trend.lastMonth.costUSD              ?? 0, fmt: (n: number) => fmtUSD(n),           lowerIsBetter: true  },
                    { label: 'Context Waste', thisVal: trend.thisMonth.contextWasteChars   ?? 0, lastVal: trend.lastMonth.contextWasteChars   ?? 0, fmt: (n: number) => fmtChars(n) + ' chars', lowerIsBetter: true  },
                    { label: 'Skills Used',   thisVal: trend.thisMonth.skillInvocations    ?? 0, lastVal: trend.lastMonth.skillInvocations    ?? 0, fmt: (n: number) => n.toLocaleString(),  lowerIsBetter: false },
                  ]).map(row => {
                    const delta = row.lastVal === 0 ? null : Math.round(((row.thisVal - row.lastVal) / row.lastVal) * 100)
                    const positive = delta !== null && delta > 0
                    const negative = delta !== null && delta < 0
                    const good = row.lowerIsBetter ? negative : positive
                    const bad  = row.lowerIsBetter ? positive : negative
                    return (
                      <div key={row.label} className="flex flex-col gap-0.5">
                        <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">{row.label}</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">{row.fmt(row.thisVal)}</p>
                        {delta !== null && (
                          <span className={`text-xs font-medium ${good ? 'text-emerald-500' : bad ? 'text-rose-400' : 'text-gray-400'}`}>
                            {positive ? '↑' : negative ? '↓' : '—'} {Math.abs(delta)}%
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
            <TaskPlaybookCard report={playbook} />
          </AccordionSection>

          <AccordionSection id="skills" title="Skills" open={analyticsOpen.has('skills')} onToggle={() => toggleAnalytics('skills')}>
            <div className="grid grid-cols-2 gap-5">
              <SkillsCard skillUsage={skillUsage} agents={agents} />
              <SkillGapsCard gaps={gaps} />
            </div>
            <McpServersCard servers={mcpServers} />
          </AccordionSection>

        </div>
      )}

      {/* ── Projects ── */}
      {insightTab === 'projects' && (
        selectedProject ? (
          <ProjectDetailView
            project={selectedProject}
            sessions={filtered}
            onBack={() => setSelectedProject(null)}
            onOpenSession={onOpenSession}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <ProjectHealthCard health={health} sessions={filtered} onSelect={setSelectedProject} />
            <div className="grid grid-cols-2 gap-5">
              <MultiFileSessionsCard sessions={multiFileSess} onOpenSession={id => onOpenSession(id)} />
              <HotFilesCard files={files} />
            </div>
            <Card>
              <ProjectTree projects={projects} sessions={sessions} onOpenSession={onOpenSession} />
            </Card>
          </div>
        )
      )}

      {/* ── Search ── */}
      {insightTab === 'search' && (
        <SearchView sessions={sessions} onOpenSession={onOpenSession} />
      )}

      {deepDiveTool && (
        <ToolDeepDiveModal
          toolName={deepDiveTool}
          sessions={filtered}
          onClose={() => setDeepDiveTool(null)}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  )
}

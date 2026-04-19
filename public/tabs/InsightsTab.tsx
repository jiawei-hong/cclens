import React, { useState } from 'react'
import { summarizeProjects, globalToolStats, activityByHour, sessionDepthStats, taskBreakdown, trendStats, bashAntiPatterns, bashCommandBreakdown, skillUsageStats, skillGaps, agentBreakdown, hotFiles, multiFileSessions, thrashingSessions, totalUsage, usageByModel, dailyCost, toolErrorRates, activityHeatmap, slowestToolCalls, mcpUsageStats, contextWindowHotspots, costByTaskType, thinkingStats, sessionCacheRanking, interruptStats, monthlyCostForecast, goldStandardSessions } from '../../src/analyzer'
import type { SessionType, BashAntiPattern, BashCategory, SkillUsage, SkillGap, AgentTypeUsage, HotFile, MultiFileSession, ThrashSession, TotalUsage, ModelUsageRow, ToolErrorStats, HeatmapCell, SlowToolCall, McpServerUsage, ContextHotspotStats, CostByTaskRow, ThinkingStats, SessionCacheStats, InterruptStats, MonthlyForecast, GoldStandardSession } from '../../src/analyzer'
import { aggregateRecommendations, recommendationTrend, projectHealth, recentRegressions, type RecAggregate, type RecCategory, type RecSeverity, type RecTrend, type RuleTrend, type RuleTrendDirection, type ProjectHealth, type RegressionReport, type Regression } from '../../src/recommendations'
import { userHabitsTrend, type HabitReportWithTrend, type HabitWithTrend, type HabitStatus, type HabitTrendDirection } from '../../src/habits'
import { generateProjectClaudeMd, claudeMdRules, claudeMdDiff, claudeMdViolations, CLAUDE_MD_SECTION_ORDER, type ClaudeMdRule, type ClaudeMdViolationReport } from '../../src/claudeMd'
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
                          </div>
                          <p className={`text-xs leading-relaxed ${status === 'covered' ? 'text-gray-500 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                            {r.text.replace(/^- /, '')}
                          </p>
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

// ── Activity & Performance Cards ──────────────────────────────────────────────

function heatmapCellColor(count: number, max: number): string {
  if (count === 0) return 'bg-gray-100 dark:bg-gray-800'
  const ratio = max === 0 ? 0 : count / max
  if (ratio > 0.75) return 'bg-indigo-700 dark:bg-indigo-300'
  if (ratio > 0.5)  return 'bg-indigo-500 dark:bg-indigo-400'
  if (ratio > 0.25) return 'bg-indigo-400 dark:bg-indigo-600'
  return 'bg-indigo-200 dark:bg-indigo-900'
}

function ActivityHeatmapCard({ cells }: { cells: HeatmapCell[] }) {
  const max = Math.max(...cells.map(c => c.count), 1)
  const totalSessions = cells.reduce((s, c) => s + c.count, 0)
  const activeDays = cells.filter(c => c.count > 0).length

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
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
          {totalSessions} sessions · {activeDays} active days
        </span>
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
                {week.map(c => (
                  <div key={c.date} className="group relative">
                    <div
                      className={`w-[11px] h-[11px] rounded-[2px] ${heatmapCellColor(c.count, max)} hover:ring-2 hover:ring-indigo-400 hover:ring-offset-0 transition-shadow cursor-default`}
                    />
                    <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-[11px] text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                      {c.count === 0 ? 'No sessions' : `${c.count} session${c.count === 1 ? '' : 's'}`} · {c.date}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-gray-400 dark:text-gray-600">
            <span>Less</span>
            {[0, 0.2, 0.4, 0.7, 1].map(r => (
              <div key={r} className={`w-[11px] h-[11px] rounded-[2px] ${heatmapCellColor(Math.ceil(r * max), max)}`} />
            ))}
            <span>More</span>
          </div>
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

function YourHabitsCard({ report }: { report: HabitReportWithTrend }) {
  if (report.totalSessions < 5) return null
  const bad = report.habits.filter(h => h.status === 'bad').length
  const ok  = report.habits.filter(h => h.status === 'ok').length
  const good = report.habits.filter(h => h.status === 'good').length

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Your Habits
          </h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-600">what *you* do, across {report.totalSessions} sessions · trend = last {report.recentWindowDays}d vs prior {report.baselineWindowDays}d</span>
        </div>
        <div className="flex items-center gap-1.5">
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

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function ProjectHealthCard({ health }: { health: ProjectHealth[] }) {
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
        <span className="w-16 text-right shrink-0">cache</span>
        <span className="w-16 text-right shrink-0">errors</span>
        <span className="w-14 text-right shrink-0">gold</span>
        <span className="w-16 text-right shrink-0">recs/sess</span>
      </div>

      {showBaseline && (
        <div
          className="flex items-center gap-3 px-2 py-1.5 mb-1 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400"
          title={`Median across ${pool.length} project${pool.length === 1 ? '' : 's'}${confident.length === 0 ? ' (no confident projects yet)' : ''}`}
        >
          <span className="tabular-nums w-10 text-right shrink-0 font-medium">{medianScore.toFixed(0)}</span>
          <span className="flex-1 italic">your median{confident.length === 0 && ' (low-conf)'}</span>
          <span className="tabular-nums w-16 text-right shrink-0">—</span>
          <span className="tabular-nums w-16 text-right shrink-0">{(medianCache * 100).toFixed(0)}%</span>
          <span className="tabular-nums w-16 text-right shrink-0">{(medianError * 100).toFixed(1)}%</span>
          <span className="tabular-nums w-14 text-right shrink-0">{medianGold.toFixed(medianGold < 1 ? 1 : 0)}</span>
          <span className="tabular-nums w-16 text-right shrink-0">{medianRecs.toFixed(1)}</span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {health.map(h => {
          const mCache = marker(h.cacheHitRate, medianCache, true)
          const mError = marker(h.errorRate,    medianError, false)
          const mGold  = marker(h.goldCount,    medianGold,  true)
          const mRecs  = marker(h.recsPerSession, medianRecs, false)
          return (
          <div key={h.project} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
            <span className={`text-sm font-semibold tabular-nums w-10 text-right shrink-0 ${scoreTone(h.score)}`}>{h.score}</span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate block">{h.project}</span>
                <div className="h-1 mt-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className={`h-1 rounded-full ${barFill(h.score)}`} style={{ width: `${h.score}%` }} />
                </div>
              </div>
              {h.lowConfidence && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0" title="Score is noisy with fewer than 3 sessions">low-conf</span>
              )}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-500 tabular-nums w-16 text-right shrink-0">{h.sessionCount}</span>
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
                          {projectSessions.map(s => (
                            <button key={s.id} onClick={() => onOpenSession(s.id)}
                              className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-indigo-600/10 transition-colors text-left group">
                              <span className="text-xs text-gray-500 group-hover:text-indigo-400">{fmt(s.startedAt)}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-600">·</span>
                              <span className="text-xs text-gray-500">{s.stats.toolCallCount} calls</span>
                              <span className="text-xs text-gray-500 dark:text-gray-600">·</span>
                              <span className="text-xs text-gray-500">{fmtDuration(s.durationMs)}</span>
                              <span className="ml-auto text-xs text-gray-400 dark:text-gray-700 group-hover:text-indigo-500">→</span>
                            </button>
                          ))}
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
  const forecast = React.useMemo(() => monthlyCostForecast(sessions), [sessions])  // full history — month-over-month
  const recAgg = React.useMemo(() => aggregateRecommendations(filtered), [filtered])
  const recTrend = React.useMemo(() => recommendationTrend(sessions), [sessions])  // full history — month-over-month
  const gold = React.useMemo(() => goldStandardSessions(filtered), [filtered])
  const health = React.useMemo(() => projectHealth(filtered), [filtered])
  const regressions = React.useMemo(() => recentRegressions(sessions), [sessions])  // full history — last 7d vs prior 7d
  const habits = React.useMemo(() => userHabitsTrend(filtered), [filtered])
  const hasUsageData = usage.totalTokens > 0
  const maxHour = Math.max(...hourActivity.map(h => h.count), 1)
  const maxTool = Math.max(...topTools.map(t => t.count), 1)
  const maxDailyCost = Math.max(...dailyCostSeries.map(d => d.costUSD), 0.0001)

  const [insightTab, setInsightTab] = useState<'opportunities' | 'overview' | 'cost' | 'efficiency' | 'skills' | 'projects'>('opportunities')
  const totalToolCalls = topTools.reduce((s, t) => s + t.count, 0)

  // Sub-tabs render via <TabGroup variant="subtle"> below.

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
          <Tab value="opportunities" badge={recAgg.sessionCount}>Opportunities</Tab>
          <Tab value="overview">Overview</Tab>
          <Tab value="cost">Cost</Tab>
          <Tab value="efficiency">Efficiency</Tab>
          <Tab value="skills" badge={gaps.length}>Skills</Tab>
          <Tab value="projects">Projects</Tab>
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

      {/* ── Opportunities ── */}
      {insightTab === 'opportunities' && (
        <OpportunitiesView
          agg={recAgg}
          trend={recTrend}
          totalSessions={filtered.length}
          sessions={filtered}
          antiPatterns={antiPatterns}
          skillGaps={gaps}
          gold={gold}
          onOpenSession={onOpenSession}
        />
      )}

      {/* ── Overview ── */}
      {insightTab === 'overview' && (
        <div className="flex flex-col gap-5">
          <RegressionAlertCard report={regressions} />
          <YourHabitsCard report={habits} />
          <div className="grid grid-cols-2 gap-5">
            {/* Task Types */}
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

            {/* Activity charts stacked */}
            <div className="flex flex-col gap-3">
              <ActivityHeatmapCard cells={heatmap} />

              <Card>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">By Hour of Day</h3>
                <div className="relative h-16 flex items-end gap-px">
                  {hourActivity.map(h => {
                    const heightPx = Math.max(2, Math.round((h.count / maxHour) * 64))
                    return (
                      <div key={h.hour} className="group relative flex-1">
                        <div className="w-full bg-violet-500/60 rounded-sm hover:bg-violet-400 transition-colors cursor-default" style={{ height: `${heightPx}px` }} />
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                          {String(h.hour).padStart(2, '0')}:00 · {h.count}
                        </div>
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
            </div>
          </div>

          {/* Top Tools + Trend */}
          <div className={range === 'all' ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-1 gap-5'}>
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
          </div>

        </div>
      )}

      {/* ── Cost ── */}
      {insightTab === 'cost' && (
        <div className="flex flex-col gap-5">
          <CostPanel usage={usage} modelRows={modelRows} dailySeries={dailyCostSeries} maxDailyCost={maxDailyCost} hasData={hasUsageData} dailySeriesDays={costSeriesDays} costByTask={costByTask} thinking={thinking} sessions={filtered} forecast={forecast} />
          <CacheEfficiencyCard rows={cacheRanking} onOpenSession={id => onOpenSession(id)} />
        </div>
      )}

      {/* ── Efficiency ── */}
      {insightTab === 'efficiency' && (
        <div className="flex flex-col gap-5">
          <ContextHotspotsCard stats={contextHotspots} onOpenSession={onOpenSession} />
          <ThinkingDepthCard stats={thinking} onOpenSession={onOpenSession} />
          <EfficiencyPanel breakdown={bashBreakdown} antiPatterns={antiPatterns} />
          <SlowestToolsCard calls={slowCalls} onOpenSession={onOpenSession} />
          <InterruptCard stats={interrupts} onOpenSession={id => onOpenSession(id)} />
          <ThrashCard sessions={thrashSess} onOpenSession={id => onOpenSession(id)} />
          <ToolErrorsCard stats={errorStats} />
        </div>
      )}

      {/* ── Skills ── */}
      {insightTab === 'skills' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-5">
            <SkillsCard skillUsage={skillUsage} agents={agents} />
            <SkillGapsCard gaps={gaps} />
          </div>
          <McpServersCard servers={mcpServers} />
        </div>
      )}

      {/* ── Projects ── */}
      {insightTab === 'projects' && (
        <div className="flex flex-col gap-5">
          <ProjectHealthCard health={health} />
          <div className="grid grid-cols-2 gap-5">
            <MultiFileSessionsCard sessions={multiFileSess} onOpenSession={id => onOpenSession(id)} />
            <HotFilesCard files={files} />
          </div>
          <Card>
            <ProjectTree projects={projects} sessions={sessions} onOpenSession={onOpenSession} />
          </Card>
        </div>
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

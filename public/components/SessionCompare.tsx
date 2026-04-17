import React, { useMemo, useState } from 'react'
import type { Session } from '../../src/types'
import { sessionCostUSD } from '../../src/analyzer'
import { fmt, fmtDuration, fmtUSD } from '../lib/format'

type Stats = {
  sessionId: string
  label: string
  durationMs: number
  costUSD: number
  toolCalls: number
  turns: number
  cacheHitRate: number
  filesTouched: number
  topTools: { name: string; count: number }[]
}

function computeStats(s: Session): Stats {
  const u = s.stats.usage
  const cacheDenom = u.inputTokens + u.cacheCreateTokens + u.cacheReadTokens
  const filePaths = new Set<string>()
  for (const turn of s.turns) {
    for (const tc of turn.toolCalls) {
      const p = tc.input['file_path']
      if (typeof p === 'string' && p) filePaths.add(p)
    }
  }
  const topTools = Object.entries(s.stats.toolBreakdown)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  return {
    sessionId: s.id,
    label: `${s.project} — ${fmt(s.startedAt)}`,
    durationMs: s.durationMs,
    costUSD: sessionCostUSD(s),
    toolCalls: s.stats.toolCallCount,
    turns: s.turns.length,
    cacheHitRate: cacheDenom === 0 ? 0 : u.cacheReadTokens / cacheDenom,
    filesTouched: filePaths.size,
    topTools,
  }
}

function deltaCell(a: number, b: number, fmtFn: (n: number) => string, lowerIsBetter = false) {
  if (a === b) return <span className="text-gray-400 dark:text-gray-600 text-[10px]">=</span>
  const diff = b - a
  const pct = a === 0 ? null : (diff / a) * 100
  const isImprovement = lowerIsBetter ? diff < 0 : diff > 0
  const color = isImprovement ? 'text-emerald-500' : 'text-rose-500'
  return (
    <span className={`${color} text-[10px] tabular-nums`}>
      {diff > 0 ? '+' : ''}{fmtFn(Math.abs(diff)) === fmtFn(0) ? '' : fmtFn(diff)}
      {pct != null && <> ({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</>}
    </span>
  )
}

export function SessionCompareModal({
  sessions,
  initialSession,
  onClose,
}: {
  sessions: Session[]
  initialSession: Session
  onClose: () => void
}) {
  const [rightId, setRightId] = useState<string>(() => {
    const candidates = sessions.filter(s => s.id !== initialSession.id)
    return candidates[0]?.id ?? ''
  })
  const [leftId, setLeftId] = useState<string>(initialSession.id)

  const left = useMemo(() => sessions.find(s => s.id === leftId) ?? initialSession, [leftId, sessions, initialSession])
  const right = useMemo(() => sessions.find(s => s.id === rightId), [rightId, sessions])

  const leftStats = useMemo(() => computeStats(left), [left])
  const rightStats = useMemo(() => right ? computeStats(right) : null, [right])

  const rows: { label: string; key: keyof Stats; fmt: (n: number) => string; lowerIsBetter?: boolean }[] = [
    { label: 'Duration',        key: 'durationMs',    fmt: (n) => fmtDuration(n) },
    { label: 'Est. cost',       key: 'costUSD',       fmt: (n) => fmtUSD(n), lowerIsBetter: true },
    { label: 'Tool calls',      key: 'toolCalls',     fmt: (n) => n.toLocaleString() },
    { label: 'Turns',           key: 'turns',         fmt: (n) => n.toLocaleString() },
    { label: 'Cache hit rate',  key: 'cacheHitRate',  fmt: (n) => `${(n * 100).toFixed(1)}%` },
    { label: 'Files touched',   key: 'filesTouched',  fmt: (n) => n.toLocaleString() },
  ]

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [sessions]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl w-full max-w-5xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Compare sessions</h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-lg leading-none px-2">×</button>
        </div>

        <div className="grid grid-cols-2 gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <select value={leftId} onChange={e => setLeftId(e.target.value)}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-900 dark:text-gray-100">
            {sorted.map(s => <option key={s.id} value={s.id}>{s.project} — {fmt(s.startedAt)}</option>)}
          </select>
          <select value={rightId} onChange={e => setRightId(e.target.value)}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-900 dark:text-gray-100">
            <option value="">Pick second session…</option>
            {sorted.filter(s => s.id !== leftId).map(s => <option key={s.id} value={s.id}>{s.project} — {fmt(s.startedAt)}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!rightStats ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 p-8 text-center">Pick a second session to compare.</p>
          ) : (
            <div className="p-5">
              <div className="grid grid-cols-3 gap-0 text-xs">
                <div className="text-[10px] uppercase text-gray-400 dark:text-gray-600 tracking-wide pb-2">Metric</div>
                <div className="text-[10px] uppercase text-gray-400 dark:text-gray-600 tracking-wide pb-2 truncate">{leftStats.label}</div>
                <div className="text-[10px] uppercase text-gray-400 dark:text-gray-600 tracking-wide pb-2 truncate">{rightStats.label}</div>
                {rows.map(r => {
                  const a = leftStats[r.key] as number
                  const b = rightStats[r.key] as number
                  return (
                    <React.Fragment key={r.label}>
                      <div className="py-2 text-gray-600 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800">{r.label}</div>
                      <div className="py-2 tabular-nums text-gray-900 dark:text-gray-100 border-t border-gray-100 dark:border-gray-800">{r.fmt(a)}</div>
                      <div className="py-2 tabular-nums text-gray-900 dark:text-gray-100 border-t border-gray-100 dark:border-gray-800 flex items-baseline gap-2">
                        <span>{r.fmt(b)}</span>
                        {deltaCell(a, b, r.fmt, r.lowerIsBetter)}
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>

              <div className="grid grid-cols-2 gap-4 mt-6">
                <ToolList title="Top tools — left" tools={leftStats.topTools} />
                <ToolList title="Top tools — right" tools={rightStats.topTools} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolList({ title, tools }: { title: string; tools: { name: string; count: number }[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600 mb-2">{title}</p>
      {tools.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No tool calls.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tools.map(t => (
            <li key={t.name} className="flex items-center justify-between text-xs">
              <span className="font-mono text-gray-700 dark:text-gray-300">{t.name}</span>
              <span className="tabular-nums text-gray-500 dark:text-gray-400">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

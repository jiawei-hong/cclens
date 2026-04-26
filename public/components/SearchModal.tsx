import React, { useState, useEffect, useRef, useMemo } from 'react'
import { search as searchSessions } from '../../src/searcher'
import type { Session, SearchResult } from '../../src/types'
import { fmt } from '../lib/format'
import { Badge, focusRing } from '../lib/ds'

type RoleFilter = 'all' | 'user' | 'assistant'
type DateFilter = 'all' | '7d' | '30d' | '90d'

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: 'All time', '7d': 'Last 7d', '30d': 'Last 30d', '90d': 'Last 90d',
}
const DATE_FILTER_DAYS: Record<DateFilter, number> = {
  all: Infinity, '7d': 7, '30d': 30, '90d': 90,
}

function highlight(snippet: string, q: string, isRegex: boolean) {
  if (!q) return <>{snippet}</>
  try {
    const re = new RegExp(isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const parts: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(snippet)) !== null) {
      if (m.index > last) parts.push(snippet.slice(last, m.index))
      parts.push(<mark key={m.index} className="bg-amber-200 text-amber-900 dark:bg-amber-400/30 dark:text-amber-200 not-italic rounded px-0.5">{m[0]}</mark>)
      last = m.index + m[0].length
      if (m[0].length === 0) { re.lastIndex++; continue }
    }
    if (last < snippet.length) parts.push(snippet.slice(last))
    return <>{parts}</>
  } catch {
    return <>{snippet}</>
  }
}

export function SearchModal({ sessions, open, onClose, onOpenSession }: {
  sessions: Session[]
  open: boolean
  onClose: () => void
  onOpenSession: (id: string, turnId?: string) => void
}) {
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [regexMode, setRegexMode] = useState(false)
  const [regexError, setRegexError] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const allProjects = useMemo(
    () => [...new Set(sessions.map(s => s.project))].sort(),
    [sessions]
  )

  // Auto-focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setResults([])
      setRegexError(false)
    }
  }, [open])

  // Close on Esc
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      if (!query.trim()) { setResults([]); setRegexError(false); return }
      if (regexMode) {
        try { new RegExp(query) } catch { setRegexError(true); setResults([]); return }
      }
      setRegexError(false)
      setResults(searchSessions(sessions, query, { regex: regexMode }))
    }, 200)
    return () => clearTimeout(t)
  }, [query, sessions, regexMode])

  const cutoff = DATE_FILTER_DAYS[dateFilter] === Infinity
    ? null
    : new Date(Date.now() - DATE_FILTER_DAYS[dateFilter] * 86_400_000).toISOString()

  const filtered = results
    .filter(r => projectFilter === 'all' || r.project === projectFilter)
    .filter(r => roleFilter === 'all' || r.role === roleFilter)
    .filter(r => !cutoff || r.timestamp >= cutoff)

  const grouped = useMemo(() => {
    const map = new Map<string, { project: string; startedAt: string; snippets: SearchResult[] }>()
    for (const r of filtered) {
      const s = sessions.find(s => s.id === r.sessionId)
      if (!s) continue
      const existing = map.get(r.sessionId)
      if (existing) existing.snippets.push(r)
      else map.set(r.sessionId, { project: s.project, startedAt: s.startedAt, snippets: [r] })
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }))
  }, [filtered, sessions])

  const filterBtn = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      onClick={() => set(value)}
      className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${focusRing} ${
        current === value
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onMouseDown={e => { if (!panelRef.current?.contains(e.target as Node)) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden"
        style={{ maxHeight: '75vh' }}
      >
        {/* Search input */}
        <div className={`flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 ${regexError ? 'bg-rose-50 dark:bg-rose-950/20' : ''}`}>
          <span className="text-gray-400 dark:text-gray-600 text-lg shrink-0">⌕</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search all sessions…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-base text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
          />
          {regexError && <span className="text-xs text-rose-500 shrink-0">invalid regex</span>}
          <button
            onClick={() => setRegexMode(v => !v)}
            title="Toggle regex"
            className={`shrink-0 px-2 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors ${
              regexMode
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-indigo-400'
            }`}
          >
            .*
          </button>
          <button
            onClick={onClose}
            className="shrink-0 px-2 py-0.5 rounded-lg text-[10px] text-gray-400 dark:text-gray-600 border border-gray-200 dark:border-gray-700 hover:text-gray-600 font-medium"
          >
            Esc
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-wrap">
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs px-2.5 py-1 rounded-lg border-0 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="all">All projects</option>
            {allProjects.map(p => <option key={p} value={p}>{p.split('/').filter(Boolean).slice(-2).join('/')}</option>)}
          </select>

          <div className="flex items-center gap-1">
            {filterBtn<RoleFilter>('all', roleFilter, setRoleFilter, 'All')}
            {filterBtn<RoleFilter>('user', roleFilter, setRoleFilter, 'User')}
            {filterBtn<RoleFilter>('assistant', roleFilter, setRoleFilter, 'Claude')}
          </div>

          <div className="flex items-center gap-1">
            {(['all', '7d', '30d', '90d'] as DateFilter[]).map(d =>
              filterBtn<DateFilter>(d, dateFilter, setDateFilter, DATE_FILTER_LABELS[d])
            )}
          </div>

          {query && !regexError && (
            <span className="text-xs text-gray-400 dark:text-gray-600 ml-auto">
              {grouped.length} sessions · {filtered.length} hits
            </span>
          )}
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 px-4 py-3 flex flex-col gap-3">
          {!query && (
            <p className="text-sm text-gray-400 dark:text-gray-600 text-center py-8">Type to search across all session text</p>
          )}
          {query && !regexError && grouped.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-600 text-center py-8">No results for "{query}"</p>
          )}
          {grouped.map(({ id, project, startedAt, snippets }) => (
            <div key={id} className="flex flex-col gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
              <button
                onClick={() => { onOpenSession(id); onClose() }}
                className={`flex items-center gap-2 text-left w-full group rounded-lg ${focusRing}`}
              >
                <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 truncate flex-1">
                  {project.split('/').filter(Boolean).slice(-2).join('/')}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 shrink-0">{fmt(startedAt)}</span>
                <Badge tone="primary" className="rounded-full shrink-0">
                  {snippets.length} {snippets.length === 1 ? 'match' : 'matches'}
                </Badge>
                <span className="text-xs text-gray-400 dark:text-gray-600 group-hover:text-indigo-400 transition-colors shrink-0">→</span>
              </button>
              <div className="flex flex-col gap-1.5">
                {snippets.slice(0, 3).map((r, i) => (
                  <button
                    key={i}
                    onClick={() => { onOpenSession(id, r.turnUuid); onClose() }}
                    className={`flex flex-col gap-1 text-left group/snippet rounded-xl ${focusRing}`}
                  >
                    <Badge tone={r.role === 'user' ? 'primary' : 'neutral'} className="self-start rounded-full">{r.role}</Badge>
                    <p className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-white dark:bg-gray-900 group-hover/snippet:bg-indigo-50 dark:group-hover/snippet:bg-indigo-950/30 rounded-xl px-3 py-2 whitespace-pre-wrap transition-colors w-full">
                      {highlight(r.snippet, query, regexMode)}
                    </p>
                  </button>
                ))}
                {snippets.length > 3 && (
                  <button
                    onClick={() => { onOpenSession(id); onClose() }}
                    className="text-xs text-gray-400 dark:text-gray-600 hover:text-indigo-500 text-left px-1"
                  >
                    +{snippets.length - 3} more in this session →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

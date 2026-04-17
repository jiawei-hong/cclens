import React, { useState, useEffect, useRef } from 'react'
import { search as searchSessions } from '../../src/searcher'
import type { Session, SearchResult } from '../../src/types'
import { fmt } from '../lib/format'
import { Card, Badge, focusRing } from '../lib/ds'

type RoleFilter = 'all' | 'user' | 'assistant'
type DateFilter = 'all' | '7d' | '30d' | '90d'

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  all: 'All time', '7d': 'Last 7d', '30d': 'Last 30d', '90d': 'Last 90d',
}
const DATE_FILTER_DAYS: Record<DateFilter, number> = {
  all: Infinity, '7d': 7, '30d': 30, '90d': 90,
}

export function SearchTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string, turnId?: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [projectFilter, setProjectFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [regexMode, setRegexMode] = useState(false)
  const [regexError, setRegexError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const allProjects = React.useMemo(
    () => [...new Set(sessions.map(s => s.project))].sort(),
    [sessions]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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

  const grouped = React.useMemo(() => {
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

  function highlight(snippet: string, q: string, isRegex: boolean) {
    if (!q) return <>{snippet}</>
    try {
      const re = new RegExp(isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const parts: React.ReactNode[] = []
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(snippet)) !== null) {
        if (m.index > last) parts.push(snippet.slice(last, m.index))
        parts.push(<mark key={m.index} className="bg-yellow-200 text-yellow-900 dark:bg-yellow-400/30 dark:text-yellow-200 rounded px-0.5">{m[0]}</mark>)
        last = m.index + m[0].length
        if (m[0].length === 0) { re.lastIndex++; continue }
      }
      if (last < snippet.length) parts.push(snippet.slice(last))
      return <>{parts}</>
    } catch {
      return <>{snippet}</>
    }
  }

  const filterBtn = <T extends string>(value: T, current: T, set: (v: T) => void, label: string, activeClass = 'bg-indigo-600 text-white') => (
    <button onClick={() => set(value)}
      className={`px-3 py-1 text-xs rounded-lg transition-colors ${focusRing} ${current === value ? activeClass : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}>
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Search input + regex toggle */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">⌕</span>
          <input ref={inputRef} type="text" placeholder="Search across all sessions…" value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            className={`w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-base px-10 py-3 rounded-2xl border shadow-sm focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600 ${
              regexError
                ? 'border-rose-400 dark:border-rose-500 focus:border-rose-400'
                : 'border-gray-200 dark:border-gray-700 focus:border-indigo-400 dark:focus:border-indigo-500'
            }`} />
          {regexError && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-rose-500">invalid regex</span>
          )}
        </div>
        <button
          onClick={() => setRegexMode(v => !v)}
          title="Toggle regex mode"
          className={`shrink-0 px-3 py-2.5 rounded-xl text-xs font-mono font-semibold border transition-colors ${
            regexMode
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500'
          }`}>
          .*
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
          className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500">
          <option value="all">All projects</option>
          {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
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
          <span className="text-xs text-gray-500 dark:text-gray-600 ml-auto">
            {grouped.length} sessions · {filtered.length} matches
          </span>
        )}
      </div>

      {/* Results */}
      <div className="flex flex-col gap-3">
        {grouped.map(({ id, project, startedAt, snippets }) => (
          <Card key={id} padding="sm" className="flex flex-col gap-3">
            <button
              onClick={() => onOpenSession(id)}
              className={`flex items-center gap-2 text-left w-full group rounded-lg ${focusRing}`}
            >
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{project}</span>
              <span className="text-gray-400 dark:text-gray-700">·</span>
              <span className="text-xs text-gray-500 dark:text-gray-600">{fmt(startedAt)}</span>
              <Badge tone="primary" className="ml-1 rounded-full">
                {snippets.length} {snippets.length === 1 ? 'match' : 'matches'}
              </Badge>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-700 group-hover:text-indigo-400 transition-colors">Open session →</span>
            </button>
            <div className="flex flex-col gap-2">
              {snippets.slice(0, 3).map((r, i) => (
                <button
                  key={i}
                  onClick={() => onOpenSession(id, r.turnUuid)}
                  className={`flex flex-col gap-1 text-left hover:opacity-80 transition-opacity group/snippet rounded-xl ${focusRing}`}
                >
                  <Badge tone={r.role === 'user' ? 'primary' : 'neutral'} className="self-start rounded-full">
                    {r.role}
                  </Badge>
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-950 group-hover/snippet:bg-indigo-50 dark:group-hover/snippet:bg-indigo-950/30 rounded-xl px-3 py-2 whitespace-pre-wrap transition-colors w-full">
                    {highlight(r.snippet, query, regexMode)}
                  </p>
                </button>
              ))}
              {snippets.length > 3 && (
                <p className="text-xs text-gray-500 dark:text-gray-600 px-1">+{snippets.length - 3} more matches in this session</p>
              )}
            </div>
          </Card>
        ))}
        {query && !regexError && grouped.length === 0 && (
          <p className="text-gray-500 dark:text-gray-600 text-sm text-center py-12">No results for "{query}"</p>
        )}
      </div>
    </div>
  )
}

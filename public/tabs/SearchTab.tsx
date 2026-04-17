import React, { useState, useEffect } from 'react'
import { search as searchSessions } from '../../src/searcher'
import type { Session, SearchResult } from '../../src/types'
import { fmt } from '../lib/format'

type RoleFilter = 'all' | 'user' | 'assistant'

export function SearchTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string, turnId?: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [projectFilter, setProjectFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')

  const allProjects = React.useMemo(
    () => [...new Set(sessions.map(s => s.project))].sort(),
    [sessions]
  )

  useEffect(() => {
    const t = setTimeout(() => {
      setResults(query.trim() ? searchSessions(sessions, query) : [])
    }, 200)
    return () => clearTimeout(t)
  }, [query, sessions])

  const filtered = results
    .filter(r => projectFilter === 'all' || r.project === projectFilter)
    .filter(r => roleFilter === 'all' || r.role === roleFilter)

  // Group by session, preserving first-match order
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

  function highlight(snippet: string, q: string) {
    if (!q) return <>{snippet}</>
    const idx = snippet.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return <>{snippet}</>
    return (
      <>
        {snippet.slice(0, idx)}
        <mark className="bg-yellow-200 text-yellow-900 dark:bg-yellow-400/30 dark:text-yellow-200 rounded px-0.5">{snippet.slice(idx, idx + q.length)}</mark>
        {snippet.slice(idx + q.length)}
      </>
    )
  }

  const roleBtn = (label: string, value: RoleFilter) => (
    <button onClick={() => setRoleFilter(value)}
      className={`px-3 py-1 text-xs rounded-lg transition-colors ${roleFilter === value ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}>
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">⌕</span>
        <input type="text" placeholder="Search across all sessions..." value={query} autoFocus
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          className="w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-base px-10 py-3 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-600" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
          className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500">
          <option value="all">All projects</option>
          {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {roleBtn('All', 'all')}
          {roleBtn('User', 'user')}
          {roleBtn('Claude', 'assistant')}
        </div>
        {query && (
          <span className="text-xs text-gray-500 dark:text-gray-600 ml-auto">
            {grouped.length} sessions · {filtered.length} matches
          </span>
        )}
      </div>

      {/* Results grouped by session */}
      <div className="flex flex-col gap-3">
        {grouped.map(({ id, project, startedAt, snippets }) => (
          <div key={id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-4 flex flex-col gap-3">
            {/* Session header */}
            <button onClick={() => onOpenSession(id)} className="flex items-center gap-2 text-left w-full group">
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{project}</span>
              <span className="text-gray-400 dark:text-gray-700">·</span>
              <span className="text-xs text-gray-500 dark:text-gray-600">{fmt(startedAt)}</span>
              <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-300 font-medium">
                {snippets.length} {snippets.length === 1 ? 'match' : 'matches'}
              </span>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-700 group-hover:text-indigo-400 transition-colors">Open session →</span>
            </button>
            {/* Snippets */}
            <div className="flex flex-col gap-2">
              {snippets.slice(0, 3).map((r, i) => (
                <button key={i} onClick={() => onOpenSession(id, r.turnUuid)}
                  className="flex flex-col gap-1 text-left hover:opacity-80 transition-opacity group/snippet">
                  <span className={`text-xs px-2 py-0.5 rounded-full self-start ${r.role === 'user' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                    {r.role}
                  </span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-950 group-hover/snippet:bg-indigo-50 dark:group-hover/snippet:bg-indigo-950/30 rounded-xl px-3 py-2 whitespace-pre-wrap transition-colors w-full">
                    {highlight(r.snippet, query)}
                  </p>
                </button>
              ))}
              {snippets.length > 3 && (
                <p className="text-xs text-gray-500 dark:text-gray-600 px-1">+{snippets.length - 3} more matches in this session</p>
              )}
            </div>
          </div>
        ))}
        {query && grouped.length === 0 && (
          <p className="text-gray-500 dark:text-gray-600 text-sm text-center py-12">No results for "{query}"</p>
        )}
      </div>
    </div>
  )
}

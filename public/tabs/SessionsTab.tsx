import React, { useState, useEffect, useRef } from 'react'
import { RiGitBranchLine, RiStarFill, RiStarLine, RiStickyNoteLine } from 'react-icons/ri'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Session } from '../../src/types'
import { sessionCostUSD } from '../../src/analyzer'
import { fmt, fmtDuration, fmtPace } from '../lib/format'
import { useBookmarks, useNotes } from '../lib/prefs'
import { focusRing } from '../lib/ds'
import { SessionDetailView } from '../components/SessionDetail'

type SortKey = 'recent' | 'oldest' | 'cost' | 'turns' | 'duration' | 'calls'

const SORT_LABELS: Record<SortKey, string> = {
  recent:   'Recent',
  oldest:   'Oldest',
  cost:     'Cost',
  turns:    'Turns',
  duration: 'Duration',
  calls:    'Tool calls',
}

function sortValue(s: Session, key: SortKey): number {
  switch (key) {
    case 'recent':   return new Date(s.startedAt).getTime()
    case 'oldest':   return -new Date(s.startedAt).getTime()
    case 'cost':     return sessionCostUSD(s)
    case 'turns':    return s.turns.length
    case 'duration': return s.durationMs
    case 'calls':    return s.stats.toolCallCount
  }
}

function sessionPreview(session: Session): string {
  const firstUser = session.turns.find(t => t.role === 'user')
  if (!firstUser?.text) return ''
  return firstUser.text
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 72)
}

function groupSessionsByProject(sessions: Session[], sortKey: SortKey): { project: string; sessions: Session[] }[] {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const list = map.get(s.project) ?? []
    list.push(s)
    map.set(s.project, list)
  }
  const groups = [...map.entries()].map(([project, sessions]) => {
    const sorted = [...sessions].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey))
    return { project, sessions: sorted }
  })
  // Project header order follows the sort: project whose top session ranks
  // highest appears first.
  groups.sort((a, b) => sortValue(b.sessions[0]!, sortKey) - sortValue(a.sessions[0]!, sortKey))
  return groups
}

type ListItem =
  | { kind: 'header'; project: string; count: number; totalTurns: number; totalCalls: number; isCollapsed: boolean }
  | { kind: 'session'; session: Session }

export function SessionsTab({ sessions, initialSessionId, scrollToTurnId, onSessionSelect }: { sessions: Session[]; initialSessionId: string | null; scrollToTurnId: string | null; onSessionSelect?: (id: string | null) => void }) {
  const [selected, setSelected] = useState<Session | null>(null)

  const selectAndNotify = (s: Session | null) => {
    setSelected(s)
    onSessionSelect?.(s?.id ?? null)
  }
  const [filter, setFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [onlyBookmarked, setOnlyBookmarked] = useState(false)
  const [onlyNoted, setOnlyNoted] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const { bookmarks, toggle: toggleBookmark } = useBookmarks()
  const { notes } = useNotes()
  const listRef = useRef<VirtuosoHandle>(null)

  useEffect(() => {
    if (initialSessionId) {
      const s = sessions.find(s => s.id === initialSessionId) ?? null
      setSelected(s)
      if (s) {
        const allProjects = new Set(sessions.map(x => x.project))
        allProjects.delete(s.project)
        setCollapsedProjects(allProjects)
      }
    }
  }, [initialSessionId, sessions])

  const toggleProject = (project: string) => setCollapsedProjects(prev => {
    const next = new Set(prev); next.has(project) ? next.delete(project) : next.add(project); return next
  })

  const detailRef = useRef<HTMLDivElement>(null)

  const noteIds = React.useMemo(
    () => new Set(Object.entries(notes).filter(([, v]) => v.trim()).map(([k]) => k)),
    [notes]
  )

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    return sessions.filter(s => {
      if (q && !s.project.toLowerCase().includes(q)) return false
      if (onlyBookmarked && !bookmarks.has(s.id)) return false
      if (onlyNoted && !noteIds.has(s.id)) return false
      return true
    })
  }, [sessions, filter, onlyBookmarked, onlyNoted, bookmarks, noteIds])

  const groups = React.useMemo(() => groupSessionsByProject(filtered, sortKey), [filtered, sortKey])

  const items = React.useMemo<ListItem[]>(() => {
    const out: ListItem[] = []
    for (const g of groups) {
      const isCollapsed = collapsedProjects.has(g.project)
      const totalTurns = g.sessions.reduce((s, x) => s + x.turns.length, 0)
      const totalCalls = g.sessions.reduce((s, x) => s + x.stats.toolCallCount, 0)
      out.push({ kind: 'header', project: g.project, count: g.sessions.length, totalTurns, totalCalls, isCollapsed })
      if (isCollapsed) continue
      const pinned = g.sessions.filter(s => bookmarks.has(s.id))
      const rest = g.sessions.filter(s => !bookmarks.has(s.id))
      for (const s of [...pinned, ...rest]) out.push({ kind: 'session', session: s })
    }
    return out
  }, [groups, collapsedProjects, bookmarks])

  const flatVisible = React.useMemo(
    () => items.flatMap(it => it.kind === 'session' ? [it.session] : []),
    [items]
  )

  const indexOfSession = (id: string) => items.findIndex(it => it.kind === 'session' && it.session.id === id)

  const scrollListToSession = (id: string) => {
    const idx = indexOfSession(id)
    if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'auto' })
  }

  useEffect(() => {
    if (selected) scrollListToSession(selected.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, items.length])

  useEffect(() => {
    let lastGTime = 0
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const idx = flatVisible.findIndex(s => s.id === selected?.id)
        const next = e.key === 'j'
          ? (idx === -1 ? 0 : Math.min(idx + 1, flatVisible.length - 1))
          : (idx === -1 ? flatVisible.length - 1 : Math.max(idx - 1, 0))
        const nextSession = flatVisible[next]
        if (nextSession) {
          selectAndNotify(nextSession)
          scrollListToSession(nextSession.id)
        }
      }

      if (e.key === 'g') {
        const now = Date.now()
        if (now - lastGTime < 400) {
          detailRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
          lastGTime = 0
        } else {
          lastGTime = now
        }
      }

      if (e.key === 'G') {
        e.preventDefault()
        if (detailRef.current)
          detailRef.current.scrollTo({ top: detailRef.current.scrollHeight, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flatVisible, selected, items])

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)]">
      {/* Left: grouped list (virtualized) */}
      <div className="w-72 flex flex-col gap-2 shrink-0">
        <input type="text" placeholder="Filter by project..." value={filter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          className={`w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-600 ${focusRing}`} />

        <div className="flex items-center gap-1.5">
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            title="Sort sessions"
            className={`bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500 ${focusRing}`}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>

          <button
            onClick={() => setOnlyBookmarked(v => !v)}
            title={onlyBookmarked ? 'Show all sessions' : 'Show only bookmarked'}
            aria-pressed={onlyBookmarked}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition-colors ${focusRing} ${
              onlyBookmarked
                ? 'bg-amber-500/15 border-amber-400 text-amber-700 dark:text-amber-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {onlyBookmarked ? <RiStarFill size={11} /> : <RiStarLine size={11} />}
          </button>

          <button
            onClick={() => setOnlyNoted(v => !v)}
            title={onlyNoted ? 'Show all sessions' : 'Show only sessions with notes'}
            aria-pressed={onlyNoted}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border transition-colors ${focusRing} ${
              onlyNoted
                ? 'bg-indigo-500/15 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <RiStickyNoteLine size={11} />
          </button>

          {(onlyBookmarked || onlyNoted || sortKey !== 'recent') && (
            <button
              onClick={() => { setOnlyBookmarked(false); setOnlyNoted(false); setSortKey('recent') }}
              title="Reset sort & filters"
              className="ml-auto text-[10px] text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              reset
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 pr-1">
          <Virtuoso
            ref={listRef}
            className="h-full"
            data={items}
            computeItemKey={(i, it) => it.kind === 'header' ? `h-${it.project}` : `s-${it.session.id}`}
            itemContent={(_, it) => {
              if (it.kind === 'header') {
                return (
                  <button
                    onClick={() => toggleProject(it.project)}
                    title={`${it.count} sessions · ${it.totalTurns} turns · ${it.totalCalls} tool calls`}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left ${focusRing}`}
                  >
                    <span className="text-gray-500 dark:text-gray-600 text-xs w-3 shrink-0">{it.isCollapsed ? '▶' : '▼'}</span>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{it.project}</span>
                      {!it.isCollapsed && (
                        <span className="block text-[10px] text-gray-400 dark:text-gray-600 truncate mt-0.5 tabular-nums">
                          {it.totalTurns.toLocaleString()} turns · {it.totalCalls.toLocaleString()} calls
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-600 shrink-0">{it.count}</span>
                  </button>
                )
              }
              const s = it.session
              const note = notes[s.id]?.trim()
              const preview = sessionPreview(s)
              const isBookmarked = bookmarks.has(s.id)
              return (
                <div className="ml-3 pl-2 border-l border-gray-200 dark:border-gray-800">
                  <button id={`sess-${s.id}`} onClick={() => selectAndNotify(s)}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${focusRing} ${selected?.id === s.id ? 'bg-indigo-600' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-600 dark:text-gray-400'}`}>{fmt(s.startedAt)}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => { e.stopPropagation(); toggleBookmark(s.id) }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleBookmark(s.id) } }}
                        title={isBookmarked ? 'Unpin session' : 'Pin session'}
                        aria-label={isBookmarked ? 'Unpin session' : 'Pin session'}
                        aria-pressed={isBookmarked}
                        className={`ml-auto shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 ${focusRing} ${isBookmarked ? (selected?.id === s.id ? 'text-amber-300' : 'text-amber-500') : (selected?.id === s.id ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-600')}`}
                      >
                        {isBookmarked ? <RiStarFill size={13} /> : <RiStarLine size={13} />}
                      </span>
                    </div>
                    {note ? (
                      <p className={`text-xs mt-0.5 truncate italic ${selected?.id === s.id ? 'text-amber-100' : 'text-amber-700 dark:text-amber-400'}`}>{note}</p>
                    ) : preview && (
                      <p className={`text-xs mt-0.5 truncate ${selected?.id === s.id ? 'text-white/90' : 'text-gray-500'}`}>{preview}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-600'}`}>{s.stats.toolCallCount} calls</span>
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-300' : 'text-gray-400 dark:text-gray-700'}`}>·</span>
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-600'}`}>{fmtDuration(s.durationMs)}</span>
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-300' : 'text-gray-400 dark:text-gray-700'}`}>·</span>
                      <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-600'}`}>{fmtPace(s.durationMs, s.stats.toolCallCount)}</span>
                    </div>
                    {s.gitBranch && (
                      <div className={`flex items-center gap-1 mt-0.5 text-xs truncate ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-600'}`}>
                        <RiGitBranchLine size={11} className="shrink-0" />
                        <span className="font-mono truncate">{s.gitBranch}</span>
                      </div>
                    )}
                  </button>
                </div>
              )
            }}
          />
        </div>
      </div>

      {/* Right: detail */}
      <div ref={detailRef} className="flex-1 overflow-y-auto">
        {selected
          ? <SessionDetailView session={selected} allSessions={sessions} scrollToTurnId={scrollToTurnId} />
          : <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-600 text-sm">Select a session to view details</div>}
      </div>
    </div>
  )
}

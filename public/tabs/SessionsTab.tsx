import React, { useState, useEffect, useRef } from 'react'
import { RiGitBranchLine } from 'react-icons/ri'
import type { Session } from '../../src/types'
import { fmt, fmtDuration, fmtPace } from '../lib/format'
import { SessionDetailView } from '../components/SessionDetail'

function sessionPreview(session: Session): string {
  const firstUser = session.turns.find(t => t.role === 'user')
  if (!firstUser?.text) return ''
  return firstUser.text
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 72)
}

function groupSessionsByProject(sessions: Session[]): { project: string; sessions: Session[] }[] {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const list = map.get(s.project) ?? []
    list.push(s)
    map.set(s.project, list)
  }
  return [...map.entries()]
    .map(([project, sessions]) => ({ project, sessions }))
    .sort((a, b) => b.sessions[0]!.startedAt.localeCompare(a.sessions[0]!.startedAt))
}

export function SessionsTab({ sessions, initialSessionId, scrollToTurnId }: { sessions: Session[]; initialSessionId: string | null; scrollToTurnId: string | null }) {
  const [selected, setSelected] = useState<Session | null>(null)
  const [filter, setFilter] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())

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

  const filtered = filter
    ? sessions.filter(s => s.project.toLowerCase().includes(filter.toLowerCase()))
    : sessions
  const groups = groupSessionsByProject(filtered)

  const flatVisible = React.useMemo(
    () => groups.flatMap(g => collapsedProjects.has(g.project) ? [] : g.sessions),
    [groups, collapsedProjects]
  )

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
          setSelected(nextSession)
          document.getElementById(`sess-${nextSession.id}`)?.scrollIntoView({ block: 'nearest' })
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
  }, [flatVisible, selected])

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)]">
      {/* Left: grouped list */}
      <div className="w-72 flex flex-col gap-2 shrink-0">
        <input type="text" placeholder="Filter by project..." value={filter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          className="w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-600" />

        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1">
          {groups.map(({ project, sessions: projectSessions }) => {
            const isCollapsed = collapsedProjects.has(project)
            return (
              <div key={project}>
                <button
                  onClick={() => toggleProject(project)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <span className="text-gray-500 dark:text-gray-600 text-xs w-3 shrink-0">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">{project}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-600 shrink-0">{projectSessions.length}</span>
                </button>

                {!isCollapsed && (
                  <div className="ml-3 pl-2 border-l border-gray-200 dark:border-gray-800 flex flex-col gap-0.5 mb-1">
                    {projectSessions.map(s => {
                      const preview = sessionPreview(s)
                      return (
                        <button key={s.id} id={`sess-${s.id}`} onClick={() => setSelected(s)}
                          className={`text-left px-3 py-2 rounded-xl transition-colors ${selected?.id === s.id ? 'bg-indigo-600' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs ${selected?.id === s.id ? 'text-indigo-200' : 'text-gray-600 dark:text-gray-400'}`}>{fmt(s.startedAt)}</span>
                          </div>
                          {preview && (
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
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: detail */}
      <div ref={detailRef} className="flex-1 overflow-y-auto">
        {selected
          ? <SessionDetailView session={selected} scrollToTurnId={scrollToTurnId} />
          : <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-600 text-sm">Select a session to view details</div>}
      </div>
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import { parseSessionFiles } from './lib/parser'
import { summarizeProjects, globalToolStats, activityByDay } from '../src/analyzer'
import { search as searchSessions } from '../src/searcher'
import type { Session, ProjectSummary, SearchResult } from '../src/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ts: string) {
  return new Date(ts).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

const TOOL_COLORS: Record<string, string> = {
  Bash:      'bg-violet-500/20 text-violet-300',
  Read:      'bg-blue-500/20 text-blue-300',
  Write:     'bg-emerald-500/20 text-emerald-300',
  Edit:      'bg-amber-500/20 text-amber-300',
  Grep:      'bg-rose-500/20 text-rose-300',
  Glob:      'bg-cyan-500/20 text-cyan-300',
  Agent:     'bg-pink-500/20 text-pink-300',
  WebFetch:  'bg-orange-500/20 text-orange-300',
  WebSearch: 'bg-orange-500/20 text-orange-300',
}
const toolColor = (name: string) => TOOL_COLORS[name] ?? 'bg-gray-500/20 text-gray-300'

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownText({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-lg font-bold text-gray-100 mt-3 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-gray-200 mt-3 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          return isBlock
            ? <code className="block bg-gray-950 text-emerald-300 rounded-lg px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre my-2">{children}</code>
            : <code className="bg-gray-800 text-indigo-300 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
        },
        pre: ({ children }) => <>{children}</>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-gray-300">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-gray-300">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-600 pl-3 italic text-gray-400 my-2">{children}</blockquote>
        ),
        hr: () => <hr className="border-gray-700 my-3" />,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">{children}</a>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}

// ── Directory walker (File System Access API) ─────────────────────────────────

async function collectJsonlFiles(dir: FileSystemDirectoryHandle, files: File[] = []): Promise<File[]> {
  for await (const [, handle] of dir) {
    if (handle.kind === 'directory') {
      await collectJsonlFiles(handle as FileSystemDirectoryHandle, files)
    } else if (handle.name.endsWith('.jsonl')) {
      files.push(await (handle as FileSystemFileHandle).getFile())
    }
  }
  return files
}

// ── Upload Screen ─────────────────────────────────────────────────────────────

function UploadScreen({ onLoad }: { onLoad: (sessions: Session[]) => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  const process = async (files: File[]) => {
    setLoadingMsg(`Parsing ${files.length} files…`)
    const sessions = await parseSessionFiles(files)
    if (sessions.length === 0) throw new Error('No valid sessions found.')
    onLoad(sessions)
  }

  const pickFolder = async () => {
    setError(null)
    setLoading(true)
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' })
      setLoadingMsg('Scanning for .jsonl files…')
      const files = await collectJsonlFiles(dir)
      if (files.length === 0) throw new Error('No .jsonl files found in the selected folder.')
      await process(files)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFiles = async (files: FileList | File[]) => {
    setLoading(true)
    setError(null)
    try {
      await process(Array.from(files))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-100">claude-lens</h1>
        <p className="text-gray-500 mt-2">Insights & search across your Claude Code sessions</p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">{loadingMsg}</p>
        </div>
      ) : (
        <div className="w-full max-w-lg flex flex-col gap-3">
          {/* Primary: folder picker */}
          {hasFolderPicker && (
            <button
              onClick={pickFolder}
              className="w-full flex items-center justify-center gap-3 py-4 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-2xl font-medium transition-all"
            >
              <span className="text-xl">📁</span>
              Select .claude/projects folder
            </button>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-800" />
            <span className="text-xs text-gray-600">{hasFolderPicker ? 'or' : 'drop files below'}</span>
            <div className="flex-1 h-px bg-gray-800" />
          </div>

          {/* Fallback: file drop / pick */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors
              ${dragging ? 'border-indigo-400 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-600 hover:bg-gray-900'}`}
          >
            <p className="text-sm text-gray-400">Drop <code className="text-gray-500">.jsonl</code> files here, or click to browse</p>
            <p className="text-xs text-gray-600">Multiple files supported</p>
            <input ref={inputRef} type="file" accept=".jsonl" multiple className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
          </div>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm text-center max-w-sm">{error}</p>}

      {!loading && (
        <div className="w-full max-w-lg bg-gray-900 rounded-2xl p-4 flex flex-col gap-2">
          <p className="text-xs text-gray-600">
            Sessions are at <code className="text-gray-500">~/.claude/projects/</code>
          </p>
          <code className="text-xs text-gray-500 bg-gray-950 rounded-lg px-3 py-2 select-all">
            open ~/.claude/projects
          </code>
        </div>
      )}
    </div>
  )
}

// ── NavTab ────────────────────────────────────────────────────────────────────

function NavTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}>
      {label}
    </button>
  )
}

// ── Insights Tab ──────────────────────────────────────────────────────────────

function InsightsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string) => void }) {
  const topTools = globalToolStats(sessions)
  const activity = activityByDay(sessions)
  const projects = summarizeProjects(sessions)
  const maxActivity = Math.max(...activity.map(d => d.count), 1)
  const maxTool = Math.max(...topTools.map(t => t.count), 1)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Sessions" value={sessions.length} />
        <StatCard label="Projects" value={projects.length} />
        <StatCard label="Total Tool Calls" value={topTools.reduce((s, t) => s + t.count, 0)} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-900 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Top Tools</h3>
          <div className="flex flex-col gap-2.5">
            {topTools.slice(0, 10).map(tool => (
              <div key={tool.name} className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-md font-mono w-28 text-center shrink-0 ${toolColor(tool.name)}`}>{tool.name}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-10 text-right">{tool.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Daily Activity</h3>
          <div className="relative h-32 flex items-end gap-1">
            {activity.slice(-30).map(d => {
              const heightPx = Math.max(4, Math.round((d.count / maxActivity) * 128))
              return (
                <div key={d.date} className="group relative flex-1">
                  <div className="w-full bg-indigo-500/70 rounded-sm hover:bg-indigo-400 transition-colors cursor-default"
                    style={{ height: `${heightPx}px` }} />
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-xs text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                    {d.date}: {d.count}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-600 mt-2">Last 30 days</p>
        </div>
      </div>

      <div className="bg-gray-900 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Projects</h3>
        <ProjectTree projects={projects} sessions={sessions} onOpenSession={onOpenSession} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-100 mt-1">{value.toLocaleString()}</p>
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
  onOpenSession: (id: string) => void
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
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-800 transition-colors text-left">
              <span className="text-gray-500 text-xs w-3 shrink-0">{isCollapsed ? '▶' : '▼'}</span>
              <span className="text-sm font-medium text-gray-300">{group.parentLabel}</span>
              <span className="text-xs text-gray-600 truncate">{group.parentDir}</span>
              <div className="ml-auto flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500">{group.projects.length} projects</span>
                <span className="text-xs text-gray-500">{group.totalSessions} sessions</span>
                <span className="text-xs text-gray-500">{group.totalToolCalls} calls</span>
              </div>
            </button>

            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 ml-5 pl-3 border-l border-gray-800">
                {group.projects.map(p => {
                  const isExpanded = expandedProjects.has(p.project)
                  const projectSessions = sessions.filter(s => s.project === p.project)
                  return (
                    <div key={p.project}>
                      <button onClick={() => toggleProject(p.project)}
                        className="w-full flex items-center gap-4 py-2 px-3 rounded-xl hover:bg-gray-800 transition-colors text-left">
                        <span className="text-gray-600 text-xs w-3 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-200 truncate">{p.project}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-gray-500">{p.sessionCount} sessions</span>
                          <span className="text-xs text-gray-500">{p.totalToolCalls} calls</span>
                          <div className="flex gap-1">
                            {p.topTools.slice(0, 3).map(t => (
                              <span key={t.name} className={`text-xs px-1.5 py-0.5 rounded font-mono ${toolColor(t.name)}`}>{t.name}</span>
                            ))}
                          </div>
                          <span className="text-xs text-gray-600">{fmt(p.lastActiveAt)}</span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="ml-5 pl-3 border-l border-gray-800/60 flex flex-col gap-0.5 mb-1">
                          {projectSessions.length === 0 && (
                            <p className="px-3 py-2 text-xs text-gray-700">No sessions found</p>
                          )}
                          {projectSessions.map(s => (
                            <button key={s.id} onClick={() => onOpenSession(s.id)}
                              className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-indigo-600/10 transition-colors text-left group">
                              <span className="text-xs text-gray-500 group-hover:text-indigo-400">{fmt(s.startedAt)}</span>
                              <span className="text-xs text-gray-600">·</span>
                              <span className="text-xs text-gray-500">{s.stats.toolCallCount} calls</span>
                              <span className="text-xs text-gray-600">·</span>
                              <span className="text-xs text-gray-500">{fmtDuration(s.durationMs)}</span>
                              <span className="ml-auto text-xs text-gray-700 group-hover:text-indigo-500">→</span>
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

// ── Sessions Tab ──────────────────────────────────────────────────────────────

function SessionsTab({ sessions, initialSessionId }: { sessions: Session[]; initialSessionId: string | null }) {
  const [selected, setSelected] = useState<Session | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (initialSessionId) {
      setSelected(sessions.find(s => s.id === initialSessionId) ?? null)
    }
  }, [initialSessionId, sessions])

  const filtered = sessions.filter(s => !filter || s.project.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)]">
      <div className="w-72 flex flex-col gap-2 shrink-0">
        <input type="text" placeholder="Filter by project..." value={filter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
          className="w-full bg-gray-800 text-gray-100 text-sm px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-indigo-500 placeholder:text-gray-600" />
        <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {filtered.map(s => (
            <button key={s.id} onClick={() => setSelected(s)}
              className={`text-left px-3 py-2.5 rounded-xl transition-colors ${selected?.id === s.id ? 'bg-indigo-600' : 'bg-gray-900 hover:bg-gray-800'}`}>
              <p className="text-sm font-medium text-gray-100 truncate">{s.project}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{fmt(s.startedAt)}</span>
                <span className="text-xs text-gray-600">·</span>
                <span className="text-xs text-gray-500">{s.stats.toolCallCount} calls</span>
                <span className="text-xs text-gray-600">·</span>
                <span className="text-xs text-gray-500">{fmtDuration(s.durationMs)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected
          ? <SessionDetailView session={selected} />
          : <div className="flex items-center justify-center h-full text-gray-600 text-sm">Select a session to view details</div>}
      </div>
    </div>
  )
}

function SessionDetailView({ session }: { session: Session }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const toggleTool = (id: string) => setExpandedTools(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="bg-gray-900 rounded-2xl p-4 flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-100">{session.project}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{session.projectPath}</p>
        </div>
        <div className="flex gap-4 text-right shrink-0">
          <div><p className="text-xs text-gray-500">Duration</p><p className="text-sm font-medium text-gray-300">{fmtDuration(session.durationMs)}</p></div>
          <div><p className="text-xs text-gray-500">Tool calls</p><p className="text-sm font-medium text-gray-300">{session.stats.toolCallCount}</p></div>
          <div><p className="text-xs text-gray-500">Turns</p><p className="text-sm font-medium text-gray-300">{session.turns.length}</p></div>
        </div>
      </div>

      {session.turns.map(turn => (
        <div key={turn.uuid} className={`flex gap-3 ${turn.role === 'user' ? 'flex-row-reverse' : ''}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
            ${turn.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
            {turn.role === 'user' ? 'U' : 'C'}
          </div>
          <div className="flex-1 max-w-[85%] flex flex-col gap-2">
            {turn.text && (
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed
                ${turn.role === 'user' ? 'bg-indigo-600/20 text-gray-200' : 'bg-gray-900 text-gray-300'}`}>
                <MarkdownText>{turn.text}</MarkdownText>
              </div>
            )}

            {turn.toolCalls.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {turn.toolCalls.map(tc => (
                  <div key={tc.id} className="bg-gray-900 rounded-xl overflow-hidden">
                    <button onClick={() => toggleTool(tc.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 transition-colors text-left">
                      <span className={`text-xs px-2 py-0.5 rounded font-mono ${toolColor(tc.name)}`}>{tc.name}</span>
                      <span className="text-xs text-gray-500 truncate flex-1">
                        {Object.values(tc.input)[0]?.toString().slice(0, 60) ?? ''}
                      </span>
                      <span className="text-gray-600 text-xs">{expandedTools.has(tc.id) ? '▾' : '▸'}</span>
                    </button>
                    {expandedTools.has(tc.id) && (
                      <div className="px-3 pb-3 flex flex-col gap-2">
                        <pre className="text-xs text-gray-400 bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(tc.input, null, 2)}
                        </pre>
                        {tc.result && (
                          <pre className="text-xs text-gray-500 bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                            {tc.result}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-700 px-1">{fmt(turn.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  useEffect(() => {
    const t = setTimeout(() => {
      setResults(query.trim() ? searchSessions(sessions, query) : [])
    }, 200)
    return () => clearTimeout(t)
  }, [query, sessions])

  function highlight(snippet: string, q: string) {
    if (!q) return <>{snippet}</>
    const idx = snippet.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return <>{snippet}</>
    return (
      <>
        {snippet.slice(0, idx)}
        <mark className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{snippet.slice(idx, idx + q.length)}</mark>
        {snippet.slice(idx + q.length)}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">⌕</span>
        <input type="text" placeholder="Search across all sessions..." value={query} autoFocus
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          className="w-full bg-gray-900 text-gray-100 text-base px-10 py-3 rounded-2xl border border-gray-700 focus:outline-none focus:border-indigo-500 placeholder:text-gray-600" />
      </div>

      {results.length > 0 && <p className="text-xs text-gray-600">{results.length} results</p>}

      <div className="flex flex-col gap-3">
        {results.map((r, i) => (
          <button key={i} onClick={() => onOpenSession(r.sessionId)}
            className="bg-gray-900 rounded-2xl p-4 flex flex-col gap-2 text-left hover:bg-gray-800 transition-colors w-full group">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-indigo-400">{r.project}</span>
              <span className="text-gray-700">·</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${r.role === 'user' ? 'bg-indigo-600/20 text-indigo-300' : 'bg-gray-700 text-gray-400'}`}>{r.role}</span>
              <span className="text-gray-700">·</span>
              <span className="text-xs text-gray-600">{fmt(r.timestamp)}</span>
              <span className="ml-auto text-xs text-gray-700 group-hover:text-indigo-400 transition-colors">Open session →</span>
            </div>
            <p className="text-sm text-gray-300 font-mono bg-gray-950 rounded-xl px-3 py-2 whitespace-pre-wrap">
              {highlight(r.snippet, query)}
            </p>
          </button>
        ))}
        {query && results.length === 0 && (
          <p className="text-gray-600 text-sm text-center py-12">No results for "{query}"</p>
        )}
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

type Tab = 'insights' | 'sessions' | 'search'

function App() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [tab, setTab] = useState<Tab>('insights')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const openSession = (id: string) => { setSelectedSessionId(id); setTab('sessions') }

  if (!sessions) return <UploadScreen onLoad={setSessions} />

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-lg font-bold text-gray-100">claude-lens</span>
          <span className="text-xs text-gray-600">{sessions.length} sessions loaded</span>
        </div>
        <NavTab label="Insights" active={tab === 'insights'} onClick={() => setTab('insights')} />
        <NavTab label="Sessions" active={tab === 'sessions'} onClick={() => setTab('sessions')} />
        <NavTab label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
        <button onClick={() => setSessions(null)} className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors">
          ↩ Upload new files
        </button>
      </header>

      <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">
        {tab === 'insights' && <InsightsTab sessions={sessions} onOpenSession={openSession} />}
        {tab === 'sessions' && <SessionsTab sessions={sessions} initialSessionId={selectedSessionId} />}
        {tab === 'search' && <SearchTab sessions={sessions} onOpenSession={openSession} />}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

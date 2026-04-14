import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import { RiSunLine, RiMoonLine, RiComputerLine } from 'react-icons/ri'
import { parseSessionFiles } from './lib/parser'
import { summarizeProjects, globalToolStats, activityByDay, activityByHour, sessionDepthStats, taskBreakdown, trendStats } from '../src/analyzer'
import type { SessionType } from '../src/analyzer'
import { search as searchSessions } from '../src/searcher'
import type { Session, ProjectSummary, SearchResult } from '../src/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m`
}

function fmtPace(durationMs: number, toolCallCount: number): string {
  if (durationMs < 30_000 || toolCallCount === 0) return '—'
  const perMin = toolCallCount / (durationMs / 60_000)
  return `${perMin.toFixed(1)}/min`
}

const TOOL_COLORS: Record<string, string> = {
  Bash:      'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  Read:      'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  Write:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  Edit:      'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Grep:      'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  Glob:      'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  Agent:     'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  WebFetch:  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  WebSearch: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}
const toolColor = (name: string) => TOOL_COLORS[name] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300'

const TASK_COLORS: Record<SessionType, string> = {
  coding:       'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  debugging:    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  research:     'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  exploration:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  conversation: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
}
const TASK_BARS: Record<SessionType, string> = {
  coding:       'bg-indigo-500',
  debugging:    'bg-rose-500',
  research:     'bg-amber-500',
  exploration:  'bg-cyan-500',
  conversation: 'bg-gray-500',
}
const taskTypeColor = (t: SessionType) => TASK_COLORS[t]
const taskTypeBar   = (t: SessionType) => TASK_BARS[t]

const TASK_DESCRIPTIONS: Record<SessionType, string> = {
  coding:       'Edit / Write > 25% of tool calls',
  debugging:    'Bash > 25% + Read / Grep > 15%',
  research:     'WebSearch / WebFetch > 20%',
  exploration:  'Read / Grep / Glob > 40% — browsing codebase',
  conversation: 'Fewer than 3 tool calls — mostly chat',
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownText({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-3 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-gray-800 dark:text-gray-200 mt-3 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-2 mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          return isBlock
            ? <code className="block bg-gray-50 dark:bg-gray-950 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre my-2">{children}</code>
            : <code className="bg-gray-100 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
        },
        pre: ({ children }) => <>{children}</>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-gray-700 dark:text-gray-300">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-gray-700 dark:text-gray-300">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-700 dark:text-gray-300">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 dark:border-gray-600 pl-3 italic text-gray-600 dark:text-gray-400 my-2">{children}</blockquote>
        ),
        hr: () => <hr className="border-gray-300 dark:border-gray-700 my-3" />,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">{children}</a>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      {/* Tooltip panel */}
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-3
        bg-white dark:bg-gray-950 border border-gray-300/60 dark:border-gray-700/60
        rounded-xl px-3 py-2.5 shadow-2xl
        opacity-0 -translate-y-1
        group-hover:opacity-100 group-hover:translate-y-0
        transition-all duration-150 delay-100
        pointer-events-none z-30 whitespace-nowrap
      ">
        {content}
        {/* Arrow */}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-300/60 dark:border-t-gray-700/60" />
      </span>
    </span>
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

// ── Theme ─────────────────────────────────────────────────────────────────────

type Theme = 'system' | 'light' | 'dark'

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <RiComputerLine size={14} /> },
  { value: 'light',  label: 'Light',  icon: <RiSunLine size={14} /> },
  { value: 'dark',   label: 'Dark',   icon: <RiMoonLine size={14} /> },
]

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = THEME_OPTIONS.find(o => o.value === theme)!

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
        title={`Theme: ${current.label}`}
      >
        {current.icon}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
          {THEME_OPTIONS.map(({ value, label, icon }) => (
            <button
              key={value}
              onClick={() => { setTheme(value); setOpen(false) }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors
                ${theme === value
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
              <span className="shrink-0">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Upload Screen ─────────────────────────────────────────────────────────────

function UploadScreen({ onLoad, theme, setTheme }: { onLoad: (sessions: Session[]) => void; theme: Theme; setTheme: (t: Theme) => void }) {
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
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-8 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Claude Lens</h1>
        <p className="text-gray-500 mt-2">Insights & search across your Claude Code sessions</p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 dark:text-gray-400 text-sm">{loadingMsg}</p>
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
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            <span className="text-xs text-gray-500 dark:text-gray-600">{hasFolderPicker ? 'or' : 'drop files below'}</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>

          {/* Fallback: file drop / pick */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors
              ${dragging ? 'border-indigo-400 bg-indigo-500/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900'}`}
          >
            <p className="text-sm text-gray-600 dark:text-gray-400">Drop <code className="text-gray-500">.jsonl</code> files here, or click to browse</p>
            <p className="text-xs text-gray-500 dark:text-gray-600">Multiple files supported</p>
            <input ref={inputRef} type="file" accept=".jsonl" multiple className="hidden"
              onChange={e => e.target.files && handleFiles(e.target.files)} />
          </div>
        </div>
      )}

      {error && <p className="text-rose-400 text-sm text-center max-w-sm">{error}</p>}

      {!loading && (
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-4 flex flex-col gap-2">
          <p className="text-xs text-gray-500 dark:text-gray-600">
            Sessions are at <code className="text-gray-500">~/.claude/projects/</code>
          </p>
          <code className="text-xs text-gray-600 dark:text-gray-500 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 select-all">
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
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
      {label}
    </button>
  )
}

// ── Insights Tab ──────────────────────────────────────────────────────────────

function InsightsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string) => void }) {
  const topTools = globalToolStats(sessions)
  const activity = activityByDay(sessions)
  const hourActivity = activityByHour(sessions)
  const depth = sessionDepthStats(sessions)
  const tasks = taskBreakdown(sessions)
  const trend = trendStats(sessions)
  const projects = summarizeProjects(sessions)
  const maxActivity = Math.max(...activity.map(d => d.count), 1)
  const maxHour = Math.max(...hourActivity.map(h => h.count), 1)
  const maxTool = Math.max(...topTools.map(t => t.count), 1)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Sessions" value={sessions.length} />
        <StatCard label="Projects" value={projects.length} />
        <StatCard label="Total Tool Calls" value={topTools.reduce((s, t) => s + t.count, 0)} />
      </div>

      {/* Depth stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Duration</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{fmtDuration(depth.avgDurationMs)}</p>
          {depth.longestSession && (
            <button onClick={() => onOpenSession(depth.longestSession!.id)}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mt-2 text-left">
              Longest: {fmtDuration(depth.longestSession.durationMs)} →
            </button>
          )}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Tool Calls</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{depth.avgToolCalls.toFixed(1)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-600 mt-2">per session</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Turns</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{depth.avgTurns.toFixed(1)}</p>
          {depth.deepestSession && (
            <button onClick={() => onOpenSession(depth.deepestSession!.id)}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mt-2 text-left">
              Deepest: {depth.deepestSession.turns.length} turns →
            </button>
          )}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Pace</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {fmtPace(depth.avgDurationMs, depth.avgToolCalls)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-600 mt-2">tool calls / min</p>
        </div>
      </div>

      {/* Task breakdown + Trend */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">Task Types</h3>
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
                  <span className="text-xs text-gray-600 dark:text-gray-400 w-14 text-right">{count} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">Monthly Trend</h3>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                { label: 'Sessions',    this: trend.thisMonth.sessions,   last: trend.lastMonth.sessions },
                { label: 'Tool Calls',  this: trend.thisMonth.toolCalls,  last: trend.lastMonth.toolCalls },
                { label: 'Active Days', this: trend.thisMonth.activeDays, last: trend.lastMonth.activeDays },
              ] as const
            ).map(row => {
              const delta = row.last === 0 ? null : Math.round(((row.this - row.last) / row.last) * 100)
              return (
                <div key={row.label} className="flex flex-col gap-1">
                  <p className="text-xs text-gray-500">{row.label}</p>
                  <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{row.this.toLocaleString()}</p>
                  <div className="flex items-center gap-1.5">
                    {delta !== null && (
                      <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-gray-500'}`}>
                        {delta > 0 ? '↑' : delta < 0 ? '↓' : ''}  {Math.abs(delta)}%
                      </span>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-600">vs {trend.lastLabel}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500">{trend.label} so far</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">Top Tools</h3>
          <div className="flex flex-col gap-2.5">
            {topTools.slice(0, 10).map(tool => (
              <div key={tool.name} className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-md font-mono w-28 text-center shrink-0 ${toolColor(tool.name)}`}>{tool.name}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400 w-10 text-right">{tool.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">Daily Activity</h3>
            <div className="relative h-24 flex items-end gap-1">
              {activity.slice(-30).map(d => {
                const heightPx = Math.max(4, Math.round((d.count / maxActivity) * 96))
                return (
                  <div key={d.date} className="group relative flex-1">
                    <div className="w-full bg-indigo-500/70 rounded-sm hover:bg-indigo-400 transition-colors cursor-default"
                      style={{ height: `${heightPx}px` }} />
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                      {d.date}: {d.count}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-600 mt-2">Last 30 days</p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">By Hour of Day</h3>
            <div className="relative h-24 flex items-end gap-px">
              {hourActivity.map(h => {
                const heightPx = Math.max(2, Math.round((h.count / maxHour) * 96))
                const label = `${String(h.hour).padStart(2, '0')}:00`
                return (
                  <div key={h.hour} className="group relative flex-1">
                    <div className="w-full bg-violet-500/60 rounded-sm hover:bg-violet-400 transition-colors cursor-default"
                      style={{ height: `${heightPx}px` }} />
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-700 dark:text-gray-300 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10">
                      {label}: {h.count}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs text-gray-400 dark:text-gray-700">0h</span>
              <span className="text-xs text-gray-400 dark:text-gray-700">12h</span>
              <span className="text-xs text-gray-400 dark:text-gray-700">23h</span>
            </div>
          </div>
        </div>
      </div>

<div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-4">Projects</h3>
        <ProjectTree projects={projects} sessions={sessions} onOpenSession={onOpenSession} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value.toLocaleString()}</p>
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

// ── Sessions Tab ──────────────────────────────────────────────────────────────

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

function SessionsTab({ sessions, initialSessionId }: { sessions: Session[]; initialSessionId: string | null }) {
  const [selected, setSelected] = useState<Session | null>(null)
  const [filter, setFilter] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (initialSessionId) {
      const s = sessions.find(s => s.id === initialSessionId) ?? null
      setSelected(s)
      if (s) {
        // collapse all other projects, expand only the target
        const allProjects = new Set(sessions.map(x => x.project))
        allProjects.delete(s.project)
        setCollapsedProjects(allProjects)
      }
    }
  }, [initialSessionId, sessions])

  const toggleProject = (project: string) => setCollapsedProjects(prev => {
    const next = new Set(prev); next.has(project) ? next.delete(project) : next.add(project); return next
  })

  const filtered = filter
    ? sessions.filter(s => s.project.toLowerCase().includes(filter.toLowerCase()))
    : sessions
  const groups = groupSessionsByProject(filtered)

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
                {/* Project header */}
                <button
                  onClick={() => toggleProject(project)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <span className="text-gray-500 dark:text-gray-600 text-xs w-3 shrink-0">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">{project}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-600 shrink-0">{projectSessions.length}</span>
                </button>

                {/* Session rows */}
                {!isCollapsed && (
                  <div className="ml-3 pl-2 border-l border-gray-200 dark:border-gray-800 flex flex-col gap-0.5 mb-1">
                    {projectSessions.map(s => {
                      const preview = sessionPreview(s)
                      return (
                        <button key={s.id} onClick={() => setSelected(s)}
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
      <div className="flex-1 overflow-y-auto">
        {selected
          ? <SessionDetailView session={selected} />
          : <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-600 text-sm">Select a session to view details</div>}
      </div>
    </div>
  )
}

// ── Turn content parser ───────────────────────────────────────────────────────

type TurnContent =
  | { kind: 'text'; text: string }
  | { kind: 'slash-command'; command: string; args: string }
  | { kind: 'stdout'; output: string }
  | { kind: 'meta' }  // caveat / system noise → hidden

function parseTurnContent(raw: string): TurnContent[] {
  // Strip <local-command-caveat>...</local-command-caveat>
  const cleaned = raw.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '').trim()

  const parts: TurnContent[] = []
  let remaining = cleaned

  while (remaining.length > 0) {
    // Slash command block
    const cmdMatch = remaining.match(/<command-name>([^<]+)<\/command-name>\s*(?:<command-message>[^<]*<\/command-message>)?\s*(?:<command-args>([^<]*)<\/command-args>)?/)
    // Stdout block
    const stdoutMatch = remaining.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)

    const cmdIdx = cmdMatch?.index ?? Infinity
    const stdoutIdx = stdoutMatch?.index ?? Infinity

    if (cmdIdx === Infinity && stdoutIdx === Infinity) {
      // No more special blocks — rest is plain text
      if (remaining.trim()) parts.push({ kind: 'text', text: remaining.trim() })
      break
    }

    const firstIdx = Math.min(cmdIdx, stdoutIdx)

    // Text before the first block
    const before = remaining.slice(0, firstIdx).trim()
    if (before) parts.push({ kind: 'text', text: before })

    if (cmdIdx <= stdoutIdx && cmdMatch) {
      parts.push({ kind: 'slash-command', command: cmdMatch[1]?.trim() ?? '', args: cmdMatch[2]?.trim() ?? '' })
      remaining = remaining.slice(cmdIdx + cmdMatch[0].length)
    } else if (stdoutMatch) {
      const out = stdoutMatch[1]?.trim() ?? ''
      if (out) parts.push({ kind: 'stdout', output: out })
      remaining = remaining.slice(stdoutIdx + stdoutMatch[0].length)
    }
  }

  return parts.filter(p => p.kind !== 'meta' && !(p.kind === 'text' && !p.text))
}

function TurnBody({ text, role }: { text: string; role: 'user' | 'assistant' }) {
  if (role === 'assistant') {
    return (
      <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">
        <MarkdownText>{text}</MarkdownText>
      </div>
    )
  }

  const parts = parseTurnContent(text)
  if (parts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) => {
        if (part.kind === 'slash-command') {
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm text-gray-800 dark:text-gray-200">
                <span className="text-indigo-500 dark:text-indigo-400 text-xs">⌘</span>
                {part.command}
                {part.args && <span className="text-gray-500 text-xs">{part.args}</span>}
              </span>
            </div>
          )
        }
        if (part.kind === 'stdout') {
          return (
            <pre key={i} className="text-xs text-gray-500 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 font-mono whitespace-pre-wrap">
              {part.output}
            </pre>
          )
        }
        // plain text
        if (part.kind !== 'text') return null
        return (
          <div key={i} className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-indigo-50 dark:bg-indigo-600/20 text-gray-900 dark:text-gray-200">
            <MarkdownText>{part.text}</MarkdownText>
          </div>
        )
      })}
    </div>
  )
}

// ── Edit Diff View ────────────────────────────────────────────────────────────

function EditDiffView({ input }: { input: Record<string, unknown> }) {
  const filePath = input['file_path'] as string | undefined
  const oldStr  = (input['old_string']  as string | undefined) ?? ''
  const newStr  = (input['new_string']  as string | undefined) ?? ''

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="flex flex-col gap-1 text-xs font-mono">
      {filePath && (
        <p className="text-gray-500 px-1 pb-1 truncate">{filePath}</p>
      )}
      <div className="rounded-lg overflow-hidden bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
        {/* removed */}
        {oldLines.map((line, i) => (
          <div key={`-${i}`} className="flex gap-2 px-3 py-0.5 bg-rose-100 dark:bg-rose-950/40 hover:bg-rose-200 dark:hover:bg-rose-950/60">
            <span className="text-rose-500 select-none w-3 shrink-0">−</span>
            <span className="text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-all">{line}</span>
          </div>
        ))}
        {/* separator */}
        <div className="border-t border-gray-200 dark:border-gray-800" />
        {/* added */}
        {newLines.map((line, i) => (
          <div key={`+${i}`} className="flex gap-2 px-3 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 hover:bg-emerald-200 dark:hover:bg-emerald-950/60">
            <span className="text-emerald-600 dark:text-emerald-500 select-none w-3 shrink-0">+</span>
            <span className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{line}</span>
          </div>
        ))}
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
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-4 flex items-start gap-4">
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{session.project}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{session.projectPath}</p>
        </div>
        <div className="flex gap-4 text-right shrink-0">
          <div><p className="text-xs text-gray-500">Duration</p><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{fmtDuration(session.durationMs)}</p></div>
          <div><p className="text-xs text-gray-500">Tool calls</p><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{session.stats.toolCallCount}</p></div>
          <div><p className="text-xs text-gray-500">Turns</p><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{session.turns.length}</p></div>
          <div><p className="text-xs text-gray-500">Pace</p><p className="text-sm font-medium text-gray-700 dark:text-gray-300">{fmtPace(session.durationMs, session.stats.toolCallCount)}</p></div>
          <div className="flex flex-col gap-1.5 pl-4 border-l border-gray-200 dark:border-gray-800">
            <button onClick={() => exportSessionAsMarkdown(session)}
              className="text-xs px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors">
              ↓ MD
            </button>
            <button onClick={() => exportSessionAsHTML(session)}
              className="text-xs px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors">
              ↓ HTML
            </button>
          </div>
        </div>
      </div>

      {session.turns.map(turn => (
        <div key={turn.uuid} className={`flex gap-3 ${turn.role === 'user' ? 'flex-row-reverse' : ''}`}>
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
            ${turn.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
            {turn.role === 'user' ? 'U' : 'C'}
          </div>
          <div className="flex-1 max-w-[85%] flex flex-col gap-2">
            {turn.text && <TurnBody text={turn.text} role={turn.role} />}

            {turn.toolCalls.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {turn.toolCalls.map(tc => {
                  const isEdit = tc.name === 'Edit' && 'old_string' in tc.input
                  const summary = isEdit
                    ? (tc.input['file_path'] as string | undefined ?? '').split('/').pop() ?? ''
                    : Object.values(tc.input)[0]?.toString().slice(0, 60) ?? ''
                  return (
                    <div key={tc.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                      <button onClick={() => toggleTool(tc.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${toolColor(tc.name)}`}>{tc.name}</span>
                        <span className="text-xs text-gray-500 truncate flex-1">{summary}</span>
                        <span className="text-gray-500 dark:text-gray-600 text-xs">{expandedTools.has(tc.id) ? '▾' : '▸'}</span>
                      </button>
                      {expandedTools.has(tc.id) && (
                        <div className="px-3 pb-3 flex flex-col gap-2">
                          {isEdit
                            ? <EditDiffView input={tc.input} />
                            : <pre className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(tc.input, null, 2)}
                              </pre>
                          }
                          {tc.result && (
                            <pre className="text-xs text-gray-500 bg-white dark:bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                              {tc.result}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-700 px-1">{fmt(turn.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportSessionAsMarkdown(session: Session) {
  const lines: string[] = [
    `# ${session.project}`,
    ``,
    `**Path:** ${session.projectPath}  `,
    `**Started:** ${new Date(session.startedAt).toLocaleString()}  `,
    `**Duration:** ${fmtDuration(session.durationMs)}  `,
    `**Tool calls:** ${session.stats.toolCallCount}  `,
    `**Turns:** ${session.turns.length}`,
    ``,
    `---`,
    ``,
  ]
  for (const turn of session.turns) {
    lines.push(`### ${turn.role === 'user' ? 'User' : 'Claude'}`)
    lines.push(``)
    if (turn.text) {
      const clean = turn.text
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (clean) lines.push(clean)
    }
    for (const tc of turn.toolCalls) {
      lines.push(``)
      lines.push(`**\`${tc.name}\`**`)
      lines.push(`\`\`\`json`)
      lines.push(JSON.stringify(tc.input, null, 2))
      lines.push(`\`\`\``)
      if (tc.result) {
        lines.push(`<details><summary>Result</summary>`)
        lines.push(``)
        lines.push(`\`\`\``)
        lines.push(tc.result)
        lines.push(`\`\`\``)
        lines.push(`</details>`)
      }
    }
    lines.push(``)
    lines.push(`*${fmt(turn.timestamp)}*`)
    lines.push(``)
    lines.push(`---`)
    lines.push(``)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${session.project}-${session.id}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSessionAsHTML(session: Session) {
  const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const turns = session.turns.map(turn => {
    const isUser = turn.role === 'user'
    const textClean = turn.text
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    const toolsHtml = turn.toolCalls.map(tc => `
      <details class="tool">
        <summary><code>${escHtml(tc.name)}</code> ${escHtml(Object.values(tc.input)[0]?.toString().slice(0, 60) ?? '')}</summary>
        <pre>${escHtml(JSON.stringify(tc.input, null, 2))}</pre>
        ${tc.result ? `<pre class="result">${escHtml(tc.result)}</pre>` : ''}
      </details>`).join('')
    return `
      <div class="turn ${isUser ? 'user' : 'assistant'}">
        <div class="avatar">${isUser ? 'U' : 'C'}</div>
        <div class="body">
          ${textClean ? `<div class="text">${escHtml(textClean)}</div>` : ''}
          ${toolsHtml}
          <div class="ts">${fmt(turn.timestamp)}</div>
        </div>
      </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(session.project)}</title>
<style>
  body { background:#0a0a0f; color:#e5e7eb; font-family:system-ui,sans-serif; max-width:800px; margin:0 auto; padding:2rem; }
  h1 { font-size:1.5rem; margin-bottom:.25rem; }
  .meta { color:#6b7280; font-size:.85rem; margin-bottom:2rem; }
  .turn { display:flex; gap:12px; margin-bottom:1.5rem; }
  .turn.user { flex-direction:row-reverse; }
  .avatar { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:.75rem; font-weight:700; flex-shrink:0; margin-top:2px; }
  .turn.user .avatar { background:#4f46e5; color:#fff; }
  .turn.assistant .avatar { background:#374151; color:#d1d5db; }
  .body { flex:1; max-width:85%; }
  .text { background:#111827; border-radius:12px; padding:.75rem 1rem; font-size:.875rem; line-height:1.6; white-space:pre-wrap; }
  .turn.user .text { background:#312e81; }
  details.tool { background:#111827; border-radius:8px; padding:.5rem .75rem; margin-top:.5rem; font-size:.8rem; }
  details.tool summary { cursor:pointer; color:#a5b4fc; }
  pre { background:#030712; border-radius:6px; padding:.5rem; overflow-x:auto; font-size:.75rem; color:#6ee7b7; white-space:pre-wrap; }
  pre.result { color:#9ca3af; }
  .ts { color:#374151; font-size:.7rem; margin-top:.25rem; }
</style>
</head>
<body>
<h1>${escHtml(session.project)}</h1>
<p class="meta">${escHtml(session.projectPath)} · ${new Date(session.startedAt).toLocaleString()} · ${fmtDuration(session.durationMs)} · ${session.stats.toolCallCount} tool calls</p>
${turns}
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${session.project}-${session.id}.html`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Search Tab ────────────────────────────────────────────────────────────────

type RoleFilter = 'all' | 'user' | 'assistant'

function SearchTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string) => void }) {
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
          <button key={id} onClick={() => onOpenSession(id)}
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-4 flex flex-col gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors w-full group">
            {/* Session header */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{project}</span>
              <span className="text-gray-400 dark:text-gray-700">·</span>
              <span className="text-xs text-gray-500 dark:text-gray-600">{fmt(startedAt)}</span>
              <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-300 font-medium">
                {snippets.length} {snippets.length === 1 ? 'match' : 'matches'}
              </span>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-700 group-hover:text-indigo-400 transition-colors">Open session →</span>
            </div>
            {/* Snippets */}
            <div className="flex flex-col gap-2">
              {snippets.slice(0, 3).map((r, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full self-start ${r.role === 'user' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                    {r.role}
                  </span>
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-white dark:bg-gray-950 rounded-xl px-3 py-2 whitespace-pre-wrap">
                    {highlight(r.snippet, query)}
                  </p>
                </div>
              ))}
              {snippets.length > 3 && (
                <p className="text-xs text-gray-500 dark:text-gray-600 px-1">+{snippets.length - 3} more matches in this session</p>
              )}
            </div>
          </button>
        ))}
        {query && grouped.length === 0 && (
          <p className="text-gray-500 dark:text-gray-600 text-sm text-center py-12">No results for "{query}"</p>
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
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme) ?? 'system'
  )

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
      localStorage.setItem('theme', theme)
    }
    apply()
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  const openSession = (id: string) => { setSelectedSessionId(id); setTab('sessions') }

  if (!sessions) return <UploadScreen onLoad={setSessions} theme={theme} setTheme={setTheme} />

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="flex items-center gap-2 mr-4">
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Claude Lens</span>
          <span className="text-xs text-gray-500 dark:text-gray-600">{sessions.length} sessions loaded</span>
        </div>
        <NavTab label="Insights" active={tab === 'insights'} onClick={() => setTab('insights')} />
        <NavTab label="Sessions" active={tab === 'sessions'} onClick={() => setTab('sessions')} />
        <NavTab label="Search" active={tab === 'search'} onClick={() => setTab('search')} />
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button onClick={() => setSessions(null)} className="text-xs text-gray-500 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
            ↩ Upload new files
          </button>
        </div>
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

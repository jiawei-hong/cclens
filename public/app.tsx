import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import { RiSunLine, RiMoonLine, RiComputerLine, RiTimeLine, RiTerminalLine, RiChat3Line, RiFlashlightLine, RiFileCodeLine, RiArrowUpLine } from 'react-icons/ri'
import { SiTypescript, SiJavascript, SiPython, SiRust, SiGo, SiRuby, SiPhp, SiSwift, SiKotlin, SiCplusplus, SiC, SiHtml5, SiCss, SiMarkdown, SiJson, SiYaml, SiShell, SiReact, SiVuedotjs, SiSvelte, SiDart, SiScala, SiElixir, SiHaskell, SiLua, SiDocker, SiPrisma } from 'react-icons/si'
import { parseSessionFiles, parseMemoryFiles, type TrackedFile } from './lib/parser'
import { summarizeProjects, globalToolStats, activityByHour, sessionDepthStats, taskBreakdown, trendStats, bashAntiPatterns, bashCommandBreakdown, skillUsageStats, skillGaps, agentBreakdown, hotFiles, totalUsage, usageByModel, dailyCost, toolErrorRates, activityHeatmap, slowestToolCalls, mcpUsageStats, contextWindowHotspots } from '../src/analyzer'
import type { SessionType, BashAntiPattern, BashCategory, SkillUsage, SkillGap, AgentTypeUsage, HotFile, TotalUsage, ModelUsageRow, ToolErrorStats, HeatmapCell, SlowToolCall, McpServerUsage, ContextHotspotStats } from '../src/analyzer'
import { search as searchSessions } from '../src/searcher'
import type { Session, ProjectSummary, SearchResult, MemoryEntry, MemoryEntryType } from '../src/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.round((ms % 3_600_000) / 60_000)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(ms / 86_400_000)
  const h = Math.round((ms % 86_400_000) / 3_600_000)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

function fmtPace(durationMs: number, toolCallCount: number): string {
  if (durationMs < 30_000 || toolCallCount === 0) return '—'
  const perMin = toolCallCount / (durationMs / 60_000)
  return `${perMin.toFixed(1)}/min`
}

const TOOL_COLORS: Record<string, string> = {
  Bash: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  Read: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  Write: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  Edit: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Grep: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  Glob: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  Agent: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  WebFetch: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  WebSearch: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}
const toolColor = (name: string) => TOOL_COLORS[name] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300'

const TOOL_TICK_COLORS: Record<string, string> = {
  Bash: 'bg-violet-500',
  Read: 'bg-blue-500',
  Write: 'bg-emerald-500',
  Edit: 'bg-amber-500',
  Grep: 'bg-rose-500',
  Glob: 'bg-cyan-500',
  Agent: 'bg-pink-500',
  WebFetch: 'bg-orange-500',
  WebSearch: 'bg-orange-500',
}
const toolTickColor = (name: string) => {
  if (name.startsWith('mcp__')) return 'bg-fuchsia-500'
  return TOOL_TICK_COLORS[name] ?? 'bg-gray-400'
}

function fmtToolDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

const TASK_COLORS: Record<SessionType, string> = {
  coding: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  debugging: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  research: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  exploration: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  conversation: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
}
const TASK_BARS: Record<SessionType, string> = {
  coding: 'bg-indigo-500',
  debugging: 'bg-rose-500',
  research: 'bg-amber-500',
  exploration: 'bg-cyan-500',
  conversation: 'bg-gray-500',
}
const taskTypeColor = (t: SessionType) => TASK_COLORS[t]
const taskTypeBar = (t: SessionType) => TASK_BARS[t]

const TASK_DESCRIPTIONS: Record<SessionType, string> = {
  coding: 'Edit / Write > 25% of tool calls',
  debugging: 'Bash > 25% + Read / Grep > 15%',
  research: 'WebSearch / WebFetch > 20%',
  exploration: 'Read / Grep / Glob > 40% — browsing codebase',
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

async function walkFolder(dir: FileSystemDirectoryHandle, base = '', out: TrackedFile[] = []): Promise<TrackedFile[]> {
  for await (const [, handle] of dir) {
    const path = base ? `${base}/${handle.name}` : handle.name
    if (handle.kind === 'directory') {
      await walkFolder(handle as FileSystemDirectoryHandle, path, out)
    } else {
      const name = handle.name
      if (name.endsWith('.jsonl') || name.endsWith('.md')) {
        out.push({ file: await (handle as FileSystemFileHandle).getFile(), path })
      }
    }
  }
  return out
}

// ── Theme ─────────────────────────────────────────────────────────────────────

type Theme = 'system' | 'light' | 'dark'

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'System', icon: <RiComputerLine size={14} /> },
  { value: 'light', label: 'Light', icon: <RiSunLine size={14} /> },
  { value: 'dark', label: 'Dark', icon: <RiMoonLine size={14} /> },
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

function UploadScreen({ onLoad, theme, setTheme }: { onLoad: (data: { sessions: Session[]; memory: MemoryEntry[] }) => void; theme: Theme; setTheme: (t: Theme) => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  const processTracked = async (tracked: TrackedFile[]) => {
    const jsonlFiles = tracked.filter(t => t.file.name.endsWith('.jsonl')).map(t => t.file)
    setLoadingMsg(`Parsing ${jsonlFiles.length} sessions…`)
    const sessions = await parseSessionFiles(jsonlFiles)
    if (sessions.length === 0) throw new Error('No valid sessions found.')
    setLoadingMsg('Parsing memory files…')
    const memory = await parseMemoryFiles(tracked)
    onLoad({ sessions, memory })
  }

  const processLooseFiles = async (files: File[]) => {
    setLoadingMsg(`Parsing ${files.length} files…`)
    const sessions = await parseSessionFiles(files)
    if (sessions.length === 0) throw new Error('No valid sessions found.')
    // Dropped loose files have no folder context — skip memory parsing.
    onLoad({ sessions, memory: [] })
  }

  const pickFolder = async () => {
    setError(null)
    setLoading(true)
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' })
      setLoadingMsg('Scanning folder…')
      const tracked = await walkFolder(dir)
      const jsonlCount = tracked.filter(t => t.file.name.endsWith('.jsonl')).length
      if (jsonlCount === 0) throw new Error('No .jsonl files found in the selected folder.')
      await processTracked(tracked)
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
      await processLooseFiles(Array.from(files))
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

function CostPanel({ usage, modelRows, dailySeries, maxDailyCost, hasData, dailySeriesDays }: {
  usage: TotalUsage
  modelRows: ModelUsageRow[]
  dailySeries: { date: string; costUSD: number }[]
  maxDailyCost: number
  hasData: boolean
  dailySeriesDays: number
}) {
  if (!hasData) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No token usage data found in these sessions.</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">Only sessions recorded by newer Claude Code versions include per-turn <code className="font-mono text-[11px]">usage</code> — older sessions will be skipped.</p>
      </div>
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
      {/* 4 stat cards */}
      <div className="grid grid-cols-4 gap-5">
        <StatCardRich label="Est. Cost" value={fmtUSD(usage.costUSD)} sub={`${fmtTokenCount(usage.totalTokens)} tokens total`} />
        <StatCardRich label="Input" value={fmtTokenCount(usage.inputTokens)} sub="fresh input tokens" />
        <StatCardRich label="Output" value={fmtTokenCount(usage.outputTokens)} sub="generated tokens" />
        <StatCardRich label="Cache Hit Rate" value={`${(usage.cacheHitRate * 100).toFixed(1)}%`} sub={`${fmtTokenCount(usage.cacheReadTokens)} read / ${fmtTokenCount(totalCacheIn)} eligible`} />
      </div>

      {/* Token composition + Per-model breakdown */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
            Estimates use public list prices per 1M tokens. Actual billing may differ (subscriptions, volume discounts, cache-write TTL).
          </p>
        </div>
      </div>

      {/* Daily cost */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
      </div>
    </div>
  )
}

function StatCardRich({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
      <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  )
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
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl flex overflow-hidden">
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
            <span className="text-sm font-bold font-mono text-rose-500 dark:text-rose-400 shrink-0 ml-2">~{fmtTokens(totalChars)} tok</span>
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
    </div>
  )
}

function ToolErrorsCard({ stats }: { stats: ToolErrorStats }) {
  const maxErrors = Math.max(...stats.rows.map(r => r.errors), 1)
  const overallPct = (stats.overallRate * 100).toFixed(1)
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
    </div>
  )
}

function BashBreakdownCard({ breakdown }: { breakdown: BashCategory[] }) {
  const total = breakdown.reduce((s, c) => s + c.count, 0)
  const max = Math.max(...breakdown.map(c => c.count), 1)
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
    </div>
  )
}

function fmtChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

function fmtTokens(chars: number): string {
  // rough estimate: 1 token ≈ 4 chars
  return fmtChars(Math.round(chars / 4))
}

function fmtTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

function fmtUSD(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`
  if (n >= 10)   return `$${n.toFixed(1)}`
  if (n >= 0.01) return `$${n.toFixed(2)}`
  if (n > 0)     return `<$0.01`
  return `$0`
}

const MODEL_BADGE: Record<string, string> = {
  opus:   'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  sonnet: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  haiku:  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  other:  'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
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
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Context Waste
        </h3>
        {totalChars > 0 && (
          <span className="text-xs font-mono font-semibold text-rose-500 dark:text-rose-400">
            ~{fmtTokens(totalChars)} tokens
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
    </div>
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
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5 flex flex-col gap-5">
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
    </div>
  )
}

function SkillGapsCard({ gaps }: { gaps: SkillGap[] }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
    </div>
  )
}

// ── Hot Files Card ────────────────────────────────────────────────────────────

function heatmapCellColor(count: number, max: number): string {
  if (count === 0) return 'bg-gray-100 dark:bg-gray-800'
  const ratio = max === 0 ? 0 : count / max
  if (ratio > 0.75) return 'bg-indigo-700 dark:bg-indigo-300'
  if (ratio > 0.5)  return 'bg-indigo-500 dark:bg-indigo-400'
  if (ratio > 0.25) return 'bg-indigo-400 dark:bg-indigo-600'
  return 'bg-indigo-200 dark:bg-indigo-900'
}

function ActivityHeatmapCard({ cells }: { cells: HeatmapCell[] }) {
  // Group into weeks (columns). weekIndex is already computed in the cells.
  const max = Math.max(...cells.map(c => c.count), 1)
  const totalSessions = cells.reduce((s, c) => s + c.count, 0)
  const activeDays = cells.filter(c => c.count > 0).length

  const weeks: HeatmapCell[][] = []
  for (const c of cells) {
    const col = weeks[c.weekIndex] ?? (weeks[c.weekIndex] = [])
    col.push(c)
  }

  // Month labels along the top: show month abbrev on the week whose Sunday is the 1st or the leftmost of that month
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
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Activity <span className="font-normal text-gray-400">— last {weeks.length} weeks</span>
        </h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
          {totalSessions} sessions · {activeDays} active days
        </span>
      </div>
      <div className="flex gap-2">
        {/* Day-of-week labels (show a subset) */}
        <div className="flex flex-col gap-[3px] pt-4 text-[9px] text-gray-400 dark:text-gray-600 font-medium">
          {dowLabels.map((l, i) => (
            <div key={i} className="h-[11px] leading-[11px]">{i % 2 === 1 ? l : ''}</div>
          ))}
        </div>
        <div className="flex-1">
          {/* Month labels */}
          <div className="relative h-3 mb-1 text-[9px] text-gray-400 dark:text-gray-600 font-medium">
            {monthLabels.map(({ weekIndex, label }) => (
              <span
                key={weekIndex}
                className="absolute"
                style={{ left: `calc(${weekIndex} * (11px + 3px))` }}
              >
                {label}
              </span>
            ))}
          </div>
          {/* Grid */}
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
          {/* Legend */}
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-gray-400 dark:text-gray-600">
            <span>Less</span>
            {[0, 0.2, 0.4, 0.7, 1].map(r => (
              <div key={r} className={`w-[11px] h-[11px] rounded-[2px] ${heatmapCellColor(Math.ceil(r * max), max)}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SlowestToolsCard({ calls, onOpenSession }: { calls: SlowToolCall[]; onOpenSession: (id: string, turnId?: string) => void }) {
  if (calls.length === 0) return null
  const max = Math.max(...calls.map(c => c.durationMs), 1)
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
    </div>
  )
}

function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function ContextHotspotsCard({ stats, onOpenSession }: { stats: ContextHotspotStats; onOpenSession: (id: string, turnId?: string) => void }) {
  if (stats.rows.length === 0) return null
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Context Window Hotspots</h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-400 dark:text-gray-600">
            avg peak {fmtTokensShort(stats.avgPeakTokens)} · p90 {fmtTokensShort(stats.p90PeakTokens)}
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
                {fmtTokensShort(r.peakContextTokens)}/{limitLabel}
              </span>
              <span className="text-xs text-gray-900 dark:text-gray-100 tabular-nums font-medium w-10 text-right shrink-0">{Math.round(pct * 100)}%</span>
            </button>
          )
        })}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-3 leading-relaxed">
        Peak = max of <span className="font-mono">input + cache_read + cache_create</span> across assistant turns — the closest the session ever got to its context limit. Claude Code auto-compacts near ~95%.
      </p>
    </div>
  )
}

function McpServersCard({ servers }: { servers: McpServerUsage[] }) {
  if (servers.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">MCP Servers</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">No MCP tool calls found in this range.</p>
      </div>
    )
  }
  const total = servers.reduce((s, v) => s + v.count, 0)
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
    </div>
  )
}

function SessionTimeline({ session }: { session: Session }) {
  const start = new Date(session.startedAt).getTime()
  const end = new Date(session.endedAt).getTime()
  const span = Math.max(end - start, 1)
  const events: { turnUuid: string; toolName: string; ts: number; pct: number }[] = []
  for (const turn of session.turns) {
    const ts = new Date(turn.timestamp).getTime()
    const pct = Math.max(0, Math.min(100, ((ts - start) / span) * 100))
    for (const tc of turn.toolCalls) {
      events.push({ turnUuid: turn.uuid, toolName: tc.name, ts, pct })
    }
  }
  if (events.length === 0) return null

  const scrollToTurn = (turnUuid: string) => {
    const el = document.getElementById(`turn-${turnUuid}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Legend: unique tool names in play, limited
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.toolName] = (counts[e.toolName] ?? 0) + 1
  const legend = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Timeline</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">{events.length} tool calls · span {fmtDuration(end - start)}</span>
      </div>
      <div className="relative h-8 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden">
        {events.map((e, i) => (
          <button key={i}
            onClick={() => scrollToTurn(e.turnUuid)}
            title={`${e.toolName} · ${new Date(e.ts).toLocaleTimeString()}`}
            className={`absolute top-1 bottom-1 w-[2px] rounded-sm ${toolTickColor(e.toolName)} opacity-70 hover:opacity-100 hover:w-[3px] transition-all cursor-pointer`}
            style={{ left: `${e.pct}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {legend.map(([name, n]) => (
            <span key={name} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-500">
              <span className={`inline-block w-2 h-2 rounded-sm ${toolTickColor(name)}`} />
              {name} <span className="text-gray-400 dark:text-gray-600 tabular-nums">{n}</span>
            </span>
          ))}
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}

function HotFilesCard({ files }: { files: HotFile[] }) {
  const max = Math.max(...files.map(f => f.totalOps), 1)

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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

function InsightsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string, turnId?: string) => void }) {
  const [range, setRange] = useState<DateRange>('all')
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
  const usage = React.useMemo(() => totalUsage(filtered), [filtered])
  const modelRows = React.useMemo(() => usageByModel(filtered), [filtered])
  const costSeriesDays = range === 'all' ? 30 : RANGE_DAYS[range]
  const dailyCostSeries = React.useMemo(() => dailyCost(filtered, costSeriesDays), [filtered, costSeriesDays])
  const errorStats = React.useMemo(() => toolErrorRates(filtered), [filtered])
  const slowCalls = React.useMemo(() => slowestToolCalls(filtered, 10), [filtered])
  const mcpServers = React.useMemo(() => mcpUsageStats(filtered), [filtered])
  const contextHotspots = React.useMemo(() => contextWindowHotspots(filtered, 10), [filtered])
  const heatmap = React.useMemo(() => activityHeatmap(sessions, 14), [sessions])  // fixed 14-week view
  const hasUsageData = usage.totalTokens > 0
  const maxHour = Math.max(...hourActivity.map(h => h.count), 1)
  const maxTool = Math.max(...topTools.map(t => t.count), 1)
  const maxDailyCost = Math.max(...dailyCostSeries.map(d => d.costUSD), 0.0001)

  const [insightTab, setInsightTab] = useState<'overview' | 'cost' | 'efficiency' | 'skills' | 'projects'>('overview')
  const totalToolCalls = topTools.reduce((s, t) => s + t.count, 0)

  const insightTabBtn = (label: string, value: typeof insightTab, badge?: number) => (
    <button
      onClick={() => setInsightTab(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        insightTab === value
          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
          insightTab === value ? 'bg-white/20 text-white dark:bg-black/20 dark:text-gray-900' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
        }`}>{badge}</span>
      )}
    </button>
  )

  return (
    <div className="flex flex-col gap-5">

      {/* ── Compact stat strip ── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl px-6 py-4">
        <div className="flex items-center gap-0 divide-x divide-gray-100 dark:divide-gray-800">
          {[
            { label: 'Sessions', value: filtered.length.toLocaleString() },
            { label: 'Projects', value: projects.length.toLocaleString() },
            { label: 'Tool Calls', value: totalToolCalls.toLocaleString() },
            { label: 'Avg Duration', value: fmtDuration(depth.avgDurationMs) },
            { label: 'Avg Tools', value: depth.avgToolCalls.toFixed(1) },
            { label: 'Avg Turns', value: depth.avgTurns.toFixed(1) },
            { label: 'Pace', value: fmtPace(depth.avgDurationMs, depth.avgToolCalls) },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col px-5 first:pl-0 last:pr-0">
              <span className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wide">{label}</span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sub-tab nav + range picker + export ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {insightTabBtn('Overview', 'overview')}
          {insightTabBtn('Cost', 'cost')}
          {insightTabBtn('Efficiency', 'efficiency')}
          {insightTabBtn('Skills', 'skills', gaps.length)}
          {insightTabBtn('Projects', 'projects')}
        </div>
        <div className="flex items-center gap-2">
          <button
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
            })}
            className="text-xs px-2.5 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg transition-colors"
            title="Download the current insights view as a Markdown report">
            ↓ Report
          </button>
          <RangePicker range={range} setRange={setRange} />
        </div>
      </div>

      {/* ── Overview ── */}
      {insightTab === 'overview' && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-5">
            {/* Task Types */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
            </div>

            {/* Activity charts stacked */}
            <div className="flex flex-col gap-3">
              <ActivityHeatmapCard cells={heatmap} />

              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
              </div>
            </div>
          </div>

          {/* Top Tools + Trend */}
          <div className={range === 'all' ? 'grid grid-cols-2 gap-5' : 'grid grid-cols-1 gap-5'}>
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Top Tools</h3>
              <div className="flex flex-col gap-2">
                {topTools.slice(0, 8).map(tool => (
                  <div key={tool.name} className="flex items-center gap-3">
                    <Tooltip content={<span className="text-[11px] font-mono text-gray-700 dark:text-gray-300">{tool.name}</span>}>
                      <span className={`text-xs px-2 py-0.5 rounded font-mono w-24 text-center shrink-0 truncate cursor-default ${toolColor(tool.name)}`}>{tool.name}</span>
                    </Tooltip>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                      <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${(tool.count / maxTool) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right tabular-nums">{tool.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {range === 'all' && (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
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
            </div>
            )}
          </div>

        </div>
      )}

      {/* ── Cost ── */}
      {insightTab === 'cost' && (
        <CostPanel usage={usage} modelRows={modelRows} dailySeries={dailyCostSeries} maxDailyCost={maxDailyCost} hasData={hasUsageData} dailySeriesDays={costSeriesDays} />
      )}

      {/* ── Efficiency ── */}
      {insightTab === 'efficiency' && (
        <div className="flex flex-col gap-5">
          <ContextHotspotsCard stats={contextHotspots} onOpenSession={onOpenSession} />
          <EfficiencyPanel breakdown={bashBreakdown} antiPatterns={antiPatterns} />
          <SlowestToolsCard calls={slowCalls} onOpenSession={onOpenSession} />
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
          <HotFilesCard files={files} />
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
            <ProjectTree projects={projects} sessions={sessions} onOpenSession={onOpenSession} />
          </div>
        </div>
      )}
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

function SessionsTab({ sessions, initialSessionId, scrollToTurnId }: { sessions: Session[]; initialSessionId: string | null; scrollToTurnId: string | null }) {
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
          ? <SessionDetailView session={selected} scrollToTurnId={scrollToTurnId} />
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
  // Strip meta noise
  const cleaned = raw
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-message>[^<]*<\/command-message>/g, '')
    .replace(/<command-args>[^<]*<\/command-args>/g, '')
    .replace(/\[Request interrupted by user\]\s*/g, '')
    .trim()

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

function TimeLabel({ timestamp }: { timestamp: string }) {
  return (
    <span className="text-[10px] text-gray-400 dark:text-gray-600 shrink-0 self-end leading-none">
      {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

function TurnBody({ text, role, timestamp }: { text: string; role: 'user' | 'assistant'; timestamp: string }) {
  if (role === 'assistant') {
    return (
      <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">
        <MarkdownText>{text}</MarkdownText>
        <div className="flex justify-end mt-1.5">
          <TimeLabel timestamp={timestamp} />
        </div>
      </div>
    )
  }

  const parts = parseTurnContent(text)
  if (parts.length === 0) return null

  const hasSlashCmd = parts.some(p => p.kind === 'slash-command')
  const lastTextIdx = [...parts].reverse().findIndex(p => p.kind === 'text')
  const lastTextAbsIdx = lastTextIdx === -1 ? -1 : parts.length - 1 - lastTextIdx

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) => {
        if (part.kind === 'slash-command') {
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm text-gray-800 dark:text-gray-200">
                {part.command}
                {part.args && <span className="text-gray-500 text-xs">{part.args}</span>}
              </span>
            </div>
          )
        }
        if (part.kind === 'stdout') {
          if (hasSlashCmd) return null
          return (
            <pre key={i} className="text-xs text-gray-500 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 font-mono whitespace-pre-wrap">
              {part.output}
            </pre>
          )
        }
        // plain text
        if (part.kind !== 'text') return null
        const isLast = i === lastTextAbsIdx
        return (
          <div key={i} className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-indigo-50 dark:bg-indigo-600/20 text-gray-900 dark:text-gray-200">
            <MarkdownText>{part.text}</MarkdownText>
            {isLast && (
              <div className={`flex mt-1.5 ${role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <TimeLabel timestamp={timestamp} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Edit Diff View ────────────────────────────────────────────────────────────

function EditDiffView({ input }: { input: Record<string, unknown> }) {
  const filePath = input['file_path'] as string | undefined
  const oldStr = (input['old_string'] as string | undefined) ?? ''
  const newStr = (input['new_string'] as string | undefined) ?? ''

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

// ── File Language Icons ───────────────────────────────────────────────────────

const EXT_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  ts:     { icon: SiTypescript,  color: 'text-blue-500' },
  tsx:    { icon: SiReact,       color: 'text-cyan-400' },
  js:     { icon: SiJavascript,  color: 'text-yellow-400' },
  jsx:    { icon: SiReact,       color: 'text-cyan-400' },
  mjs:    { icon: SiJavascript,  color: 'text-yellow-400' },
  cjs:    { icon: SiJavascript,  color: 'text-yellow-400' },
  py:     { icon: SiPython,      color: 'text-blue-400' },
  rs:     { icon: SiRust,        color: 'text-orange-500' },
  go:     { icon: SiGo,          color: 'text-cyan-500' },
  rb:     { icon: SiRuby,        color: 'text-red-500' },
  php:    { icon: SiPhp,         color: 'text-indigo-400' },
  swift:  { icon: SiSwift,       color: 'text-orange-400' },
  kt:     { icon: SiKotlin,      color: 'text-purple-400' },
  kts:    { icon: SiKotlin,      color: 'text-purple-400' },
  cpp:    { icon: SiCplusplus,   color: 'text-blue-600' },
  cc:     { icon: SiCplusplus,   color: 'text-blue-600' },
  c:      { icon: SiC,           color: 'text-blue-500' },
  h:      { icon: SiC,           color: 'text-blue-400' },
  html:   { icon: SiHtml5,       color: 'text-orange-500' },
  css:    { icon: SiCss,         color: 'text-blue-400' },
  scss:   { icon: SiCss,         color: 'text-pink-400' },
  sass:   { icon: SiCss,         color: 'text-pink-400' },
  md:     { icon: SiMarkdown,    color: 'text-gray-500' },
  mdx:    { icon: SiMarkdown,    color: 'text-gray-500' },
  json:   { icon: SiJson,        color: 'text-yellow-500' },
  yaml:   { icon: SiYaml,        color: 'text-red-400' },
  yml:    { icon: SiYaml,        color: 'text-red-400' },
  sh:     { icon: SiShell,       color: 'text-green-400' },
  bash:   { icon: SiShell,       color: 'text-green-400' },
  zsh:    { icon: SiShell,       color: 'text-green-400' },
  vue:    { icon: SiVuedotjs,    color: 'text-emerald-400' },
  svelte: { icon: SiSvelte,      color: 'text-orange-500' },
  dart:   { icon: SiDart,        color: 'text-cyan-500' },
  scala:  { icon: SiScala,       color: 'text-red-500' },
  ex:     { icon: SiElixir,      color: 'text-purple-500' },
  exs:    { icon: SiElixir,      color: 'text-purple-500' },
  hs:     { icon: SiHaskell,     color: 'text-purple-400' },
  lua:    { icon: SiLua,         color: 'text-blue-400' },
  prisma: { icon: SiPrisma,      color: 'text-teal-400' },
  dockerfile: { icon: SiDocker,  color: 'text-blue-400' },
}

function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  const name = path.split('/').pop() ?? ''
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : name.toLowerCase()
  const match = EXT_ICONS[ext]
  if (!match) return <RiFileCodeLine size={size} className="text-gray-400 dark:text-gray-600" />
  const Icon = match.icon
  return <Icon size={size} className={match.color} />
}

// ── File Change Summary ───────────────────────────────────────────────────────

type FileWriteOp = { kind: 'write'; content: string; ts: string }
type FileEditOp = { kind: 'edit'; oldStr: string; newStr: string; ts: string }
type FileOp = FileWriteOp | FileEditOp

type FileChange = {
  path: string
  ops: FileOp[]
  writeCount: number
  editCount: number
  linesAdded: number
  linesRemoved: number
}

function buildFileChanges(session: Session): FileChange[] {
  const map = new Map<string, FileChange>()
  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      const path = tc.input['file_path'] as string | undefined
      if (!path) continue
      const get = () => map.get(path) ?? (() => {
        const fc: FileChange = { path, ops: [], writeCount: 0, editCount: 0, linesAdded: 0, linesRemoved: 0 }
        map.set(path, fc); return fc
      })()
      if (tc.name === 'Write') {
        const content = (tc.input['content'] as string | undefined) ?? ''
        const fc = get()
        fc.ops.push({ kind: 'write', content, ts: turn.timestamp })
        fc.writeCount++
        fc.linesAdded += content.split('\n').length
      } else if (tc.name === 'Edit') {
        const oldStr = (tc.input['old_string'] as string | undefined) ?? ''
        const newStr = (tc.input['new_string'] as string | undefined) ?? ''
        const fc = get()
        fc.ops.push({ kind: 'edit', oldStr, newStr, ts: turn.timestamp })
        fc.editCount++
        fc.linesAdded += newStr.split('\n').length
        fc.linesRemoved += oldStr.split('\n').length
      }
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function SessionFilesView({ session }: { session: Session }) {
  const changes = React.useMemo(() => buildFileChanges(session), [session.id])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set())
  const toggle = (p: string) => setExpanded(prev => {
    const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next
  })
  const toggleOp = (key: string) => setExpandedOps(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  if (changes.length === 0) {
    return <p className="text-center py-12 text-sm text-gray-500 dark:text-gray-600">No file changes in this session</p>
  }

  const totalEdits = changes.reduce((s, c) => s + c.editCount, 0)
  const totalWrites = changes.reduce((s, c) => s + c.writeCount, 0)
  const totalAdded = changes.reduce((s, c) => s + c.linesAdded, 0)
  const totalRemoved = changes.reduce((s, c) => s + c.linesRemoved, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Summary strip */}
      <div className="flex items-center gap-4 px-1 text-xs text-gray-500 dark:text-gray-500">
        <span className="font-medium text-gray-700 dark:text-gray-300">{changes.length} files</span>
        {totalWrites > 0 && <span>{totalWrites} write{totalWrites > 1 ? 's' : ''}</span>}
        {totalEdits > 0 && <span>{totalEdits} edit{totalEdits > 1 ? 's' : ''}</span>}
        <span className="ml-auto font-mono">
          {totalAdded > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{totalAdded}</span>}
          {totalAdded > 0 && totalRemoved > 0 && <span className="text-gray-400 mx-1">/</span>}
          {totalRemoved > 0 && <span className="text-rose-500 dark:text-rose-400">−{totalRemoved}</span>}
        </span>
      </div>

      {changes.map(fc => {
        const isExpanded = expanded.has(fc.path)
        const parts = fc.path.split('/')
        const fileName = parts.pop() ?? fc.path
        const dir = parts.slice(-2).join('/')

        return (
          <div key={fc.path} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
            <button onClick={() => toggle(fc.path)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
              <span className="shrink-0"><FileIcon path={fc.path} size={15} /></span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-200">{fileName}</span>
                {dir && <span className="text-xs text-gray-400 dark:text-gray-600 ml-2 font-mono">{dir}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {fc.writeCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    {fc.writeCount}W
                  </span>
                )}
                {fc.editCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    {fc.editCount}E
                  </span>
                )}
                <span className="text-xs font-mono">
                  <span className="text-emerald-600 dark:text-emerald-400">+{fc.linesAdded}</span>
                  <span className="text-gray-400 mx-0.5">/</span>
                  <span className="text-rose-500 dark:text-rose-400">−{fc.linesRemoved}</span>
                </span>
              </div>
              <span className="text-gray-400 dark:text-gray-600 text-xs ml-1">{isExpanded ? '▾' : '▸'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 pt-2 flex flex-col gap-2 border-t border-gray-100 dark:border-gray-800">
                {fc.ops.map((op, i) => {
                  const opKey = `${fc.path}:${i}`
                  const isOpExpanded = expandedOps.has(opKey)
                  const opLabel = op.kind === 'write'
                    ? `WRITE · ${op.content.split('\n').length} lines`
                    : `EDIT`
                  return (
                    <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                      <button onClick={() => toggleOp(opKey)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                        <span className={`text-[11px] font-mono font-semibold ${op.kind === 'write' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'}`}>
                          {opLabel}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-600 font-mono">
                          · {new Date(op.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {fc.ops.length > 1 && ` #${i + 1}`}
                        </span>
                        <span className="ml-auto text-gray-400 dark:text-gray-600 text-xs">{isOpExpanded ? '▾' : '▸'}</span>
                      </button>
                      {isOpExpanded && (
                        <div className="border-t border-gray-100 dark:border-gray-800">
                          {op.kind === 'write' ? (
                            <div className="max-h-56 overflow-y-auto text-xs font-mono">
                              {op.content.split('\n').slice(0, 60).map((line, li) => (
                                <div key={li} className="flex gap-2 px-3 py-0.5 bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                                  <span className="text-gray-300 dark:text-gray-700 select-none w-6 text-right shrink-0">{li + 1}</span>
                                  <span className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{line || ' '}</span>
                                </div>
                              ))}
                              {op.content.split('\n').length > 60 && (
                                <div className="px-4 py-2 text-gray-400 dark:text-gray-600 text-center">
                                  … {op.content.split('\n').length - 60} more lines
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3">
                              <EditDiffView input={{ old_string: op.oldStr, new_string: op.newStr }} />
                            </div>
                          )}
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

// ── Session Detail View ───────────────────────────────────────────────────────

function SessionDetailView({ session, scrollToTurnId }: { session: Session; scrollToTurnId: string | null }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'conversation' | 'files'>('conversation')
  const toggleTool = (id: string) => setExpandedTools(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const filesCount = React.useMemo(() => buildFileChanges(session).length, [session.id])

  useEffect(() => {
    if (!scrollToTurnId) return
    const el = document.getElementById(`turn-${scrollToTurnId}`)
    if (!el) return
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedTurnId(scrollToTurnId)
      setTimeout(() => setHighlightedTurnId(null), 1500)
    }, 150)
    return () => clearTimeout(timer)
  }, [scrollToTurnId, session.id])

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl overflow-hidden">
        {/* Project info + export */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{session.project}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{session.projectPath}</p>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-4">
            <button onClick={() => exportSessionAsMarkdown(session)}
              className="text-xs px-2.5 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg transition-colors">
              ↓ MD
            </button>
            <button onClick={() => exportSessionAsHTML(session)}
              className="text-xs px-2.5 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg transition-colors">
              ↓ HTML
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 border-t border-gray-100 dark:border-gray-800 divide-x divide-gray-100 dark:divide-gray-800">
          {([
            { icon: <RiTimeLine size={15} />, label: 'Duration', value: fmtDuration(session.durationMs) },
            { icon: <RiTerminalLine size={15} />, label: 'Tool Calls', value: session.stats.toolCallCount },
            { icon: <RiChat3Line size={15} />, label: 'Turns', value: session.turns.length },
            { icon: <RiFlashlightLine size={15} />, label: 'Pace', value: fmtPace(session.durationMs, session.stats.toolCallCount) },
          ] as const).map(({ icon, label, value }) => (
            <div key={label} className="flex items-center gap-2.5 px-4 py-3">
              <span className="text-gray-400 dark:text-gray-600 shrink-0">{icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none">{value}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-none">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SessionTimeline session={session} />

      {/* Detail tab switcher */}
      <div className="flex gap-1">
        <button onClick={() => setDetailTab('conversation')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${detailTab === 'conversation' ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          Conversation
        </button>
        <button onClick={() => setDetailTab('files')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${detailTab === 'files' ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          Files changed
          {filesCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${detailTab === 'files' ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
              {filesCount}
            </span>
          )}
        </button>
      </div>

      {detailTab === 'files' && <SessionFilesView session={session} />}

      {detailTab === 'conversation' && (() => {
        let lastDate = ''
        return session.turns.flatMap(turn => {
          const dateKey = new Date(turn.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          const showDate = dateKey !== lastDate
          lastDate = dateKey
          // Skip user turns whose text is entirely meta/noise (nothing left after stripping)
          const userPartsEmpty = turn.role === 'user'
            && turn.toolCalls.length === 0
            && parseTurnContent(turn.text).length === 0

          return [
            !userPartsEmpty && showDate && (
              <div key={`date-${dateKey}`} className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                <span className="text-[11px] text-gray-400 dark:text-gray-600 font-medium px-2">{dateKey}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>
            ),
            !userPartsEmpty && <div key={turn.uuid} id={`turn-${turn.uuid}`}
              className={`flex gap-3 rounded-2xl transition-colors duration-700 ${turn.role === 'user' ? 'flex-row-reverse' : ''} ${highlightedTurnId === turn.uuid ? 'bg-yellow-100 dark:bg-yellow-400/10' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                ${turn.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                {turn.role === 'user' ? 'U' : 'C'}
              </div>
              <div className={`max-w-[85%] flex flex-col gap-2 min-w-0 ${turn.role === 'assistant' ? 'flex-1' : ''}`}>
                {turn.text && <TurnBody text={turn.text} role={turn.role} timestamp={turn.timestamp} />}

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
              </div>
            </div>,
          ].filter(Boolean)
        })
      })()}
    </div>
  )
}

// ── Session Detail View end ───────────────────────────────────────────────────

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

type InsightsExportInput = {
  rangeLabel: string
  sessionCount: number
  projectCount: number
  totalToolCalls: number
  depth: { avgDurationMs: number; avgToolCalls: number; avgTurns: number }
  topTools: { name: string; count: number }[]
  tasks: { type: SessionType; count: number }[]
  usage: TotalUsage
  modelRows: ModelUsageRow[]
  antiPatterns: BashAntiPattern[]
  slowCalls: SlowToolCall[]
  skillUsage: SkillUsage[]
  gaps: SkillGap[]
  mcpServers: McpServerUsage[]
  hotFiles: HotFile[]
  errorStats: ToolErrorStats
}

function exportInsightsAsMarkdown(data: InsightsExportInput) {
  const L: string[] = []
  const now = new Date()
  L.push(`# Claude Code Insights — ${data.rangeLabel}`)
  L.push(``)
  L.push(`Generated ${now.toLocaleString()}`)
  L.push(``)
  L.push(`## Summary`)
  L.push(``)
  L.push(`| Metric | Value |`)
  L.push(`| --- | --- |`)
  L.push(`| Sessions | ${data.sessionCount.toLocaleString()} |`)
  L.push(`| Projects | ${data.projectCount.toLocaleString()} |`)
  L.push(`| Tool calls | ${data.totalToolCalls.toLocaleString()} |`)
  L.push(`| Avg duration | ${fmtDuration(data.depth.avgDurationMs)} |`)
  L.push(`| Avg tools / session | ${data.depth.avgToolCalls.toFixed(1)} |`)
  L.push(`| Avg turns / session | ${data.depth.avgTurns.toFixed(1)} |`)
  L.push(``)

  if (data.usage.totalTokens > 0) {
    L.push(`## Cost & tokens`)
    L.push(``)
    L.push(`- **Est. cost:** ${fmtUSD(data.usage.costUSD)}`)
    L.push(`- **Total tokens:** ${fmtTokenCount(data.usage.totalTokens)}`)
    L.push(`- **Cache hit rate:** ${(data.usage.cacheHitRate * 100).toFixed(1)}%`)
    L.push(``)
    if (data.modelRows.length > 0) {
      L.push(`### By model`)
      L.push(``)
      L.push(`| Model | Tokens | Cost |`)
      L.push(`| --- | ---: | ---: |`)
      for (const m of data.modelRows) L.push(`| ${m.versionLabel} | ${fmtTokenCount(m.totalTokens)} | ${fmtUSD(m.costUSD)} |`)
      L.push(``)
    }
  }

  if (data.tasks.length > 0) {
    L.push(`## Task types`)
    L.push(``)
    for (const t of data.tasks) {
      const pct = Math.round((t.count / Math.max(data.sessionCount, 1)) * 100)
      L.push(`- **${t.type}** — ${t.count} (${pct}%)`)
    }
    L.push(``)
  }

  if (data.topTools.length > 0) {
    L.push(`## Top tools`)
    L.push(``)
    for (const t of data.topTools.slice(0, 10)) L.push(`- \`${t.name}\` — ${t.count}`)
    L.push(``)
  }

  if (data.antiPatterns.length > 0) {
    L.push(`## Bash anti-patterns`)
    L.push(``)
    L.push(`| Bash | Better tool | Count | Wasted chars |`)
    L.push(`| --- | --- | ---: | ---: |`)
    for (const p of data.antiPatterns) L.push(`| ${p.bashCmd} | ${p.betterTool} | ${p.count} | ${p.totalResultChars.toLocaleString()} |`)
    L.push(``)
  }

  if (data.slowCalls.length > 0) {
    L.push(`## Slowest tool calls`)
    L.push(``)
    for (const c of data.slowCalls) L.push(`- \`${c.toolName}\` — ${fmtToolDuration(c.durationMs)}${c.preview ? ` — ${c.preview}` : ''}`)
    L.push(``)
  }

  if (data.errorStats.rows.length > 0) {
    L.push(`## Tool errors`)
    L.push(``)
    L.push(`Overall error rate: ${(data.errorStats.overallRate * 100).toFixed(2)}% (${data.errorStats.totalErrors} / ${data.errorStats.totalCalls})`)
    L.push(``)
    for (const r of data.errorStats.rows) L.push(`- \`${r.name}\` — ${r.errors} errors / ${r.total} calls (${(r.errorRate * 100).toFixed(1)}%)`)
    L.push(``)
  }

  if (data.skillUsage.length > 0) {
    L.push(`## Skills used`)
    L.push(``)
    for (const s of data.skillUsage) L.push(`- \`/${s.name}\` — ${s.count}× across ${s.projectCount} project(s)`)
    L.push(``)
  }

  if (data.gaps.length > 0) {
    L.push(`## Skill suggestions`)
    L.push(``)
    for (const g of data.gaps) L.push(`- \`${g.skill}\` — ${g.description} (${g.evidence})`)
    L.push(``)
  }

  if (data.mcpServers.length > 0) {
    L.push(`## MCP servers`)
    L.push(``)
    for (const m of data.mcpServers) L.push(`- \`${m.server}\` — ${m.count} calls across ${m.sessionCount} session(s)`)
    L.push(``)
  }

  if (data.hotFiles.length > 0) {
    L.push(`## Hot files`)
    L.push(``)
    for (const f of data.hotFiles.slice(0, 10)) L.push(`- \`${f.path}\` — ${f.totalOps} ops (${f.editCount} edits, ${f.writeCount} writes)`)
    L.push(``)
  }

  const blob = new Blob([L.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cclens-insights-${now.toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSessionAsHTML(session: Session) {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

function SearchTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (id: string, turnId?: string) => void }) {
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

// ── Memory Tab ────────────────────────────────────────────────────────────────

const MEMORY_TYPE_ORDER: MemoryEntryType[] = ['user', 'feedback', 'project', 'reference', 'other']

const MEMORY_TYPE_BADGE: Record<MemoryEntryType, string> = {
  user:      'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  feedback:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  project:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  reference: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  other:     'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
}

const MEMORY_TYPE_LABEL: Record<MemoryEntryType, string> = {
  user:      'User',
  feedback:  'Feedback',
  project:   'Project',
  reference: 'Reference',
  other:     'Other',
}

function MemoryTab({ memory }: { memory: MemoryEntry[] }) {
  const projects = React.useMemo(() => {
    const map = new Map<string, { slug: string; name: string; entries: MemoryEntry[] }>()
    for (const e of memory) {
      if (e.isIndex) continue  // exclude MEMORY.md from entry lists
      const g = map.get(e.projectSlug) ?? { slug: e.projectSlug, name: e.projectName, entries: [] }
      g.entries.push(e)
      map.set(e.projectSlug, g)
    }
    return [...map.values()].sort((a, b) => b.entries.length - a.entries.length)
  }, [memory])

  const [selectedSlug, setSelectedSlug] = useState<string | null>(projects[0]?.slug ?? null)
  const [typeFilter, setTypeFilter] = useState<MemoryEntryType | 'all'>('all')

  const selected = projects.find(p => p.slug === selectedSlug) ?? projects[0]

  const grouped = React.useMemo(() => {
    const groups = new Map<MemoryEntryType, MemoryEntry[]>()
    if (!selected) return groups
    for (const e of selected.entries) {
      if (typeFilter !== 'all' && e.type !== typeFilter) continue
      const arr = groups.get(e.type) ?? []
      arr.push(e)
      groups.set(e.type, arr)
    }
    return groups
  }, [selected, typeFilter])

  const typeCounts = React.useMemo(() => {
    const c: Record<MemoryEntryType, number> = { user: 0, feedback: 0, project: 0, reference: 0, other: 0 }
    if (!selected) return c
    for (const e of selected.entries) c[e.type]++
    return c
  }, [selected])

  if (projects.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No Claude Code memory files found in the selected folder.</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">Memory lives at <code className="font-mono text-[11px]">~/.claude/projects/&lt;project&gt;/memory/*.md</code> — pick that parent folder to surface it here.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-5">
      {/* Project list */}
      <aside className="w-64 shrink-0">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-3 sticky top-6">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-2 pt-1 pb-2">Projects</h3>
          <div className="flex flex-col gap-0.5">
            {projects.map(p => (
              <button
                key={p.slug}
                onClick={() => { setSelectedSlug(p.slug); setTypeFilter('all') }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                  selected?.slug === p.slug
                    ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <span className="text-xs font-medium truncate flex-1" title={p.slug}>{p.name}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{p.entries.length}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Entry list */}
      <section className="flex-1 min-w-0 flex flex-col gap-4">
        {selected && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selected.name}</h2>
              <span className="text-xs text-gray-400 dark:text-gray-600 font-mono" title={selected.slug}>{selected.slug}</span>
              <span className="text-xs text-gray-500 dark:text-gray-500 ml-auto">{selected.entries.length} entries</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <MemoryFilterBtn label="All" count={selected.entries.length} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {MEMORY_TYPE_ORDER.map(t => {
                const c = typeCounts[t]
                if (c === 0) return null
                return (
                  <MemoryFilterBtn
                    key={t}
                    label={MEMORY_TYPE_LABEL[t]}
                    count={c}
                    active={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    accent={MEMORY_TYPE_BADGE[t]}
                  />
                )
              })}
            </div>

            <div className="flex flex-col gap-3">
              {MEMORY_TYPE_ORDER.flatMap(t => grouped.get(t) ?? []).map(e => (
                <article key={e.projectSlug + '/' + e.fileName} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
                  <header className="flex items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{e.name ?? e.fileName}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${MEMORY_TYPE_BADGE[e.type]}`}>
                          {MEMORY_TYPE_LABEL[e.type]}
                        </span>
                      </div>
                      {e.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">{e.description}</p>
                      )}
                      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1 font-mono">{e.fileName}</p>
                    </div>
                  </header>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <MarkdownText>{e.body}</MarkdownText>
                  </div>
                </article>
              ))}
              {selected.entries.filter(e => typeFilter === 'all' || e.type === typeFilter).length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-600 text-center py-8">No entries in this category.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function MemoryFilterBtn({ label, count, active, onClick, accent }: { label: string; count: number; active: boolean; onClick: () => void; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
        active
          ? accent ?? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      <span className={`text-[10px] tabular-nums ${active ? 'opacity-80' : 'text-gray-400 dark:text-gray-600'}`}>{count}</span>
    </button>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

type Tab = 'insights' | 'sessions' | 'search' | 'memory'

function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)
  const scrolledEl = useRef<Element | null>(null)

  useEffect(() => {
    const onScroll = (e: Event) => {
      const target = e.target as Element | Document
      const scrollTop = target === document ? window.scrollY : (target as Element).scrollTop
      if (scrollTop > 300) {
        setVisible(true)
        scrolledEl.current = target === document ? null : (target as Element)
      } else {
        setVisible(false)
        scrolledEl.current = null
      }
    }
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  return (
    <button
      onClick={() => {
        if (scrolledEl.current) scrolledEl.current.scrollTo({ top: 0, behavior: 'smooth' })
        else window.scrollTo({ top: 0, behavior: 'smooth' })
      }}
      className={`fixed bottom-6 right-6 z-50 w-10 h-10 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-90 text-white shadow-lg transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      title="Back to top"
    >
      <RiArrowUpLine size={18} />
    </button>
  )
}

function App() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [memory, setMemory] = useState<MemoryEntry[]>([])
  const [tab, setTab] = useState<Tab>('insights')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
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

  const openSession = (id: string, turnId?: string) => {
    setSelectedSessionId(id)
    setSelectedTurnId(turnId ?? null)
    setTab('sessions')
  }

  if (!sessions) return <UploadScreen onLoad={({ sessions, memory }) => { setSessions(sessions); setMemory(memory) }} theme={theme} setTheme={setTheme} />

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
        {memory.length > 0 && (
          <NavTab label="Memory" active={tab === 'memory'} onClick={() => setTab('memory')} />
        )}
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button onClick={() => { setSessions(null); setMemory([]) }} className="text-xs text-gray-500 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
            ↩ Upload new files
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">
        {tab === 'insights' && <InsightsTab sessions={sessions} onOpenSession={openSession} />}
        {tab === 'sessions' && <SessionsTab sessions={sessions} initialSessionId={selectedSessionId} scrollToTurnId={selectedTurnId} />}
        {tab === 'search' && <SearchTab sessions={sessions} onOpenSession={openSession} />}
        {tab === 'memory' && <MemoryTab memory={memory} />}
      </main>
      <ScrollToTopButton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

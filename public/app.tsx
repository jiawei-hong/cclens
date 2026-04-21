import React, { useState, useEffect, useRef } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { createRoot } from 'react-dom/client'
import { RiSunLine, RiMoonLine, RiComputerLine, RiArrowUpLine, RiSettings3Line, RiFolderHistoryLine } from 'react-icons/ri'
import { parseSessionFiles, parseSessionFilesCached, parseMemoryFiles, parseMemoryFilesCached, type TrackedFile } from './lib/parser'
import type { Session, MemoryEntry } from '../src/types'
import { walkFolder } from './lib/walkDir'
import { loadRootHandle, saveRootHandle, clearRootHandle, queryHandlePermission, requestHandlePermission } from './lib/db'
import { InsightsTab } from './tabs/InsightsTab'
import { SearchTab } from './tabs/SearchTab'
import { MemoryTab } from './tabs/MemoryTab'
import { SessionsTab } from './tabs/SessionsTab'
import { SettingsModal } from './components/SettingsModal'
import { ShortcutsHelp } from './components/ShortcutsHelp'

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
  const [savedHandle, setSavedHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [savedPerm, setSavedPerm] = useState<'granted' | 'prompt' | 'denied' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  const processTrackedHandle = async (dir: FileSystemDirectoryHandle) => {
    setLoadingMsg('Scanning folder…')
    const tracked = await walkFolder(dir)
    const jsonlCount = tracked.filter(t => t.file.name.endsWith('.jsonl')).length
    if (jsonlCount === 0) throw new Error('No .jsonl files found in the selected folder.')
    setLoadingMsg(`Parsing ${jsonlCount} sessions…`)
    const { items: sessions, fromCache, reparsed } = await parseSessionFilesCached(tracked, (done, total) => {
      setLoadingMsg(`Parsing sessions ${done}/${total}…`)
    })
    if (sessions.length === 0) throw new Error('No valid sessions found.')
    setLoadingMsg(fromCache > 0 ? `Loaded ${sessions.length} sessions (${fromCache} cached, ${reparsed} re-parsed). Parsing memory…` : 'Parsing memory files…')
    const { items: memory } = await parseMemoryFilesCached(tracked)
    saveRootHandle(dir).catch(() => { /* best-effort */ })
    onLoad({ sessions, memory })
  }

  const processLooseFiles = async (files: File[]) => {
    setLoadingMsg(`Parsing ${files.length} files…`)
    const sessions = await parseSessionFiles(files)
    if (sessions.length === 0) throw new Error('No valid sessions found.')
    onLoad({ sessions, memory: [] })
  }

  const pickFolder = async () => {
    setError(null)
    setLoading(true)
    try {
      const dir = await window.showDirectoryPicker({ mode: 'read' })
      await processTrackedHandle(dir)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const restoreSaved = async (handle: FileSystemDirectoryHandle) => {
    setError(null)
    setLoading(true)
    try {
      let perm = await queryHandlePermission(handle)
      if (perm !== 'granted') perm = await requestHandlePermission(handle)
      if (perm !== 'granted') throw new Error('Folder access was not granted.')
      await processTrackedHandle(handle)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // On mount, look for a saved folder handle. If permission is already
  // granted (common when the user previously chose "allow on every visit"),
  // auto-load. Otherwise surface a "Restore previous folder" button.
  useEffect(() => {
    let cancelled = false
      ; (async () => {
        const handle = await loadRootHandle()
        if (!handle || cancelled) return
        const perm = await queryHandlePermission(handle)
        if (cancelled) return
        setSavedHandle(handle)
        setSavedPerm(perm)
        if (perm === 'granted') restoreSaved(handle)
      })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const forgetSaved = async () => {
    await clearRootHandle().catch(() => { /* ignore */ })
    setSavedHandle(null)
    setSavedPerm(null)
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
          {savedHandle && savedPerm !== 'granted' && (
            <div className="flex flex-col gap-2 p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <RiFolderHistoryLine size={18} className="text-indigo-500 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">Restore previous folder</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{savedHandle.name} · cached sessions will load instantly</span>
                  </div>
                </div>
                <button
                  onClick={() => restoreSaved(savedHandle)}
                  className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg font-medium transition-colors"
                >
                  Restore
                </button>
              </div>
              <button
                onClick={forgetSaved}
                className="text-[11px] text-gray-500 hover:text-rose-500 dark:text-gray-500 dark:hover:text-rose-400 transition-colors self-start"
              >
                Forget this folder
              </button>
            </div>
          )}

          {hasFolderPicker && (
            <button
              onClick={pickFolder}
              className="w-full flex items-center justify-center gap-3 py-4 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-2xl font-medium transition-all"
            >
              <span className="text-xl">📁</span>
              Select .claude/projects folder
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            <span className="text-xs text-gray-500 dark:text-gray-600">{hasFolderPicker ? 'or' : 'drop files below'}</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>

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

// ── App ───────────────────────────────────────────────────────────────────────

type Tab = 'insights' | 'sessions' | 'search' | 'memory'

const TABS: Tab[] = ['insights', 'sessions', 'search', 'memory']

type HashState = { tab: Tab; sessionId: string | null; turnId: string | null }

function readHashState(): Partial<HashState> {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return {}
  const params = new URLSearchParams(raw)
  const tab = params.get('tab')
  return {
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : undefined,
    sessionId: params.get('session'),
    turnId: params.get('turn'),
  }
}

function encodeHashState(state: HashState): string {
  const params = new URLSearchParams()
  if (state.tab !== 'insights') params.set('tab', state.tab)
  if (state.sessionId) params.set('session', state.sessionId)
  if (state.turnId) params.set('turn', state.turnId)
  return params.toString()
}

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
  const initialHash = React.useMemo(() => readHashState(), [])
  const [tab, setTab] = useState<Tab>(initialHash.tab ?? 'insights')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialHash.sessionId ?? null)
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(initialHash.turnId ?? null)
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme) ?? 'system'
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // Sync state → hash (replaceState so nav doesn't spam history). Only writes
  // once sessions are loaded, so a deep-link hash doesn't get clobbered during
  // the async parse.
  useEffect(() => {
    if (!sessions) return
    const encoded = encodeHashState({ tab, sessionId: selectedSessionId, turnId: selectedTurnId })
    const nextHash = encoded ? `#${encoded}` : ''
    if (window.location.hash === nextHash) return
    const url = window.location.pathname + window.location.search + nextHash
    window.history.replaceState(null, '', url)
  }, [tab, selectedSessionId, selectedTurnId, sessions])

  // Sync hash → state (back/forward button).
  useEffect(() => {
    const onHashChange = () => {
      const h = readHashState()
      if (h.tab && h.tab !== tab) setTab(h.tab)
      if ((h.sessionId ?? null) !== selectedSessionId) setSelectedSessionId(h.sessionId ?? null)
      if ((h.turnId ?? null) !== selectedTurnId) setSelectedTurnId(h.turnId ?? null)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [tab, selectedSessionId, selectedTurnId])

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // `?` toggles help even while the help modal itself is open. Any other
      // modal being open suppresses global shortcuts so they don't fire
      // behind the dialog.
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(v => !v)
        return
      }
      if (settingsOpen || helpOpen) return

      if (e.key === '/') {
        e.preventDefault()
        setTab('search')
        setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus(), 50)
        return
      }

      if (e.key === 'Escape' && tab === 'sessions' && selectedSessionId) {
        e.preventDefault()
        setSelectedSessionId(null)
        setSelectedTurnId(null)
        return
      }

      if (e.key === '1') { setTab('insights'); return }
      if (e.key === '2') { setTab('sessions'); return }
      if (e.key === '3') {
        setTab('search')
        setTimeout(() => document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus(), 50)
        return
      }
      if (e.key === '4' && memory.length > 0) { setTab('memory'); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tab, selectedSessionId, memory.length, settingsOpen, helpOpen])

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
          <button
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors text-xs font-semibold"
          >
            ?
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
          >
            <RiSettings3Line size={14} />
          </button>
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button onClick={() => { setSessions(null); setMemory([]) }} className="text-xs text-gray-500 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
            ↩ Upload new files
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">
        {tab === 'insights' && <InsightsTab sessions={sessions} onOpenSession={openSession} />}
        {tab === 'sessions' && <SessionsTab
          sessions={sessions}
          initialSessionId={selectedSessionId}
          scrollToTurnId={selectedTurnId}
          onSessionSelect={id => { setSelectedSessionId(id); setSelectedTurnId(null) }}
        />}
        {tab === 'search' && <SearchTab sessions={sessions} onOpenSession={openSession} />}
        {tab === 'memory' && <MemoryTab memory={memory} />}
      </main>
      <ScrollToTopButton />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<><App /><Analytics /></>)

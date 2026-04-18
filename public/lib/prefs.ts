import { useEffect, useState, useCallback } from 'react'

const BOOKMARKS_KEY = 'cclens.bookmarks'
const NOTES_KEY = 'cclens.notes'
const DIFF_MODE_KEY = 'cclens.diffMode'

export type DiffMode = 'stacked' | 'split'

export type PrefsExport = {
  version: 1
  exportedAt: string
  bookmarks: string[]
  notes: Record<string, string>
  diffMode: DiffMode
}

export type ImportMode = 'merge' | 'replace'

export type ImportResult = {
  bookmarksAdded: number
  bookmarksTotal: number
  notesAdded: number
  notesUpdated: number
  notesTotal: number
}

export function exportPrefs(): PrefsExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    bookmarks: [...readBookmarks()],
    notes: readNotes(),
    diffMode: readDiffMode(),
  }
}

function isPrefsExport(x: unknown): x is PrefsExport {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (o.version !== 1) return false
  if (!Array.isArray(o.bookmarks)) return false
  if (!o.notes || typeof o.notes !== 'object') return false
  return true
}

export function importPrefs(raw: unknown, mode: ImportMode): ImportResult {
  if (!isPrefsExport(raw)) throw new Error('Invalid backup file — expected a cclens prefs export (version 1).')

  const existingBookmarks = mode === 'replace' ? new Set<string>() : readBookmarks()
  const existingNotes = mode === 'replace' ? {} : readNotes()

  let bookmarksAdded = 0
  for (const id of raw.bookmarks) {
    if (typeof id !== 'string') continue
    if (!existingBookmarks.has(id)) { existingBookmarks.add(id); bookmarksAdded++ }
  }

  let notesAdded = 0
  let notesUpdated = 0
  for (const [id, text] of Object.entries(raw.notes)) {
    if (typeof text !== 'string') continue
    if (id in existingNotes) {
      if (existingNotes[id] !== text) notesUpdated++
    } else {
      notesAdded++
    }
    existingNotes[id] = text
  }

  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...existingBookmarks])) } catch { /* quota / disabled */ }
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(existingNotes)) } catch { /* quota / disabled */ }
  if (raw.diffMode === 'split' || raw.diffMode === 'stacked') {
    try { localStorage.setItem(DIFF_MODE_KEY, raw.diffMode) } catch { /* quota / disabled */ }
  }

  // Nudge in-tab listeners (the `storage` event only fires in *other* tabs)
  window.dispatchEvent(new StorageEvent('storage', { key: BOOKMARKS_KEY }))
  window.dispatchEvent(new StorageEvent('storage', { key: NOTES_KEY }))
  window.dispatchEvent(new StorageEvent('storage', { key: DIFF_MODE_KEY }))

  return {
    bookmarksAdded,
    bookmarksTotal: existingBookmarks.size,
    notesAdded,
    notesUpdated,
    notesTotal: Object.keys(existingNotes).length,
  }
}

function readBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((x: unknown): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => readBookmarks())

  const persist = useCallback((next: Set<string>) => {
    setBookmarks(next)
    try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...next])) } catch { /* quota / disabled */ }
  }, [])

  const toggle = useCallback((id: string) => {
    const next = new Set(bookmarks)
    next.has(id) ? next.delete(id) : next.add(id)
    persist(next)
  }, [bookmarks, persist])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === BOOKMARKS_KEY) setBookmarks(readBookmarks())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { bookmarks, toggle }
}

function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

export function useNotes() {
  const [notes, setNotes] = useState<Record<string, string>>(() => readNotes())

  const setNote = useCallback((id: string, text: string) => {
    setNotes(prev => {
      const next = { ...prev }
      if (text.trim()) next[id] = text
      else delete next[id]
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)) } catch { /* quota / disabled */ }
      return next
    })
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTES_KEY) setNotes(readNotes())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { notes, setNote }
}

function readDiffMode(): DiffMode {
  try {
    const raw = localStorage.getItem(DIFF_MODE_KEY)
    return raw === 'split' ? 'split' : 'stacked'
  } catch {
    return 'stacked'
  }
}

export function useDiffMode() {
  const [mode, setMode] = useState<DiffMode>(() => readDiffMode())

  const toggle = useCallback(() => {
    setMode(prev => {
      const next: DiffMode = prev === 'stacked' ? 'split' : 'stacked'
      try { localStorage.setItem(DIFF_MODE_KEY, next) } catch { /* quota / disabled */ }
      return next
    })
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DIFF_MODE_KEY) setMode(readDiffMode())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { mode, toggle }
}

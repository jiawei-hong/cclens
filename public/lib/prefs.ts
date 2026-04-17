import { useEffect, useState, useCallback } from 'react'

const BOOKMARKS_KEY = 'cclens.bookmarks'
const NOTES_KEY = 'cclens.notes'

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

import { useEffect, useState, useCallback } from 'react'

const BOOKMARKS_KEY = 'cclens.bookmarks'

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

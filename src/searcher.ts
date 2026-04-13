import type { Session, SearchResult } from './types'

const SNIPPET_RADIUS = 120 // chars around match

export function search(sessions: Session[], query: string): SearchResult[] {
  if (!query.trim()) return []

  const q = query.toLowerCase()
  const results: SearchResult[] = []

  for (const session of sessions) {
    for (const turn of session.turns) {
      const text = turn.text.toLowerCase()
      const idx = text.indexOf(q)
      if (idx === -1) continue

      const start = Math.max(0, idx - SNIPPET_RADIUS)
      const end = Math.min(turn.text.length, idx + q.length + SNIPPET_RADIUS)
      const snippet = (start > 0 ? '…' : '') +
        turn.text.slice(start, end) +
        (end < turn.text.length ? '…' : '')

      results.push({
        sessionId: session.id,
        project: session.project,
        turnUuid: turn.uuid,
        role: turn.role,
        timestamp: turn.timestamp,
        snippet,
        matchIndex: idx - start + (start > 0 ? 1 : 0), // offset for "…"
      })
    }
  }

  // Sort by recency
  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100)
}

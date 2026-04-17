import type { Session, SearchResult } from './types'

const SNIPPET_RADIUS = 120

export type SearchOptions = {
  regex?: boolean
}

export function search(sessions: Session[], query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return []

  // Build matcher — returns [matchIndex, matchLength] or null
  let matchFn: (text: string) => [number, number] | null

  if (opts.regex) {
    let re: RegExp
    try { re = new RegExp(query, 'gi') } catch { return [] }
    matchFn = (text) => {
      re.lastIndex = 0
      const m = re.exec(text)
      return m ? [m.index, m[0].length] : null
    }
  } else {
    const q = query.toLowerCase()
    matchFn = (text) => {
      const idx = text.toLowerCase().indexOf(q)
      return idx === -1 ? null : [idx, q.length]
    }
  }

  const results: SearchResult[] = []

  for (const session of sessions) {
    for (const turn of session.turns) {
      const match = matchFn(turn.text)
      if (!match) continue
      const [idx, matchLen] = match

      const start = Math.max(0, idx - SNIPPET_RADIUS)
      const end = Math.min(turn.text.length, idx + matchLen + SNIPPET_RADIUS)
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
        matchIndex: idx - start + (start > 0 ? 1 : 0),
      })
    }
  }

  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200)
}

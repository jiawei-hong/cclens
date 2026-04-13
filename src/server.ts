import index from '../public/index.html'
import { loadAllSessions } from './parser'
import { summarizeProjects, globalToolStats, activityByDay } from './analyzer'
import { search } from './searcher'
import type { Session } from './types'

// Cache sessions in memory; reload on demand
let cachedSessions: Session[] | null = null

async function getSessions(): Promise<Session[]> {
  if (!cachedSessions) {
    console.log('Loading sessions...')
    cachedSessions = await loadAllSessions()
    console.log(`Loaded ${cachedSessions.length} sessions`)
  }
  return cachedSessions
}

const PORT = 3737

Bun.serve({
  port: PORT,
  routes: {
    '/': index,

    '/api/sessions': {
      GET: async () => {
        const sessions = await getSessions()
        // Return lightweight list (no turns)
        const list = sessions.map(s => ({
          id: s.id,
          project: s.project,
          projectPath: s.projectPath,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMs: s.durationMs,
          stats: s.stats,
        }))
        return Response.json(list)
      },
    },

    '/api/sessions/:id': {
      GET: async (req) => {
        const sessions = await getSessions()
        const session = sessions.find(s => s.id === req.params.id)
        if (!session) return new Response('Not found', { status: 404 })
        return Response.json(session)
      },
    },

    '/api/insights': {
      GET: async () => {
        const sessions = await getSessions()
        return Response.json({
          projects: summarizeProjects(sessions),
          topTools: globalToolStats(sessions),
          activityByDay: activityByDay(sessions),
          totalSessions: sessions.length,
        })
      },
    },

    '/api/search': {
      GET: async (req) => {
        const url = new URL(req.url)
        const query = url.searchParams.get('q') ?? ''
        const sessions = await getSessions()
        const results = search(sessions, query)
        return Response.json(results)
      },
    },

    '/api/reload': {
      POST: async () => {
        cachedSessions = null
        const sessions = await getSessions()
        return Response.json({ count: sessions.length })
      },
    },
  },

  development: { hmr: true, console: true },
})

console.log(`claude-lens running at http://localhost:${PORT}`)

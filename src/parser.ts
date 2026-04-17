import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Session } from './types'
import { parseRawJsonl, projectNameFromPath } from './parseCore'

const CLAUDE_DIR = join(process.env.HOME ?? '~', '.claude', 'projects')

export async function listProjectDirs(): Promise<string[]> {
  return readdir(CLAUDE_DIR)
}

function projectPathFromDir(dir: string): string {
  return '/' + dir.replace(/^-/, '').replace(/-/g, '/')
}

export async function parseSession(projectDir: string, filename: string): Promise<Session | null> {
  const filePath = join(CLAUDE_DIR, projectDir, filename)
  const raw = await readFile(filePath, 'utf-8')
  const sessionId = filename.replace('.jsonl', '')
  const fallbackPath = projectPathFromDir(projectDir)
  return parseRawJsonl(raw, sessionId, fallbackPath)
}

export async function loadAllSessions(): Promise<Session[]> {
  const projectDirs = await listProjectDirs()
  const sessions: Session[] = []

  await Promise.all(
    projectDirs.map(async dir => {
      const dirPath = join(CLAUDE_DIR, dir)
      let files: string[]
      try { files = await readdir(dirPath) } catch { return }

      await Promise.all(
        files.filter(f => f.endsWith('.jsonl')).map(async f => {
          const session = await parseSession(dir, f).catch(() => null)
          if (session) sessions.push(session)
        })
      )
    })
  )

  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

// Re-export for consumers that import projectNameFromPath from here
export { projectNameFromPath }

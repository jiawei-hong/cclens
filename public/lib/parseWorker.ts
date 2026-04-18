import { parseRawJsonl } from '../../src/parseCore'
import type { Session } from '../../src/types'

// Parse JSONL session files off the main thread. File objects cross the
// postMessage boundary via structured clone (no copy of the backing bytes).
// The worker streams one result back per file so the UI can update progress.

export type ParseJob = {
  path: string
  file: File
  lastModified: number
  size: number
}

export type WorkerRequest = { type: 'parse'; jobs: ParseJob[] }

export type WorkerItem = {
  type: 'item'
  path: string
  session: Session | null
  lastModified: number
  size: number
}
export type WorkerProgress = { type: 'progress'; done: number; total: number }
export type WorkerDone = { type: 'done' }
export type WorkerMessage = WorkerItem | WorkerProgress | WorkerDone

interface WorkerCtx {
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequest>) => void): void
  postMessage(msg: WorkerMessage): void
}
const ctx = self as unknown as WorkerCtx

ctx.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  if (e.data?.type !== 'parse') return
  const { jobs } = e.data
  const total = jobs.length
  for (let i = 0; i < total; i++) {
    const job = jobs[i]!
    let session: Session | null = null
    try {
      const raw = await job.file.text()
      const sessionId = job.file.name.replace('.jsonl', '')
      session = parseRawJsonl(raw, sessionId, '/')
    } catch { /* surface as null; caller ignores */ }
    ctx.postMessage({
      type: 'item',
      path: job.path,
      session,
      lastModified: job.lastModified,
      size: job.size,
    } satisfies WorkerItem)
    ctx.postMessage({ type: 'progress', done: i + 1, total } satisfies WorkerProgress)
  }
  ctx.postMessage({ type: 'done' } satisfies WorkerDone)
})

import type { Session } from '../../src/types'
import type { ParseJob, WorkerMessage, WorkerRequest } from './parseWorker'

// Thin client around the parseWorker: spawn lazily, serialize requests so a
// single worker handles one batch at a time, and surface per-file progress.

export type WorkerResult = {
  path: string
  session: Session | null
  lastModified: number
  size: number
}

let worker: Worker | null = null
let busy = false

function getWorker(): Worker {
  if (!worker) {
    // Served by src/server.ts in dev (Bun.build on demand) and by scripts/build.ts
    // as a static asset in production. Same URL under both modes.
    worker = new Worker('/parseWorker.js', { type: 'module' })
  }
  return worker
}

export function workerAvailable(): boolean {
  return typeof Worker !== 'undefined'
}

export function parseInWorker(
  jobs: ParseJob[],
  onProgress?: (done: number, total: number) => void,
): Promise<WorkerResult[]> {
  if (busy) return Promise.reject(new Error('parse worker already running'))
  if (jobs.length === 0) return Promise.resolve([])
  busy = true

  const w = getWorker()
  const results: WorkerResult[] = []

  return new Promise<WorkerResult[]>((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      busy = false
    }
    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'item') {
        results.push({
          path: msg.path,
          session: msg.session,
          lastModified: msg.lastModified,
          size: msg.size,
        })
      } else if (msg.type === 'progress') {
        onProgress?.(msg.done, msg.total)
      } else if (msg.type === 'done') {
        cleanup()
        resolve(results)
      }
    }
    const onError = (e: ErrorEvent) => {
      cleanup()
      reject(e.error ?? new Error(e.message || 'worker error'))
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ type: 'parse', jobs } satisfies WorkerRequest)
  })
}

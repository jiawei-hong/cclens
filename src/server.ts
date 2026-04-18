import index from '../public/index.html'

const PORT = 3737

// Bun's dev HMR bundler doesn't transform `new Worker(new URL(...))` into a
// served chunk (prod `bun build` does). Build the worker on demand here so
// the client can load it from /parseWorker.js under both dev and prod.
const WORKER_ENTRY = './public/lib/parseWorker.ts'
let workerCode: string | null = null
let workerBuiltMtime = 0

async function getWorkerBundle(): Promise<string> {
  const stat = await Bun.file(WORKER_ENTRY).stat().catch(() => null)
  const mtime = stat?.mtimeMs ?? 0
  if (workerCode && mtime === workerBuiltMtime) return workerCode
  const res = await Bun.build({
    entrypoints: [WORKER_ENTRY],
    target: 'browser',
    format: 'esm',
  })
  if (!res.success) {
    const msg = res.logs.map(l => l.message).join('\n')
    throw new Error(`worker build failed: ${msg}`)
  }
  workerCode = await res.outputs[0]!.text()
  workerBuiltMtime = mtime
  return workerCode
}

Bun.serve({
  port: PORT,
  routes: {
    '/': index,
    '/parseWorker.js': async () => {
      const code = await getWorkerBundle()
      return new Response(code, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    },
  },
  development: { hmr: true, console: true },
})

console.log(`claude-lens running at http://localhost:${PORT}`)

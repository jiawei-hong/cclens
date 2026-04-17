import index from '../public/index.html'

const PORT = 3737

Bun.serve({
  port: PORT,
  routes: { '/': index },
  development: { hmr: true, console: true },
})

console.log(`claude-lens running at http://localhost:${PORT}`)

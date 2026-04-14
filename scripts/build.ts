import { build } from 'bun'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

mkdirSync('dist', { recursive: true })

await build({
  entrypoints: ['public/app.tsx'],
  outdir: 'dist',
  target: 'browser',
  minify: true,
})

const html = readFileSync('public/index.html', 'utf-8')
  .replace('src="./app.tsx"', 'src="./app.js"')
writeFileSync('dist/index.html', html)

console.log('Build complete → dist/')

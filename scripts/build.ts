import { build } from 'bun'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

mkdirSync('dist', { recursive: true })

// 1. Bundle the app
await build({
  entrypoints: ['public/app.tsx'],
  outdir: 'dist',
  target: 'browser',
  minify: true,
})

// 2. Compile Tailwind — strips unused utilities, replaces the CDN script.
//    Using the `@tailwindcss/cli` Node package so this works on any platform
//    where `bun install` succeeded (no separate binary download needed).
const tw = Bun.spawnSync([
  'bunx', '@tailwindcss/cli',
  '-i', 'public/styles.css',
  '-o', 'dist/styles.css',
  '--minify',
])
if (tw.exitCode !== 0) {
  console.error(new TextDecoder().decode(tw.stderr))
  throw new Error('Tailwind build failed')
}

// 3. Rewrite the HTML to point at the compiled bundles instead of the
//    CDN + raw TSX entrypoint used in dev mode.
const html = readFileSync('public/index.html', 'utf-8')
  .replace('src="./app.tsx"', 'src="./app.js"')
  .replace(
    /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*<script>tailwind\.config = \{ darkMode: 'class' \}<\/script>/,
    '<link rel="stylesheet" href="./styles.css" />',
  )
writeFileSync('dist/index.html', html)

console.log('Build complete → dist/')

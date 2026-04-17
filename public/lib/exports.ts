import type { Session } from '../../src/types'
import type {
  SessionType, TotalUsage, ModelUsageRow, BashAntiPattern,
  SlowToolCall, SkillUsage, SkillGap, McpServerUsage, HotFile, ToolErrorStats,
} from '../../src/analyzer'
import { fmt, fmtDuration, fmtUSD, fmtTokenCount, fmtToolDuration } from './format'

// ── Session → Markdown ────────────────────────────────────────────────────────

export function exportSessionAsMarkdown(session: Session) {
  const lines: string[] = [
    `# ${session.project}`,
    ``,
    `**Path:** ${session.projectPath}  `,
    `**Started:** ${new Date(session.startedAt).toLocaleString()}  `,
    `**Duration:** ${fmtDuration(session.durationMs)}  `,
    `**Tool calls:** ${session.stats.toolCallCount}  `,
    `**Turns:** ${session.turns.length}`,
    ``,
    `---`,
    ``,
  ]
  for (const turn of session.turns) {
    lines.push(`### ${turn.role === 'user' ? 'User' : 'Claude'}`)
    lines.push(``)
    if (turn.text) {
      const clean = turn.text
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
      if (clean) lines.push(clean)
    }
    for (const tc of turn.toolCalls) {
      lines.push(``)
      lines.push(`**\`${tc.name}\`**`)
      lines.push(`\`\`\`json`)
      lines.push(JSON.stringify(tc.input, null, 2))
      lines.push(`\`\`\``)
      if (tc.result) {
        lines.push(`<details><summary>Result</summary>`)
        lines.push(``)
        lines.push(`\`\`\``)
        lines.push(tc.result)
        lines.push(`\`\`\``)
        lines.push(`</details>`)
      }
    }
    lines.push(``)
    lines.push(`*${fmt(turn.timestamp)}*`)
    lines.push(``)
    lines.push(`---`)
    lines.push(``)
  }

  downloadBlob(lines.join('\n'), 'text/markdown', `${session.project}-${session.id}.md`)
}

// ── Insights → Markdown report ────────────────────────────────────────────────

export type InsightsExportInput = {
  rangeLabel: string
  sessionCount: number
  projectCount: number
  totalToolCalls: number
  depth: { avgDurationMs: number; avgToolCalls: number; avgTurns: number }
  topTools: { name: string; count: number }[]
  tasks: { type: SessionType; count: number }[]
  usage: TotalUsage
  modelRows: ModelUsageRow[]
  antiPatterns: BashAntiPattern[]
  slowCalls: SlowToolCall[]
  skillUsage: SkillUsage[]
  gaps: SkillGap[]
  mcpServers: McpServerUsage[]
  hotFiles: HotFile[]
  errorStats: ToolErrorStats
}

export function exportInsightsAsMarkdown(data: InsightsExportInput) {
  const L: string[] = []
  const now = new Date()
  L.push(`# Claude Code Insights — ${data.rangeLabel}`)
  L.push(``)
  L.push(`Generated ${now.toLocaleString()}`)
  L.push(``)
  L.push(`## Summary`)
  L.push(``)
  L.push(`| Metric | Value |`)
  L.push(`| --- | --- |`)
  L.push(`| Sessions | ${data.sessionCount.toLocaleString()} |`)
  L.push(`| Projects | ${data.projectCount.toLocaleString()} |`)
  L.push(`| Tool calls | ${data.totalToolCalls.toLocaleString()} |`)
  L.push(`| Avg duration | ${fmtDuration(data.depth.avgDurationMs)} |`)
  L.push(`| Avg tools / session | ${data.depth.avgToolCalls.toFixed(1)} |`)
  L.push(`| Avg turns / session | ${data.depth.avgTurns.toFixed(1)} |`)
  L.push(``)

  if (data.usage.totalTokens > 0) {
    L.push(`## Cost & tokens`)
    L.push(``)
    L.push(`- **Est. cost:** ${fmtUSD(data.usage.costUSD)}`)
    L.push(`- **Total tokens:** ${fmtTokenCount(data.usage.totalTokens)}`)
    L.push(`- **Cache hit rate:** ${(data.usage.cacheHitRate * 100).toFixed(1)}%`)
    L.push(``)
    if (data.modelRows.length > 0) {
      L.push(`### By model`)
      L.push(``)
      L.push(`| Model | Tokens | Cost |`)
      L.push(`| --- | ---: | ---: |`)
      for (const m of data.modelRows) L.push(`| ${m.versionLabel} | ${fmtTokenCount(m.totalTokens)} | ${fmtUSD(m.costUSD)} |`)
      L.push(``)
    }
  }

  if (data.tasks.length > 0) {
    L.push(`## Task types`)
    L.push(``)
    for (const t of data.tasks) {
      const pct = Math.round((t.count / Math.max(data.sessionCount, 1)) * 100)
      L.push(`- **${t.type}** — ${t.count} (${pct}%)`)
    }
    L.push(``)
  }

  if (data.topTools.length > 0) {
    L.push(`## Top tools`)
    L.push(``)
    for (const t of data.topTools.slice(0, 10)) L.push(`- \`${t.name}\` — ${t.count}`)
    L.push(``)
  }

  if (data.antiPatterns.length > 0) {
    L.push(`## Bash anti-patterns`)
    L.push(``)
    L.push(`| Bash | Better tool | Count | Wasted chars |`)
    L.push(`| --- | --- | ---: | ---: |`)
    for (const p of data.antiPatterns) L.push(`| ${p.bashCmd} | ${p.betterTool} | ${p.count} | ${p.totalResultChars.toLocaleString()} |`)
    L.push(``)
  }

  if (data.slowCalls.length > 0) {
    L.push(`## Slowest tool calls`)
    L.push(``)
    for (const c of data.slowCalls) L.push(`- \`${c.toolName}\` — ${fmtToolDuration(c.durationMs)}${c.preview ? ` — ${c.preview}` : ''}`)
    L.push(``)
  }

  if (data.errorStats.rows.length > 0) {
    L.push(`## Tool errors`)
    L.push(``)
    L.push(`Overall error rate: ${(data.errorStats.overallRate * 100).toFixed(2)}% (${data.errorStats.totalErrors} / ${data.errorStats.totalCalls})`)
    L.push(``)
    for (const r of data.errorStats.rows) L.push(`- \`${r.name}\` — ${r.errors} errors / ${r.total} calls (${(r.errorRate * 100).toFixed(1)}%)`)
    L.push(``)
  }

  if (data.skillUsage.length > 0) {
    L.push(`## Skills used`)
    L.push(``)
    for (const s of data.skillUsage) L.push(`- \`/${s.name}\` — ${s.count}× across ${s.projectCount} project(s)`)
    L.push(``)
  }

  if (data.gaps.length > 0) {
    L.push(`## Skill suggestions`)
    L.push(``)
    for (const g of data.gaps) L.push(`- \`${g.skill}\` — ${g.description} (${g.evidence})`)
    L.push(``)
  }

  if (data.mcpServers.length > 0) {
    L.push(`## MCP servers`)
    L.push(``)
    for (const m of data.mcpServers) L.push(`- \`${m.server}\` — ${m.count} calls across ${m.sessionCount} session(s)`)
    L.push(``)
  }

  if (data.hotFiles.length > 0) {
    L.push(`## Hot files`)
    L.push(``)
    for (const f of data.hotFiles.slice(0, 10)) L.push(`- \`${f.path}\` — ${f.totalOps} ops (${f.editCount} edits, ${f.writeCount} writes)`)
    L.push(``)
  }

  downloadBlob(L.join('\n'), 'text/markdown', `cclens-insights-${now.toISOString().slice(0, 10)}.md`)
}

// ── Session → HTML ────────────────────────────────────────────────────────────

export function exportSessionAsHTML(session: Session) {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const turns = session.turns.map(turn => {
    const isUser = turn.role === 'user'
    const textClean = turn.text
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    const toolsHtml = turn.toolCalls.map(tc => `
      <details class="tool">
        <summary><code>${escHtml(tc.name)}</code> ${escHtml(Object.values(tc.input)[0]?.toString().slice(0, 60) ?? '')}</summary>
        <pre>${escHtml(JSON.stringify(tc.input, null, 2))}</pre>
        ${tc.result ? `<pre class="result">${escHtml(tc.result)}</pre>` : ''}
      </details>`).join('')
    return `
      <div class="turn ${isUser ? 'user' : 'assistant'}">
        <div class="avatar">${isUser ? 'U' : 'C'}</div>
        <div class="body">
          ${textClean ? `<div class="text">${escHtml(textClean)}</div>` : ''}
          ${toolsHtml}
          <div class="ts">${fmt(turn.timestamp)}</div>
        </div>
      </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(session.project)}</title>
<style>
  body { background:#0a0a0f; color:#e5e7eb; font-family:system-ui,sans-serif; max-width:800px; margin:0 auto; padding:2rem; }
  h1 { font-size:1.5rem; margin-bottom:.25rem; }
  .meta { color:#6b7280; font-size:.85rem; margin-bottom:2rem; }
  .turn { display:flex; gap:12px; margin-bottom:1.5rem; }
  .turn.user { flex-direction:row-reverse; }
  .avatar { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:.75rem; font-weight:700; flex-shrink:0; margin-top:2px; }
  .turn.user .avatar { background:#4f46e5; color:#fff; }
  .turn.assistant .avatar { background:#374151; color:#d1d5db; }
  .body { flex:1; max-width:85%; }
  .text { background:#111827; border-radius:12px; padding:.75rem 1rem; font-size:.875rem; line-height:1.6; white-space:pre-wrap; }
  .turn.user .text { background:#312e81; }
  details.tool { background:#111827; border-radius:8px; padding:.5rem .75rem; margin-top:.5rem; font-size:.8rem; }
  details.tool summary { cursor:pointer; color:#a5b4fc; }
  pre { background:#030712; border-radius:6px; padding:.5rem; overflow-x:auto; font-size:.75rem; color:#6ee7b7; white-space:pre-wrap; }
  pre.result { color:#9ca3af; }
  .ts { color:#374151; font-size:.7rem; margin-top:.25rem; }
</style>
</head>
<body>
<h1>${escHtml(session.project)}</h1>
<p class="meta">${escHtml(session.projectPath)} · ${new Date(session.startedAt).toLocaleString()} · ${fmtDuration(session.durationMs)} · ${session.stats.toolCallCount} tool calls</p>
${turns}
</body>
</html>`

  downloadBlob(html, 'text/html', `${session.project}-${session.id}.html`)
}

// ── Shared blob-download helper ───────────────────────────────────────────────

function downloadBlob(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

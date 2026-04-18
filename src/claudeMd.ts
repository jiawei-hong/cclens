import type { Session } from './types'
import type { BashAntiPattern, SkillGap } from './analyzer'
import { aggregateRecommendations } from './recommendations'

// ── Rule text library ────────────────────────────────────────────────────────
// Maps each anti-pattern id to the rule text that should go into CLAUDE.md.
// Kept in src/ (not public/tabs) so it is usable from both the UI and any
// future CLI export.

const BASH_RULE_TEXT: Record<string, string> = {
  grep:       'NEVER use `bash grep` or `bash rg` to search file contents — use the Grep tool instead.',
  find:       'NEVER use `bash find` to locate files — use the Glob tool instead.',
  cat:        'NEVER use `bash cat`, `bash head`, or `bash tail` to read files — use the Read tool with offset/limit parameters to fetch only what is needed.',
  ls:         'NEVER use `bash ls` to list files — use the Glob tool instead.',
  echo_write: 'NEVER use `bash echo >` or `bash echo >>` to write files — use the Write or Edit tool instead.',
  sed:        'NEVER use `bash sed` to edit files — use the Edit tool for targeted replacements.',
  awk:        'NEVER use `bash awk` to process file content — read the file with Read, then reason over the content directly.',
}

// Minimum evidence thresholds: a section only appears if the user would
// actually benefit from a written-down rule. Tuned to avoid one-off noise.
const MIN_ANTIPATTERN_CALLS   = 3
const MIN_RULE_SESSIONS       = 3
const MIN_RULE_SAVINGS_USD    = 0.5
const MIN_SKILL_GAP_SESSIONS  = 3

// ── Helpers ──────────────────────────────────────────────────────────────────

function section(title: string, lines: string[]): string {
  if (lines.length === 0) return ''
  return `## ${title}\n\n${lines.join('\n')}\n\n`
}

function bashRules(antiPatterns: BashAntiPattern[]): string[] {
  return antiPatterns
    .filter(p => p.count >= MIN_ANTIPATTERN_CALLS && BASH_RULE_TEXT[p.id])
    .map(p => `- ${BASH_RULE_TEXT[p.id]}`)
}

function modelRules(ruleById: Map<string, { count: number; savingsUSD: number }>): string[] {
  const out: string[] = []
  const wrongModel = ruleById.get('wrong-model-for-task')
  if (wrongModel && wrongModel.count >= MIN_RULE_SESSIONS && wrongModel.savingsUSD >= MIN_RULE_SAVINGS_USD) {
    out.push(`- Prefer Sonnet for conversation, exploration, and research tasks — Opus is only needed for deep reasoning or complex multi-step refactors. Flagged in ${wrongModel.count} past sessions ($${wrongModel.savingsUSD.toFixed(2)} potential savings).`)
  }
  return out
}

function cacheRules(ruleById: Map<string, { count: number; savingsUSD: number }>): string[] {
  const out: string[] = []
  const h1 = ruleById.get('1h-cache-misused')
  if (h1 && h1.count >= MIN_RULE_SESSIONS) {
    out.push(`- Do not request 1-hour cache TTL for short-lived sessions. Default to 5-minute (ephemeral) caching unless the prompt is genuinely reused across ≥1h.`)
  }
  const lowHit = ruleById.get('low-cache-hit')
  if (lowHit && lowHit.count >= MIN_RULE_SESSIONS) {
    out.push(`- Keep the session's stable prefix (CLAUDE.md, system prompt, project docs) at the top and avoid editing it mid-session — this is what the prompt cache hits against.`)
  }
  return out
}

function workflowRules(ruleById: Map<string, { count: number; savingsUSD: number }>): string[] {
  const out: string[] = []
  const redundant = ruleById.get('redundant-reads')
  if (redundant && redundant.count >= MIN_RULE_SESSIONS) {
    out.push(`- Avoid re-reading the same file multiple times in one session. If you need a second look, use Grep or Read with offset/limit to fetch just the part you need.`)
  }
  const thrash = ruleById.get('thrashing')
  if (thrash && thrash.count >= MIN_RULE_SESSIONS) {
    out.push(`- If a tool call fails 2+ times with the same argument, stop and re-read the failure — do not retry a third time with the same input.`)
  }
  const errors = ruleById.get('high-error-rate')
  if (errors && errors.count >= MIN_RULE_SESSIONS) {
    out.push(`- When a tool errors, inspect the error before the next call. Do not chain speculative tool calls while earlier ones are still failing.`)
  }
  const linear = ruleById.get('linear-context-growth')
  if (linear && linear.count >= MIN_RULE_SESSIONS) {
    out.push(`- Keep tool result sizes small: prefer Grep + targeted Read over dumping full files. Context grows linearly when results are not trimmed.`)
  }
  return out
}

function skillHints(skillGaps: SkillGap[], ruleById: Map<string, { count: number; savingsUSD: number }>): string[] {
  const out: string[] = []
  const commitGap = ruleById.get('skill-gap-commit')
  const prGap     = ruleById.get('skill-gap-create-pr')

  if (commitGap && commitGap.count >= MIN_SKILL_GAP_SESSIONS) {
    out.push(`- For git commits, prefer the \`commit\` skill (or \`/commit\` slash command) over composing \`git add\` + \`git commit\` manually — it handles staging, message conventions, and hook failures.`)
  }
  if (prGap && prGap.count >= MIN_SKILL_GAP_SESSIONS) {
    out.push(`- For opening PRs, prefer the \`create-pr\` subagent or \`/create-pr\` command over \`gh pr create\` — it writes a structured title + body from the diff.`)
  }

  // Additional skills the user has a strong gap signal for
  const skillsAlreadyCovered = new Set(['/commit', '/create-pr'])
  const underused = skillGaps
    .filter(g => g.signalCount >= MIN_SKILL_GAP_SESSIONS && !skillsAlreadyCovered.has(g.skill))
    .slice(0, 3)
  for (const g of underused) {
    out.push(`- Consider using the \`${g.skill}\` skill — ${g.howToUse} (${g.signalCount} past sessions would have benefited).`)
  }
  return out
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ClaudeMdInput = {
  sessions: Session[]
  antiPatterns: BashAntiPattern[]
  skillGaps: SkillGap[]
}

export function generateProjectClaudeMd(input: ClaudeMdInput): string {
  const { sessions, antiPatterns, skillGaps } = input
  const agg = aggregateRecommendations(sessions)

  // Build a lookup by rule id so each section can check evidence without
  // re-scanning the whole list.
  const ruleById = new Map<string, { count: number; savingsUSD: number }>()
  for (const r of agg.byRule) ruleById.set(r.id, { count: r.count, savingsUSD: r.savingsUSD })

  const header = [
    `<!-- Generated by cclens (claude-lens). Re-generate after notable behavior changes. -->`,
    `# Project Instructions`,
    ``,
    `These rules were derived from ${agg.sessionCount > 0 ? agg.sessionCount : sessions.length} past Claude Code sessions in this project. Each section only appears when there is measurable evidence (${MIN_RULE_SESSIONS}+ sessions or $${MIN_RULE_SAVINGS_USD.toFixed(2)}+ in potential savings).`,
    ``,
  ].join('\n')

  const body =
    section('Tool Usage Rules', bashRules(antiPatterns)) +
    section('Model Selection',  modelRules(ruleById)) +
    section('Cache & Context',  cacheRules(ruleById)) +
    section('Workflow Rules',   workflowRules(ruleById)) +
    section('Preferred Skills', skillHints(skillGaps, ruleById))

  if (body.trim().length === 0) {
    return `${header}\n_No actionable rules yet — your sessions are tracking well. Re-generate after a few weeks of new activity._\n`
  }

  return `${header}\n${body}`.trimEnd() + '\n'
}

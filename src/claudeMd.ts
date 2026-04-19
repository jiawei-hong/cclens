import type { Session } from './types'
import type { BashAntiPattern, SkillGap } from './analyzer'
import { aggregateRecommendations, sessionRecommendations } from './recommendations'

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

// ── Rule text keyed by recommendation id ─────────────────────────────────────
// One CLAUDE.md rule line per rec id. Used by the aggregator below *and* by
// the inline turn-coaching UI so a single click can drop the exact rule into
// the user's CLAUDE.md. Kept flat and un-gated on thresholds — the text is
// always the right text; evidence gating happens elsewhere.

export const RULE_TEXT_BY_REC_ID: Record<string, string> = {
  'wrong-model-for-task':
    `Prefer Sonnet for conversation, exploration, and research tasks — Opus is only needed for deep reasoning or complex multi-step refactors.`,
  '1h-cache-misused':
    `Do not request 1-hour cache TTL for short-lived sessions. Default to 5-minute (ephemeral) caching unless the prompt is genuinely reused across ≥1h.`,
  'low-cache-hit':
    `Keep the session's stable prefix (CLAUDE.md, system prompt, project docs) at the top and avoid editing it mid-session — this is what the prompt cache hits against.`,
  'linear-context-growth':
    `Keep tool result sizes small: prefer Grep + targeted Read over dumping full files. Context grows linearly when results are not trimmed.`,
  'redundant-reads':
    `Avoid re-reading the same file multiple times in one session. If you need a second look, use Grep or Read with offset/limit to fetch just the part you need.`,
  'thrashing':
    `If a tool call fails 2+ times with the same argument, stop and re-read the failure — do not retry a third time with the same input.`,
  'high-error-rate':
    `When a tool errors, inspect the error before the next call. Do not chain speculative tool calls while earlier ones are still failing.`,
  'bash-antipatterns':
    `Prefer native tools (Read with offset/limit, Grep, Glob, Edit) over their Bash equivalents (cat/grep/ls/find/sed) — the native tools are scoped and do not dump raw output into context.`,
  'peak-near-compact':
    `Keep sessions focused — split long work across multiple sessions and avoid loading full files so context stays well below the 200k auto-compact threshold.`,
  'skill-gap-commit':
    `For git commits, prefer the \`commit\` skill (or \`/commit\` slash command) over composing \`git add\` + \`git commit\` manually — it handles staging, message conventions, and hook failures.`,
  'skill-gap-create-pr':
    `For opening PRs, prefer the \`create-pr\` subagent or \`/create-pr\` command over \`gh pr create\` — it writes a structured title + body from the diff.`,
}

// ── Structured rule type ─────────────────────────────────────────────────────
// Each rule is its own record so the UI can render per-rule copy buttons and
// evidence pills. The markdown exporter just joins `text` lines by section.

export type ClaudeMdRuleSection =
  | 'Tool Usage Rules'
  | 'Model Selection'
  | 'Cache & Context'
  | 'Workflow Rules'
  | 'Preferred Skills'

export type ClaudeMdRule = {
  id: string                 // stable id so React can key by it
  section: ClaudeMdRuleSection
  text: string               // "- NEVER use `bash grep`…" — full markdown line
  evidence: string           // human-readable evidence, e.g. "4 sessions · $1.20 potential savings"
  count: number              // session count the rule is backed by
  savingsUSD: number         // 0 if no $ figure
}

type RuleMap = Map<string, { count: number; savingsUSD: number }>

function fmtEvidence(count: number, savingsUSD: number): string {
  const parts: string[] = [`${count} session${count === 1 ? '' : 's'}`]
  if (savingsUSD >= 0.01) parts.push(`$${savingsUSD.toFixed(2)} potential savings`)
  return parts.join(' · ')
}

// ── Per-section rule builders ────────────────────────────────────────────────

function bashRules(antiPatterns: BashAntiPattern[]): ClaudeMdRule[] {
  const out: ClaudeMdRule[] = []
  for (const p of antiPatterns) {
    const text = BASH_RULE_TEXT[p.id]
    if (!text) continue
    if (p.count < MIN_ANTIPATTERN_CALLS) continue
    out.push({
      id: `bash-${p.id}`,
      section: 'Tool Usage Rules',
      text: `- ${text}`,
      evidence: `${p.count} bash call${p.count === 1 ? '' : 's'} flagged`,
      count: p.count,
      savingsUSD: 0,
    })
  }
  return out
}

function modelRules(ruleById: RuleMap): ClaudeMdRule[] {
  const out: ClaudeMdRule[] = []
  const wrongModel = ruleById.get('wrong-model-for-task')
  if (wrongModel && wrongModel.count >= MIN_RULE_SESSIONS && wrongModel.savingsUSD >= MIN_RULE_SAVINGS_USD) {
    out.push({
      id: 'wrong-model-for-task',
      section: 'Model Selection',
      text: `- Prefer Sonnet for conversation, exploration, and research tasks — Opus is only needed for deep reasoning or complex multi-step refactors.`,
      evidence: fmtEvidence(wrongModel.count, wrongModel.savingsUSD),
      count: wrongModel.count,
      savingsUSD: wrongModel.savingsUSD,
    })
  }
  return out
}

function cacheRules(ruleById: RuleMap): ClaudeMdRule[] {
  const out: ClaudeMdRule[] = []
  const h1 = ruleById.get('1h-cache-misused')
  if (h1 && h1.count >= MIN_RULE_SESSIONS) {
    out.push({
      id: '1h-cache-misused',
      section: 'Cache & Context',
      text: `- Do not request 1-hour cache TTL for short-lived sessions. Default to 5-minute (ephemeral) caching unless the prompt is genuinely reused across ≥1h.`,
      evidence: fmtEvidence(h1.count, h1.savingsUSD),
      count: h1.count,
      savingsUSD: h1.savingsUSD,
    })
  }
  const lowHit = ruleById.get('low-cache-hit')
  if (lowHit && lowHit.count >= MIN_RULE_SESSIONS) {
    out.push({
      id: 'low-cache-hit',
      section: 'Cache & Context',
      text: `- Keep the session's stable prefix (CLAUDE.md, system prompt, project docs) at the top and avoid editing it mid-session — this is what the prompt cache hits against.`,
      evidence: fmtEvidence(lowHit.count, lowHit.savingsUSD),
      count: lowHit.count,
      savingsUSD: lowHit.savingsUSD,
    })
  }
  return out
}

function workflowRules(ruleById: RuleMap): ClaudeMdRule[] {
  const defs: { id: string; text: string }[] = [
    { id: 'redundant-reads',       text: `- Avoid re-reading the same file multiple times in one session. If you need a second look, use Grep or Read with offset/limit to fetch just the part you need.` },
    { id: 'thrashing',             text: `- If a tool call fails 2+ times with the same argument, stop and re-read the failure — do not retry a third time with the same input.` },
    { id: 'high-error-rate',       text: `- When a tool errors, inspect the error before the next call. Do not chain speculative tool calls while earlier ones are still failing.` },
    { id: 'linear-context-growth', text: `- Keep tool result sizes small: prefer Grep + targeted Read over dumping full files. Context grows linearly when results are not trimmed.` },
  ]
  const out: ClaudeMdRule[] = []
  for (const d of defs) {
    const ev = ruleById.get(d.id)
    if (!ev || ev.count < MIN_RULE_SESSIONS) continue
    out.push({
      id: d.id,
      section: 'Workflow Rules',
      text: d.text,
      evidence: fmtEvidence(ev.count, ev.savingsUSD),
      count: ev.count,
      savingsUSD: ev.savingsUSD,
    })
  }
  return out
}

function skillHints(skillGaps: SkillGap[], ruleById: RuleMap): ClaudeMdRule[] {
  const out: ClaudeMdRule[] = []
  const commitGap = ruleById.get('skill-gap-commit')
  const prGap     = ruleById.get('skill-gap-create-pr')

  if (commitGap && commitGap.count >= MIN_SKILL_GAP_SESSIONS) {
    out.push({
      id: 'skill-gap-commit',
      section: 'Preferred Skills',
      text: `- For git commits, prefer the \`commit\` skill (or \`/commit\` slash command) over composing \`git add\` + \`git commit\` manually — it handles staging, message conventions, and hook failures.`,
      evidence: fmtEvidence(commitGap.count, commitGap.savingsUSD),
      count: commitGap.count,
      savingsUSD: commitGap.savingsUSD,
    })
  }
  if (prGap && prGap.count >= MIN_SKILL_GAP_SESSIONS) {
    out.push({
      id: 'skill-gap-create-pr',
      section: 'Preferred Skills',
      text: `- For opening PRs, prefer the \`create-pr\` subagent or \`/create-pr\` command over \`gh pr create\` — it writes a structured title + body from the diff.`,
      evidence: fmtEvidence(prGap.count, prGap.savingsUSD),
      count: prGap.count,
      savingsUSD: prGap.savingsUSD,
    })
  }

  const skillsAlreadyCovered = new Set(['/commit', '/create-pr'])
  const underused = skillGaps
    .filter(g => g.signalCount >= MIN_SKILL_GAP_SESSIONS && !skillsAlreadyCovered.has(g.skill))
    .slice(0, 3)
  for (const g of underused) {
    out.push({
      id: `skill-${g.skill.replace(/[^a-z0-9]/gi, '-')}`,
      section: 'Preferred Skills',
      text: `- Consider using the \`${g.skill}\` skill — ${g.howToUse}.`,
      evidence: `${g.signalCount} past session${g.signalCount === 1 ? '' : 's'} would have benefited`,
      count: g.signalCount,
      savingsUSD: 0,
    })
  }
  return out
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ClaudeMdInput = {
  sessions: Session[]
  antiPatterns: BashAntiPattern[]
  skillGaps: SkillGap[]
}

export const CLAUDE_MD_SECTION_ORDER: ClaudeMdRuleSection[] = [
  'Tool Usage Rules',
  'Model Selection',
  'Cache & Context',
  'Workflow Rules',
  'Preferred Skills',
]

export function claudeMdRules(input: ClaudeMdInput): ClaudeMdRule[] {
  const { sessions, antiPatterns, skillGaps } = input
  const agg = aggregateRecommendations(sessions)
  const ruleById: RuleMap = new Map()
  for (const r of agg.byRule) ruleById.set(r.id, { count: r.count, savingsUSD: r.savingsUSD })

  return [
    ...bashRules(antiPatterns),
    ...modelRules(ruleById),
    ...cacheRules(ruleById),
    ...workflowRules(ruleById),
    ...skillHints(skillGaps, ruleById),
  ]
}

// ── Diff mode: what's missing from an existing CLAUDE.md ────────────────────
// Maps each rule id to a list of distinctive phrases. If the existing
// CLAUDE.md contains any phrase (case-insensitive) we consider the rule
// already covered. Hand-curated so it stays stable as the rule text evolves.

export const MATCH_PHRASES_BY_RULE_ID: Record<string, string[]> = {
  // Tool Usage Rules (bash anti-patterns)
  'bash-grep':        ['bash grep', 'bash rg', 'Grep tool'],
  'bash-find':        ['bash find', 'Glob tool'],
  'bash-cat':         ['bash cat', 'bash head', 'bash tail'],
  'bash-ls':          ['bash ls'],
  'bash-echo_write':  ['echo >', 'echo >>'],
  'bash-sed':         ['bash sed'],
  'bash-awk':         ['bash awk'],
  // Model Selection
  'wrong-model-for-task': ['Prefer Sonnet', '/model sonnet', 'Opus is only needed'],
  // Cache & Context
  '1h-cache-misused':     ['1-hour cache', '5-minute', 'ephemeral cach'],
  'low-cache-hit':        ['stable prefix', 'prompt cache'],
  // Workflow Rules
  'redundant-reads':        ['re-read', 're-reading'],
  'thrashing':              ['fails 2+ times', 'stop and re-read the failure'],
  'high-error-rate':        ['inspect the error'],
  'linear-context-growth':  ['tool result sizes'],
  // Preferred Skills
  'skill-gap-commit':     ['/commit', '`commit` skill'],
  'skill-gap-create-pr':  ['/create-pr', 'create-pr subagent'],
}

export type ClaudeMdDiff = {
  covered: ClaudeMdRule[]
  missing: ClaudeMdRule[]
}

export function claudeMdDiff(existing: string, rules: ClaudeMdRule[]): ClaudeMdDiff {
  const haystack = existing.toLowerCase()
  const covered: ClaudeMdRule[] = []
  const missing: ClaudeMdRule[] = []

  for (const rule of rules) {
    const phrases = MATCH_PHRASES_BY_RULE_ID[rule.id]
    let hit = false
    if (phrases && phrases.length > 0) {
      hit = phrases.some(p => haystack.includes(p.toLowerCase()))
    } else if (rule.id.startsWith('skill-')) {
      const slug = rule.id.slice('skill-'.length).replace(/-/g, '')
      hit = haystack.includes('/' + slug.toLowerCase())
    } else {
      hit = haystack.includes(rule.text.slice(2, 40).toLowerCase())
    }
    if (hit) covered.push(rule)
    else missing.push(rule)
  }

  return { covered, missing }
}

// ── Rule-violation detector ─────────────────────────────────────────────────
// Once a user tells cclens which rules their CLAUDE.md already covers (via
// claudeMdDiff), we can ask the inverse question: *are those rules actually
// being followed?* A covered rule that still gets flagged in recent sessions
// means either Claude didn't read the rule, or the user stopped enforcing it.
// Either way it's the single most actionable signal for "does my CLAUDE.md
// work?" and closes the loop with the diff view.

export type ClaudeMdViolation = {
  rule: ClaudeMdRule
  sessions: {
    sessionId: string
    project: string
    startedAt: string
    evidence: string
    turnUuid?: string
  }[]
}

export type ClaudeMdViolationReport = {
  violations: ClaudeMdViolation[]
  windowDays: number
  recentSessionCount: number
}

export function claudeMdViolations(
  existing: string,
  rules: ClaudeMdRule[],
  sessions: Session[],
  windowDays: number = 14,
  now: Date = new Date(),
): ClaudeMdViolationReport {
  const { covered } = claudeMdDiff(existing, rules)
  const coveredById = new Map(covered.map(r => [r.id, r]))
  const firstCoveredBashRule = covered.find(r => r.id.startsWith('bash-')) ?? null

  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const recent = sessions.filter(s => new Date(s.startedAt).getTime() >= cutoff)

  const byRuleId = new Map<string, ClaudeMdViolation>()

  for (const s of recent) {
    const { recommendations } = sessionRecommendations(s)
    for (const rec of recommendations) {
      // Map the rec to a covered rule, if any. Non-bash rec ids map 1:1.
      // bash-antipatterns is a rolled-up rec covering all bash sub-rules, so
      // we attribute it to the first covered bash rule (close enough — the
      // user's intent was clearly "no bash anti-patterns").
      let ruleMatch: ClaudeMdRule | null = null
      if (rec.id === 'bash-antipatterns') {
        ruleMatch = firstCoveredBashRule
      } else {
        ruleMatch = coveredById.get(rec.id) ?? null
      }
      if (!ruleMatch) continue

      const entry = byRuleId.get(ruleMatch.id) ?? { rule: ruleMatch, sessions: [] }
      entry.sessions.push({
        sessionId: s.id,
        project: s.project,
        startedAt: s.startedAt,
        evidence: rec.evidence,
        turnUuid: rec.turnUuids?.[0],
      })
      byRuleId.set(ruleMatch.id, entry)
    }
  }

  return {
    violations: [...byRuleId.values()].sort((a, b) => b.sessions.length - a.sessions.length),
    windowDays,
    recentSessionCount: recent.length,
  }
}

export function generateProjectClaudeMd(input: ClaudeMdInput): string {
  const agg = aggregateRecommendations(input.sessions)
  const rules = claudeMdRules(input)

  const header = [
    `<!-- Generated by cclens (claude-lens). Re-generate after notable behavior changes. -->`,
    `# Project Instructions`,
    ``,
    `These rules were derived from ${agg.sessionCount > 0 ? agg.sessionCount : input.sessions.length} past Claude Code sessions in this project. Each section only appears when there is measurable evidence (${MIN_RULE_SESSIONS}+ sessions or $${MIN_RULE_SAVINGS_USD.toFixed(2)}+ in potential savings).`,
    ``,
  ].join('\n')

  if (rules.length === 0) {
    return `${header}\n_No actionable rules yet — your sessions are tracking well. Re-generate after a few weeks of new activity._\n`
  }

  const bySection = new Map<ClaudeMdRuleSection, ClaudeMdRule[]>()
  for (const r of rules) {
    const list = bySection.get(r.section) ?? []
    list.push(r)
    bySection.set(r.section, list)
  }

  const body = CLAUDE_MD_SECTION_ORDER
    .map(section => {
      const list = bySection.get(section)
      if (!list || list.length === 0) return ''
      return `## ${section}\n\n${list.map(r => r.text).join('\n')}\n\n`
    })
    .join('')

  return `${header}\n${body}`.trimEnd() + '\n'
}

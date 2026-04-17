import type { SessionType } from '../../src/analyzer'

// ── Tool pill (background + text) ─────────────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  Bash:      'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  Read:      'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  Write:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  Edit:      'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Grep:      'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  Glob:      'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  Agent:     'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  WebFetch:  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  WebSearch: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
}

export const toolColor = (name: string) =>
  TOOL_COLORS[name] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300'

// ── Tool tick (solid background, for timeline ticks / bar fills) ──────────────

const TOOL_TICK_COLORS: Record<string, string> = {
  Bash:      'bg-violet-500',
  Read:      'bg-blue-500',
  Write:     'bg-emerald-500',
  Edit:      'bg-amber-500',
  Grep:      'bg-rose-500',
  Glob:      'bg-cyan-500',
  Agent:     'bg-pink-500',
  WebFetch:  'bg-orange-500',
  WebSearch: 'bg-orange-500',
}

export const toolTickColor = (name: string) => {
  if (name.startsWith('mcp__')) return 'bg-fuchsia-500'
  return TOOL_TICK_COLORS[name] ?? 'bg-gray-400'
}

// ── Task type (session classification) ────────────────────────────────────────

const TASK_COLORS: Record<SessionType, string> = {
  coding:       'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  debugging:    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  research:     'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  exploration:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300',
  conversation: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
}

const TASK_BARS: Record<SessionType, string> = {
  coding:       'bg-indigo-500',
  debugging:    'bg-rose-500',
  research:     'bg-amber-500',
  exploration:  'bg-cyan-500',
  conversation: 'bg-gray-500',
}

export const taskTypeColor = (t: SessionType) => TASK_COLORS[t]
export const taskTypeBar   = (t: SessionType) => TASK_BARS[t]

export const TASK_DESCRIPTIONS: Record<SessionType, string> = {
  coding:       'Edit / Write > 25% of tool calls',
  debugging:    'Bash > 25% + Read / Grep > 15%',
  research:     'WebSearch / WebFetch > 20%',
  exploration:  'Read / Grep / Glob > 40% — browsing codebase',
  conversation: 'Fewer than 3 tool calls — mostly chat',
}

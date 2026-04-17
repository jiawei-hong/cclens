// Design tokens — everything is a Tailwind className string so tokens compose
// naturally with other utilities at the call site. Two kinds of palette:
//
// - `accent`   — semantic status colors (primary / success / warning / danger /
//                neutral). Pick by meaning, not by hue.
// - `categorical` — hue list for coloring *data* (tool names, task types,
//                bash categories). Pick by stable index so the same value
//                always gets the same color across renders.

export const radius = {
  sm:   'rounded-md',
  md:   'rounded-xl',
  lg:   'rounded-2xl',
  pill: 'rounded-full',
} as const

export const space = {
  cardSm:     'p-3',
  card:       'p-5',
  cardLg:     'px-6 py-5',
  sectionGap: 'gap-5',
  rowGap:     'gap-3',
  tightGap:   'gap-2',
} as const

export const type = {
  caption: 'text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600',
  label:   'text-xs text-gray-500 dark:text-gray-400',
  body:    'text-sm text-gray-700 dark:text-gray-300',
  strong:  'text-sm font-medium text-gray-900 dark:text-gray-100',
  heading: 'text-base font-semibold text-gray-900 dark:text-gray-100',
  title:   'text-lg font-bold text-gray-900 dark:text-gray-100',
  display: 'text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums',
  mono:    'font-mono text-xs text-gray-700 dark:text-gray-300',
} as const

export const surface = {
  card:    'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm',
  sunken:  'bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800',
  overlay: 'bg-black/60',
  dialog:  'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl',
} as const

export type AccentTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

export const accent: Record<AccentTone, { solid: string; soft: string; text: string }> = {
  primary: {
    solid: 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white',
    soft:  'bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-300',
    text:  'text-indigo-600 dark:text-indigo-400',
  },
  success: {
    solid: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    soft:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-600/20 dark:text-emerald-300',
    text:  'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    solid: 'bg-amber-600 hover:bg-amber-500 text-white',
    soft:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
    text:  'text-amber-600 dark:text-amber-400',
  },
  danger: {
    solid: 'bg-rose-600 hover:bg-rose-500 text-white',
    soft:  'bg-rose-100 text-rose-700 dark:bg-rose-600/20 dark:text-rose-300',
    text:  'text-rose-600 dark:text-rose-400',
  },
  neutral: {
    solid: 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900',
    soft:  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    text:  'text-gray-700 dark:text-gray-300',
  },
}

// Categorical — use pickCategorical(key) to get a stable color for a given
// string. Keep this list stable: appending is fine, reordering breaks every
// existing chart.
export const categoricalPalette = [
  { solid: 'bg-indigo-500',  text: 'text-indigo-600 dark:text-indigo-400',   soft: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'  },
  { solid: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', soft: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  { solid: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',    soft: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'     },
  { solid: 'bg-sky-500',     text: 'text-sky-600 dark:text-sky-400',        soft: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'         },
  { solid: 'bg-violet-500',  text: 'text-violet-600 dark:text-violet-400',  soft: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'   },
  { solid: 'bg-rose-500',    text: 'text-rose-600 dark:text-rose-400',      soft: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'      },
  { solid: 'bg-teal-500',    text: 'text-teal-600 dark:text-teal-400',      soft: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300'      },
  { solid: 'bg-fuchsia-500', text: 'text-fuchsia-600 dark:text-fuchsia-400', soft: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300' },
] as const

export function pickCategorical(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0
  return categoricalPalette[Math.abs(h) % categoricalPalette.length]!
}

// Shared focus ring — apply to any focusable element for keyboard a11y.
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-offset-gray-900'

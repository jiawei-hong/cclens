import React from 'react'
import { focusRing } from './tokens'

// Two tab variants:
//
// - `solid`  — large filled pills (used as the top-level nav).
// - `subtle` — high-contrast black/white active state (used as sub-nav,
//              section filters).
//
// Prefer `solid` for primary navigation and `subtle` for secondary groupings
// so the hierarchy is visually obvious.

type Variant = 'solid' | 'subtle'

type Ctx = { value: string; onChange: (v: string) => void; variant: Variant }
const TabCtx = React.createContext<Ctx | null>(null)

export function TabGroup<T extends string>({ value, onChange, variant = 'solid', className = '', children }: {
  value: T
  onChange: (v: T) => void
  variant?: Variant
  className?: string
  children: React.ReactNode
}) {
  return (
    <TabCtx.Provider value={{ value, onChange: onChange as (v: string) => void, variant }}>
      <div className={`flex items-center gap-1 ${className}`} role="tablist">{children}</div>
    </TabCtx.Provider>
  )
}

export function Tab<T extends string>({ value, badge, children }: {
  value: T
  badge?: number
  children: React.ReactNode
}) {
  const ctx = React.useContext(TabCtx)
  if (!ctx) throw new Error('<Tab> must be rendered inside <TabGroup>')
  const active = ctx.value === value

  const base = `inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors rounded-lg ${focusRing}`
  const solid = active
    ? 'bg-indigo-600 text-white'
    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
  const subtle = active
    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'

  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.onChange(value)}
      className={`${base} ${ctx.variant === 'solid' ? solid : subtle}`}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
          active
            ? 'bg-white/20 text-white dark:bg-black/20 dark:text-gray-900'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
        }`}>{badge}</span>
      )}
    </button>
  )
}

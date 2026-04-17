import React from 'react'
import { type } from './tokens'

type Size = 'md' | 'lg'

const valueSize: Record<Size, string> = {
  md: 'text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums',  // compact strip
  lg: type.display,                                                         // emphasis card
}

// Single stat: small caption label, large tabular value, optional sub-text.
// Use inside a Card or a StatStrip. `size="md"` is compact (page strips);
// `size="lg"` is for emphasized single-metric cards.

export function Stat({ label, value, sub, size = 'lg', className = '' }: {
  label: string
  value: React.ReactNode
  sub?: string
  size?: Size
  className?: string
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className={type.caption}>{label}</span>
      <span className={`${valueSize[size]} mt-0.5`}>{value}</span>
      {sub && <span className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{sub}</span>}
    </div>
  )
}

// StatStrip — horizontal row of stats inside a card, separated by thin dividers.
// Defaults to compact sizing so it drops into a strip without inflating.
export function StatStrip({ items, size = 'md' }: {
  items: { label: string; value: React.ReactNode; sub?: string }[]
  size?: Size
}) {
  return (
    <div className="flex items-center gap-0 divide-x divide-gray-100 dark:divide-gray-800">
      {items.map(it => (
        <div key={it.label} className="px-5 first:pl-0 last:pr-0">
          <Stat label={it.label} value={it.value} sub={it.sub} size={size} />
        </div>
      ))}
    </div>
  )
}

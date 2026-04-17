import React from 'react'
import { type } from './tokens'

// Single stat: small caption label, large tabular value, optional sub-text.
// Use inside a Card or a StatStrip.

export function Stat({ label, value, sub, className = '' }: {
  label: string
  value: React.ReactNode
  sub?: string
  className?: string
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className={type.caption}>{label}</span>
      <span className={`${type.display} mt-0.5`}>{value}</span>
      {sub && <span className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{sub}</span>}
    </div>
  )
}

// StatStrip — horizontal row of stats inside a card, separated by thin dividers.
export function StatStrip({ items }: { items: { label: string; value: React.ReactNode; sub?: string }[] }) {
  return (
    <div className="flex items-center gap-0 divide-x divide-gray-100 dark:divide-gray-800">
      {items.map(it => (
        <div key={it.label} className="px-5 first:pl-0 last:pr-0">
          <Stat label={it.label} value={it.value} sub={it.sub} />
        </div>
      ))}
    </div>
  )
}

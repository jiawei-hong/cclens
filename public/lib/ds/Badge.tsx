import React from 'react'
import { accent, type AccentTone } from './tokens'

type Size = 'sm' | 'md'

const sizeCls: Record<Size, string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
}

export function Badge({ tone = 'neutral', size = 'md', children, className = '' }: {
  tone?: AccentTone
  size?: Size
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded ${accent[tone].soft} ${sizeCls[size]} ${className}`}>
      {children}
    </span>
  )
}

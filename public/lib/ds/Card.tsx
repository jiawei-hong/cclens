import React from 'react'
import { surface, radius } from './tokens'

type Padding = 'none' | 'sm' | 'md' | 'lg'

const padCls: Record<Padding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-6',
}

type CardProps = {
  padding?: Padding
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>

export function Card({ padding = 'md', children, className = '', ...rest }: CardProps) {
  return (
    <div className={`${surface.card} ${radius.lg} ${padCls[padding]} ${className}`} {...rest}>
      {children}
    </div>
  )
}

Card.Header = function CardHeader({ title, subtitle, actions, className = '' }: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{title}</h3>
        {subtitle && <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

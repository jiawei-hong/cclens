import React from 'react'
import { focusRing } from './tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantCls: Record<Variant, string> = {
  primary:   'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white border-indigo-600',
  secondary: 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700',
  ghost:     'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent',
  danger:    'bg-rose-600 hover:bg-rose-500 text-white border-rose-600',
}

const sizeCls: Record<Size, string> = {
  sm: 'text-xs px-2.5 py-1 gap-1 rounded-lg',
  md: 'text-sm px-3 py-1.5 gap-1.5 rounded-lg',
  lg: 'text-sm px-4 py-2 gap-2 rounded-xl',
}

type ButtonProps = {
  variant?: Variant
  size?: Size
  icon?: React.ReactNode
  children?: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${focusRing} ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  )
}

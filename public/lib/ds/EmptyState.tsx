import React from 'react'
import { Card } from './Card'

export function EmptyState({ title, description, action, className = '' }: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <Card padding="lg" className={`text-center ${className}`}>
      <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{title}</p>
      {description && <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 max-w-md mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  )
}

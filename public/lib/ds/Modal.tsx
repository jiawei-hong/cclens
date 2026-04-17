import React from 'react'
import { surface, radius } from './tokens'
import { useEscapeKey, useScrollLock, useFocusTrap } from './hooks'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const sizeCls: Record<Size, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
}

// Modal — accessible dialog with focus trap, Esc-to-close, and body scroll
// lock. Pass `open` to control visibility; the component renders nothing
// when closed, so conditional mounting is not required at the call site
// (but is also fine for perf).

export function Modal({ open, onClose, size = 'lg', title, children, className = '' }: {
  open: boolean
  onClose: () => void
  size?: Size
  title?: string
  children: React.ReactNode
  className?: string
}) {
  useEscapeKey(open, onClose)
  useScrollLock(open)
  const ref = useFocusTrap<HTMLDivElement>(open)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`${surface.dialog} ${radius.lg} w-full ${sizeCls[size]} flex flex-col overflow-hidden ${className}`}
      >
        {title && (
          <Modal.Header title={title} onClose={onClose} />
        )}
        {children}
      </div>
    </div>
  )
}

Modal.Header = function ModalHeader({ title, onClose, actions }: {
  title: string
  onClose?: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h2>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-lg leading-none px-2 -mr-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >×</button>
        )}
      </div>
    </div>
  )
}

Modal.Body = function ModalBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex-1 overflow-y-auto p-5 ${className}`}>{children}</div>
}

Modal.Footer = function ModalFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800 ${className}`}>
      {children}
    </div>
  )
}

import React from 'react'
import { Modal } from '../lib/ds'

type Shortcut = { keys: string[]; label: string }

const SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['1'], label: 'Go to Insights' },
      { keys: ['2'], label: 'Go to Sessions' },
      { keys: ['3'], label: 'Go to Memory (when available)' },
      { keys: ['⌘', 'K'], label: 'Open search' },
      { keys: ['/'], label: 'Open search' },
      { keys: ['←', '→'], label: 'Cycle Insights sub-tabs' },
    ],
  },
  {
    title: 'Sessions list',
    items: [
      { keys: ['j'], label: 'Next session' },
      { keys: ['k'], label: 'Previous session' },
      { keys: ['Esc'], label: 'Close selected session' },
    ],
  },
  {
    title: 'Session detail',
    items: [
      { keys: ['g', 'g'], label: 'Jump to top of detail' },
      { keys: ['Shift', 'G'], label: 'Jump to bottom of detail' },
    ],
  },
  {
    title: 'Search modal',
    items: [
      { keys: ['↑'], label: 'Previous result' },
      { keys: ['↓'], label: 'Next result' },
      { keys: ['Enter'], label: 'Open selected session' },
    ],
  },
  {
    title: 'Overlay',
    items: [
      { keys: ['?'], label: 'Show / hide this help' },
      { keys: ['Esc'], label: 'Close any open modal' },
    ],
  },
]

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] px-1.5 h-[22px] text-[11px] font-mono font-medium rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 shadow-[inset_0_-1px_0_rgb(0_0_0_/_0.08)] dark:shadow-[inset_0_-1px_0_rgb(255_255_255_/_0.06)]">
      {label}
    </kbd>
  )
}

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="md" title="Keyboard shortcuts">
      <Modal.Body className="flex flex-col gap-5">
        {SECTIONS.map(section => (
          <section key={section.title} className="flex flex-col gap-2">
            <h3 className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600 font-semibold">{section.title}</h3>
            <div className="flex flex-col gap-1.5">
              {section.items.map(({ keys, label }) => (
                <div key={label} className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-gray-700 dark:text-gray-300">{label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {keys.map((k, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <span className="text-gray-400 dark:text-gray-600">then</span>}
                        <Key label={k} />
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </Modal.Body>
    </Modal>
  )
}

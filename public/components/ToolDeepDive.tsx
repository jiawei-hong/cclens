import React, { useMemo } from 'react'
import type { Session } from '../../src/types'
import { fmt, fmtToolDuration } from '../lib/format'
import { toolColor } from '../lib/colors'
import { Modal, Badge } from '../lib/ds'

type ToolCallHit = {
  sessionId: string
  project: string
  timestamp: string
  turnUuid: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  durationMs?: number
}

function collectCalls(sessions: Session[], toolName: string): ToolCallHit[] {
  const out: ToolCallHit[] = []
  for (const s of sessions) {
    for (const turn of s.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.name !== toolName) continue
        out.push({
          sessionId: s.id,
          project: s.project,
          timestamp: turn.timestamp,
          turnUuid: turn.uuid,
          input: tc.input,
          result: tc.result,
          isError: tc.isError,
          durationMs: tc.durationMs,
        })
      }
    }
  }
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

function summarizeInput(input: Record<string, unknown>): string {
  const first = Object.values(input)[0]
  if (first == null) return ''
  const s = typeof first === 'string' ? first : JSON.stringify(first)
  return s.slice(0, 140)
}

export function ToolDeepDiveModal({
  toolName,
  sessions,
  onClose,
  onOpenSession,
}: {
  toolName: string
  sessions: Session[]
  onClose: () => void
  onOpenSession: (id: string, turnId?: string) => void
}) {
  const hits = useMemo(() => collectCalls(sessions, toolName), [sessions, toolName])
  const errors = hits.filter(h => h.isError).length
  const withDur = hits.filter(h => h.durationMs != null)
  const avgMs = withDur.length > 0 ? withDur.reduce((s, h) => s + (h.durationMs ?? 0), 0) / withDur.length : 0

  return (
    <Modal open onClose={onClose} size="lg">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded font-mono shrink-0 ${toolColor(toolName)}`}>{toolName}</span>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {hits.length.toLocaleString()} calls
            {errors > 0 && <> · <span className="text-rose-500">{errors} errors</span></>}
            {avgMs > 0 && <> · avg {fmtToolDuration(avgMs)}</>}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-lg leading-none px-2 -mr-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >×</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {hits.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 p-8 text-center">No calls in the current range.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {hits.map((h, i) => (
              <li key={`${h.sessionId}-${h.turnUuid}-${i}`} className="px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => { onOpenSession(h.sessionId, h.turnUuid); onClose() }}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium truncate"
                    title="Jump to this turn"
                  >
                    {h.project}
                  </button>
                  <span className="text-gray-400 dark:text-gray-600">·</span>
                  <span className="text-gray-500 dark:text-gray-400">{fmt(h.timestamp)}</span>
                  {h.durationMs != null && (
                    <>
                      <span className="text-gray-400 dark:text-gray-600">·</span>
                      <span className="text-gray-500 dark:text-gray-400 tabular-nums">{fmtToolDuration(h.durationMs)}</span>
                    </>
                  )}
                  {h.isError && (
                    <Badge tone="danger" size="sm" className="ml-auto">error</Badge>
                  )}
                </div>
                <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mt-1 truncate">{summarizeInput(h.input)}</p>
                {h.result && (
                  <p className="text-[11px] font-mono text-gray-500 dark:text-gray-500 mt-0.5 truncate">→ {h.result.slice(0, 160)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

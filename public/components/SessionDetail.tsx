import React, { useState, useEffect, useMemo } from 'react'
import { RiTimeLine, RiTerminalLine, RiChat3Line, RiFlashlightLine, RiGitBranchLine, RiLinkM, RiCheckLine, RiLightbulbFlashLine } from 'react-icons/ri'
import type { Session } from '../../src/types'
import { fmtDuration, fmtPace, fmtUSD } from '../lib/format'
import { toolColor, toolTickColor } from '../lib/colors'
import { exportSessionAsMarkdown, exportSessionAsHTML } from '../lib/exports'
import { useNotes, useDiffMode } from '../lib/prefs'
import { MarkdownText, FileIcon } from '../lib/ui'
import { Button, Card, Tab, TabGroup, Badge, focusRing } from '../lib/ds'
import { SessionCompareModal } from './SessionCompare'
import { RecommendationsPanel } from './RecommendationsPanel'
import { sessionRecommendations, type Recommendation } from '../../src/recommendations'
import { RULE_TEXT_BY_REC_ID } from '../../src/claudeMd'
import { classifySession, sessionCostUSD, goldStandardSessions, type SessionType } from '../../src/analyzer'
import { sessionQualityScore, GRADE_TONE } from '../../src/quality'

// ── Inline turn coach ─────────────────────────────────────────────────────────
// Surfaces the recommendations that flagged *this specific turn* so the user
// can see why it was called out and copy the matching CLAUDE.md rule.

const COACH_SEVERITY_TONE = {
  high:   'danger',
  medium: 'warning',
  low:    'neutral',
} as const

function TurnCoach({ recs }: { recs: Recommendation[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = async (rec: Recommendation) => {
    const rule = RULE_TEXT_BY_REC_ID[rec.id] ?? rec.actionHint
    try {
      await navigator.clipboard.writeText(`- ${rule}`)
      setCopiedId(rec.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch { /* clipboard blocked — best-effort */ }
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-amber-600 dark:text-amber-400"><RiLightbulbFlashLine size={12} /></span>
        <span className="text-[10px] uppercase tracking-wide font-medium text-amber-700 dark:text-amber-300">
          Coach · flagged this turn
        </span>
      </div>
      {recs.map(rec => (
        <div key={rec.id} className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge tone={COACH_SEVERITY_TONE[rec.severity]} size="sm">{rec.severity}</Badge>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{rec.title}</span>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">{rec.actionHint}</p>
          </div>
          {RULE_TEXT_BY_REC_ID[rec.id] && (
            <button
              onClick={() => copy(rec)}
              className={`text-[11px] px-2 py-1 rounded bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 hover:border-amber-400 font-medium shrink-0 ${focusRing}`}
              title="Copy this rule as a CLAUDE.md line"
            >
              {copiedId === rec.id ? '✓ copied' : 'Copy rule'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Session Timeline ──────────────────────────────────────────────────────────

function SessionTimeline({ session }: { session: Session }) {
  const start = new Date(session.startedAt).getTime()
  const end = new Date(session.endedAt).getTime()
  const span = Math.max(end - start, 1)
  const events: { turnUuid: string; toolName: string; ts: number; pct: number }[] = []
  for (const turn of session.turns) {
    const ts = new Date(turn.timestamp).getTime()
    const pct = Math.max(0, Math.min(100, ((ts - start) / span) * 100))
    for (const tc of turn.toolCalls) {
      events.push({ turnUuid: turn.uuid, toolName: tc.name, ts, pct })
    }
  }
  if (events.length === 0) return null

  const turnPositions = session.turns.map(t => ({
    turnUuid: t.uuid,
    ts: new Date(t.timestamp).getTime(),
  }))

  const scrollToTurn = (turnUuid: string) => {
    const el = document.getElementById(`turn-${turnUuid}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const [hoverPct, setHoverPct] = useState<number | null>(null)

  const findNearestTurn = (pct: number): string | null => {
    const targetTs = start + (pct / 100) * span
    let best: { uuid: string; delta: number } | null = null
    for (const p of turnPositions) {
      const d = Math.abs(p.ts - targetTs)
      if (!best || d < best.delta) best = { uuid: p.turnUuid, delta: d }
    }
    return best?.uuid ?? null
  }

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const uuid = findNearestTurn(pct)
    if (uuid) scrollToTurn(uuid)
  }

  const onBarMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    setHoverPct(pct)
  }

  const counts: Record<string, number> = {}
  for (const e of events) counts[e.toolName] = (counts[e.toolName] ?? 0) + 1
  const legend = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const hoverTs = hoverPct != null ? start + (hoverPct / 100) * span : null

  return (
    <Card className="px-5 py-4" padding="none">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Timeline</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">
          {events.length} tool calls · span {fmtDuration(end - start)}
          {hoverTs != null && <> · <span className="tabular-nums">{new Date(hoverTs).toLocaleTimeString()}</span></>}
        </span>
      </div>
      <div
        className="relative h-8 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-crosshair"
        onClick={onBarClick}
        onMouseMove={onBarMove}
        onMouseLeave={() => setHoverPct(null)}
      >
        {events.map((e, i) => (
          <span key={i}
            title={`${e.toolName} · ${new Date(e.ts).toLocaleTimeString()}`}
            className={`absolute top-1 bottom-1 w-[2px] rounded-sm ${toolTickColor(e.toolName)} opacity-70 pointer-events-none`}
            style={{ left: `${e.pct}%` }}
          />
        ))}
        {hoverPct != null && (
          <div className="absolute top-0 bottom-0 w-px bg-indigo-500 pointer-events-none" style={{ left: `${hoverPct}%` }} />
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {legend.map(([name, n]) => (
            <span key={name} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-500">
              <span className={`inline-block w-2 h-2 rounded-sm ${toolTickColor(name)}`} />
              {name} <span className="text-gray-400 dark:text-gray-600 tabular-nums">{n}</span>
            </span>
          ))}
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </Card>
  )
}

// ── Context Growth Chart ──────────────────────────────────────────────────────

function ContextGrowthChart({ session }: { session: Session }) {
  const { contextSeries, contextLimit } = session.stats
  if (contextSeries.length < 2) return null
  const first = contextSeries[0]!
  const last  = contextSeries[contextSeries.length - 1]!

  const W = 600
  const H = 56
  const PAD = { top: 6, right: 8, bottom: 6, left: 8 }
  const iw = W - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom

  const maxTokens = Math.max(...contextSeries.map(p => p.tokens), contextLimit * 0.1)
  const yScale = (v: number) => PAD.top + ih - (v / maxTokens) * ih
  const xScale = (i: number) => PAD.left + (i / (contextSeries.length - 1)) * iw

  const points = contextSeries.map((p, i) => `${xScale(i)},${yScale(p.tokens)}`).join(' ')
  const areaBottom = PAD.top + ih
  const areaPath = `M${xScale(0)},${areaBottom} L${contextSeries.map((p, i) => `${xScale(i)},${yScale(p.tokens)}`).join(' L')} L${xScale(contextSeries.length - 1)},${areaBottom} Z`

  const thresholdY = yScale(contextLimit * 0.95)
  const thresholdVisible = thresholdY >= PAD.top && thresholdY <= PAD.top + ih

  const peak = session.stats.peakContextTokens
  const pct = Math.round((peak / contextLimit) * 100)
  const overThreshold = peak >= contextLimit * 0.95

  return (
    <Card className="px-5 py-4" padding="none">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Context Growth</h3>
        <span className={`text-[10px] tabular-nums font-mono ${overThreshold ? 'text-rose-500 dark:text-rose-400 font-semibold' : 'text-gray-400 dark:text-gray-600'}`}>
          peak {(peak / 1000).toFixed(0)}k / {(contextLimit / 1000).toFixed(0)}k ({pct}%)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ctx-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={overThreshold ? '#f43f5e' : '#6366f1'} stopOpacity="0.25" />
            <stop offset="100%" stopColor={overThreshold ? '#f43f5e' : '#6366f1'} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaPath} fill="url(#ctx-fill)" />
        {/* Line */}
        <polyline points={points} fill="none"
          stroke={overThreshold ? '#f43f5e' : '#6366f1'}
          strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* 95% threshold */}
        {thresholdVisible && (
          <line x1={PAD.left} y1={thresholdY} x2={PAD.left + iw} y2={thresholdY}
            stroke="#f43f5e" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
        )}
      </svg>
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
          {new Date(first.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {thresholdVisible && (
          <span className="text-[10px] text-rose-400 dark:text-rose-500">— 95% limit</span>
        )}
        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">
          {new Date(last.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </Card>
  )
}

// ── Turn content parser ───────────────────────────────────────────────────────

type TurnContent =
  | { kind: 'text'; text: string }
  | { kind: 'slash-command'; command: string; args: string }
  | { kind: 'stdout'; output: string }
  | { kind: 'meta' }

function parseTurnContent(raw: string): TurnContent[] {
  const cleaned = raw
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-message>[^<]*<\/command-message>/g, '')
    .replace(/<command-args>[^<]*<\/command-args>/g, '')
    .replace(/\[Request interrupted by user\]\s*/g, '')
    .trim()

  const parts: TurnContent[] = []
  let remaining = cleaned

  while (remaining.length > 0) {
    const cmdMatch = remaining.match(/<command-name>([^<]+)<\/command-name>\s*(?:<command-message>[^<]*<\/command-message>)?\s*(?:<command-args>([^<]*)<\/command-args>)?/)
    const stdoutMatch = remaining.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)

    const cmdIdx = cmdMatch?.index ?? Infinity
    const stdoutIdx = stdoutMatch?.index ?? Infinity

    if (cmdIdx === Infinity && stdoutIdx === Infinity) {
      if (remaining.trim()) parts.push({ kind: 'text', text: remaining.trim() })
      break
    }

    const firstIdx = Math.min(cmdIdx, stdoutIdx)
    const before = remaining.slice(0, firstIdx).trim()
    if (before) parts.push({ kind: 'text', text: before })

    if (cmdIdx <= stdoutIdx && cmdMatch) {
      parts.push({ kind: 'slash-command', command: cmdMatch[1]?.trim() ?? '', args: cmdMatch[2]?.trim() ?? '' })
      remaining = remaining.slice(cmdIdx + cmdMatch[0].length)
    } else if (stdoutMatch) {
      const out = stdoutMatch[1]?.trim() ?? ''
      if (out) parts.push({ kind: 'stdout', output: out })
      remaining = remaining.slice(stdoutIdx + stdoutMatch[0].length)
    }
  }

  return parts.filter(p => p.kind !== 'meta' && !(p.kind === 'text' && !p.text))
}

function TimeLabel({ timestamp }: { timestamp: string }) {
  return (
    <span className="text-[10px] text-gray-400 dark:text-gray-600 shrink-0 self-end leading-none">
      {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

function TurnBody({ text, role, timestamp }: { text: string; role: 'user' | 'assistant'; timestamp: string }) {
  if (role === 'assistant') {
    return (
      <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">
        <MarkdownText>{text}</MarkdownText>
        <div className="flex justify-end mt-1.5">
          <TimeLabel timestamp={timestamp} />
        </div>
      </div>
    )
  }

  const parts = parseTurnContent(text)
  if (parts.length === 0) return null

  const hasSlashCmd = parts.some(p => p.kind === 'slash-command')
  const lastTextIdx = [...parts].reverse().findIndex(p => p.kind === 'text')
  const lastTextAbsIdx = lastTextIdx === -1 ? -1 : parts.length - 1 - lastTextIdx

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) => {
        if (part.kind === 'slash-command') {
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl font-mono text-sm text-gray-800 dark:text-gray-200">
                {part.command}
                {part.args && <span className="text-gray-500 text-xs">{part.args}</span>}
              </span>
            </div>
          )
        }
        if (part.kind === 'stdout') {
          if (hasSlashCmd) return null
          return (
            <pre key={i} className="text-xs text-gray-500 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl px-3 py-2 font-mono whitespace-pre-wrap">
              {part.output}
            </pre>
          )
        }
        if (part.kind !== 'text') return null
        const isLast = i === lastTextAbsIdx
        return (
          <div key={i} className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-indigo-50 dark:bg-indigo-600/20 text-gray-900 dark:text-gray-200">
            <MarkdownText>{part.text}</MarkdownText>
            {isLast && (
              <div className={`flex mt-1.5 ${role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <TimeLabel timestamp={timestamp} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Edit Diff View ────────────────────────────────────────────────────────────

function EditDiffView({ input }: { input: Record<string, unknown> }) {
  const filePath = input['file_path'] as string | undefined
  const oldStr = (input['old_string'] as string | undefined) ?? ''
  const newStr = (input['new_string'] as string | undefined) ?? ''

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  const { mode, toggle } = useDiffMode()

  return (
    <div className="flex flex-col gap-1 text-xs font-mono">
      <div className="flex items-center justify-between px-1 pb-1 gap-2">
        {filePath ? <p className="text-gray-500 truncate">{filePath}</p> : <span />}
        <button
          onClick={toggle}
          title={`Switch to ${mode === 'stacked' ? 'side-by-side' : 'stacked'} diff`}
          className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-1.5 py-0.5 border border-gray-200 dark:border-gray-700 rounded font-sans"
        >
          {mode === 'stacked' ? '⇆ side-by-side' : '↕ stacked'}
        </button>
      </div>
      {mode === 'stacked' ? (
        <div className="rounded-lg overflow-hidden bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800">
          {oldLines.map((line, i) => (
            <div key={`-${i}`} className="flex gap-2 px-3 py-0.5 bg-rose-100 dark:bg-rose-950/40 hover:bg-rose-200 dark:hover:bg-rose-950/60">
              <span className="text-rose-500 select-none w-3 shrink-0">−</span>
              <span className="text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-all">{line}</span>
            </div>
          ))}
          <div className="border-t border-gray-200 dark:border-gray-800" />
          {newLines.map((line, i) => (
            <div key={`+${i}`} className="flex gap-2 px-3 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 hover:bg-emerald-200 dark:hover:bg-emerald-950/60">
              <span className="text-emerald-600 dark:text-emerald-500 select-none w-3 shrink-0">+</span>
              <span className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
          <div className="bg-white dark:bg-gray-950 border border-rose-200 dark:border-rose-900/50 rounded-lg overflow-hidden">
            {oldLines.map((line, i) => (
              <div key={`L-${i}`} className="flex gap-2 px-3 py-0.5 bg-rose-100 dark:bg-rose-950/40">
                <span className="text-rose-400 dark:text-rose-700 select-none w-6 text-right shrink-0 tabular-nums">{i + 1}</span>
                <span className="text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-all">{line}</span>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-950 border border-emerald-200 dark:border-emerald-900/50 rounded-lg overflow-hidden">
            {newLines.map((line, i) => (
              <div key={`R-${i}`} className="flex gap-2 px-3 py-0.5 bg-emerald-100 dark:bg-emerald-950/40">
                <span className="text-emerald-400 dark:text-emerald-700 select-none w-6 text-right shrink-0 tabular-nums">{i + 1}</span>
                <span className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── File Change Summary ───────────────────────────────────────────────────────

type FileWriteOp = { kind: 'write'; content: string; ts: string }
type FileEditOp = { kind: 'edit'; oldStr: string; newStr: string; ts: string }
type FileOp = FileWriteOp | FileEditOp

type FileChange = {
  path: string
  ops: FileOp[]
  writeCount: number
  editCount: number
  linesAdded: number
  linesRemoved: number
}

function buildFileChanges(session: Session): FileChange[] {
  const map = new Map<string, FileChange>()
  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      const path = tc.input['file_path'] as string | undefined
      if (!path) continue
      const get = () => map.get(path) ?? (() => {
        const fc: FileChange = { path, ops: [], writeCount: 0, editCount: 0, linesAdded: 0, linesRemoved: 0 }
        map.set(path, fc); return fc
      })()
      if (tc.name === 'Write') {
        const content = (tc.input['content'] as string | undefined) ?? ''
        const fc = get()
        fc.ops.push({ kind: 'write', content, ts: turn.timestamp })
        fc.writeCount++
        fc.linesAdded += content.split('\n').length
      } else if (tc.name === 'Edit') {
        const oldStr = (tc.input['old_string'] as string | undefined) ?? ''
        const newStr = (tc.input['new_string'] as string | undefined) ?? ''
        const fc = get()
        fc.ops.push({ kind: 'edit', oldStr, newStr, ts: turn.timestamp })
        fc.editCount++
        fc.linesAdded += newStr.split('\n').length
        fc.linesRemoved += oldStr.split('\n').length
      }
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function SessionFilesView({ session }: { session: Session }) {
  const changes = React.useMemo(() => buildFileChanges(session), [session.id])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set())
  const toggle = (p: string) => setExpanded(prev => {
    const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next
  })
  const toggleOp = (key: string) => setExpandedOps(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  if (changes.length === 0) {
    return <p className="text-center py-12 text-sm text-gray-500 dark:text-gray-600">No file changes in this session</p>
  }

  const totalEdits = changes.reduce((s, c) => s + c.editCount, 0)
  const totalWrites = changes.reduce((s, c) => s + c.writeCount, 0)
  const totalAdded = changes.reduce((s, c) => s + c.linesAdded, 0)
  const totalRemoved = changes.reduce((s, c) => s + c.linesRemoved, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 px-1 text-xs text-gray-500 dark:text-gray-500">
        <span className="font-medium text-gray-700 dark:text-gray-300">{changes.length} files</span>
        {totalWrites > 0 && <span>{totalWrites} write{totalWrites > 1 ? 's' : ''}</span>}
        {totalEdits > 0 && <span>{totalEdits} edit{totalEdits > 1 ? 's' : ''}</span>}
        <span className="ml-auto font-mono">
          {totalAdded > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{totalAdded}</span>}
          {totalAdded > 0 && totalRemoved > 0 && <span className="text-gray-400 mx-1">/</span>}
          {totalRemoved > 0 && <span className="text-rose-500 dark:text-rose-400">−{totalRemoved}</span>}
        </span>
      </div>

      {changes.map(fc => {
        const isExpanded = expanded.has(fc.path)
        const parts = fc.path.split('/')
        const fileName = parts.pop() ?? fc.path
        const dir = parts.slice(-2).join('/')

        return (
          <div key={fc.path} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
            <button onClick={() => toggle(fc.path)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
              <span className="shrink-0"><FileIcon path={fc.path} size={15} /></span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-mono font-medium text-gray-800 dark:text-gray-200">{fileName}</span>
                {dir && <span className="text-xs text-gray-400 dark:text-gray-600 ml-2 font-mono">{dir}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {fc.writeCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    {fc.writeCount}W
                  </span>
                )}
                {fc.editCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    {fc.editCount}E
                  </span>
                )}
                <span className="text-xs font-mono">
                  <span className="text-emerald-600 dark:text-emerald-400">+{fc.linesAdded}</span>
                  <span className="text-gray-400 mx-0.5">/</span>
                  <span className="text-rose-500 dark:text-rose-400">−{fc.linesRemoved}</span>
                </span>
              </div>
              <span className="text-gray-400 dark:text-gray-600 text-xs ml-1">{isExpanded ? '▾' : '▸'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 pt-2 flex flex-col gap-2 border-t border-gray-100 dark:border-gray-800">
                {fc.ops.map((op, i) => {
                  const opKey = `${fc.path}:${i}`
                  const isOpExpanded = expandedOps.has(opKey)
                  const opLabel = op.kind === 'write'
                    ? `WRITE · ${op.content.split('\n').length} lines`
                    : `EDIT`
                  return (
                    <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                      <button onClick={() => toggleOp(opKey)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                        <span className={`text-[11px] font-mono font-semibold ${op.kind === 'write' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'}`}>
                          {opLabel}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-600 font-mono">
                          · {new Date(op.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {fc.ops.length > 1 && ` #${i + 1}`}
                        </span>
                        <span className="ml-auto text-gray-400 dark:text-gray-600 text-xs">{isOpExpanded ? '▾' : '▸'}</span>
                      </button>
                      {isOpExpanded && (
                        <div className="border-t border-gray-100 dark:border-gray-800">
                          {op.kind === 'write' ? (
                            <div className="max-h-56 overflow-y-auto text-xs font-mono">
                              {op.content.split('\n').slice(0, 60).map((line, li) => (
                                <div key={li} className="flex gap-2 px-3 py-0.5 bg-emerald-50/60 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                                  <span className="text-gray-300 dark:text-gray-700 select-none w-6 text-right shrink-0">{li + 1}</span>
                                  <span className="text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap break-all">{line || ' '}</span>
                                </div>
                              ))}
                              {op.content.split('\n').length > 60 && (
                                <div className="px-4 py-2 text-gray-400 dark:text-gray-600 text-center">
                                  … {op.content.split('\n').length - 60} more lines
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3">
                              <EditDiffView input={{ old_string: op.oldStr, new_string: op.newStr }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Session Postmortem ───────────────────────────────────────────────────────
// Two-second verdict at the top of the session view. Runs the same signals the
// Recommendations panel and gold-standard card use, but boils the result down
// to one headline + one colour tone so users can triage before scrolling.

const TASK_TYPE_LABEL: Record<SessionType, string> = {
  coding:       'Coding',
  debugging:    'Debugging',
  research:     'Research',
  exploration:  'Exploration',
  conversation: 'Conversation',
}

type VerdictTone = 'success' | 'warning' | 'danger' | 'neutral'

function SessionPostmortem({ session, allSessions }: { session: Session; allSessions: Session[] }) {
  const data = useMemo(() => {
    const taskType = classifySession(session)
    const cost = sessionCostUSD(session)

    const others = allSessions.filter(s => s.id !== session.id && s.turns.length >= 5)
    const otherCosts = others.map(s => sessionCostUSD(s)).filter(c => c > 0).sort((a, b) => a - b)
    const median = otherCosts.length > 0 ? otherCosts[Math.floor(otherCosts.length / 2)]! : 0
    const costRatio = median > 0.01 ? cost / median : null

    const goldIds = new Set(goldStandardSessions(allSessions).map(g => g.sessionId))
    const isGold = goldIds.has(session.id)

    const { recommendations, totalSavingsUSD } = sessionRecommendations(session)
    const highSev = recommendations.filter(r => r.severity === 'high')

    let tc = 0, err = 0
    for (const t of session.turns) for (const c of t.toolCalls) { tc++; if (c.isError) err++ }
    const errorRate = tc === 0 ? 0 : err / tc

    const peakPct = session.stats.contextLimit > 0
      ? session.stats.peakContextTokens / session.stats.contextLimit
      : 0

    const quality = sessionQualityScore(session)

    let verdict: { tone: VerdictTone; headline: string; detail?: string }
    if (isGold) {
      verdict = { tone: 'success', headline: 'Worth learning from — cache ran hot and tool calls ran clean', detail: 'Marked as a gold-standard session.' }
    } else if (highSev.length > 0) {
      verdict = { tone: 'danger', headline: `${highSev.length} high-severity issue${highSev.length === 1 ? '' : 's'} worth reviewing`, detail: 'Jump to Recommendations for details.' }
    } else if (recommendations.length >= 3) {
      verdict = { tone: 'warning', headline: `${recommendations.length} recommendations surfaced`, detail: 'Jump to Recommendations for details.' }
    } else if (peakPct > 0.8) {
      verdict = { tone: 'warning', headline: `Ran hot — peak context hit ${Math.round(peakPct * 100)}% of the ${Math.round(session.stats.contextLimit / 1000)}k limit`, detail: 'Close to the auto-compact threshold.' }
    } else if (totalSavingsUSD >= 0.5) {
      verdict = { tone: 'warning', headline: `Could have been ~${fmtUSD(totalSavingsUSD)} cheaper`, detail: 'See Recommendations for what to change.' }
    } else if (errorRate > 0.1 && tc >= 5) {
      verdict = { tone: 'warning', headline: `Tool-call friction — ${err}/${tc} calls errored`, detail: 'Check the failing calls for a pattern.' }
    } else if (quality.rated && quality.grade === 'D') {
      verdict = { tone: 'warning', headline: `Grade D (${quality.score}/100) — weakest on ${quality.weakest?.label.toLowerCase() ?? 'multiple factors'}`, detail: 'Nothing urgent, but the quality score is on the low side.' }
    } else {
      verdict = { tone: 'success', headline: 'No red flags — session ran clean' }
    }

    return { taskType, cost, costRatio, isGold, verdict, recCount: recommendations.length, quality }
  }, [session.id, allSessions])

  const toneStyles: Record<VerdictTone, string> = {
    success: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
    warning: 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
    danger:  'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10',
    neutral: 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900',
  }
  const toneHeadline: Record<VerdictTone, string> = {
    success: 'text-emerald-800 dark:text-emerald-200',
    warning: 'text-amber-800 dark:text-amber-200',
    danger:  'text-rose-800 dark:text-rose-200',
    neutral: 'text-gray-800 dark:text-gray-200',
  }

  const costPill = data.costRatio != null
    ? `${fmtUSD(data.cost)} · ${data.costRatio >= 10 ? '10×+' : data.costRatio >= 1.5 ? `${data.costRatio.toFixed(1)}×` : data.costRatio <= 0.5 ? `${data.costRatio.toFixed(2)}×` : '≈'} median`
    : fmtUSD(data.cost)

  const quality = data.quality
  const factorTone: Record<'good' | 'ok' | 'bad', string> = {
    good: 'text-emerald-700 dark:text-emerald-300',
    ok:   'text-amber-700 dark:text-amber-300',
    bad:  'text-rose-700 dark:text-rose-300',
  }

  return (
    <div className={`rounded-2xl border px-4 py-3 flex flex-col gap-1.5 ${toneStyles[data.verdict.tone]}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">
          Postmortem
        </span>
        <Badge tone="neutral" size="sm">{TASK_TYPE_LABEL[data.taskType]}</Badge>
        <Badge tone="neutral" size="sm">{costPill}</Badge>
        {quality.rated && (
          <span title={quality.factors.map(f => `${f.label}: ${Math.round(f.points)}/${f.maxPoints} (${f.displayValue})`).join('\n')}>
            <Badge tone={GRADE_TONE[quality.grade]} size="sm">
              Grade {quality.grade} · {quality.score}
            </Badge>
          </span>
        )}
        {data.isGold && <Badge tone="success" size="sm">Gold</Badge>}
      </div>
      <p className={`text-sm font-semibold ${toneHeadline[data.verdict.tone]}`}>
        {data.verdict.headline}
      </p>
      {data.verdict.detail && (
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
          {data.verdict.detail}
        </p>
      )}
      {quality.rated && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] tabular-nums mt-0.5">
          {quality.factors.map(f => (
            <span key={f.id} className="flex items-center gap-1">
              <span className="text-gray-500 dark:text-gray-500">{f.label}:</span>
              <span className={factorTone[f.tone]}>{f.displayValue}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Session Detail View ───────────────────────────────────────────────────────

export function SessionDetailView({ session, allSessions, scrollToTurnId }: { session: Session; allSessions: Session[]; scrollToTurnId: string | null }) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'conversation' | 'files'>('conversation')
  const [compareOpen, setCompareOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const { notes, setNote } = useNotes()

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch { /* clipboard blocked — best-effort */ }
  }
  const [noteDraft, setNoteDraft] = useState(notes[session.id] ?? '')
  useEffect(() => { setNoteDraft(notes[session.id] ?? '') }, [session.id, notes])
  const toggleTool = (id: string) => setExpandedTools(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const filesCount = React.useMemo(() => buildFileChanges(session).length, [session.id])

  const recsByTurn = useMemo(() => {
    const m = new Map<string, Recommendation[]>()
    for (const r of sessionRecommendations(session).recommendations) {
      for (const uuid of r.turnUuids ?? []) {
        const list = m.get(uuid) ?? []
        list.push(r)
        m.set(uuid, list)
      }
    }
    return m
  }, [session.id])

  useEffect(() => {
    if (!scrollToTurnId) return
    const el = document.getElementById(`turn-${scrollToTurnId}`)
    if (!el) return
    const timer = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedTurnId(scrollToTurnId)
      setTimeout(() => setHighlightedTurnId(null), 1500)
    }, 150)
    return () => clearTimeout(timer)
  }, [scrollToTurnId, session.id])

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-start justify-between px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{session.project}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{session.projectPath}</p>
            {session.gitBranch && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1 truncate">
                <RiGitBranchLine size={12} className="shrink-0" />
                <span className="font-mono truncate">{session.gitBranch}</span>
              </p>
            )}
            <input
              type="text"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onBlur={() => setNote(session.id, noteDraft)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              placeholder="Add a note…"
              aria-label="Session note"
              className={`mt-2 w-full text-xs bg-transparent text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 border border-dashed border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500 focus:border-solid focus:bg-white dark:focus:bg-gray-800 ${focusRing}`}
            />
          </div>
          <div className="flex gap-1.5 shrink-0 ml-4">
            <Button
              size="sm"
              onClick={copyShareLink}
              title="Copy a shareable link to this session (current URL)"
              icon={linkCopied ? <RiCheckLine size={13} /> : <RiLinkM size={13} />}
            >
              {linkCopied ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" onClick={() => setCompareOpen(true)}>⇆ Compare</Button>
            <Button size="sm" onClick={() => exportSessionAsMarkdown(session)}>↓ MD</Button>
            <Button size="sm" onClick={() => exportSessionAsMarkdown(session, { anonymize: true })}
              title="Export markdown with paths, URLs, emails, UUIDs redacted">
              ↓ MD (anon)
            </Button>
            <Button size="sm" onClick={() => exportSessionAsHTML(session)}>↓ HTML</Button>
          </div>
        </div>

        <div className="grid grid-cols-4 border-t border-gray-100 dark:border-gray-800 divide-x divide-gray-100 dark:divide-gray-800">
          {([
            { icon: <RiTimeLine size={15} />, label: 'Duration', value: fmtDuration(session.durationMs) },
            { icon: <RiTerminalLine size={15} />, label: 'Tool Calls', value: session.stats.toolCallCount },
            { icon: <RiChat3Line size={15} />, label: 'Turns', value: session.turns.length },
            { icon: <RiFlashlightLine size={15} />, label: 'Pace', value: fmtPace(session.durationMs, session.stats.toolCallCount) },
          ] as const).map(({ icon, label, value }) => (
            <div key={label} className="flex items-center gap-2.5 px-4 py-3">
              <span className="text-gray-400 dark:text-gray-600 shrink-0">{icon}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none">{value}</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-none">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {((session.stats.compactionEvents ?? []).length > 0 || (session.stats.overEditing?.editToReadRatio ?? 0) > 1.5) && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {(session.stats.compactionEvents ?? []).some(e => e.trigger === 'auto') && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium">
              ⚡ Auto-compacted ×{(session.stats.compactionEvents ?? []).filter(e => e.trigger === 'auto').length}
            </span>
          )}
          {(session.stats.compactionEvents ?? []).some(e => e.trigger === 'manual') && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-medium">
              /compact ×{(session.stats.compactionEvents ?? []).filter(e => e.trigger === 'manual').length}
            </span>
          )}
          {(session.stats.overEditing?.editToReadRatio ?? 0) > 1.5 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-medium">
              ⚠ Edit-heavy ({session.stats.overEditing!.editToReadRatio.toFixed(1)}× e/r)
            </span>
          )}
        </div>
      )}

      <SessionPostmortem session={session} allSessions={allSessions} />
      <RecommendationsPanel session={session} />
      <SessionTimeline session={session} />
      <ContextGrowthChart session={session} />

      <TabGroup value={detailTab} onChange={setDetailTab} variant="solid">
        <Tab value="conversation">Conversation</Tab>
        <Tab value="files" badge={filesCount}>Files changed</Tab>
      </TabGroup>

      {detailTab === 'files' && <SessionFilesView session={session} />}

      {detailTab === 'conversation' && (() => {
        let lastDate = ''
        let lastTurnTs = ''
        // Pre-sort compaction events ascending for insertion
        const sortedCompactions = [...session.stats.compactionEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        let compactionIdx = 0

        return session.turns.flatMap(turn => {
          const dateKey = new Date(turn.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          const showDate = dateKey !== lastDate
          lastDate = dateKey
          const userPartsEmpty = turn.role === 'user'
            && turn.toolCalls.length === 0
            && parseTurnContent(turn.text).length === 0

          // Inject any compaction markers that fall between lastTurnTs and this turn
          const markers: React.ReactNode[] = []
          while (compactionIdx < sortedCompactions.length) {
            const ev = sortedCompactions[compactionIdx]!
            if (ev.timestamp > turn.timestamp) break
            if (!lastTurnTs || ev.timestamp > lastTurnTs) {
              markers.push(
                <div key={`compact-${ev.timestamp}`} className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-amber-300 dark:bg-amber-600/50" />
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap">
                    ⚡ Context {ev.trigger === 'auto' ? 'auto-compacted' : 'compacted'} at {(ev.preTokens / 1000).toFixed(0)}K tokens
                  </span>
                  <div className="flex-1 h-px bg-amber-300 dark:bg-amber-600/50" />
                </div>
              )
            }
            compactionIdx++
          }
          lastTurnTs = turn.timestamp

          return [
            ...markers,
            !userPartsEmpty && showDate && (
              <div key={`date-${dateKey}`} className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                <span className="text-[11px] text-gray-400 dark:text-gray-600 font-medium px-2">{dateKey}</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              </div>
            ),
            !userPartsEmpty && <div key={turn.uuid} id={`turn-${turn.uuid}`}
              className={`flex gap-3 rounded-2xl transition-colors duration-700 ${turn.role === 'user' ? 'flex-row-reverse' : ''} ${highlightedTurnId === turn.uuid ? 'bg-yellow-100 dark:bg-yellow-400/10' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                ${turn.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                {turn.role === 'user' ? 'U' : 'C'}
              </div>
              <div className={`max-w-[85%] flex flex-col gap-2 min-w-0 ${turn.role === 'assistant' ? 'flex-1' : ''}`}>
                {recsByTurn.get(turn.uuid) && <TurnCoach recs={recsByTurn.get(turn.uuid)!} />}
                {turn.role === 'assistant' && turn.thinkingBlocks > 0 && (
                  <span
                    title={`${turn.thinkingBlocks} thinking block${turn.thinkingBlocks === 1 ? '' : 's'} — Anthropic bills these tokens but they are not reported in usage.output_tokens`}
                    className="inline-flex self-start items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 font-medium cursor-help">
                    🧠 ×{turn.thinkingBlocks}
                  </span>
                )}
                {turn.text && <TurnBody text={turn.text} role={turn.role} timestamp={turn.timestamp} />}

                {turn.toolCalls.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {turn.toolCalls.map(tc => {
                      const isEdit = tc.name === 'Edit' && 'old_string' in tc.input
                      const summary = isEdit
                        ? (tc.input['file_path'] as string | undefined ?? '').split('/').pop() ?? ''
                        : Object.values(tc.input)[0]?.toString().slice(0, 60) ?? ''
                      return (
                        <div key={tc.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                          <button onClick={() => toggleTool(tc.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                            <span className={`text-xs px-2 py-0.5 rounded font-mono ${toolColor(tc.name)}`}>{tc.name}</span>
                            <span className="text-xs text-gray-500 truncate flex-1">{summary}</span>
                            <span className="text-gray-500 dark:text-gray-600 text-xs">{expandedTools.has(tc.id) ? '▾' : '▸'}</span>
                          </button>
                          {expandedTools.has(tc.id) && (
                            <div className="px-3 pb-3 flex flex-col gap-2">
                              {isEdit
                                ? <EditDiffView input={tc.input} />
                                : <pre className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(tc.input, null, 2)}
                                </pre>
                              }
                              {tc.result && (
                                <pre className="text-xs text-gray-500 bg-white dark:bg-gray-950 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                                  {tc.result}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>,
          ].filter(Boolean)
        })
      })()}

      {compareOpen && (
        <SessionCompareModal
          sessions={allSessions}
          initialSession={session}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  )
}

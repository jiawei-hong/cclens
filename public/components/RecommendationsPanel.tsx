import React, { useMemo, useState } from 'react'
import { RiLightbulbFlashLine, RiArrowDownSLine } from 'react-icons/ri'
import type { Session } from '../../src/types'
import {
  sessionRecommendations,
  type Recommendation,
  type RecCategory,
  type RecSeverity,
  type Savings,
} from '../../src/recommendations'
import { fmtUSD, fmtTokenCount } from '../lib/format'
import { Card, Badge, focusRing } from '../lib/ds'
import type { AccentTone } from '../lib/ds/tokens'

// ── Visual tokens ─────────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<RecSeverity, AccentTone> = {
  high:   'danger',
  medium: 'warning',
  low:    'neutral',
}

const CATEGORY_LABEL: Record<RecCategory, string> = {
  cost:     'Cost',
  context:  'Context',
  skill:    'Skill',
  workflow: 'Workflow',
}

const CATEGORY_TONE: Record<RecCategory, AccentTone> = {
  cost:     'success',
  context:  'primary',
  skill:    'warning',
  workflow: 'neutral',
}

const CATEGORY_ORDER: RecCategory[] = ['cost', 'context', 'workflow', 'skill']

// ── Savings badge ────────────────────────────────────────────────────────────

function SavingsBadge({ s }: { s: Savings | undefined }) {
  if (!s) return null
  let label: string
  let tone: AccentTone = 'success'
  if (s.kind === 'usd') {
    label = `save ${fmtUSD(s.amount)}`
  } else if (s.kind === 'tokens') {
    label = `${fmtTokenCount(s.amount)} tokens`
    tone = 'primary'
  } else if (s.kind === 'pctContext') {
    label = `${Math.round(s.amount * 100)}% of context`
    tone = 'warning'
  } else {
    label = `${s.amount}× occurrences`
    tone = 'neutral'
  }
  return (
    <Badge tone={tone} size="sm" className="shrink-0">{label}</Badge>
  )
}

// ── Single recommendation row ────────────────────────────────────────────────

function RecRow({ rec, onJumpToTurn }: { rec: Recommendation; onJumpToTurn: (turnUuid: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge tone={SEVERITY_TONE[rec.severity]} size="sm">{rec.severity}</Badge>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{rec.title}</span>
        </div>
        <SavingsBadge s={rec.savings} />
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{rec.evidence}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
        <span className="font-medium text-gray-600 dark:text-gray-400">Try: </span>{rec.actionHint}
      </p>
      {rec.turnUuids && rec.turnUuids.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-600">Jump to</span>
          {rec.turnUuids.map((uuid, i) => (
            <button
              key={uuid}
              onClick={() => onJumpToTurn(uuid)}
              className={`text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-mono ${focusRing}`}
            >
              turn {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function RecommendationsPanel({ session }: { session: Session }) {
  const { recommendations, totalSavingsUSD } = useMemo(() => sessionRecommendations(session), [session])
  const [collapsed, setCollapsed] = useState(false)

  if (recommendations.length === 0) return null

  const grouped: Record<RecCategory, Recommendation[]> = { cost: [], context: [], workflow: [], skill: [] }
  for (const r of recommendations) grouped[r.category].push(r)

  const jumpToTurn = (turnUuid: string) => {
    const el = document.getElementById(`turn-${turnUuid}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-3 text-left ${focusRing}`}
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-amber-500 dark:text-amber-400 shrink-0"><RiLightbulbFlashLine size={16} /></span>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Recommendations
          </h3>
          <Badge tone="neutral" size="sm">{recommendations.length}</Badge>
          {totalSavingsUSD > 0.01 && (
            <Badge tone="success" size="sm">save ~{fmtUSD(totalSavingsUSD)}</Badge>
          )}
        </div>
        <span className={`text-gray-400 dark:text-gray-600 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}>
          <RiArrowDownSLine size={16} />
        </span>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-4 px-5 pb-4 border-t border-gray-100 dark:border-gray-800 pt-4">
          {CATEGORY_ORDER.map(cat => {
            const items = grouped[cat]
            if (items.length === 0) return null
            return (
              <section key={cat} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={CATEGORY_TONE[cat]} size="sm">{CATEGORY_LABEL[cat]}</Badge>
                  <span className="text-[10px] text-gray-400 dark:text-gray-600">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map(r => <RecRow key={r.id} rec={r} onJumpToTurn={jumpToTurn} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}

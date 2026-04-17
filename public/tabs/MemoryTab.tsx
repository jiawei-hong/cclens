import React, { useState } from 'react'
import type { MemoryEntry, MemoryEntryType } from '../../src/types'
import { MarkdownText } from '../lib/ui'

const MEMORY_TYPE_ORDER: MemoryEntryType[] = ['user', 'feedback', 'project', 'reference', 'other']

const MEMORY_TYPE_BADGE: Record<MemoryEntryType, string> = {
  user:      'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  feedback:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  project:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  reference: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  other:     'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
}

const MEMORY_TYPE_LABEL: Record<MemoryEntryType, string> = {
  user:      'User',
  feedback:  'Feedback',
  project:   'Project',
  reference: 'Reference',
  other:     'Other',
}

function MemoryFilterBtn({ label, count, active, onClick, accent }: { label: string; count: number; active: boolean; onClick: () => void; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
        active
          ? accent ?? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      <span className={`text-[10px] tabular-nums ${active ? 'opacity-80' : 'text-gray-400 dark:text-gray-600'}`}>{count}</span>
    </button>
  )
}

export function MemoryTab({ memory }: { memory: MemoryEntry[] }) {
  const projects = React.useMemo(() => {
    const map = new Map<string, { slug: string; name: string; entries: MemoryEntry[] }>()
    for (const e of memory) {
      if (e.isIndex) continue  // exclude MEMORY.md from entry lists
      const g = map.get(e.projectSlug) ?? { slug: e.projectSlug, name: e.projectName, entries: [] }
      g.entries.push(e)
      map.set(e.projectSlug, g)
    }
    return [...map.values()].sort((a, b) => b.entries.length - a.entries.length)
  }, [memory])

  const [selectedSlug, setSelectedSlug] = useState<string | null>(projects[0]?.slug ?? null)
  const [typeFilter, setTypeFilter] = useState<MemoryEntryType | 'all'>('all')

  const selected = projects.find(p => p.slug === selectedSlug) ?? projects[0]

  const grouped = React.useMemo(() => {
    const groups = new Map<MemoryEntryType, MemoryEntry[]>()
    if (!selected) return groups
    for (const e of selected.entries) {
      if (typeFilter !== 'all' && e.type !== typeFilter) continue
      const arr = groups.get(e.type) ?? []
      arr.push(e)
      groups.set(e.type, arr)
    }
    return groups
  }, [selected, typeFilter])

  const typeCounts = React.useMemo(() => {
    const c: Record<MemoryEntryType, number> = { user: 0, feedback: 0, project: 0, reference: 0, other: 0 }
    if (!selected) return c
    for (const e of selected.entries) c[e.type]++
    return c
  }, [selected])

  if (projects.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No Claude Code memory files found in the selected folder.</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">Memory lives at <code className="font-mono text-[11px]">~/.claude/projects/&lt;project&gt;/memory/*.md</code> — pick that parent folder to surface it here.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-5">
      {/* Project list */}
      <aside className="w-64 shrink-0">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-3 sticky top-6">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide px-2 pt-1 pb-2">Projects</h3>
          <div className="flex flex-col gap-0.5">
            {projects.map(p => (
              <button
                key={p.slug}
                onClick={() => { setSelectedSlug(p.slug); setTypeFilter('all') }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                  selected?.slug === p.slug
                    ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <span className="text-xs font-medium truncate flex-1" title={p.slug}>{p.name}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums">{p.entries.length}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Entry list */}
      <section className="flex-1 min-w-0 flex flex-col gap-4">
        {selected && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selected.name}</h2>
              <span className="text-xs text-gray-400 dark:text-gray-600 font-mono" title={selected.slug}>{selected.slug}</span>
              <span className="text-xs text-gray-500 dark:text-gray-500 ml-auto">{selected.entries.length} entries</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <MemoryFilterBtn label="All" count={selected.entries.length} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {MEMORY_TYPE_ORDER.map(t => {
                const c = typeCounts[t]
                if (c === 0) return null
                return (
                  <MemoryFilterBtn
                    key={t}
                    label={MEMORY_TYPE_LABEL[t]}
                    count={c}
                    active={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    accent={MEMORY_TYPE_BADGE[t]}
                  />
                )
              })}
            </div>

            <div className="flex flex-col gap-3">
              {MEMORY_TYPE_ORDER.flatMap(t => grouped.get(t) ?? []).map(e => (
                <article key={e.projectSlug + '/' + e.fileName} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl p-5">
                  <header className="flex items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{e.name ?? e.fileName}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${MEMORY_TYPE_BADGE[e.type]}`}>
                          {MEMORY_TYPE_LABEL[e.type]}
                        </span>
                      </div>
                      {e.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">{e.description}</p>
                      )}
                      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1 font-mono">{e.fileName}</p>
                    </div>
                  </header>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <MarkdownText>{e.body}</MarkdownText>
                  </div>
                </article>
              ))}
              {selected.entries.filter(e => typeFilter === 'all' || e.type === typeFilter).length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-600 text-center py-8">No entries in this category.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

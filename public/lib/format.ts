// Display formatters shared across all UI components.
// Separated from the analyzer because these are UI concerns (locale, short labels).

export function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.round((ms % 3_600_000) / 60_000)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(ms / 86_400_000)
  const h = Math.round((ms % 86_400_000) / 3_600_000)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

export function fmtPace(durationMs: number, toolCallCount: number): string {
  if (durationMs < 30_000 || toolCallCount === 0) return '—'
  const perMin = toolCallCount / (durationMs / 60_000)
  return `${perMin.toFixed(1)}/min`
}

export function fmtToolDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function fmtTokenCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

export function fmtUSD(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`
  if (n >= 10)   return `$${n.toFixed(1)}`
  if (n >= 0.01) return `$${n.toFixed(2)}`
  if (n > 0)     return `<$0.01`
  return `$0`
}

export function fmtChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

// Rough estimate for char-based heuristics (e.g. context-waste calculations).
// 1 token ≈ 4 chars — the standard rough ratio for English text.
export function fmtTokensFromChars(chars: number): string {
  return fmtChars(Math.round(chars / 4))
}

import { describe, it, expect } from 'bun:test'
import {
  priceFor,
  costOfUsage,
  classifySession,
  bashAntiPatterns,
  contextWindowHotspots,
  costByTaskType,
  modelVersionLabel,
} from '../src/analyzer'
import type { Session } from '../src/types'

function makeSession(overrides: Partial<Session> & { id: string; project?: string }): Session {
  return {
    id: overrides.id,
    project: overrides.project ?? 'p',
    projectPath: '/p',
    startedAt: '2026-04-01T00:00:00Z',
    endedAt: '2026-04-01T00:10:00Z',
    durationMs: 600_000,
    turns: overrides.turns ?? [],
    stats: {
      userTurns: 1,
      assistantTurns: 1,
      toolCallCount: 0,
      toolBreakdown: {},
      totalTextLength: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
      modelUsage: {},
      peakContextTokens: 0,
      contextLimit: 200_000,
      ...(overrides.stats ?? {}),
    },
  }
}

describe('priceFor', () => {
  it('applies new Opus pricing for 4.5+', () => {
    expect(priceFor('claude-opus-4-7')).toEqual({ input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.5 })
    expect(priceFor('claude-opus-4-6')).toEqual({ input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.5 })
    expect(priceFor('claude-opus-4-5')).toEqual({ input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.5 })
  })

  it('treats [1m] context tag as standard pricing (no surcharge)', () => {
    // Opus 4.5+ includes 1M context at standard rates.
    expect(priceFor('claude-opus-4-7[1m]')).toEqual(priceFor('claude-opus-4-7'))
  })

  it('keeps legacy Opus pricing for 4 / 4.1', () => {
    expect(priceFor('claude-opus-4-1')).toEqual({ input: 15, output: 75, cacheCreate: 18.75, cacheRead: 1.5 })
    expect(priceFor('claude-opus-4-0')).toEqual({ input: 15, output: 75, cacheCreate: 18.75, cacheRead: 1.5 })
  })

  it('returns new Haiku pricing for 4.5+ and legacy for 3.5', () => {
    expect(priceFor('claude-haiku-4-5')).toEqual({ input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 })
    expect(priceFor('claude-haiku-3-5')).toEqual({ input: 0.8, output: 4, cacheCreate: 1.0, cacheRead: 0.08 })
  })

  it('returns Sonnet pricing regardless of version', () => {
    expect(priceFor('claude-sonnet-4-6')).toEqual({ input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 })
    expect(priceFor('claude-sonnet-3-7')).toEqual({ input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 })
  })

  it('falls back to Sonnet pricing for unknown models', () => {
    expect(priceFor('claude-mystery-99')).toEqual({ input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 })
  })
})

describe('costOfUsage', () => {
  it('computes Opus 4.7 cost correctly', () => {
    const usage = { inputTokens: 10_000, outputTokens: 5_000, cacheCreateTokens: 2_000, cacheReadTokens: 8_000 }
    // 10k × $5 + 5k × $25 + 2k × $6.25 + 8k × $0.5 = 50 + 125 + 12.5 + 4 = 191.5 µUSD/1M? No —
    // per-MTok, so divide by 1_000_000:
    // 10000*5/1e6 = 0.05; 5000*25/1e6 = 0.125; 2000*6.25/1e6 = 0.0125; 8000*0.5/1e6 = 0.004
    // total = 0.1915
    expect(costOfUsage(usage, 'claude-opus-4-7')).toBeCloseTo(0.1915, 5)
  })

  it('Opus 4.7 is exactly 3× cheaper than Opus 4.1 for pure input/output', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreateTokens: 0, cacheReadTokens: 0 }
    expect(costOfUsage(u, 'claude-opus-4-1') / costOfUsage(u, 'claude-opus-4-7')).toBeCloseTo(3, 5)
  })
})

describe('modelVersionLabel', () => {
  it('extracts version digits', () => {
    expect(modelVersionLabel('claude-opus-4-7')).toBe('opus 4.7')
    expect(modelVersionLabel('claude-sonnet-4-6-20260101')).toBe('sonnet 4.6')
    expect(modelVersionLabel('claude-opus-4-7[1m]')).toBe('opus 4.7')
  })
})

describe('classifySession', () => {
  const mk = (tb: Record<string, number>) => makeSession({
    id: 's',
    stats: {
      userTurns: 1, assistantTurns: 1,
      toolCallCount: Object.values(tb).reduce((s, n) => s + n, 0),
      toolBreakdown: tb,
      totalTextLength: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
      modelUsage: {},
      peakContextTokens: 0,
      contextLimit: 200_000,
    },
  })

  it('flags fewer than 3 tool calls as conversation', () => {
    expect(classifySession(mk({ Read: 2 }))).toBe('conversation')
  })

  it('flags web-heavy sessions as research', () => {
    expect(classifySession(mk({ WebSearch: 5, Read: 1 }))).toBe('research')
  })

  it('flags Bash + Read as debugging', () => {
    expect(classifySession(mk({ Bash: 10, Read: 5, Grep: 2 }))).toBe('debugging')
  })

  it('flags edit-heavy sessions as coding', () => {
    expect(classifySession(mk({ Edit: 8, Write: 2, Read: 1, Bash: 1 }))).toBe('coding')
  })
})

describe('bashAntiPatterns', () => {
  it('detects grep / find / cat calls in Bash tool inputs', () => {
    const s = makeSession({
      id: 's',
      turns: [{
        uuid: 't1', role: 'assistant', timestamp: '2026-04-01T00:00:00Z',
        text: '', thinkingBlocks: 0,
        toolCalls: [
          { id: '1', name: 'Bash', input: { command: 'grep foo src/' }, result: 'x'.repeat(100) },
          { id: '2', name: 'Bash', input: { command: 'cat file.ts' }, result: 'y'.repeat(200) },
          { id: '3', name: 'Bash', input: { command: 'npm test' }, result: 'z' },
        ],
      }],
    })
    const rows = bashAntiPatterns([s])
    const grep = rows.find(r => r.id === 'grep')
    const cat  = rows.find(r => r.id === 'cat')
    expect(grep?.count).toBe(1)
    expect(cat?.count).toBe(1)
    // npm test should not flag
    expect(rows.find(r => r.id === 'ls')).toBeUndefined()
    expect(cat?.totalResultChars).toBe(200)
  })
})

describe('contextWindowHotspots', () => {
  it('sorts sessions by % of limit and flags near-compact', () => {
    const sessions = [
      makeSession({ id: 'low',  stats: statsWithPeak(50_000, 200_000) }),
      makeSession({ id: 'high', stats: statsWithPeak(185_000, 200_000) }),  // 92.5%
      makeSession({ id: '1m',   stats: statsWithPeak(800_000, 1_000_000) }), // 80%
    ]
    const out = contextWindowHotspots(sessions, 10)
    expect(out.rows[0]!.sessionId).toBe('high')
    expect(out.rows[1]!.sessionId).toBe('1m')
    expect(out.rows[2]!.sessionId).toBe('low')
    expect(out.nearCompactCount).toBe(1)
  })

  it('excludes sessions with zero peak tokens', () => {
    const sessions = [makeSession({ id: 's', stats: statsWithPeak(0, 200_000) })]
    const out = contextWindowHotspots(sessions, 10)
    expect(out.rows.length).toBe(0)
  })
})

describe('costByTaskType', () => {
  it('groups spend by session classification with avg and share', () => {
    // Coding session on Opus 4.7: 1M input + 1M output ≈ $5 + $25 = $30
    const coding = makeSession({
      id: 'c1',
      stats: {
        userTurns: 1, assistantTurns: 1, toolCallCount: 10,
        toolBreakdown: { Edit: 6, Write: 2, Read: 1, Bash: 1 },
        totalTextLength: 0,
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreateTokens: 0, cacheReadTokens: 0 },
        modelUsage: { 'claude-opus-4-7': { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreateTokens: 0, cacheReadTokens: 0 } },
        peakContextTokens: 0, contextLimit: 200_000,
      },
    })
    // Research session on Sonnet 4.6: 1M input + 1M output ≈ $3 + $15 = $18
    const research = makeSession({
      id: 'r1',
      stats: {
        userTurns: 1, assistantTurns: 1, toolCallCount: 10,
        toolBreakdown: { WebSearch: 5, Read: 1 },
        totalTextLength: 0,
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreateTokens: 0, cacheReadTokens: 0 },
        modelUsage: { 'claude-sonnet-4-6': { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreateTokens: 0, cacheReadTokens: 0 } },
        peakContextTokens: 0, contextLimit: 200_000,
      },
    })
    const rows = costByTaskType([coding, research])
    expect(rows.length).toBe(2)
    expect(rows[0]!.type).toBe('coding')       // higher spend first
    expect(rows[0]!.totalCostUSD).toBeCloseTo(30, 5)
    expect(rows[1]!.type).toBe('research')
    expect(rows[1]!.totalCostUSD).toBeCloseTo(18, 5)
    expect(rows[0]!.share + rows[1]!.share).toBeCloseTo(1, 5)
    expect(rows[0]!.avgCostUSD).toBeCloseTo(30, 5)  // one session in bucket
  })

  it('omits task types with zero sessions', () => {
    const s = makeSession({
      id: 's',
      stats: {
        userTurns: 1, assistantTurns: 1, toolCallCount: 10,
        toolBreakdown: { Edit: 8 },
        totalTextLength: 0,
        usage: { inputTokens: 100, outputTokens: 50, cacheCreateTokens: 0, cacheReadTokens: 0 },
        modelUsage: { 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 50, cacheCreateTokens: 0, cacheReadTokens: 0 } },
        peakContextTokens: 0, contextLimit: 200_000,
      },
    })
    const rows = costByTaskType([s])
    expect(rows.length).toBe(1)
    expect(rows[0]!.type).toBe('coding')
    expect(rows[0]!.share).toBe(1)
  })
})

function statsWithPeak(peak: number, limit: number) {
  return {
    userTurns: 0, assistantTurns: 0,
    toolCallCount: 0, toolBreakdown: {}, totalTextLength: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 },
    modelUsage: {},
    peakContextTokens: peak,
    contextLimit: limit,
  }
}

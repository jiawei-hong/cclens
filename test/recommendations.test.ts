import { describe, it, expect } from 'bun:test'
import { sessionRecommendations, aggregateRecommendations } from '../src/recommendations'
import type { Session, Turn, ToolCall, SessionStats } from '../src/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<Turn> & { uuid: string; role: 'user' | 'assistant' }): Turn {
  return {
    uuid: overrides.uuid,
    role: overrides.role,
    timestamp: overrides.timestamp ?? '2026-04-01T00:00:00Z',
    text: overrides.text ?? '',
    toolCalls: overrides.toolCalls ?? [],
    thinkingBlocks: overrides.thinkingBlocks ?? 0,
  }
}

function makeToolCall(overrides: Partial<ToolCall> & { name: string }): ToolCall {
  return {
    id: overrides.id ?? `tc-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name,
    input: overrides.input ?? {},
    result: overrides.result,
    isError: overrides.isError,
    durationMs: overrides.durationMs,
  }
}

type SessionOverrides = Omit<Partial<Session>, 'stats'> & { id: string; stats?: Partial<SessionStats> }

function makeSession(overrides: SessionOverrides): Session {
  return {
    id: overrides.id,
    project: overrides.project ?? 'p',
    projectPath: overrides.projectPath ?? '/p',
    startedAt: overrides.startedAt ?? '2026-04-01T00:00:00Z',
    endedAt: overrides.endedAt ?? '2026-04-01T00:10:00Z',
    durationMs: overrides.durationMs ?? 10 * 60_000,
    turns: overrides.turns ?? [],
    stats: {
      userTurns: 1,
      assistantTurns: 1,
      toolCallCount: 0,
      toolBreakdown: {},
      totalTextLength: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheCreate1hTokens: 0, cacheReadTokens: 0 },
      modelUsage: {},
      peakContextTokens: 0,
      contextLimit: 200_000,
      contextSeries: [],
      totalThinkingBlocks: 0,
      compactionEvents: [],
      overEditing: { editWithoutReadCount: 0, rapidIterationFiles: 0, editToReadRatio: 0 },
      ...(overrides.stats ?? {}),
    },
  }
}

// ── Rule: wrong-model-for-task ────────────────────────────────────────────────

describe('wrong-model-for-task', () => {
  it('fires when Opus runs an exploration-flavored session', () => {
    // Tool mix classifies as "exploration" (Read/Grep/Glob > 40%)
    const turns: Turn[] = []
    for (let i = 0; i < 12; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Read', input: { file_path: `/p/f${i}.ts` } })],
      }))
    }
    const s = makeSession({
      id: 's1',
      turns,
      stats: {
        toolBreakdown: { Read: 12 },
        toolCallCount: 12,
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 200_000, outputTokens: 20_000,
            cacheCreateTokens: 0, cacheCreate1hTokens: 0, cacheReadTokens: 0,
          },
        },
      },
    })
    const { recommendations, totalSavingsUSD } = sessionRecommendations(s)
    const rec = recommendations.find(r => r.id === 'wrong-model-for-task')
    expect(rec).toBeDefined()
    expect(rec!.category).toBe('cost')
    expect(rec!.savings?.kind).toBe('usd')
    expect(totalSavingsUSD).toBeGreaterThan(0)
  })

  it('does not fire when task type is coding', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 10; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Edit', input: { file_path: '/p/a.ts' } })],
      }))
    }
    const s = makeSession({
      id: 's1',
      turns,
      stats: {
        toolBreakdown: { Edit: 10 },
        toolCallCount: 10,
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 200_000, outputTokens: 20_000,
            cacheCreateTokens: 0, cacheCreate1hTokens: 0, cacheReadTokens: 0,
          },
        },
      },
    })
    const { recommendations } = sessionRecommendations(s)
    expect(recommendations.find(r => r.id === 'wrong-model-for-task')).toBeUndefined()
  })
})

// ── Rule: 1h-cache-misused ────────────────────────────────────────────────────

describe('1h-cache-misused', () => {
  it('fires when 1h TTL tokens were used on a short session', () => {
    const s = makeSession({
      id: 's1',
      durationMs: 10 * 60_000,
      stats: {
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 10_000, outputTokens: 1_000,
            cacheCreateTokens: 100_000, cacheCreate1hTokens: 100_000, cacheReadTokens: 0,
          },
        },
        usage: {
          inputTokens: 10_000, outputTokens: 1_000,
          cacheCreateTokens: 100_000, cacheCreate1hTokens: 100_000, cacheReadTokens: 0,
        },
      },
    })
    const { recommendations } = sessionRecommendations(s)
    const rec = recommendations.find(r => r.id === '1h-cache-misused')
    expect(rec).toBeDefined()
    expect(rec!.savings?.kind).toBe('usd')
    // 100k tokens × (6 - 3.75) / 1M = 0.225
    expect((rec!.savings as { amount: number }).amount).toBeCloseTo(0.225, 2)
  })

  it('does not fire on long sessions', () => {
    const s = makeSession({
      id: 's1',
      durationMs: 2 * 60 * 60_000,  // 2h
      stats: {
        usage: {
          inputTokens: 10_000, outputTokens: 1_000,
          cacheCreateTokens: 100_000, cacheCreate1hTokens: 100_000, cacheReadTokens: 0,
        },
      },
    })
    const { recommendations } = sessionRecommendations(s)
    expect(recommendations.find(r => r.id === '1h-cache-misused')).toBeUndefined()
  })
})

// ── Rule: peak-near-compact ───────────────────────────────────────────────────

describe('peak-near-compact', () => {
  it('fires when peak context exceeds 80% of limit', () => {
    const s = makeSession({
      id: 's1',
      stats: { peakContextTokens: 180_000, contextLimit: 200_000 },
    })
    const { recommendations } = sessionRecommendations(s)
    const rec = recommendations.find(r => r.id === 'peak-near-compact')
    expect(rec).toBeDefined()
    expect(rec!.severity).toBe('medium')
    expect(rec!.savings?.kind).toBe('pctContext')
  })

  it('marks high severity at 95%+', () => {
    const s = makeSession({
      id: 's1',
      stats: { peakContextTokens: 195_000, contextLimit: 200_000 },
    })
    const rec = sessionRecommendations(s).recommendations.find(r => r.id === 'peak-near-compact')
    expect(rec!.severity).toBe('high')
  })

  it('does not fire below 80%', () => {
    const s = makeSession({
      id: 's1',
      stats: { peakContextTokens: 150_000, contextLimit: 200_000 },
    })
    expect(sessionRecommendations(s).recommendations.find(r => r.id === 'peak-near-compact')).toBeUndefined()
  })
})

// ── Rule: redundant-reads ─────────────────────────────────────────────────────

describe('redundant-reads', () => {
  it('fires when the same file is read 3+ times', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 4; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Read', input: { file_path: '/p/same.ts' } })],
      }))
    }
    const s = makeSession({ id: 's1', turns })
    const rec = sessionRecommendations(s).recommendations.find(r => r.id === 'redundant-reads')
    expect(rec).toBeDefined()
    expect(rec!.savings?.amount).toBe(3)  // 4 reads → 3 redundant
  })

  it('does not fire when each file is read once', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 4; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Read', input: { file_path: `/p/f${i}.ts` } })],
      }))
    }
    const s = makeSession({ id: 's1', turns })
    expect(sessionRecommendations(s).recommendations.find(r => r.id === 'redundant-reads')).toBeUndefined()
  })
})

// ── Rule: bash-antipatterns ───────────────────────────────────────────────────

describe('bash-antipatterns', () => {
  it('fires when enough Bash calls shadow native tools', () => {
    const turns: Turn[] = []
    const commands = ['grep -r foo .', 'cat file.txt', 'find . -name "*.ts"', 'ls -la']
    for (let i = 0; i < commands.length; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: commands[i] } })],
      }))
    }
    const rec = sessionRecommendations(makeSession({ id: 's1', turns }))
      .recommendations.find(r => r.id === 'bash-antipatterns')
    expect(rec).toBeDefined()
    expect(rec!.savings?.amount).toBe(4)
  })

  it('ignores non-matching Bash commands', () => {
    const turns: Turn[] = [
      makeTurn({ uuid: 't1', role: 'assistant', toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'git status' } })] }),
      makeTurn({ uuid: 't2', role: 'assistant', toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'npm test' } })] }),
    ]
    expect(sessionRecommendations(makeSession({ id: 's1', turns })).recommendations.find(r => r.id === 'bash-antipatterns')).toBeUndefined()
  })
})

// ── Rule: thrashing ───────────────────────────────────────────────────────────

describe('thrashing', () => {
  it('fires when one target is hit 4+ times with the same tool', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 5; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'npm run build' } })],
      }))
    }
    const rec = sessionRecommendations(makeSession({ id: 's1', turns }))
      .recommendations.find(r => r.id === 'thrashing')
    expect(rec).toBeDefined()
    expect(rec!.severity).toBe('medium')
  })
})

// ── Rule: high-error-rate ─────────────────────────────────────────────────────

describe('high-error-rate', () => {
  it('fires when >20% of tool calls fail', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 10; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: `cmd${i}` }, isError: i < 4 })],
      }))
    }
    const rec = sessionRecommendations(makeSession({ id: 's1', turns }))
      .recommendations.find(r => r.id === 'high-error-rate')
    expect(rec).toBeDefined()
    expect(rec!.severity).toBe('high')  // 40%
  })
})

// ── Rule: skill-gap-commit ────────────────────────────────────────────────────

describe('skill-gap-commit', () => {
  it('fires when there are repeated manual git commits without /commit', () => {
    const turns: Turn[] = []
    for (let i = 0; i < 3; i++) {
      turns.push(makeTurn({
        uuid: `t${i}`, role: 'assistant',
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'git commit -m "wip"' } })],
      }))
    }
    const rec = sessionRecommendations(makeSession({ id: 's1', turns }))
      .recommendations.find(r => r.id === 'skill-gap-commit')
    expect(rec).toBeDefined()
    expect(rec!.category).toBe('skill')
  })

  it('does not fire when /commit was used in-session', () => {
    const turns: Turn[] = [
      makeTurn({ uuid: 'u1', role: 'user', text: '<command-name>/commit</command-name>' }),
      makeTurn({ uuid: 't1', role: 'assistant', toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'git commit -m "x"' } })] }),
      makeTurn({ uuid: 't2', role: 'assistant', toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'git commit -m "y"' } })] }),
    ]
    expect(sessionRecommendations(makeSession({ id: 's1', turns })).recommendations.find(r => r.id === 'skill-gap-commit')).toBeUndefined()
  })
})

// ── Aggregate ─────────────────────────────────────────────────────────────────

describe('aggregateRecommendations', () => {
  it('sums USD savings across sessions and ranks by rule', () => {
    // Session A: 1h-cache-misused → concrete $ savings
    const sA = makeSession({
      id: 'a',
      durationMs: 5 * 60_000,
      stats: {
        usage: {
          inputTokens: 10_000, outputTokens: 1_000,
          cacheCreateTokens: 200_000, cacheCreate1hTokens: 200_000, cacheReadTokens: 0,
        },
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 10_000, outputTokens: 1_000,
            cacheCreateTokens: 200_000, cacheCreate1hTokens: 200_000, cacheReadTokens: 0,
          },
        },
      },
    })
    // Session B: peak-near-compact (no $ savings, just context %)
    const sB = makeSession({
      id: 'b',
      stats: { peakContextTokens: 190_000, contextLimit: 200_000 },
    })
    // Session C: no triggers
    const sC = makeSession({ id: 'c' })

    const agg = aggregateRecommendations([sA, sB, sC])
    expect(agg.sessionCount).toBe(2)
    expect(agg.totalSavingsUSD).toBeGreaterThan(0)
    expect(agg.byCategory.cost.count).toBeGreaterThanOrEqual(1)
    expect(agg.byCategory.context.count).toBeGreaterThanOrEqual(1)
    expect(agg.topSessions[0]?.sessionId).toBe('a')  // session with USD savings ranks first
    expect(agg.byRule.length).toBeGreaterThanOrEqual(2)
  })

  it('handles no sessions', () => {
    const agg = aggregateRecommendations([])
    expect(agg.sessionCount).toBe(0)
    expect(agg.totalSavingsUSD).toBe(0)
    expect(agg.byRule).toEqual([])
    expect(agg.topSessions).toEqual([])
  })
})

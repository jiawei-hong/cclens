import { describe, it, expect } from 'bun:test'
import { parseRawJsonl, attachSubagents, subagentParentId } from '../src/parseCore'
import type { Session } from '../src/types'

// ── Fixture helpers ───────────────────────────────────────────────────────────

let uuidCounter = 0
const nextUuid = () => `u${++uuidCounter}`

type EntryOverrides = Record<string, unknown>

function userEntry(text: string, over: EntryOverrides = {}) {
  return {
    uuid: nextUuid(), parentUuid: null, type: 'user',
    timestamp: '2026-07-20T10:00:00.000Z', sessionId: 's1', cwd: '/p/demo',
    message: { role: 'user', content: text },
    ...over,
  }
}

function assistantEntry(msgId: string, over: EntryOverrides = {}, usageOver: Record<string, unknown> = {}) {
  return {
    uuid: nextUuid(), parentUuid: null, type: 'assistant',
    timestamp: '2026-07-20T10:00:05.000Z', sessionId: 's1', cwd: '/p/demo',
    message: {
      role: 'assistant', id: msgId, model: 'claude-opus-5',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 1000, output_tokens: 100,
        cache_creation_input_tokens: 200, cache_read_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 },
        speed: 'standard',
        ...usageOver,
      },
    },
    ...over,
  }
}

function toJsonl(entries: unknown[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n')
}

function parse(entries: unknown[]): Session {
  const s = parseRawJsonl(toJsonl(entries), 's1', '/p/demo')
  expect(s).not.toBeNull()
  return s!
}

// ── Usage dedupe ──────────────────────────────────────────────────────────────

describe('parseRawJsonl usage dedupe', () => {
  it('counts usage once when multiple assistant entries share a message.id', () => {
    const s = parse([
      userEntry('hello'),
      assistantEntry('msg_1'),           // text block entry
      assistantEntry('msg_1'),           // tool_use block entry — same API response
      assistantEntry('msg_1'),           // third split entry
      assistantEntry('msg_2'),           // a second, real API response
    ])
    expect(s.stats.usage.inputTokens).toBe(2000)
    expect(s.stats.usage.outputTokens).toBe(200)
    expect(s.stats.usage.cacheReadTokens).toBe(10_000)
    expect(s.stats.apiTurns).toBe(2)
    expect(s.stats.contextSeries.length).toBe(2)
    // Turn list still keeps every entry (content differs per entry)
    expect(s.stats.assistantTurns).toBe(4)
  })

  it('does not dedupe entries lacking message.id (old-format files)', () => {
    const noId = (over: EntryOverrides = {}) => {
      const e = assistantEntry('ignored', over)
      delete (e.message as Record<string, unknown>)['id']
      return e
    }
    const s = parse([userEntry('hi'), noId(), noId()])
    expect(s.stats.usage.inputTokens).toBe(2000)
    expect(s.stats.apiTurns).toBe(2)
  })
})

// ── Fast mode ─────────────────────────────────────────────────────────────────

describe('fast-mode usage bucketing', () => {
  it('keys fast-speed usage as model[fast]', () => {
    const s = parse([
      userEntry('hi'),
      assistantEntry('msg_1', {}, { speed: 'fast' }),
      assistantEntry('msg_2', {}, { speed: 'standard' }),
    ])
    expect(Object.keys(s.stats.modelUsage).sort()).toEqual(['claude-opus-5', 'claude-opus-5[fast]'])
    expect(s.stats.modelUsage['claude-opus-5[fast]']!.inputTokens).toBe(1000)
  })
})

// ── Context limit ─────────────────────────────────────────────────────────────

describe('contextLimit detection', () => {
  it('defaults to 200K', () => {
    const s = parse([userEntry('hi'), assistantEntry('msg_1')])
    expect(s.stats.contextLimit).toBe(200_000)
  })

  it('escalates to 1M when observed context exceeds 200K (no [1m] tag in JSONL)', () => {
    const s = parse([
      userEntry('hi'),
      assistantEntry('msg_1', {}, { input_tokens: 50_000, cache_read_input_tokens: 400_000 }),
    ])
    expect(s.stats.contextLimit).toBe(1_000_000)
  })
})

// ── New field capture ─────────────────────────────────────────────────────────

describe('new field capture', () => {
  it('captures ai-title, pr-link, effort, interrupts, tool denials, api errors', () => {
    const s = parse([
      { type: 'ai-title', aiTitle: 'Fix pricing tables', sessionId: 's1' },
      { type: 'pr-link', sessionId: 's1', prNumber: 42, prUrl: 'https://github.com/o/r/pull/42', prRepository: 'o/r', timestamp: '2026-07-20T10:01:00.000Z' },
      userEntry('do the thing', { promptSource: 'typed' }),
      assistantEntry('msg_1', { effort: 'xhigh' }),
      userEntry('[Request interrupted by user for tool use]', { interruptedMessageId: 'msg_1' }),
      userEntry('denied', { toolDenialKind: 'user-rejected' }),
      assistantEntry('msg_2', { effort: 'xhigh', isApiErrorMessage: true }),
      {
        uuid: nextUuid(), parentUuid: null, type: 'system', subtype: 'turn_duration',
        timestamp: '2026-07-20T10:02:00.000Z', sessionId: 's1', durationMs: 12_000, messageCount: 3,
      },
      {
        uuid: nextUuid(), parentUuid: null, type: 'system', subtype: 'model_refusal_fallback',
        timestamp: '2026-07-20T10:02:01.000Z', sessionId: 's1',
      },
    ])
    expect(s.title).toBe('Fix pricing tables')
    expect(s.prLinks).toEqual([{ number: 42, url: 'https://github.com/o/r/pull/42', repository: 'o/r' }])
    expect(s.stats.effortCounts).toEqual({ xhigh: 2 })
    expect(s.stats.interruptCount).toBe(1)
    expect(s.stats.toolDenialCount).toBe(1)
    expect(s.stats.apiErrorCount).toBe(1)
    expect(s.stats.apiDurationMsTotal).toBe(12_000)
    expect(s.stats.modelFallbackCount).toBe(1)
    const userTurn = s.turns.find(t => t.role === 'user' && t.promptSource === 'typed')
    expect(userTurn).toBeDefined()
    const effortTurn = s.turns.find(t => t.role === 'assistant' && t.effort === 'xhigh')
    expect(effortTurn?.model).toBe('claude-opus-5')
  })

  it('falls back to text markers for interrupts in old-format files', () => {
    const s = parse([
      userEntry('start'),
      assistantEntry('msg_1'),
      userEntry('[Request interrupted by user]'),
    ])
    expect(s.stats.interruptCount).toBe(1)
  })
})

// ── Subagent attachment ───────────────────────────────────────────────────────

describe('subagent attachment', () => {
  it('subagentParentId extracts the parent session id', () => {
    expect(subagentParentId('-Users-x-proj/abc-123/subagents/agent-a1.jsonl')).toBe('abc-123')
    expect(subagentParentId('-Users-x-proj/abc-123.jsonl')).toBeNull()
    expect(subagentParentId('abc-123/subagents/agent-a1.jsonl')).toBe('abc-123')
  })

  it('aggregates child usage into parent.subagents', () => {
    const parent = parse([userEntry('main'), assistantEntry('msg_1')])
    uuidCounter = 100
    const childEntries = [
      userEntry('sub task'),
      assistantEntry('sub_msg_1', {}, { input_tokens: 500, output_tokens: 50 }),
    ]
    const child = parseRawJsonl(toJsonl(childEntries), 'agent-a1', '/p/demo')!
    attachSubagents(parent, [child, child])
    expect(parent.subagents?.count).toBe(2)
    expect(parent.subagents?.usage.inputTokens).toBe(1000)
    expect(parent.subagents?.usage.outputTokens).toBe(100)
    expect(parent.subagents?.modelUsage['claude-opus-5']!.inputTokens).toBe(1000)
  })

  it('attachSubagents with no children leaves parent untouched', () => {
    const parent = parse([userEntry('main'), assistantEntry('msg_1')])
    attachSubagents(parent, [])
    expect(parent.subagents).toBeUndefined()
  })
})

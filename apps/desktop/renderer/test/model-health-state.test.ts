import { describe, expect, test } from 'bun:test'
import type { RpcResult } from '@codepilotx/agent-protocol'
import {
  applyModelHealthEvent,
  countModelHealthItems,
  createModelHealthState,
  filterModelHealthItems,
  invalidateModelHealth,
  replaceModelHealthItem,
  replaceModelHealthRun,
} from '../src/features/models/health/modelHealthState.js'

type Run = NonNullable<RpcResult<'model/health/read'>['run']>

const model = (providerID: string, id: string) => ({ providerID, id })

function run(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run-1',
    status: 'running',
    startedAt: 1000,
    counts: {
      total: 2,
      queued: 2,
      running: 0,
      healthy: 0,
      failed: 0,
      cancelled: 0,
    },
    excludedProviders: [],
    items: [
      { model: model('openai', 'gpt-4o'), status: 'queued' },
      { model: model('anthropic', 'claude-3-5-sonnet'), status: 'queued' },
    ],
    ...overrides,
  }
}

const event = (
  runId: string,
  patch: Partial<Parameters<typeof applyModelHealthEvent>[1]>,
) => ({
  runId,
  status: 'running' as const,
  counts: {
    total: 2,
    queued: 1,
    running: 1,
    healthy: 0,
    failed: 0,
    cancelled: 0,
  },
  ...patch,
})

describe('model health state', () => {
  test('creates an empty page-scoped state', () => {
    expect(createModelHealthState()).toEqual({
      run: null,
      reconciled: false,
      staleEventRunId: null,
    })
  })

  test('start snapshot replaces the page run as authoritative', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run())

    expect(state.reconciled).toBe(true)
    expect(state.run?.runId).toBe('run-1')
    expect(state.staleEventRunId).toBeNull()
  })

  test('ignores events from an unrelated run', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run())
    const next = applyModelHealthEvent(state, event('other-run', {
      changed: {
        model: model('openai', 'gpt-4o'),
        status: 'healthy',
        startedAt: 1000,
        completedAt: 1500,
        latencyMs: 42,
      },
    }))

    expect(next.run?.items[0]).toEqual({ model: model('openai', 'gpt-4o'), status: 'queued' })
    expect(next.staleEventRunId).toBe('other-run')
  })

  test('replaces a single item by model key and keeps provider/model order', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run())
    const next = applyModelHealthEvent(state, event('run-1', {
      changed: {
        model: model('openai', 'gpt-4o'),
        status: 'healthy',
        startedAt: 1000,
        completedAt: 1500,
        latencyMs: 42,
      },
    }))

    expect(next.run?.items.map(item => item.status)).toEqual(['healthy', 'queued'])
    expect(next.run?.counts).toEqual(event('run-1', {}).counts)
    expect(next.reconciled).toBe(false)
  })

  test('single-model retest only replaces that row and keeps counts consistent', () => {
    const completed = run({
      status: 'completed',
      completedAt: 2000,
      counts: {
        total: 2,
        queued: 0,
        running: 0,
        healthy: 1,
        failed: 1,
        cancelled: 0,
      },
      items: [
        {
          model: model('openai', 'gpt-4o'),
          status: 'failed',
          startedAt: 1000,
          completedAt: 1500,
          category: 'timeout',
          message: '请求在 15 秒内未完成',
        },
        {
          model: model('anthropic', 'claude-3-5-sonnet'),
          status: 'healthy',
          startedAt: 1000,
          completedAt: 1400,
          latencyMs: 380,
        },
      ],
    })
    const state = replaceModelHealthRun(createModelHealthState(), completed)

    const retested = replaceModelHealthItem(state, {
      model: model('openai', 'gpt-4o'),
      status: 'healthy',
      startedAt: 2100,
      completedAt: 2150,
      latencyMs: 55,
    })

    expect(retested.run?.items).toEqual([
      {
        model: model('openai', 'gpt-4o'),
        status: 'healthy',
        startedAt: 2100,
        completedAt: 2150,
        latencyMs: 55,
      },
      {
        model: model('anthropic', 'claude-3-5-sonnet'),
        status: 'healthy',
        startedAt: 1000,
        completedAt: 1400,
        latencyMs: 380,
      },
    ])
    expect(retested.run?.counts).toEqual({
      total: 2,
      queued: 0,
      running: 0,
      healthy: 2,
      failed: 0,
      cancelled: 0,
    })
    expect(retested.reconciled).toBe(false)
  })

  test('retest is a no-op for an unknown model key', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run())
    const retested = replaceModelHealthItem(state, {
      model: model('openai', 'missing'),
      status: 'healthy',
      startedAt: 2100,
      completedAt: 2150,
      latencyMs: 55,
    })

    expect(retested.run?.items).toEqual(state.run?.items)
  })

  test('counts always satisfy the queued+running+healthy+failed+cancelled invariant', () => {
    const items = run().items
    const counts = countModelHealthItems(items)

    expect(counts.total).toBe(2)
    expect(counts.queued + counts.running + counts.healthy + counts.failed + counts.cancelled)
      .toBe(counts.total)
  })

  test('invalidation clears results and prompts a fresh run', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run())
    const next = invalidateModelHealth(state)

    expect(next.run).toBeNull()
    expect(next.reconciled).toBe(false)
  })

  test('filters by query, provider and status without mutating ordering', () => {
    const state = replaceModelHealthRun(createModelHealthState(), run({
      items: [
        { model: model('openai', 'gpt-4o'), status: 'queued' },
        {
          model: model('anthropic', 'claude-3-5-sonnet'),
          status: 'failed',
          startedAt: 1000,
          completedAt: 1500,
          category: 'authentication',
          message: '凭据鉴权失败',
        },
        {
          model: model('openai', 'gpt-4o-mini'),
          status: 'healthy',
          startedAt: 1000,
          completedAt: 1400,
          latencyMs: 90,
        },
      ],
    }))

    expect(filterModelHealthItems(state.run!.items, { query: 'gpt-4o' })).toHaveLength(2)
    expect(filterModelHealthItems(state.run!.items, { providerId: 'openai' }))
      .toEqual([state.run!.items[0], state.run!.items[2]])
    expect(filterModelHealthItems(state.run!.items, { status: 'failed' }))
      .toEqual([state.run!.items[1]])
    expect(filterModelHealthItems(state.run!.items, {
      providerId: 'openai',
      status: 'healthy',
    })).toEqual([state.run!.items[2]])
  })
})

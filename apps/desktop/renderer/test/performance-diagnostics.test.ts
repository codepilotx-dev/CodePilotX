import { afterEach, describe, expect, test } from 'bun:test'
import {
  enablePerformanceDiagnostics,
  getPerformanceDiagnosticsSnapshot,
  recordCanonicalBatch,
  recordCanonicalProjection,
  recordFirstDelta,
  recordHeapSample,
  recordLongTask,
  recordReactCommit,
  recordSseEvent,
  recordTurnStarted,
  resetPerformanceDiagnostics,
  serializePerformanceDiagnosticsSnapshot,
} from '../src/features/debug/performanceDiagnosticsStore.js'

let disable: (() => void) | undefined

afterEach(() => {
  disable?.()
  disable = undefined
  resetPerformanceDiagnostics()
})

describe('performance diagnostics store', () => {
  test('recording is a no-op while diagnostics are disabled', () => {
    recordSseEvent({
      eventType: 'item/agentMessage/delta',
      scope: 'canonical',
      bytes: 42,
    })
    recordCanonicalBatch({
      eventCount: 3,
      applyMs: 4,
      projectionMs: 5,
      liveEventIds: 12,
    })

    const snapshot = getPerformanceDiagnosticsSnapshot()
    expect(snapshot.enabled).toBe(false)
    expect(snapshot.sse.byEventType).toEqual({})
    expect(snapshot.canonical.eventsPerBatch.count).toBe(0)
    expect(snapshot.canonical.liveEventIds).toBe(0)
  })

  test('collects rolling rates, distributions and current counters', () => {
    disable = enablePerformanceDiagnostics()
    resetPerformanceDiagnostics()
    const base = performance.now()

    recordSseEvent({
      eventType: 'item/agentMessage/delta',
      scope: 'canonical',
      bytes: 100,
      at: base + 10,
    })
    recordSseEvent({
      eventType: 'item/agentMessage/delta',
      scope: 'canonical',
      bytes: 300,
      at: base + 20,
    })
    recordSseEvent({
      eventType: 'provider/usage/updated',
      scope: 'provider',
      bytes: 100,
      at: base + 30,
    })
    recordCanonicalBatch({
      eventCount: 2,
      applyMs: 1,
      projectionMs: 2,
      liveEventIds: 8,
      at: base + 40,
    })
    recordCanonicalBatch({
      eventCount: 6,
      applyMs: 5,
      liveEventIds: 9,
      at: base + 50,
    })
    recordCanonicalProjection(6, base + 60)
    recordReactCommit(4, base + 70)
    recordReactCommit(12, base + 80)
    recordLongTask(55, base + 90)
    recordHeapSample({
      usedBytes: 1_000,
      totalBytes: 2_000,
      at: base + 100,
    })
    recordHeapSample({
      usedBytes: 1_250,
      totalBytes: 2_000,
      at: base + 110,
    })

    const snapshot = JSON.parse(
      serializePerformanceDiagnosticsSnapshot(),
    ) as ReturnType<typeof getPerformanceDiagnosticsSnapshot>
    expect(snapshot.sse.byEventType).toEqual({
      'item/agentMessage/delta': 2,
      'provider/usage/updated': 1,
    })
    expect(snapshot.sse.byScope).toEqual({ canonical: 2, provider: 1 })
    expect(snapshot.canonical.eventsPerBatch).toMatchObject({
      count: 2,
      p50: 2,
      p95: 6,
      max: 6,
    })
    expect(snapshot.canonical.applyMs.p95).toBe(5)
    expect(snapshot.canonical.projectionMs.p95).toBe(6)
    expect(snapshot.canonical.liveEventIds).toBe(9)
    expect(snapshot.reactCommitMs.p95).toBe(12)
    expect(snapshot.longTasks).toEqual({ count: 1, longestMs: 55 })
    expect(snapshot.heap).toEqual({
      usedBytes: 1_250,
      totalBytes: 2_000,
      usedDeltaBytes: 250,
    })
  })

  test('pairs a pending turn with only its first delta and reset clears data', () => {
    disable = enablePerformanceDiagnostics()
    resetPerformanceDiagnostics()
    const base = performance.now()

    recordTurnStarted(base)
    recordFirstDelta(base + 125)
    recordFirstDelta(base + 250)

    expect(
      JSON.parse(serializePerformanceDiagnosticsSnapshot()).firstDeltaMs,
    ).toEqual({ count: 1, p50: 125, p95: 125, max: 125 })

    resetPerformanceDiagnostics()
    expect(getPerformanceDiagnosticsSnapshot().firstDeltaMs.count).toBe(0)
  })

  test('serialized snapshots expose only aggregate diagnostic fields', () => {
    disable = enablePerformanceDiagnostics()
    resetPerformanceDiagnostics()
    recordSseEvent({
      eventType: 'item/reasoning/delta',
      scope: 'global',
      bytes: 16,
    })

    const serialized = serializePerformanceDiagnosticsSnapshot()
    expect(serialized).toContain('"byEventType"')
    expect(serialized).not.toContain('threadId')
    expect(serialized).not.toContain('sessionId')
    expect(serialized).not.toContain('content')
    expect(serialized).not.toContain('path')
  })
})

import {
  installPerformanceDiagnosticsRecorder,
  type PerformanceDiagnosticsSseScope,
} from './performanceDiagnosticsBridge.js'

export type { PerformanceDiagnosticsSseScope } from './performanceDiagnosticsBridge.js'

export type DistributionSnapshot = {
  count: number
  p50: number
  p95: number
  max: number
}

export type PerformanceDiagnosticsSnapshot = {
  enabled: boolean
  observedForMs: number
  sse: {
    eventsPerSecond: number
    bytesPerSecond: number
    byEventType: Readonly<Record<string, number>>
    byScope: Readonly<Record<string, number>>
  }
  firstDeltaMs: DistributionSnapshot
  canonical: {
    eventsPerBatch: DistributionSnapshot
    applyMs: DistributionSnapshot
    projectionMs: DistributionSnapshot
    liveEventIds: number
  }
  reactCommitMs: DistributionSnapshot
  frames: {
    fps: number
    longestFrameMs: number
    longFrames: number
    sampleCount: number
  }
  longTasks: {
    count: number
    longestMs: number
  }
  heap: {
    usedBytes: number | null
    totalBytes: number | null
    usedDeltaBytes: number | null
  }
  conversationSwitch: {
    skeletonMs: DistributionSnapshot
    canonicalReadyMs: DistributionSnapshot
    initialTurns: DistributionSnapshot
    initialItems: DistributionSnapshot
    threadReadsPerSwitch: DistributionSnapshot
    historyReadsPerSwitch: DistributionSnapshot
    workspaceRefreshesPerSwitch: DistributionSnapshot
    longTasksPerSwitch: DistributionSnapshot
  }
}

type TimedValue = {
  at: number
  value: number
}

type SseSample = {
  at: number
  bytes: number
  eventType: string
  scope: PerformanceDiagnosticsSseScope
}

type MutableState = {
  observedFrom: number
  sse: SseSample[]
  pendingTurnStarts: number[]
  firstDeltaMs: TimedValue[]
  canonicalBatchSizes: TimedValue[]
  canonicalApplyMs: TimedValue[]
  canonicalProjectionMs: TimedValue[]
  reactCommitMs: TimedValue[]
  liveEventIds: number
  frames: PerformanceDiagnosticsSnapshot['frames']
  longTasks: TimedValue[]
  heapSamples: Array<{
    at: number
    usedBytes: number
    totalBytes: number
  }>
  conversationSwitch: {
    startedAt: number
    skeletonRecorded: boolean
    threadReads: number
    historyReads: number
    workspaceRefreshes: number
    longTasks: number
  } | null
  conversationSwitchSkeletonMs: TimedValue[]
  conversationSwitchCanonicalReadyMs: TimedValue[]
  conversationSwitchInitialTurns: TimedValue[]
  conversationSwitchInitialItems: TimedValue[]
  conversationSwitchThreadReads: TimedValue[]
  conversationSwitchHistoryReads: TimedValue[]
  conversationSwitchWorkspaceRefreshes: TimedValue[]
  conversationSwitchLongTasks: TimedValue[]
}

const RATE_WINDOW_MS = 10_000
const SAMPLE_WINDOW_MS = 60_000
const MAX_SSE_SAMPLES = 10_000
const MAX_TIMED_SAMPLES = 512
const MAX_PENDING_TURNS = 16
const NOTIFY_INTERVAL_MS = 250

let enabledConsumers = 0
let uninstallRecorder: (() => void) | undefined
let notifyTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function createState(at = now()): MutableState {
  return {
    observedFrom: at,
    sse: [],
    pendingTurnStarts: [],
    firstDeltaMs: [],
    canonicalBatchSizes: [],
    canonicalApplyMs: [],
    canonicalProjectionMs: [],
    reactCommitMs: [],
    liveEventIds: 0,
    frames: {
      fps: 0,
      longestFrameMs: 0,
      longFrames: 0,
      sampleCount: 0,
    },
    longTasks: [],
    heapSamples: [],
    conversationSwitch: null,
    conversationSwitchSkeletonMs: [],
    conversationSwitchCanonicalReadyMs: [],
    conversationSwitchInitialTurns: [],
    conversationSwitchInitialItems: [],
    conversationSwitchThreadReads: [],
    conversationSwitchHistoryReads: [],
    conversationSwitchWorkspaceRefreshes: [],
    conversationSwitchLongTasks: [],
  }
}

let state = createState()

function round(value: number, decimals = 2): number {
  const multiplier = 10 ** decimals
  return Math.round(value * multiplier) / multiplier
}

function distribution(samples: readonly TimedValue[]): DistributionSnapshot {
  if (samples.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0 }
  }

  const values = samples.map(sample => sample.value).sort((a, b) => a - b)
  const percentile = (ratio: number): number => {
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.ceil(values.length * ratio) - 1),
    )
    return round(values[index] ?? 0)
  }

  return {
    count: values.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: round(values[values.length - 1] ?? 0),
  }
}

function pruneTimedSamples(samples: TimedValue[], at: number): void {
  const oldestAllowed = at - SAMPLE_WINDOW_MS
  while (samples.length > 0 && (samples[0]?.at ?? at) < oldestAllowed) {
    samples.shift()
  }
  if (samples.length > MAX_TIMED_SAMPLES) {
    samples.splice(0, samples.length - MAX_TIMED_SAMPLES)
  }
}

function appendTimedSample(
  samples: TimedValue[],
  value: number,
  at: number,
): void {
  if (!Number.isFinite(value) || value < 0) return
  samples.push({ at, value })
  pruneTimedSamples(samples, at)
}

function pruneState(at: number): void {
  const oldestRateSample = at - RATE_WINDOW_MS
  while (state.sse.length > 0 && (state.sse[0]?.at ?? at) < oldestRateSample) {
    state.sse.shift()
  }
  if (state.sse.length > MAX_SSE_SAMPLES) {
    state.sse.splice(0, state.sse.length - MAX_SSE_SAMPLES)
  }

  pruneTimedSamples(state.firstDeltaMs, at)
  pruneTimedSamples(state.canonicalBatchSizes, at)
  pruneTimedSamples(state.canonicalApplyMs, at)
  pruneTimedSamples(state.canonicalProjectionMs, at)
  pruneTimedSamples(state.reactCommitMs, at)
  pruneTimedSamples(state.longTasks, at)
  pruneTimedSamples(state.conversationSwitchSkeletonMs, at)
  pruneTimedSamples(state.conversationSwitchCanonicalReadyMs, at)
  pruneTimedSamples(state.conversationSwitchInitialTurns, at)
  pruneTimedSamples(state.conversationSwitchInitialItems, at)
  pruneTimedSamples(state.conversationSwitchThreadReads, at)
  pruneTimedSamples(state.conversationSwitchHistoryReads, at)
  pruneTimedSamples(state.conversationSwitchWorkspaceRefreshes, at)
  pruneTimedSamples(state.conversationSwitchLongTasks, at)

  const oldestHeapSample = at - SAMPLE_WINDOW_MS
  while (
    state.heapSamples.length > 0 &&
    (state.heapSamples[0]?.at ?? at) < oldestHeapSample
  ) {
    state.heapSamples.shift()
  }
  if (state.heapSamples.length > MAX_TIMED_SAMPLES) {
    state.heapSamples.splice(0, state.heapSamples.length - MAX_TIMED_SAMPLES)
  }
}

function createSnapshot(at = now()): PerformanceDiagnosticsSnapshot {
  pruneState(at)

  const byEventType: Record<string, number> = {}
  const byScope: Record<string, number> = {}
  let bytes = 0
  for (const sample of state.sse) {
    bytes += sample.bytes
    byEventType[sample.eventType] = (byEventType[sample.eventType] ?? 0) + 1
    byScope[sample.scope] = (byScope[sample.scope] ?? 0) + 1
  }

  const rateWindowSeconds = Math.max(
    1,
    Math.min(RATE_WINDOW_MS, at - state.observedFrom) / 1000,
  )
  const firstHeap = state.heapSamples[0]
  const lastHeap = state.heapSamples[state.heapSamples.length - 1]

  return {
    enabled: enabledConsumers > 0,
    observedForMs: Math.max(0, round(at - state.observedFrom)),
    sse: {
      eventsPerSecond: round(state.sse.length / rateWindowSeconds),
      bytesPerSecond: round(bytes / rateWindowSeconds),
      byEventType,
      byScope,
    },
    firstDeltaMs: distribution(state.firstDeltaMs),
    canonical: {
      eventsPerBatch: distribution(state.canonicalBatchSizes),
      applyMs: distribution(state.canonicalApplyMs),
      projectionMs: distribution(state.canonicalProjectionMs),
      liveEventIds: state.liveEventIds,
    },
    reactCommitMs: distribution(state.reactCommitMs),
    frames: { ...state.frames },
    longTasks: {
      count: state.longTasks.length,
      longestMs: round(
        state.longTasks.reduce(
          (longest, sample) => Math.max(longest, sample.value),
          0,
        ),
      ),
    },
    heap: {
      usedBytes: lastHeap?.usedBytes ?? null,
      totalBytes: lastHeap?.totalBytes ?? null,
      usedDeltaBytes:
        firstHeap && lastHeap ? lastHeap.usedBytes - firstHeap.usedBytes : null,
    },
    conversationSwitch: {
      skeletonMs: distribution(state.conversationSwitchSkeletonMs),
      canonicalReadyMs: distribution(
        state.conversationSwitchCanonicalReadyMs,
      ),
      initialTurns: distribution(state.conversationSwitchInitialTurns),
      initialItems: distribution(state.conversationSwitchInitialItems),
      threadReadsPerSwitch: distribution(
        state.conversationSwitchThreadReads,
      ),
      historyReadsPerSwitch: distribution(
        state.conversationSwitchHistoryReads,
      ),
      workspaceRefreshesPerSwitch: distribution(
        state.conversationSwitchWorkspaceRefreshes,
      ),
      longTasksPerSwitch: distribution(state.conversationSwitchLongTasks),
    },
  }
}

let snapshot = createSnapshot()

function emitChange(immediate = false): void {
  if (listeners.size === 0) return
  if (immediate) {
    if (notifyTimer !== undefined) {
      clearTimeout(notifyTimer)
      notifyTimer = undefined
    }
    snapshot = createSnapshot()
    for (const listener of listeners) listener()
    return
  }
  if (notifyTimer !== undefined) return

  notifyTimer = setTimeout(() => {
    notifyTimer = undefined
    snapshot = createSnapshot()
    for (const listener of listeners) listener()
  }, NOTIFY_INTERVAL_MS)
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return enabledConsumers > 0
}

export function enablePerformanceDiagnostics(): () => void {
  enabledConsumers += 1
  if (enabledConsumers === 1) {
    uninstallRecorder = installPerformanceDiagnosticsRecorder({
      recordSseEvent,
      recordTurnStarted,
      recordFirstDelta,
      recordCanonicalBatch,
      recordCanonicalProjection,
      recordReactCommit,
      recordConversationSwitchStarted,
      recordConversationSwitchSkeleton,
      recordConversationSwitchCanonicalReady,
      recordConversationSwitchRequest,
    })
  }
  snapshot = createSnapshot()
  emitChange(true)
  let active = true

  return () => {
    if (!active) return
    active = false
    enabledConsumers = Math.max(0, enabledConsumers - 1)
    if (enabledConsumers === 0) {
      uninstallRecorder?.()
      uninstallRecorder = undefined
    }
    if (enabledConsumers === 0 && notifyTimer !== undefined) {
      clearTimeout(notifyTimer)
      notifyTimer = undefined
    }
    snapshot = createSnapshot()
  }
}

export function subscribePerformanceDiagnostics(
  listener: () => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPerformanceDiagnosticsSnapshot(): PerformanceDiagnosticsSnapshot {
  return snapshot
}

export function resetPerformanceDiagnostics(): void {
  state = createState()
  snapshot = createSnapshot()
  emitChange(true)
}

export function recordSseEvent({
  eventType,
  scope,
  bytes,
  at = now(),
}: {
  eventType: string
  scope: PerformanceDiagnosticsSseScope
  bytes: number
  at?: number
}): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  state.sse.push({
    at,
    bytes: Number.isFinite(bytes) ? Math.max(0, bytes) : 0,
    eventType,
    scope,
  })
  pruneState(at)
  emitChange()
}

export function recordTurnStarted(at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  state.pendingTurnStarts.push(at)
  if (state.pendingTurnStarts.length > MAX_PENDING_TURNS) {
    state.pendingTurnStarts.shift()
  }
}

export function recordFirstDelta(at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  const startedAt = state.pendingTurnStarts.shift()
  if (startedAt === undefined || at < startedAt) return
  appendTimedSample(state.firstDeltaMs, at - startedAt, at)
  emitChange()
}

export function recordCanonicalBatch({
  eventCount,
  applyMs,
  projectionMs,
  liveEventIds,
  at = now(),
}: {
  eventCount: number
  applyMs: number
  projectionMs?: number
  liveEventIds: number
  at?: number
}): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  appendTimedSample(state.canonicalBatchSizes, eventCount, at)
  appendTimedSample(state.canonicalApplyMs, applyMs, at)
  if (projectionMs !== undefined) {
    appendTimedSample(state.canonicalProjectionMs, projectionMs, at)
  }
  if (Number.isFinite(liveEventIds)) {
    state.liveEventIds = Math.max(0, Math.floor(liveEventIds))
  }
  emitChange()
}

export function recordCanonicalProjection(
  durationMs: number,
  at = now(),
): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  appendTimedSample(state.canonicalProjectionMs, durationMs, at)
  emitChange()
}

export function recordReactCommit(durationMs: number, at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  appendTimedSample(state.reactCommitMs, durationMs, at)
  emitChange()
}

export function recordFrameWindow(
  frame: PerformanceDiagnosticsSnapshot['frames'],
): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  state.frames = {
    fps: Math.max(0, Math.round(frame.fps)),
    longestFrameMs: Math.max(0, round(frame.longestFrameMs)),
    longFrames: Math.max(0, Math.floor(frame.longFrames)),
    sampleCount: Math.max(0, Math.floor(frame.sampleCount)),
  }
  emitChange()
}

export function recordLongTask(durationMs: number, at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  appendTimedSample(state.longTasks, durationMs, at)
  if (state.conversationSwitch && at >= state.conversationSwitch.startedAt) {
    state.conversationSwitch.longTasks += 1
  }
  emitChange()
}

export function recordConversationSwitchStarted(at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  state.conversationSwitch = {
    startedAt: at,
    skeletonRecorded: false,
    threadReads: 0,
    historyReads: 0,
    workspaceRefreshes: 0,
    longTasks: 0,
  }
}

export function recordConversationSwitchSkeleton(at = now()): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  const current = state.conversationSwitch
  if (!current || current.skeletonRecorded || at < current.startedAt) return
  current.skeletonRecorded = true
  appendTimedSample(
    state.conversationSwitchSkeletonMs,
    at - current.startedAt,
    at,
  )
  emitChange()
}

export function recordConversationSwitchCanonicalReady(
  {
    turnCount,
    itemCount,
  }: {
    turnCount: number
    itemCount: number
  },
  at = now(),
): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  const current = state.conversationSwitch
  if (!current || at < current.startedAt) return
  appendTimedSample(
    state.conversationSwitchCanonicalReadyMs,
    at - current.startedAt,
    at,
  )
  appendTimedSample(state.conversationSwitchInitialTurns, turnCount, at)
  appendTimedSample(state.conversationSwitchInitialItems, itemCount, at)
  appendTimedSample(
    state.conversationSwitchThreadReads,
    current.threadReads,
    at,
  )
  appendTimedSample(
    state.conversationSwitchHistoryReads,
    current.historyReads,
    at,
  )
  appendTimedSample(
    state.conversationSwitchWorkspaceRefreshes,
    current.workspaceRefreshes,
    at,
  )
  appendTimedSample(
    state.conversationSwitchLongTasks,
    current.longTasks,
    at,
  )
  state.conversationSwitch = null
  emitChange()
}

export function recordConversationSwitchRequest(
  kind: 'thread-read' | 'history-read' | 'workspace-refresh',
): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  const current = state.conversationSwitch
  if (!current) return
  if (kind === 'thread-read') current.threadReads += 1
  if (kind === 'history-read') current.historyReads += 1
  if (kind === 'workspace-refresh') current.workspaceRefreshes += 1
}

export function recordHeapSample({
  usedBytes,
  totalBytes,
  at = now(),
}: {
  usedBytes: number
  totalBytes: number
  at?: number
}): void {
  if (!isPerformanceDiagnosticsEnabled()) return
  if (
    !Number.isFinite(usedBytes) ||
    !Number.isFinite(totalBytes) ||
    usedBytes < 0 ||
    totalBytes < 0
  ) {
    return
  }
  state.heapSamples.push({ at, usedBytes, totalBytes })
  pruneState(at)
  emitChange()
}

export function serializePerformanceDiagnosticsSnapshot(): string {
  const current = createSnapshot()
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      windowMs: {
        rates: RATE_WINDOW_MS,
        distributions: SAMPLE_WINDOW_MS,
      },
      ...current,
    },
    null,
    2,
  )
}

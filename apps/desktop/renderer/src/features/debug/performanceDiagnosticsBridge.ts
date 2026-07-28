export type PerformanceDiagnosticsSseScope =
  | 'canonical'
  | 'global'
  | 'provider'
  | 'skills'
  | 'tooling'
  | 'mcp'
  | 'other'

export type PerformanceDiagnosticsRecorder = {
  recordSseEvent(input: {
    eventType: string
    scope: PerformanceDiagnosticsSseScope
    bytes: number
  }): void
  recordTurnStarted(): void
  recordFirstDelta(): void
  recordCanonicalBatch(input: {
    eventCount: number
    applyMs: number
    liveEventIds: number
  }): void
  recordCanonicalProjection(durationMs: number): void
  recordReactCommit(durationMs: number): void
}

let recorder: PerformanceDiagnosticsRecorder | null = null

export function installPerformanceDiagnosticsRecorder(
  next: PerformanceDiagnosticsRecorder,
): () => void {
  recorder = next
  return () => {
    if (recorder === next) recorder = null
  }
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return recorder !== null
}

export function recordSseEvent(
  input: Parameters<PerformanceDiagnosticsRecorder['recordSseEvent']>[0],
): void {
  recorder?.recordSseEvent(input)
}

export function recordTurnStarted(): void {
  recorder?.recordTurnStarted()
}

export function recordFirstDelta(): void {
  recorder?.recordFirstDelta()
}

export function recordCanonicalBatch(
  input: Parameters<
    PerformanceDiagnosticsRecorder['recordCanonicalBatch']
  >[0],
): void {
  recorder?.recordCanonicalBatch(input)
}

export function recordCanonicalProjection(durationMs: number): void {
  recorder?.recordCanonicalProjection(durationMs)
}

export function recordReactCommit(durationMs: number): void {
  recorder?.recordReactCommit(durationMs)
}

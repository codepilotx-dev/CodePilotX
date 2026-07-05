/**
 * OpenTelemetry instrumentation
 *
 * NO-OP FACADE: All OpenTelemetry telemetry has been removed. This file
 * preserves the public exports so callers don't need updating.
 */

import { isEnvTruthy } from '../envUtils.js'

/**
 * Bootstrap telemetry env vars — no-op.
 */
export function bootstrapTelemetry(): void {
  // No-op
}

/**
 * Parse exporter types from env var. Returns empty array since
 * telemetry is removed.
 */
export function parseExporterTypes(_value: string | undefined): string[] {
  return []
}

/**
 * Check if telemetry is enabled based on env var.
 */
export function isTelemetryEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_ENABLE_TELEMETRY)
}

/**
 * No-op meter that satisfies the minimal Meter interface.
 */
const noopMeter = {
  createCounter: () => noopInstrument,
  createHistogram: () => noopInstrument,
  createUpDownCounter: () => noopInstrument,
  createObservableCounter: () => noopObservableInstrument,
  createObservableGauge: () => noopObservableInstrument,
  createObservableUpDownCounter: () => noopObservableInstrument,
}

const noopInstrument = {
  add: () => {},
  record: () => {},
  bind: () => noopInstrument,
  unbind: () => {},
}

const noopObservableInstrument = {
  addCallback: () => {},
  removeCallback: () => {},
}

/**
 * Initialize telemetry — returns a no-op meter.
 * No OpenTelemetry exporters are created; no network traffic.
 */
export async function initializeTelemetry(): Promise<typeof noopMeter> {
  return noopMeter
}

/**
 * Flush all pending telemetry data immediately — no-op.
 */
export async function flushTelemetry(): Promise<void> {
  // No-op
}

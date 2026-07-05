/**
 * Analytics sink implementation
 *
 * NO-OP SINK: Telemetry has been removed. This file exports a no-op analytics
 * sink that drops all events. The public API surface (initializeAnalyticsGates,
 * initializeAnalyticsSink) is preserved so callers don't need updating.
 */

import { attachAnalyticsSink } from './index.js'

type LogEventMetadata = { [key: string]: boolean | number | undefined }

function logEventImpl(_eventName: string, _metadata: LogEventMetadata): void {
  // No-op: all analytics events are discarded
}

function logEventAsyncImpl(
  _eventName: string,
  _metadata: LogEventMetadata,
): Promise<void> {
  return Promise.resolve()
}

/**
 * Initialize analytics gates during startup.
 * No-op since telemetry is removed.
 */
export function initializeAnalyticsGates(): void {
  // No-op
}

/**
 * Initialize the analytics sink.
 * Attaches a no-op sink that drops all events.
 */
export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: logEventImpl,
    logEventAsync: logEventAsyncImpl,
  })
}

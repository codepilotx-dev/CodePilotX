/**
 * First-party (1P) event logger
 *
 * NO-OP FACADE: All 1P event logging has been removed. This file preserves
 * public exports so that callers don't need updating.
 */

import type { GrowthBookUserAttributes } from './growthbook.js'
import { getDynamicConfig_CACHED_MAY_BE_STALE } from './growthbook.js'

/**
 * Configuration for sampling individual event types.
 * Each event name maps to an object containing sample_rate (0-1).
 * Events not in the config are logged at 100% rate.
 */
export type EventSamplingConfig = {
  [eventName: string]: {
    sample_rate: number
  }
}

const EVENT_SAMPLING_CONFIG_NAME = 'tengu_event_sampling_config'

/**
 * Get the event sampling configuration from cache.
 * Uses cached GrowthBook values since all telemetry is removed.
 */
export function getEventSamplingConfig(): EventSamplingConfig {
  return getDynamicConfig_CACHED_MAY_BE_STALE<EventSamplingConfig>(
    EVENT_SAMPLING_CONFIG_NAME,
    {},
  )
}

/**
 * Determine if an event should be sampled based on its sample rate.
 * Returns the sample rate if sampled, null if not sampled.
 */
export function shouldSampleEvent(eventName: string): number | null {
  const config = getEventSamplingConfig()
  const eventConfig = config[eventName]

  // If no config for this event, log at 100% rate (no sampling)
  if (!eventConfig) {
    return null
  }

  const sampleRate = eventConfig.sample_rate

  // Validate sample rate is in valid range
  if (typeof sampleRate !== 'number' || sampleRate < 0 || sampleRate > 1) {
    return null
  }

  // Sample rate of 1 means log everything (no need to add metadata)
  if (sampleRate >= 1) {
    return null
  }

  // Sample rate of 0 means drop everything
  if (sampleRate <= 0) {
    return 0
  }

  // Randomly decide whether to sample this event
  return Math.random() < sampleRate ? sampleRate : 0
}

/**
 * Flush and shutdown the 1P event logger — no-op.
 */
export async function shutdown1PEventLogging(): Promise<void> {
  // No-op
}

/**
 * Check if 1P event logging is enabled — always returns false.
 */
export function is1PEventLoggingEnabled(): boolean {
  return false
}

/**
 * Log a 1st-party event for internal analytics — no-op.
 */
export function logEventTo1P(
  _eventName: string,
  _metadata: Record<string, number | boolean | undefined> = {},
): void {
  // No-op
}

/**
 * GrowthBook experiment event data for logging
 */
export type GrowthBookExperimentData = {
  experimentId: string
  variationId: number
  userAttributes?: GrowthBookUserAttributes
  experimentMetadata?: Record<string, unknown>
}

/**
 * Log a GrowthBook experiment assignment event to 1P — no-op.
 */
export function logGrowthBookExperimentTo1P(
  _data: GrowthBookExperimentData,
): void {
  // No-op
}

/**
 * Initialize 1P event logging infrastructure — no-op.
 */
export function initialize1PEventLogging(): void {
  // No-op
}

/**
 * Rebuild the 1P event logging pipeline if the batch config changed — no-op.
 */
export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {
  // No-op
}

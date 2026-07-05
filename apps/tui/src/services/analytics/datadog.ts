/**
 * Datadog analytics sink
 *
 * NO-OP FACADE: All Datadog telemetry has been removed. This file preserves
 * the public exports (initializeDatadog, shutdownDatadog, trackDatadogEvent)
 * so that callers don't need updating, but all operations are no-ops.
 */

/**
 * Initialize Datadog — no-op. Returns false immediately.
 */
export const initializeDatadog = async (): Promise<boolean> => {
  return false
}

/**
 * Shutdown Datadog — no-op.
 */
export async function shutdownDatadog(): Promise<void> {
  // No-op
}

/**
 * Track a Datadog event — no-op.
 */
export async function trackDatadogEvent(
  _eventName: string,
  _properties: { [key: string]: boolean | number | undefined },
): Promise<void> {
  // No-op
}

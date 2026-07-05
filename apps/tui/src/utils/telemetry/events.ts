/**
 * Telemetry event logging
 *
 * NO-OP FACADE: All telemetry event logging has been removed.
 * Preserves the public export so callers don't break.
 */

export function redactIfDisabled(content: string): string {
  return content
}

export async function logOTelEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  // No-op
}

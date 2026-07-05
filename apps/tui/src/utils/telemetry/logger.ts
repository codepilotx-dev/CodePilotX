/**
 * Telemetry diagnostic logger
 *
 * NO-OP FACADE: All telemetry diagnostic logging has been removed.
 * Preserves the class export so callers don't break.
 */

export class CodePilotXDiagLogger {
  error(_message: string, ..._args: unknown[]) {
    // No-op
  }
  warn(_message: string, ..._args: unknown[]) {
    // No-op
  }
  info(_message: string, ..._args: unknown[]) {
    // No-op
  }
  debug(_message: string, ..._args: unknown[]) {
    // No-op
  }
  verbose(_message: string, ..._args: unknown[]) {
    // No-op
  }
}

/**
 * First-party event logging exporter
 *
 * NO-OP FACADE: All 1P event logging exports have been removed. This file
 * preserves the public class export so callers of the old API don't break.
 */

// Inline minimal types to avoid importing removed @opentelemetry packages.
// These match the OTel ExportResult / LogRecordExporter interfaces.
type ExportResultCodeValue = 0 | 1

const SUCCESS: ExportResultCodeValue = 0

export type { ExportResultCodeValue as ExportResultCode }

export type ExportResult = {
  code: ExportResultCodeValue
  error?: Error
}

export interface LogRecordExporter {
  export(
    logs: unknown[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void>
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
}

/**
 * No-op exporter for 1st-party event logging.
 * All operations are no-ops.
 */
export class FirstPartyEventLoggingExporter implements LogRecordExporter {
  constructor(_options: Record<string, unknown> = {}) {
    // No-op
  }

  async export(
    _logs: unknown[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    resultCallback({ code: SUCCESS })
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  async forceFlush(): Promise<void> {
    // No-op
  }
}

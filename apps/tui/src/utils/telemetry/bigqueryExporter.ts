/**
 * BigQuery Metrics Exporter
 *
 * NO-OP FACADE: All BigQuery metrics export has been removed. This file
 * preserves the public class export so callers don't break.
 */

// Inline minimal types to avoid importing removed @opentelemetry packages.
type ExportResultCodeValue = 0 | 1

const SUCCESS: ExportResultCodeValue = 0

export type { ExportResultCodeValue as ExportResultCode }

export type ExportResult = {
  code: ExportResultCodeValue
  error?: Error
}

export interface PushMetricExporter {
  export(
    metrics: unknown,
    resultCallback: (result: ExportResult) => void,
  ): Promise<void>
  shutdown(): Promise<void>
  forceFlush(): Promise<void>
  selectAggregationTemporality(): unknown
}

// Re-export AggregationTemporality as a simple constant
export const AggregationTemporality = {
  DELTA: 1,
} as const

/**
 * No-op BigQuery metrics exporter.
 * All operations are no-ops — no network traffic.
 */
export class BigQueryMetricsExporter implements PushMetricExporter {
  constructor(_options: { timeout?: number } = {}) {
    // No-op
  }

  async export(
    _metrics: unknown,
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

  selectAggregationTemporality(): number {
    return AggregationTemporality.DELTA
  }
}

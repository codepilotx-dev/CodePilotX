export const BUNDLE_BUDGET_WARNING_PERCENT = 0.01
export const BUNDLE_BUDGET_WARNING_FLOOR_BYTES = 8 * 1024
export const BUNDLE_BUDGET_FAILURE_PERCENT = 0.05
export const BUNDLE_BUDGET_FAILURE_FLOOR_BYTES = 32 * 1024

export const BUNDLE_BUDGET_METRIC_NAMES = [
  'entryCssRawBytes',
  'newInteractiveCssRawBytes',
  'sessionGroupsInitialIncrementalCssRawBytes',
] as const

export type BundleBudgetMetricName = (typeof BUNDLE_BUDGET_METRIC_NAMES)[number]
export type BundleBudgetStatus = 'pass' | 'warning' | 'failure'

export type BundleBudgetEvaluation = {
  status: BundleBudgetStatus
  baselineBytes: number
  observedBytes: number
  deltaBytes: number
  warningLimitBytes: number
  failureLimitBytes: number
}

export type BundleBudgetBaseline = {
  schemaVersion: 1
  acceptedAt: string
  acceptedReason: string
  metrics: Record<BundleBudgetMetricName, number>
}

export function evaluateBundleBudget(
  baselineBytes: number,
  observedBytes: number,
): BundleBudgetEvaluation {
  const warningDelta = Math.max(
    BUNDLE_BUDGET_WARNING_FLOOR_BYTES,
    Math.ceil(baselineBytes * BUNDLE_BUDGET_WARNING_PERCENT),
  )
  const failureDelta = Math.max(
    BUNDLE_BUDGET_FAILURE_FLOOR_BYTES,
    Math.ceil(baselineBytes * BUNDLE_BUDGET_FAILURE_PERCENT),
  )
  const warningLimitBytes = baselineBytes + warningDelta
  const failureLimitBytes = baselineBytes + failureDelta

  return {
    status: observedBytes <= warningLimitBytes
      ? 'pass'
      : observedBytes <= failureLimitBytes
        ? 'warning'
        : 'failure',
    baselineBytes,
    observedBytes,
    deltaBytes: observedBytes - baselineBytes,
    warningLimitBytes,
    failureLimitBytes,
  }
}

export function parseBundleBudgetBaseline(value: unknown): BundleBudgetBaseline {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Renderer bundle budget baseline schemaVersion 必须为 1')
  }
  if (!isNonEmptyString(value.acceptedAt)) {
    throw new Error('Renderer bundle budget baseline acceptedAt 不能为空')
  }
  if (!isNonEmptyString(value.acceptedReason)) {
    throw new Error('Renderer bundle budget baseline acceptedReason 不能为空')
  }
  if (!isRecord(value.metrics)) {
    throw new Error('Renderer bundle budget baseline metrics 无效')
  }
  const baselineMetrics = value.metrics

  const metrics = Object.fromEntries(
    BUNDLE_BUDGET_METRIC_NAMES.map(name => {
      const metric = baselineMetrics[name]
      if (
        typeof metric !== 'number'
        || !Number.isSafeInteger(metric)
        || metric < 0
      ) {
        throw new Error(`Renderer bundle budget baseline ${name} 必须为非负整数`)
      }
      return [name, metric]
    }),
  ) as Record<BundleBudgetMetricName, number>

  return {
    schemaVersion: 1,
    acceptedAt: value.acceptedAt,
    acceptedReason: value.acceptedReason,
    metrics,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

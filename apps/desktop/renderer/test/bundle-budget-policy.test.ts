import { describe, expect, test } from 'bun:test'
import {
  evaluateBundleBudget,
  parseBundleBudgetBaseline,
} from '../scripts/bundle-budget-policy.js'

describe('Renderer bundle budget policy', () => {
  test('passes at or below the warning boundary', () => {
    const baseline = 100 * 1024

    expect(evaluateBundleBudget(baseline, baseline).status).toBe('pass')
    expect(evaluateBundleBudget(baseline, baseline + 8 * 1024).status).toBe('pass')
  })

  test('warns above the soft boundary and fails above the hard boundary', () => {
    const baseline = 100 * 1024

    expect(
      evaluateBundleBudget(baseline, baseline + 8 * 1024 + 1).status,
    ).toBe('warning')
    expect(
      evaluateBundleBudget(baseline, baseline + 32 * 1024).status,
    ).toBe('warning')
    expect(
      evaluateBundleBudget(baseline, baseline + 32 * 1024 + 1).status,
    ).toBe('failure')
  })

  test('uses percentage thresholds when they exceed the byte floors', () => {
    const baseline = 4_000_000
    const evaluation = evaluateBundleBudget(baseline, baseline)

    expect(evaluation.warningLimitBytes).toBe(4_040_000)
    expect(evaluation.failureLimitBytes).toBe(4_200_000)
  })

  test('rejects missing or invalid baseline metrics', () => {
    expect(() => parseBundleBudgetBaseline({
      schemaVersion: 1,
      acceptedAt: '2026-08-24',
      acceptedReason: 'initial baseline',
      metrics: {
        entryCssRawBytes: 1,
        newInteractiveCssRawBytes: 1,
      },
    })).toThrow('sessionGroupsInitialIncrementalCssRawBytes')

    expect(() => parseBundleBudgetBaseline({
      schemaVersion: 1,
      acceptedAt: '2026-08-24',
      acceptedReason: 'initial baseline',
      metrics: {
        entryCssRawBytes: -1,
        newInteractiveCssRawBytes: 1,
        sessionGroupsInitialIncrementalCssRawBytes: 1,
      },
    })).toThrow('entryCssRawBytes')
  })
})

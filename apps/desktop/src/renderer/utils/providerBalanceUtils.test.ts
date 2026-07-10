import { describe, it, expect } from 'bun:test'
import { formatRemainingWindow, formatDuration, clampPercent } from './providerBalanceUtils.js'

describe('clampPercent', () => {
  it('clamps values within 0-100', () => {
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(-10)).toBe(0)
    expect(clampPercent(75)).toBe(75)
  })
  it('handles NaN', () => {
    expect(clampPercent(NaN)).toBe(0)
  })
  it('rounds to nearest integer', () => {
    expect(clampPercent(75.6)).toBe(76)
    expect(clampPercent(75.4)).toBe(75)
  })
})

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(120_000)).toBe('2 分钟')
    expect(formatDuration(60_000)).toBe('1 分钟')
  })
  it('formats hours and minutes', () => {
    // 90 minutes = 1h30m
    expect(formatDuration(5_400_000)).toBe('1 小时 30 分')
  })
  it('formats whole hours', () => {
    expect(formatDuration(7_200_000)).toBe('2 小时')
  })
  it('minimum 1 minute', () => {
    expect(formatDuration(1000)).toBe('1 分钟')
  })
})

describe('formatRemainingWindow', () => {
  it('formats remaining time when available', () => {
    // 30 minutes
    expect(formatRemainingWindow(1_800_000, null)).toBe('30 分钟')
  })
  it('formats end date when no remaining time', () => {
    const endTime = new Date('2026-07-15T00:00:00Z').getTime()
    const result = formatRemainingWindow(null, endTime)
    expect(result).toContain('7月')
    expect(result).toContain('15')
  })
  it('returns em-dash when no data', () => {
    expect(formatRemainingWindow(null, null)).toBe('—')
  })
  it('ignores zero/negative remaining time', () => {
    expect(formatRemainingWindow(0, 1_000_000)).toBe(formatRemainingWindow(null, 1_000_000))
    expect(formatRemainingWindow(-1, null)).toBe('—')
  })
})

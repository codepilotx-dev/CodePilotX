import { expect, test } from 'bun:test'
import {
  buildDesktopContextUsage,
  inferProviderFromModel,
} from './desktopContextUsage.js'

test('buildDesktopContextUsage returns null for all-zero usage', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-v4-flash',
    usage: {},
  })
  expect(result).toBeNull()
})

test('buildDesktopContextUsage uses 1M context window for deepseek-v4-flash', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-v4-flash',
    usage: { input_tokens: 24_700, output_tokens: 1_500 },
  })

  expect(result).not.toBeNull()
  expect(result!.contextWindow).toBe(1_000_000)
  expect(result!.remainingTokens).toBe(1_000_000 - 24_700 - 1_500)
  expect(result!.usedPercent).toBe(
    Math.round(((24_700 + 1_500) / 1_000_000) * 100),
  )
  expect(result!.remainingPercent).toBe(100 - result!.usedPercent)
})

test('buildDesktopContextUsage infers provider from model name', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-v4-pro',
    usage: { input_tokens: 10_000 },
  })

  expect(result).not.toBeNull()
  expect(result!.provider).toBe('deepseek')
  expect(result!.contextWindow).toBe(1_000_000)
})

test('buildDesktopContextUsage uses provided provider directly', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-v4-flash',
    provider: 'custom-deepseek',
    usage: { input_tokens: 5_000 },
  })

  expect(result).not.toBeNull()
  expect(result!.provider).toBe('custom-deepseek')
  expect(result!.contextWindow).toBe(1_000_000)
})

test('buildDesktopContextUsage handles null provider gracefully', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-v4-flash',
    provider: null,
    usage: { input_tokens: 5_000 },
  })

  expect(result).not.toBeNull()
  // null is treated as explicitly-set falsy → no inference → undefined
  expect(result!.provider).toBeUndefined()
})

test('buildDesktopContextUsage calculates percentages correctly for small values', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-reasoner',
    usage: { input_tokens: 100 },
  })

  expect(result).not.toBeNull()
  expect(result!.contextWindow).toBe(1_000_000)
  expect(result!.usedTokens).toBe(100)
  expect(result!.remainingTokens).toBe(1_000_000 - 100)
  expect(result!.usedPercent).toBe(0) // 100/1M = 0.01%, rounds to 0
})

test('buildDesktopContextUsage handles cache tokens for non-OpenAI-compatible usage', () => {
  const result = buildDesktopContextUsage({
    model: 'deepseek-chat',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    },
  })

  expect(result).not.toBeNull()
  // Without reasoning_tokens/prompt_cache_* flags, cache tokens are included
  expect(result!.usedTokens).toBe(100 + 50 + 200 + 300)
  expect(result!.remainingTokens).toBe(1_000_000 - 650)
})

test('buildDesktopContextUsage handles OpenAI-compatible usage fields', () => {
  const result = buildDesktopContextUsage({
    model: 'gpt-4o',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
      reasoning_tokens: 10,
    },
  })

  expect(result).not.toBeNull()
  // With reasoning_tokens present, cache tokens are excluded from usedTokens
  expect(result!.usedTokens).toBe(100 + 50)
  expect(result!.contextWindow).toBe(128_000)
})

test('buildDesktopContextUsage returns 200k default for unknown model', () => {
  const result = buildDesktopContextUsage({
    model: 'some-unknown-model',
    usage: { input_tokens: 100 },
  })

  expect(result).not.toBeNull()
  expect(result!.contextWindow).toBe(200_000)
})

test('inferProviderFromModel handles deepseek model prefix', () => {
  expect(inferProviderFromModel('deepseek-v4-flash')).toBe('deepseek')
  expect(inferProviderFromModel('deepseek-chat')).toBe('deepseek')
  expect(inferProviderFromModel('claude-sonnet-4-20250514')).toBe('anthropic')
  expect(inferProviderFromModel('openai/gpt-4o')).toBe('openai')
  expect(inferProviderFromModel('')).toBeUndefined()
  expect(inferProviderFromModel('unknown')).toBeUndefined()
})

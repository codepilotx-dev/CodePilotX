import { expect, test } from 'bun:test'
import {
  MODEL_CONTEXT_WINDOW_DEFAULT,
  getContextWindowForModel,
} from './context.js'

test('context window defaults to the shared default', () => {
  expect(getContextWindowForModel('claude-sonnet-4-5')).toBe(
    MODEL_CONTEXT_WINDOW_DEFAULT,
  )
})

test('context window honors explicit 1m model suffix', () => {
  expect(getContextWindowForModel('claude-sonnet-4-5 [1m]')).toBe(1_000_000)
})

test('context window recognizes common third-party model families', () => {
  expect(getContextWindowForModel('openai/gpt-4o')).toBe(128_000)
  expect(getContextWindowForModel('deepseek-chat')).toBe(1_000_000)
})

test('context window returns 1M for known DeepSeek models', () => {
  expect(getContextWindowForModel('deepseek-v4-flash')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-reasoner')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-chat')).toBe(1_000_000)
})

test('context window supports provider-prefixed model names', () => {
  expect(getContextWindowForModel('deepseek/deepseek-v4-flash')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek/deepseek-v4-pro')).toBe(1_000_000)
})

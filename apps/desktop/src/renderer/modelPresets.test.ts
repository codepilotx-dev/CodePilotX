import { expect, test } from 'bun:test'
import { resolveModelPresetId } from './modelPresets.js'

test('resolveModelPresetId returns empty preset when model is not in presets', () => {
  expect(resolveModelPresetId('deepseek-chat', '__custom__', [])).toBe('')
  expect(resolveModelPresetId('deepseek-chat', 'missing-preset', [])).toBe('')
})

test('resolveModelPresetId keeps matching provider model preset', () => {
  expect(
    resolveModelPresetId('deepseek-v4-pro', undefined, [
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        value: 'deepseek-v4-pro',
      },
    ]),
  ).toBe('deepseek-v4-pro')
})

import { expect, test } from 'bun:test'
import {
  UnsupportedCoreFeatureError,
  unsupportedCoreFeature,
} from './unsupported.js'

test('unsupported core feature errors keep feature and migration message', () => {
  const error = new UnsupportedCoreFeatureError(
    'desktop headless runtime',
    'Use subprocess fallback for now.',
  )

  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe('UnsupportedCoreFeatureError')
  expect(error.feature).toBe('desktop headless runtime')
  expect(error.message).toContain('当前 core 暂不支持/迁移中')
  expect(error.message).toContain('desktop headless runtime')
  expect(error.message).toContain('Use subprocess fallback for now.')
})

test('unsupportedCoreFeature throws the typed error', () => {
  expect(() => unsupportedCoreFeature('mcp config')).toThrow(
    UnsupportedCoreFeatureError,
  )
})

import { expect, test } from 'bun:test'
import { clearAllCaches } from './cache.js'

test('plugin cache facade exposes all-cache invalidation entrypoint', () => {
  expect(typeof clearAllCaches).toBe('function')
})

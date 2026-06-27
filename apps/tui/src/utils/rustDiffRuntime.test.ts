import { afterEach, describe, expect, test } from 'bun:test'
import { shouldUseRustDiffRuntime } from './rustDiffRuntime.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('shouldUseRustDiffRuntime', () => {
  test('requires the feature flag and keeps whitespace-ignore diffs on JS fallback', () => {
    delete process.env.CODEPILOTX_RUST_DIFF
    expect(shouldUseRustDiffRuntime(false)).toBe(false)

    process.env.CODEPILOTX_RUST_DIFF = '1'
    expect(shouldUseRustDiffRuntime(false)).toBe(true)
    expect(shouldUseRustDiffRuntime(true)).toBe(false)
  })
})

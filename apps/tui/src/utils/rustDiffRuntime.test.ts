import { afterEach, describe, expect, test } from 'bun:test'
import {
  shouldUseRustDiffRuntime,
  tryGetRustPatchFromContents,
} from './rustDiffRuntime.js'

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

describe('tryGetRustPatchFromContents', () => {
  test('falls back when the configured runtime cannot execute', () => {
    process.env.CODEPILOTX_RUST_DIFF = '1'
    process.env.CODEPILOTX_RUST_RUNTIME_PATH = 'package.json'

    expect(
      tryGetRustPatchFromContents({
        oldContent: 'one\n',
        newContent: 'two\n',
        contextLines: 3,
        ignoreWhitespace: false,
      }),
    ).toBeNull()
  })
})

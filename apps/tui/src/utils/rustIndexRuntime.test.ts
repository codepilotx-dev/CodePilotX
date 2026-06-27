import { afterEach, describe, expect, test } from 'bun:test'
import {
  shouldUseRustIndexSidecar,
  tryBuildRustIndex,
  tryQueryRustIndex,
} from './rustIndexRuntime.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('shouldUseRustIndexSidecar', () => {
  test('stays disabled unless explicitly enabled', () => {
    delete process.env.CODEPILOTX_RUST_INDEX_SIDECAR

    expect(shouldUseRustIndexSidecar()).toBe(false)
  })

  test('enables sidecar only when feature flag is truthy', () => {
    process.env.CODEPILOTX_RUST_INDEX_SIDECAR = '1'

    expect(shouldUseRustIndexSidecar()).toBe(true)
  })
})

describe('rust index sidecar fallback', () => {
  test('build falls back when the configured runtime cannot execute', async () => {
    process.env.CODEPILOTX_RUST_INDEX_SIDECAR = '1'
    process.env.CODEPILOTX_RUST_RUNTIME_PATH = 'package.json'

    await expect(
      tryBuildRustIndex(
        {
          workspace: process.cwd(),
          cachePath: 'index.json',
          hidden: true,
          noIgnore: true,
        },
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
  })

  test('query falls back when the configured runtime cannot execute', async () => {
    process.env.CODEPILOTX_RUST_INDEX_SIDECAR = '1'
    process.env.CODEPILOTX_RUST_RUNTIME_PATH = 'package.json'

    await expect(
      tryQueryRustIndex(
        {
          cachePath: 'index.json',
          query: 'src',
          limit: 10,
        },
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
  })
})

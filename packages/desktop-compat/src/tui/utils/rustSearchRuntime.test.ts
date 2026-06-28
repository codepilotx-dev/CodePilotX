import { afterEach, describe, expect, test } from 'bun:test'
import {
  rustSearchCommandForArgs,
  shouldUseRustSearchRuntime,
  tryRunRustSearchRuntime,
} from './rustSearchRuntime.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('rustSearchCommandForArgs', () => {
  test('classifies ripgrep file listing as glob and content search as grep', () => {
    expect(rustSearchCommandForArgs(['--files', '--glob', '*.ts'])).toBe('glob')
    expect(rustSearchCommandForArgs(['--hidden', '--max-columns', '500', 'foo'])).toBe(
      'grep',
    )
  })
})

describe('shouldUseRustSearchRuntime', () => {
  test('keeps glob and grep disabled unless their feature flags are enabled', () => {
    delete process.env.CODEPILOTX_RUST_GLOB
    delete process.env.CODEPILOTX_RUST_GREP

    expect(
      shouldUseRustSearchRuntime(['--files', '--glob', '*.ts', '--hidden']),
    ).toBe(false)
    expect(
      shouldUseRustSearchRuntime(['--hidden', '--max-columns', '500', 'foo']),
    ).toBe(false)
  })

  test('enables only supported glob and grep argument shapes', () => {
    process.env.CODEPILOTX_RUST_GLOB = '1'
    process.env.CODEPILOTX_RUST_GREP = '1'

    expect(
      shouldUseRustSearchRuntime([
        '--files',
        '--glob',
        '*.ts',
        '--sort=modified',
        '--no-ignore',
        '--hidden',
      ]),
    ).toBe(true)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '-n',
        'foo',
      ]),
    ).toBe(true)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '-C',
        '2',
        'foo',
      ]),
    ).toBe(true)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '--type',
        'ts',
        'foo',
      ]),
    ).toBe(true)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '-U',
        '--multiline-dotall',
        'foo\\nbar',
      ]),
    ).toBe(true)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '--type',
        'unknown-type',
        'foo',
      ]),
    ).toBe(false)
    expect(
      shouldUseRustSearchRuntime([
        '--hidden',
        '--max-columns',
        '500',
        '--glob',
        'C:\\absolute\\*.ts',
        'foo',
      ]),
    ).toBe(false)
  })
})

describe('tryRunRustSearchRuntime', () => {
  test('falls back when the configured runtime cannot execute', async () => {
    process.env.CODEPILOTX_RUST_GREP = '1'
    process.env.CODEPILOTX_RUST_RUNTIME_PATH = 'package.json'

    await expect(
      tryRunRustSearchRuntime(
        ['--hidden', '--max-columns', '500', 'needle'],
        process.cwd(),
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
  })
})

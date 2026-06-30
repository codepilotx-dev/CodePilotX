import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findRustShellRuntimeExecutable,
  getRustShellRuntimeDevPath,
  shouldUseRustShellRuntime,
} from './rustShellRuntime.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('shouldUseRustShellRuntime', () => {
  test('stays disabled unless explicitly enabled', () => {
    delete process.env.CODEPILOTX_RUST_SHELL

    expect(
      shouldUseRustShellRuntime({
        shouldUseSandbox: false,
        shouldAutoBackground: false,
        hasStdoutCallback: false,
      }),
    ).toBe(false)
  })

  test('uses rust runtime only for the foreground file-output path', () => {
    process.env.CODEPILOTX_RUST_SHELL = '1'

    expect(
      shouldUseRustShellRuntime({
        shouldUseSandbox: false,
        shouldAutoBackground: false,
        hasStdoutCallback: false,
      }),
    ).toBe(true)
    expect(
      shouldUseRustShellRuntime({
        shouldUseSandbox: true,
        shouldAutoBackground: false,
        hasStdoutCallback: false,
      }),
    ).toBe(false)
    expect(
      shouldUseRustShellRuntime({
        shouldUseSandbox: false,
        shouldAutoBackground: true,
        hasStdoutCallback: false,
      }),
    ).toBe(false)
    expect(
      shouldUseRustShellRuntime({
        shouldUseSandbox: false,
        shouldAutoBackground: false,
        hasStdoutCallback: true,
      }),
    ).toBe(false)
  })
})

describe('findRustShellRuntimeExecutable', () => {
  test('finds dev runtime from desktop agent exec path when cwd is a workspace', () => {
    const root = join(tmpdir(), `rust-shell-runtime-${Date.now()}`)
    const workspace = join(root, 'workspace')
    const execPath = join(root, 'dist', 'desktop-agent', 'codepilotx-local.exe')
    const runtimePath = getRustShellRuntimeDevPath(root)
    mkdirSync(join(root, 'dist', 'desktop-agent'), { recursive: true })
    mkdirSync(join(runtimePath, '..'), { recursive: true })
    mkdirSync(workspace, { recursive: true })
    writeFileSync(execPath, '')
    writeFileSync(runtimePath, '')

    try {
      expect(
        findRustShellRuntimeExecutable({
          cwd: workspace,
          execPath,
          env: {},
        }),
      ).toBe(runtimePath)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

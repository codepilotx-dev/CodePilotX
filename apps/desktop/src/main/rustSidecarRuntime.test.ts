import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  RUST_APP_SERVER_BINARY_ENV,
  RustSidecarDesktopAgentRuntime,
  createRustSidecarOptions,
  resolveRustAppServerExecutable,
} from './rustSidecarRuntime.js'
import type { DesktopAgentRuntimeContext } from './agentRuntime.js'

/** Temporarily set process.env[key] and restore on dispose. */
function withEnv(key: string, value: string): Disposable {
  const previous = process.env[key]
  process.env[key] = value
  return {
    [Symbol.dispose]() {
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    },
  }
}

// ── Options / executable resolution tests ───────────────────────────

describe('rust sidecar runtime options', () => {
  test('resolves explicit Rust app-server executable from env', () => {
    const envPath = process.platform === 'win32'
      ? 'C:\\tools\\codex-app-server.exe'
      : '/tools/codex-app-server'

    expect(
      resolveRustAppServerExecutable({
        [RUST_APP_SERVER_BINARY_ENV]: envPath,
      } as NodeJS.ProcessEnv),
    ).toBe(resolve(envPath))
  })

  test('creates stdio app-server launch options', () => {
    const context = {
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      model: 'test-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = createRustSidecarOptions(context)

    expect(options.args).toEqual([
      '--listen',
      'stdio://',
      '--session-source',
      'vscode',
    ])
    expect(options.cwd).toBe(process.cwd())
    expect(options.env.CODEPILOTX_SIDECAR_SESSION_ID).toBe('session-1')
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('test-model')
  })

  test('inherits process.env including CODEX_HOME', () => {
    using _restore = withEnv('CODEX_HOME', '/custom/codex-home')

    const context = {
      sessionId: 'session-2',
      workspacePath: process.cwd(),
      model: 'test-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = createRustSidecarOptions(context)

    // CODEX_HOME 已透传
    expect(options.env.CODEX_HOME).toBe('/custom/codex-home')
    // sidecar 专属变量仍正常生成
    expect(options.env.CODEPILOTX_SIDECAR_SESSION_ID).toBe('session-2')
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('test-model')
  })

  test('sidecar env overrides process.env on conflict', () => {
    using _restore = withEnv('CODEPILOTX_SIDECAR_MODEL', 'should-be-overridden')

    const context = {
      sessionId: 'session-3',
      workspacePath: process.cwd(),
      model: 'override-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = createRustSidecarOptions(context)

    // sidecar 专属变量应覆盖 process.env 中的同名值
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('override-model')
  })
})

// ── Non-text input rejection ────────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime input validation', () => {
  test('rejects non-text input with clear error', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    await expect(
      runtime.runUserTurn(
        [{ type: 'text', text: 'hello' }],
        new AbortController().signal,
      ),
    ).rejects.toThrow('text-only')
  })

  test('rejects control responses with clear error', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    await expect(
      runtime.runControlResponse(
        { behavior: 'allow' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('not supported')
  })
})

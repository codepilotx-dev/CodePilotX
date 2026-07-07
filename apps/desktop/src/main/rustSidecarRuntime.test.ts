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

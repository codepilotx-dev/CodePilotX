import { describe, expect, mock, test, beforeEach } from 'bun:test'
import { SidecarStartError } from './sidecarManager.js'
import { RustSidecarDesktopAgentRuntime } from './rustSidecarRuntime.js'

// ── Mock for the TUI headless runtime (avoids actual session init) ──

const mockRunDesktopHeadlessTurn = mock<
  (runtime: unknown, content: unknown, signal: AbortSignal) => Promise<void>
>()
const mockCreateDesktopHeadlessRuntime = mock<(...args: unknown[]) => unknown>()

class MockHeadlessRuntime {
  setModel = mock()
  setProvider = mock()
  setPermissionMode = mock()
  setCodexPermissionConfig = mock()
  setDebugConversationDump = mock()
  getMcpRuntimeStatus = mock(() => ({
    servers: [],
    totalTools: 0,
    totalResources: 0,
    totalPrompts: 0,
  }))
}

mock.module('@codepilotx/tui/headless/desktopRuntime.js', () => ({
  createDesktopHeadlessRuntime: (...args: unknown[]) =>
    mockCreateDesktopHeadlessRuntime(...args),
  runDesktopHeadlessTurn: (...args: unknown[]) =>
    mockRunDesktopHeadlessTurn(...(args as [unknown, unknown, AbortSignal])),
  runDesktopHeadlessControlResponse: mock(
    async () => {},
  ) as unknown as (...args: unknown[]) => Promise<void>,
}))

// ── Dynamic import after module mocks are set up ────────────────────

const { createDesktopAgentRuntime } = await import('./agentRuntime.js')

// ── Helper: save/restore prototype method ──────────────────────────

const originalRunUserTurn =
  RustSidecarDesktopAgentRuntime.prototype.runUserTurn

function withMockedRustRunUserTurn(
  impl: (content: unknown, signal: AbortSignal) => Promise<void>,
  fn: () => Promise<void>,
): Promise<void> {
  RustSidecarDesktopAgentRuntime.prototype.runUserTurn = mock(impl)
  return fn().finally(() => {
    RustSidecarDesktopAgentRuntime.prototype.runUserTurn = originalRunUserTurn
  })
}

// ── Tests ───────────────────────────────────────────────────────────

describe('RustFallbackDesktopAgentRuntime', () => {
  beforeEach(() => {
    mockRunDesktopHeadlessTurn.mockReset()
    mockCreateDesktopHeadlessRuntime.mockReset()
    mockCreateDesktopHeadlessRuntime.mockReturnValue(new MockHeadlessRuntime())
  })

  function createFallbackRuntime(preference: string = 'rust-sidecar') {
    return createDesktopAgentRuntime({
      runtimePreference: preference as any,
      sessionId: 'test-session',
      workspacePath: '/tmp',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
  }

  test('falls back to embedded headless on SidecarStartError', async () => {
    await withMockedRustRunUserTurn(async () => {
      throw new SidecarStartError('binary not found')
    }, async () => {
      mockRunDesktopHeadlessTurn.mockImplementation(async () => {})

      const runtime = createFallbackRuntime()

      await expect(
        runtime.runUserTurn('hello', new AbortController().signal),
      ).resolves.toBeUndefined()

      // The embedded headless turn was dispatched
      expect(mockRunDesktopHeadlessTurn).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.anything(),
      )
    })
  })

  test('does NOT fallback on non-startup error — rethrows', async () => {
    await withMockedRustRunUserTurn(async () => {
      throw new Error('unexpected runtime failure')
    }, async () => {
      const runtime = createFallbackRuntime()

      await expect(
        runtime.runUserTurn('hello', new AbortController().signal),
      ).rejects.toThrow('unexpected runtime failure')
    })
  })

  test('does NOT fallback when signal is already aborted', async () => {
    await withMockedRustRunUserTurn(async () => {
      throw new SidecarStartError('binary not found')
    }, async () => {
      const runtime = createFallbackRuntime()
      const controller = new AbortController()
      controller.abort()

      await expect(
        runtime.runUserTurn('hello', controller.signal),
      ).rejects.toThrow(SidecarStartError)
    })
  })

  test('subsequent turns use embedded runtime after fallback', async () => {
    let callCount = 0
    await withMockedRustRunUserTurn(async () => {
      callCount++
      throw new SidecarStartError('binary not found')
    }, async () => {
      mockRunDesktopHeadlessTurn.mockImplementation(async () => {})

      const runtime = createFallbackRuntime()

      // First turn triggers fallback → goes to embedded
      await runtime.runUserTurn('first message', new AbortController().signal)
      expect(callCount).toBe(1)
      expect(mockRunDesktopHeadlessTurn).toHaveBeenCalledTimes(1)

      // Second turn — Rust prototype still throws but fallback is cached
      mockRunDesktopHeadlessTurn.mockImplementation(async () => {})
      await runtime.runUserTurn('second message', new AbortController().signal)

      expect(callCount).toBe(1) // Rust was never called again
      expect(mockRunDesktopHeadlessTurn).toHaveBeenCalledTimes(2)
    })
  })

  test('embedded runtime state methods are forwarded', async () => {
    await withMockedRustRunUserTurn(async () => {}, async () => {
      mockRunDesktopHeadlessTurn.mockImplementation(async () => {})

      const runtime = createFallbackRuntime()

      expect(() => runtime.setModel('new-model')).not.toThrow()
      expect(() =>
        runtime.setModelProvider('openai', 'gpt-4o', undefined),
      ).not.toThrow()
      expect(() => runtime.setPermissionMode('full-access')).not.toThrow()
      expect(() => runtime.setPlanModeActive(true)).not.toThrow()
      expect(() => runtime.setDebugConversationDump(true)).not.toThrow()

      const status = runtime.getMcpRuntimeStatus()
      expect(status).toEqual({
        servers: [],
        totalTools: 0,
        totalResources: 0,
        totalPrompts: 0,
      })
    })
  })

  test('auto preference creates RustFallbackDesktopAgentRuntime with same fallback behavior', async () => {
    await withMockedRustRunUserTurn(async () => {
      throw new SidecarStartError('binary not found')
    }, async () => {
      mockRunDesktopHeadlessTurn.mockImplementation(async () => {})

      const runtime = createFallbackRuntime('auto')

      await expect(
        runtime.runUserTurn('hello', new AbortController().signal),
      ).resolves.toBeUndefined()

      // The embedded headless turn was dispatched (same fallback as rust-sidecar)
      expect(mockRunDesktopHeadlessTurn).toHaveBeenCalledWith(
        expect.anything(),
        'hello',
        expect.anything(),
      )
    })
  })
})

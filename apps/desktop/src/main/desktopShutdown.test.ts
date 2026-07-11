import { expect, mock, test } from 'bun:test'
import {
  createDesktopShutdown,
  createDesktopShutdownController,
} from './desktopShutdown.js'

test('shutdown is a singleton and always disposes and quits after flush failures', async () => {
  const calls: string[] = []
  const logError = mock((_step: string, _error: unknown) => {})
  const shutdown = createDesktopShutdown({
    flushRollout: async () => {
      calls.push('rollout')
      throw new Error('rollout failed')
    },
    flushSessionStore: async () => {
      calls.push('session-store')
      throw new Error('session store failed')
    },
    disposeSessions: async () => {
      calls.push('dispose')
      throw new Error('dispose failed')
    },
    quit: () => calls.push('quit'),
    logError,
  })

  const first = shutdown()
  const second = shutdown()
  expect(second).toBe(first)
  await expect(first).resolves.toBeUndefined()

  expect(calls).toEqual(['rollout', 'session-store', 'dispose', 'quit'])
  expect(logError).toHaveBeenCalledTimes(3)
})

test('before-quit remains prevented until internal shutdown finally marks complete', async () => {
  let releaseDispose: (() => void) | undefined
  const disposing = new Promise<void>(resolve => {
    releaseDispose = resolve
  })
  const preventDefault = mock(() => {})
  let controller: ReturnType<typeof createDesktopShutdownController>
  const reentrantPreventDefault = mock(() => {})
  controller = createDesktopShutdownController({
    flushRollout: async () => {},
    flushSessionStore: async () => {},
    disposeSessions: async () => disposing,
    quit: () => controller.handleBeforeQuit({ preventDefault: reentrantPreventDefault }),
    logError: () => {},
  })

  controller.handleBeforeQuit({ preventDefault })
  controller.handleBeforeQuit({ preventDefault })
  expect(preventDefault).toHaveBeenCalledTimes(2)

  releaseDispose?.()
  await controller.shutdownPromise
  expect(reentrantPreventDefault).toHaveBeenCalledTimes(0)
})

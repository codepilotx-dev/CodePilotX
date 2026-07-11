import { expect, mock, test } from 'bun:test'
import {
  createDesktopShutdown,
  createDesktopShutdownController,
} from './desktopShutdown.js'

test('shutdown rejects without disposing or quitting and can retry after flush recovery', async () => {
  const calls: string[] = []
  let failing = true
  const logError = mock((_step: string, _error: unknown) => {})
  const shutdown = createDesktopShutdown({
    flushRollout: async () => {
      calls.push('rollout')
      if (failing) throw new Error('rollout failed')
    },
    flushSessionStore: async () => {
      calls.push('session-store')
    },
    disposeSessions: async () => {
      calls.push('dispose')
    },
    quit: () => calls.push('quit'),
    logError,
  })

  const first = shutdown()
  const second = shutdown()
  expect(second).toBe(first)
  await expect(first).rejects.toThrow('rollout failed')

  expect(calls).toEqual(['rollout'])
  expect(logError).toHaveBeenCalledTimes(1)

  failing = false
  await shutdown()
  expect(calls).toEqual(['rollout', 'rollout', 'session-store', 'dispose', 'quit'])
})

test('before-quit controller resets its failed promise so persistence can retry', async () => {
  let failing = true
  const quit = mock(() => {})
  const controller = createDesktopShutdownController({
    flushRollout: async () => {
      if (failing) throw new Error('disk full')
    },
    flushSessionStore: async () => {},
    disposeSessions: async () => {},
    quit,
    logError: () => {},
  })
  controller.handleBeforeQuit({ preventDefault() {} })
  await expect(controller.shutdownPromise).rejects.toThrow('disk full')
  expect(quit).not.toHaveBeenCalled()

  failing = false
  controller.handleBeforeQuit({ preventDefault() {} })
  await controller.shutdownPromise
  expect(quit).toHaveBeenCalledTimes(1)
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

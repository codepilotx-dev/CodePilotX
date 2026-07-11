import { describe, expect, test } from 'bun:test'
import {
  disposeDesktopSessionRuntimes,
  disposeDesktopSession,
  removeSessionIndexWithRetry,
} from './desktopSessionRemoval.js'

describe('desktop session removal', () => {
  test('app shutdown awaits every session runtime disposal', async () => {
    const completed: string[] = []
    let release: (() => void) | undefined
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    const disposing = disposeDesktopSessionRuntimes([
      async () => {
        await blocked
        completed.push('first')
      },
      async () => {
        completed.push('second')
      },
    ])

    await Promise.resolve()
    expect(completed).toEqual(['second'])
    release?.()
    await disposing
    expect(completed).toEqual(['second', 'first'])
  })

  test('closes a pending session without a server Thread as a local-only removal', async () => {
    const calls: string[] = []

    await disposeDesktopSession({
      sessionId: 'pending-1',
      appServerThreadId: null,
      appServerThreadPending: true,
      deleteThread: async () => {
        calls.push('delete-thread')
      },
      removeIndex: async () => {
        calls.push('remove-index')
      },
      removeLocalState: () => calls.push('remove-local-state'),
      disposeRuntime: async () => {
        calls.push('dispose-runtime')
      },
    })

    expect(calls).toEqual([
      'remove-index',
      'remove-local-state',
      'dispose-runtime',
    ])
  })

  test('keeps local state when index removal fails after a server delete', async () => {
    const calls: string[] = []

    await expect(
      disposeDesktopSession({
        sessionId: 'thread-1',
        appServerThreadId: 'thread-1',
        appServerThreadPending: false,
        deleteThread: async () => {
          calls.push('delete-thread')
        },
        removeIndex: async () => {
          calls.push('remove-index')
          throw new Error('SQLite is locked')
        },
        removeLocalState: () => calls.push('remove-local-state'),
        disposeRuntime: async () => {
          calls.push('dispose-runtime')
        },
      }),
    ).rejects.toThrow('SQLite is locked')

    expect(calls).toEqual(['delete-thread', 'remove-index'])
  })

  test('reports the third index-removal failure after the configured retry schedule', async () => {
    const calls: number[] = []
    const delays: number[] = []

    await expect(
      removeSessionIndexWithRetry(
        'session-1',
        async () => {
          calls.push(calls.length)
          throw new Error('SQLite is locked')
        },
        async delayMs => {
          delays.push(delayMs)
        },
      ),
    ).rejects.toThrow('SQLite is locked')

    expect(calls).toHaveLength(3)
    expect(delays).toEqual([100, 500])
  })
})

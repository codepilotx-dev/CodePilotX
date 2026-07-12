import { describe, expect, test } from 'bun:test'
import {
  archiveDesktopSession,
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
      flushPersistence: async () => {
        calls.push('flush')
      },
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
      'flush',
      'remove-index',
      'remove-local-state',
      'dispose-runtime',
    ])
  })

  test('removes an orphaned local session without requiring a server Thread', async () => {
    const calls: string[] = []

    await disposeDesktopSession({
      sessionId: 'local-orphan',
      appServerThreadId: null,
      appServerThreadPending: false,
      flushPersistence: async () => {
        calls.push('flush')
      },
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
      'flush',
      'remove-index',
      'remove-local-state',
      'dispose-runtime',
    ])
  })

  test('archives a local-only session by removing it without a server RPC', async () => {
    const calls: string[] = []

    const result = await archiveDesktopSession({
      appServerThreadId: null,
      archiveThread: async () => calls.push('archive-thread'),
      removeLocalSession: async () => {
        calls.push('remove-local-session')
      },
    })

    expect(result).toBe('removed')
    expect(calls).toEqual(['remove-local-session'])
  })

  test('keeps local state when index removal fails after a server delete', async () => {
    const calls: string[] = []

    await expect(
      disposeDesktopSession({
        sessionId: 'thread-1',
        appServerThreadId: 'thread-1',
        appServerThreadPending: false,
        flushPersistence: async () => {
          calls.push('flush')
        },
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

    expect(calls).toEqual(['flush', 'delete-thread', 'remove-index'])
  })

  test('persistence failure keeps server, index, runtime and local state intact', async () => {
    const calls: string[] = []
    await expect(
      disposeDesktopSession({
        sessionId: 'thread-unsaved',
        appServerThreadId: 'thread-unsaved',
        appServerThreadPending: false,
        flushPersistence: async () => {
          calls.push('flush')
          throw new Error('ENOSPC')
        },
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
      }),
    ).rejects.toThrow('ENOSPC')
    expect(calls).toEqual(['flush'])
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

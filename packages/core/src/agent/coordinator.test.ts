import { expect, test } from 'bun:test'
import { SessionCoordinator } from './coordinator.js'

test('single run drains and returns the result', async () => {
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => `${key}-${mode}-done`,
  })

  const result = await coordinator.run('thread-1')
  expect(result).toBe('thread-1-run-done')
  expect(coordinator.isIdle).toBe(true)
})

test('serialized runs on same key are sequential, not parallel', async () => {
  const order: string[] = []
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => {
      order.push(`start-${mode}`)
      await new Promise(r => setTimeout(r, 5))
      order.push(`end-${mode}`)
      return `${key}-${mode}`
    },
  })

  const [r1, r2] = await Promise.all([
    coordinator.run('same-key'),
    coordinator.run('same-key'),
  ])

  // Only one drain should have happened (second is coalesced)
  expect(r1).toBe('same-key-run')
  expect(r2).toBe('same-key-run')
  expect(order).toEqual(['start-run', 'end-run'])
})

test('different keys run in parallel', async () => {
  const order: string[] = []
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => {
      order.push(`start-${key}`)
      await new Promise(r => setTimeout(r, 5))
      order.push(`end-${key}`)
      return `${key}-${mode}`
    },
  })

  const [r1, r2] = await Promise.all([
    coordinator.run('thread-a'),
    coordinator.run('thread-b'),
  ])

  expect(r1).toBe('thread-a-run')
  expect(r2).toBe('thread-b-run')
  // Both should start before either ends (parallel)
  expect(order).toEqual(['start-thread-a', 'start-thread-b', 'end-thread-a', 'end-thread-b'])
})

test('wake starts a drain and fires coalesced rerun', async () => {
  const order: string[] = []
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => {
      order.push(`drain-${mode}`)
      return `${key}-${mode}`
    },
  })

  // wake without existing drain → starts wake-mode drain
  await coordinator.wake('key-1')

  // If already draining, wake sets rerun flag but doesn't start a new drain
  await coordinator.wake('key-1')

  expect(order).toEqual(['drain-wake', 'drain-wake'])
  expect(coordinator.isIdle).toBe(true)
})

test('awaitIdle returns undefined for unknown key', async () => {
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => `${key}-done`,
  })

  const result = await coordinator.awaitIdle('unknown')
  expect(result).toBeUndefined()
})

test('awaitIdle waits for active drain to complete', async () => {
  const coordinator = new SessionCoordinator<string>({
    drain: async (key, mode) => {
      await new Promise(r => setTimeout(r, 5))
      return `${key}-done`
    },
  })

  const drainPromise = coordinator.run('key-1')
  // drain hasn't completed yet
  expect(coordinator.isIdle).toBe(false)

  const result = await coordinator.awaitIdle('key-1')
  expect(result).toBe('key-1-done')
  await drainPromise
  expect(coordinator.isIdle).toBe(true)
})

test('onFailure is called when drain throws', async () => {
  const failures: Array<{ key: string; error: Error }> = []
  const coordinator = new SessionCoordinator<string>({
    drain: async (_key, _mode) => {
      throw new Error('drain error')
    },
    onFailure: (key, error) => {
      failures.push({ key, error })
    },
  })

  await expect(coordinator.run('key-2')).rejects.toThrow('drain error')
  expect(failures).toHaveLength(1)
  expect(failures[0].key).toBe('key-2')
  expect(coordinator.isIdle).toBe(true)
})

test('activeKeys returns running keys', async () => {
  const coordinator = new SessionCoordinator<string>({
    drain: async (key) => {
      await new Promise(r => setTimeout(r, 10))
      return `${key}-done`
    },
  })

  const runPromise = coordinator.run('key-a')
  expect(coordinator.activeKeys).toEqual(['key-a'])
  await runPromise
  expect(coordinator.activeKeys).toEqual([])
})

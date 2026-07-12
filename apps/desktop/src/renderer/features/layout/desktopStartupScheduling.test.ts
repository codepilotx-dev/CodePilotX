import { expect, test } from 'bun:test'
import { canCommitProviderCatalog, createBrowserRequestController, createLatestRequestGuard, getProviderCatalogKey, mergeBrowserStateError, scheduleIdleTask } from './desktopStartupScheduling.js'
import type { DesktopBrowserState, DesktopModelProviderState } from '../../../shared/types.js'

test('latest request guard rejects stale and disposed generations', () => {
  const guard = createLatestRequestGuard()
  const first = guard.begin()
  const second = guard.begin()
  expect(guard.isCurrent(first)).toBe(false)
  expect(guard.isCurrent(second)).toBe(true)
  guard.dispose()
  expect(guard.isCurrent(second)).toBe(false)
})

test('latest request guard prevents an older deferred browser response from committing', async () => {
  const guard = createLatestRequestGuard()
  const first = deferred<string>()
  const second = deferred<string>()
  const committed: string[] = []
  const run = (request: Promise<string>): void => {
    const generation = guard.begin()
    void request.then(value => {
      if (guard.isCurrent(generation)) committed.push(value)
    })
  }

  run(first.promise)
  run(second.promise)
  second.resolve('new')
  await Promise.resolve()
  first.resolve('old')
  await Promise.resolve()
  expect(committed).toEqual(['new'])
})

test('browser controller does not start a read while open is pending', async () => {
  const commits: string[] = []
  const controller = createBrowserRequestController<string>(value => commits.push(value))
  const opening = deferred<string>()
  const read = deferred<string>()
  controller.open(() => opening.promise)
  expect(controller.read(() => read.promise)).toBe(false)
  opening.resolve('opened')
  await Promise.resolve()
  expect(commits).toEqual(['opened'])
})

test('browser mutation invalidates an older poll response', async () => {
  const commits: string[] = []
  const controller = createBrowserRequestController<string>(value => commits.push(value))
  const poll = deferred<string>()
  controller.read(() => poll.promise)
  controller.runMutation(() => Promise.resolve('navigated'))
  await Promise.resolve()
  poll.resolve('stale poll')
  await Promise.resolve()
  expect(commits).toEqual(['navigated'])
})

test('browser controller ignores mutation results after dispose', async () => {
  const commits: string[] = []
  const controller = createBrowserRequestController<string>(value => commits.push(value))
  const mutation = deferred<string>()
  controller.runMutation(() => mutation.promise)
  controller.dispose()
  mutation.resolve('stale mutation')
  await Promise.resolve()
  expect(commits).toEqual([])
})

test('browser error helper preserves current state and exposes the error inline', () => {
  const current = { open: true, url: 'https://example.com', error: null } as DesktopBrowserState
  expect(mergeBrowserStateError(current, new Error('navigation failed'))).toEqual({
    ...current,
    error: 'navigation failed',
  })
  expect(mergeBrowserStateError(null, new Error('open failed'))).toBeNull()
})

test('browser controller does not report mutation errors after dispose', async () => {
  const errors: unknown[] = []
  const controller = createBrowserRequestController<string>(() => {}, error => errors.push(error))
  const mutation = deferred<string>()
  controller.runMutation(() => mutation.promise)
  controller.dispose()
  mutation.reject(new Error('stale failure'))
  await Promise.resolve()
  expect(errors).toEqual([])
})

test('browser controller commits only the latest mutation when responses resolve out of order', async () => {
  const commits: string[] = []
  const controller = createBrowserRequestController<string>(value => commits.push(value))
  const first = deferred<string>()
  const second = deferred<string>()
  controller.runMutation(() => first.promise)
  controller.runMutation(() => second.promise)
  second.resolve('second')
  await Promise.resolve()
  first.resolve('first')
  await Promise.resolve()
  expect(commits).toEqual(['second'])
})

test('latest request guard prevents provider commits after cleanup', async () => {
  const guard = createLatestRequestGuard()
  const request = deferred<string>()
  const committed: string[] = []
  const generation = guard.begin()
  void request.promise.then(value => {
    if (guard.isCurrent(generation)) committed.push(value)
  })
  guard.dispose()
  request.resolve('stale')
  await Promise.resolve()
  expect(committed).toEqual([])
})

test('provider catalog key changes with provider, base URL, and key state', () => {
  const base = {
    selectedProviderID: 'openai',
    baseURL: 'https://one.example',
    apiKeyConfigured: true,
  } as DesktopModelProviderState
  expect(getProviderCatalogKey(base)).not.toBe(getProviderCatalogKey({ ...base, selectedProviderID: 'other' }))
  expect(getProviderCatalogKey(base)).not.toBe(getProviderCatalogKey({ ...base, baseURL: 'https://two.example' }))
  expect(getProviderCatalogKey(base)).not.toBe(getProviderCatalogKey({ ...base, apiKeyConfigured: false }))
})

test('pending provider catalog remains committable across a same-key refresh only', () => {
  const key = 'provider\0base\0key'
  expect(canCommitProviderCatalog(true, key, key)).toBe(true)
  expect(canCommitProviderCatalog(true, 'provider\0other\0key', key)).toBe(false)
  expect(canCommitProviderCatalog(false, key, key)).toBe(false)
})

test('scheduleIdleTask uses requestIdleCallback and cancels the pending task', () => {
  let callback: (() => void) | undefined
  let cancelled: number | undefined
  const cancel = scheduleIdleTask(() => {}, {
    requestIdleCallback: next => {
      callback = next
      return 42
    },
    cancelIdleCallback: id => { cancelled = id },
    setTimeout: () => 7,
    clearTimeout: () => {},
  })

  expect(callback).toBeFunction()
  cancel()
  expect(cancelled).toBe(42)
})

test('scheduleIdleTask falls back to a cancellable timeout', () => {
  let cleared: number | undefined
  const cancel = scheduleIdleTask(() => {}, {
    setTimeout: () => 7,
    clearTimeout: id => { cleared = id },
  })

  cancel()
  expect(cleared).toBe(7)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

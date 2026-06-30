import { expect, test } from 'bun:test'
import { createSessionPersistScheduler } from './sessionPersistScheduler.js'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('session persist scheduler collapses debounced saves to the latest state', async () => {
  const saved: number[] = []
  let state = 1
  const scheduler = createSessionPersistScheduler({
    debounceMs: 10,
    getState: () => state,
    save: async value => {
      saved.push(value)
    },
  })

  scheduler.requestSave()
  state = 2
  scheduler.requestSave()
  state = 3
  scheduler.requestSave()

  await wait(30)
  await scheduler.flush()

  expect(saved).toEqual([3])
})

test('session persist scheduler serializes saves and writes latest state after an in-flight save', async () => {
  const saved: number[] = []
  let state = 1
  let releaseFirstSave: (() => void) | null = null
  const firstSave = new Promise<void>(resolve => {
    releaseFirstSave = resolve
  })
  const scheduler = createSessionPersistScheduler({
    debounceMs: 10,
    getState: () => state,
    save: async value => {
      saved.push(value)
      if (value === 1) {
        await firstSave
      }
    },
  })

  scheduler.requestSave({ immediate: true })
  await wait(0)
  state = 2
  scheduler.requestSave({ immediate: true })

  expect(saved).toEqual([1])
  releaseFirstSave?.()
  await scheduler.flush()

  expect(saved).toEqual([1, 2])
})

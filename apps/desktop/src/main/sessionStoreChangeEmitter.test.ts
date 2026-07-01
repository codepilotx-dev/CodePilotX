import { expect, test } from 'bun:test'
import { createSessionStoreChangeEmitter } from './sessionStoreChangeEmitter.js'

test('session store change emitter debounces non-immediate changes', () => {
  const emitted: number[] = []
  let timerCallback: (() => void) | null = null
  const emitter = createSessionStoreChangeEmitter({
    debounceMs: 100,
    emit: () => emitted.push(Date.now()),
    setTimeout: callback => {
      timerCallback = callback
      return 1
    },
    clearTimeout: () => {
      timerCallback = null
    },
  })

  emitter.requestEmit()
  emitter.requestEmit()

  expect(emitted).toHaveLength(0)
  timerCallback?.()
  expect(emitted).toHaveLength(1)
})

test('session store change emitter flushes pending debounce for immediate changes', () => {
  const emitted: string[] = []
  let timerCallback: (() => void) | null = null
  const emitter = createSessionStoreChangeEmitter({
    debounceMs: 100,
    emit: () => emitted.push('emit'),
    setTimeout: callback => {
      timerCallback = callback
      return 1
    },
    clearTimeout: () => {
      timerCallback = null
    },
  })

  emitter.requestEmit()
  emitter.requestEmit({ immediate: true })

  expect(timerCallback).toBeNull()
  expect(emitted).toEqual(['emit'])
})

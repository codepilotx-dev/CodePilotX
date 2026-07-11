import { expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { terminateChildProcess } from './childProcessTermination.js'

class FakeChild extends EventEmitter {
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  pid = 123
  kill = mock(() => {
    this.killed = true
    return true
  })
}

test('termination waits for exit and does not treat error as exit', async () => {
  const child = new FakeChild()
  let settled = false
  const terminating = terminateChildProcess(child as never, {
    timeoutMs: 1_000,
    forceKill: async () => {},
  }).then(() => {
    settled = true
  })

  child.emit('error', new Error('kill signal delivery error'))
  await Promise.resolve()
  expect(settled).toBe(false)
  child.exitCode = 0
  child.emit('exit', 0, null)
  await terminating
  expect(settled).toBe(true)
})

test('termination timeout invokes force kill and still waits for exit', async () => {
  const child = new FakeChild()
  const forceKill = mock(async () => {
    child.exitCode = 1
    child.emit('close', 1, 'SIGKILL')
  })

  await terminateChildProcess(child as never, { timeoutMs: 1, forceKill })

  expect(forceKill).toHaveBeenCalledTimes(1)
})

test('termination propagates kill errors', async () => {
  const child = new FakeChild()
  child.kill = mock(() => {
    throw new Error('kill denied')
  })

  await expect(
    terminateChildProcess(child as never, { timeoutMs: 1 }),
  ).rejects.toThrow('kill denied')
})

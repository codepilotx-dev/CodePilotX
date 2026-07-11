import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'

const children: FakeAppServerProcess[] = []
let activeChildren = 0

class FakeAppServerProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(private readonly failThreadStart: boolean) {
    super()
    activeChildren += 1
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const message = JSON.parse(String(chunk).trim()) as {
          id?: number
          method?: string
        }
        if (message.method === 'turn/start') {
          queueMicrotask(() => {
            callback(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
          })
          return
        }
        queueMicrotask(() => {
          if (message.method === 'initialize') {
            this.respond(message.id!, {
              userAgent: 'test',
              codexHome: 'test',
              codepilotxHome: 'test',
              platformFamily: 'windows',
              platformOs: 'windows',
            })
          } else if (message.method === 'thread/start') {
            if (this.failThreadStart) {
              this.stdout.write(`${JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32000, message: 'thread start failed' },
              })}\n`)
            } else {
              this.respond(message.id!, { thread: { id: 'thread-fresh' } })
            }
          }
        })
        callback()
      },
    })
  }

  kill(): boolean {
    if (this.killed) return false
    this.killed = true
    queueMicrotask(() => {
      this.exitCode = 0
      activeChildren -= 1
      this.emit('exit', 0, null)
    })
    return true
  }

  private respond(id: number, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
  }
}

mock.module('node:fs', () => ({
  ...fs,
  existsSync: () => true,
}))

mock.module('node:child_process', () => ({
  ...childProcess,
  spawn: mock(() => {
    const child = new FakeAppServerProcess(children.length === 0)
    children.push(child)
    return child
  }),
}))

const { RustSidecarDesktopAgentRuntime } = await import('./rustSidecarRuntime.js')

test('thread start failure kills the failed child and the next attempt spawns fresh', async () => {
  const events: Array<{ type: string; message?: string }> = []
  const unhandledRejections: unknown[] = []
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason)
  }
  process.on('unhandledRejection', onUnhandledRejection)
  const runtime = new RustSidecarDesktopAgentRuntime({
    sessionId: 'startup-retry',
    workspacePath: process.cwd(),
    emit: event => events.push(event),
    requestPermission: async () => ({ behavior: 'deny' }),
  })
  const internals = runtime as unknown as {
    startupState: string
    child: FakeAppServerProcess | null
    startAppServer(): Promise<void>
  }

  await expect(
    runtime.runUserTurn('first', new AbortController().signal),
  ).rejects.toThrow('thread start failed')
  expect(events).toEqual([
    expect.objectContaining({ type: 'error', message: 'thread start failed' }),
  ])
  expect(internals.startupState).toBe('failed')
  expect(children).toHaveLength(1)
  expect(children[0].killed).toBe(true)
  expect(activeChildren).toBe(0)
  expect(internals.child).toBeNull()

  await internals.startAppServer()
  expect(internals.startupState).toBe('ready')
  expect(children).toHaveLength(2)
  expect(children[1].killed).toBe(false)
  expect(activeChildren).toBe(1)

  await expect(
    runtime.runUserTurn('second', new AbortController().signal),
  ).rejects.toThrow('broken pipe')
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(events).toEqual([
    expect.objectContaining({ type: 'error', message: 'thread start failed' }),
    expect.objectContaining({ type: 'error', message: 'broken pipe' }),
  ])
  expect(unhandledRejections).toEqual([])

  await runtime.dispose()
  expect(children[1].killed).toBe(true)
  expect(activeChildren).toBe(0)
  process.off('unhandledRejection', onUnhandledRejection)
})

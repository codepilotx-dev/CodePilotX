import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'

const children: FakeAppServerProcess[] = []

class FakeAppServerProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(private readonly failThreadStart: boolean) {
    super()
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const message = JSON.parse(String(chunk).trim()) as {
          id?: number
          method?: string
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
  const runtime = new RustSidecarDesktopAgentRuntime({
    sessionId: 'startup-retry',
    workspacePath: process.cwd(),
    emit: () => {},
    requestPermission: async () => ({ behavior: 'deny' }),
  })
  const internals = runtime as unknown as {
    startupState: string
    child: FakeAppServerProcess | null
    startAppServer(): Promise<void>
  }

  await expect(internals.startAppServer()).rejects.toThrow('thread start failed')
  expect(internals.startupState).toBe('failed')
  expect(children).toHaveLength(1)
  expect(children[0].killed).toBe(true)
  expect(internals.child).toBeNull()

  await internals.startAppServer()
  expect(internals.startupState).toBe('ready')
  expect(children).toHaveLength(2)
  expect(children[1].killed).toBe(false)

  await runtime.dispose()
  expect(children[1].killed).toBe(true)
})

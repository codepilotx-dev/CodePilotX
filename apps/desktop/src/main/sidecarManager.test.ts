import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

type Handler = (params: unknown) => unknown

class FakeConnection {
  readonly notificationHandlers = new Map<string, Handler>()
  readonly requestHandlers = new Map<string, Handler>()
  readonly sentRequests: Array<{ method: string; params: unknown }> = []

  listen(): void {}

  onNotification(method: string, handler: Handler): void {
    this.notificationHandlers.set(method, handler)
  }

  onRequest(method: string, handler: Handler): void {
    this.requestHandlers.set(method, handler)
  }

  async sendRequest<T>(method: string, params: unknown): Promise<T> {
    this.sentRequests.push({ method, params })
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        capabilities: {
          transports: ['stdio'],
          methods: [],
          notifications: [],
        },
      } as T
    }
    return undefined as T
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('exit', null, null)
    return true
  }
}

const fakeConnection = new FakeConnection()

mock.module('node:child_process', () => ({
  ...childProcess,
  spawn: mock(() => new FakeChildProcess()),
}))

mock.module('vscode-jsonrpc/node', () => ({
  createMessageConnection: () => fakeConnection,
  ResponseError: class ResponseError<T = unknown> extends Error {
    constructor(
      public readonly code: number,
      message: string,
      public readonly data?: T,
    ) {
      super(message)
      this.name = 'ResponseError'
    }
  },
  StreamMessageReader: class {
    constructor(_stream: unknown) {}
  },
  StreamMessageWriter: class {
    constructor(_stream: unknown) {}
  },
}))

const { SidecarManager } = await import('./sidecarManager.js')

test('sidecar permission notifications are returned through control/submit', async () => {
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
  })
  await manager.start()

  expect(fakeConnection.notificationHandlers.has('pending/tool/permission')).toBe(true)
  expect(fakeConnection.requestHandlers.has('pending/tool/permission')).toBe(false)

  manager.on('permissionRequest', context => {
    manager.respondPermission(context.requestId, { behavior: 'allow' })
  })

  fakeConnection.notificationHandlers.get('pending/tool/permission')?.({
    requestId: 'permission-1',
    toolName: 'Read',
    input: { file_path: 'README.md' },
    description: 'Read README.md',
  })

  expect(fakeConnection.sentRequests).toContainEqual({
    method: 'control/submit',
    params: {
      requestId: 'permission-1',
      decision: { behavior: 'allow' },
    },
  })
})

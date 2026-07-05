import { beforeEach, expect, mock, test } from 'bun:test'
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
const spawnedChildren: FakeChildProcess[] = []
let nextSpawnError: Error | null = null
const spawnMock = mock(() => {
  const child = new FakeChildProcess()
  spawnedChildren.push(child)
  const error = nextSpawnError
  if (error) {
    queueMicrotask(() => child.emit('error', error))
  }
  return child
})

mock.module('node:child_process', () => ({
  ...childProcess,
  spawn: spawnMock,
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

const { SidecarManager, buildSidecarEnv } = await import('./sidecarManager.js')

beforeEach(() => {
  fakeConnection.notificationHandlers.clear()
  fakeConnection.requestHandlers.clear()
  fakeConnection.sentRequests.length = 0
  spawnedChildren.length = 0
  nextSpawnError = null
  spawnMock.mockClear()
})

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

test('sidecar start reports spawn errors before sending initialize', async () => {
  nextSpawnError = new Error('spawn bun ENOENT')
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
  })

  await expect(manager.start()).rejects.toThrow('spawn bun ENOENT')
  expect(fakeConnection.sentRequests.some(request => request.method === 'initialize')).toBe(false)
})

test('sidecar env preserves desktop runtime environment paths', () => {
  const env = buildSidecarEnv({
    sessionId: 'session-1',
    workspacePath: 'C:\\workspace',
    runtimeEnvironment: {
      Path: 'C:\\bun;C:\\Windows\\System32',
    },
  } as any)

  expect(env.Path).toBe('C:\\bun;C:\\Windows\\System32')
})

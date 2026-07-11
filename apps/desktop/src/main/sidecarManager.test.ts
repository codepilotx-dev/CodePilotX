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
  dispose(): void {
    if (nextDisposeError) throw nextDisposeError
  }

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
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killCount = 0

  kill(): boolean {
    this.killCount += 1
    if (nextKillError) throw nextKillError
    this.killed = true
    if (autoExitOnKill) {
      this.exitCode = 0
      this.emit('exit', 0, null)
    }
    return true
  }
}

const fakeConnection = new FakeConnection()
const spawnedChildren: FakeChildProcess[] = []
let nextSpawnError: Error | null = null
let nextKillError: Error | null = null
let nextDisposeError: Error | null = null
let autoExitOnKill = true
const spawnMock = mock((..._args: unknown[]) => {
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
  nextKillError = null
  nextDisposeError = null
  autoExitOnKill = true
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

test('sidecar process environment excludes inherited credential variables', async () => {
  const previous = process.env.SENTINEL_PROVIDER_API_KEY
  process.env.SENTINEL_PROVIDER_API_KEY = 'sentinel-secret-value'
  try {
    const manager = new SidecarManager({
      entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
      cwd: process.cwd(),
      env: {},
    })

    await manager.start()

    const spawnOptions = spawnMock.mock.calls[0]?.[2] as
      | { env?: Record<string, string | undefined> }
      | undefined
    expect(spawnOptions?.env?.SENTINEL_PROVIDER_API_KEY).toBeUndefined()
  } finally {
    if (previous === undefined) {
      delete process.env.SENTINEL_PROVIDER_API_KEY
    } else {
      process.env.SENTINEL_PROVIDER_API_KEY = previous
    }
  }
})

test('sidecar stop is idempotent and waits for process exit', async () => {
  autoExitOnKill = false
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
    stopTimeoutMs: 1_000,
  })
  await manager.start()
  const child = spawnedChildren[0]
  let settled = false
  const first = manager.stop().then(() => {
    settled = true
  })
  const second = manager.stop()
  child.emit('error', new Error('not an exit'))
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(child.killCount).toBe(1)

  child.exitCode = 0
  child.emit('exit', 0, null)
  await Promise.all([first, second])
  expect(settled).toBe(true)
  expect(child.killCount).toBe(1)
})

test('sidecar stop timeout uses force kill and waits for close', async () => {
  autoExitOnKill = false
  const forceKill = mock(async (child: FakeChildProcess) => {
    child.signalCode = 'SIGKILL'
    child.emit('close', null, 'SIGKILL')
  })
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
    stopTimeoutMs: 1,
    forceKill: forceKill as never,
  })
  await manager.start()

  await manager.stop()

  expect(forceKill).toHaveBeenCalledTimes(1)
})

test('sidecar stop propagates kill errors', async () => {
  nextKillError = new Error('kill denied')
  const forceKill = mock(async (child: FakeChildProcess) => {
    child.exitCode = 1
    child.emit('exit', 1, 'SIGKILL')
  })
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
    forceKill: forceKill as never,
  })
  await manager.start()

  await expect(manager.stop()).rejects.toThrow('kill denied')
  expect(forceKill).toHaveBeenCalledTimes(1)
})

test('sidecar stop still terminates the child when connection cleanup fails', async () => {
  nextDisposeError = new Error('connection dispose failed')
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
  })
  await manager.start()
  const child = spawnedChildren[0]

  await expect(manager.stop()).rejects.toThrow('connection dispose failed')
  expect(child.killCount).toBe(1)
})

test('sidecar stop reports cleanup and termination failures together', async () => {
  nextDisposeError = new Error('connection dispose failed')
  nextKillError = new Error('kill denied')
  const manager = new SidecarManager({
    entrypoint: 'apps/tui/src/entrypoints/appServer.ts',
    cwd: process.cwd(),
    env: {},
  })
  await manager.start()

  const error = await manager.stop().catch(value => value)
  expect(error).toBeInstanceOf(AggregateError)
  expect((error as AggregateError).errors).toHaveLength(2)
})

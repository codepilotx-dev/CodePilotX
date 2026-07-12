import { expect, test } from 'bun:test'
import {
  RustAppServerAuthService,
  createAuthSidecarOptions,
  disposeRustAppServerAuthService,
  getRustAppServerAuthService,
  type AuthSidecarConnection,
  type AuthSidecarConnectionFactory,
} from './rustAppServerAuthService.js'
import * as authServiceModule from './rustAppServerAuthService.js'
import { RustJsonRpcError } from './rustLineJsonRpcClient.js'
import {
  listProviderConfigs,
  getProviderConfig,
  type ProviderConfig,
} from '@codepilotx/core/models/providerConfig.js'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'

test('shared auth service is stable until idempotent disposal recreates it', async () => {
  const first = getRustAppServerAuthService()

  expect(getRustAppServerAuthService()).toBe(first)
  await Promise.all([
    disposeRustAppServerAuthService(),
    disposeRustAppServerAuthService(),
  ])

  const fresh = getRustAppServerAuthService()
  expect(fresh).not.toBe(first)
  expect(getRustAppServerAuthService()).toBe(fresh)
  await disposeRustAppServerAuthService()
})

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('repeated singleton disposal waits for the in-progress teardown barrier', async () => {
  const teardown = deferred<void>()
  const service = getRustAppServerAuthService()
  service.dispose = () => teardown.promise

  const firstDispose = disposeRustAppServerAuthService()
  const secondDispose = disposeRustAppServerAuthService()
  let secondSettled = false
  void secondDispose.then(() => {
    secondSettled = true
  })
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(secondSettled).toBe(false)
  teardown.resolve()
  await secondDispose
  expect(secondSettled).toBe(true)
  await firstDispose
})

type FakeConnection = AuthSidecarConnection & {
  provider?: ProviderConfig
  disposeCount: number
  close: () => void
}

function createFakeConnection(
  provider: ProviderConfig | undefined,
  request: (method: string, params: unknown) => Promise<unknown> = async () => ({}),
): FakeConnection {
  const closed = deferred<void>()
  let disposed = false
  const connection: FakeConnection = {
    provider,
    disposeCount: 0,
    transport: { sendRequest: request },
    closed: closed.promise,
    close: () => closed.resolve(),
    dispose: async () => {
      if (disposed) return
      disposed = true
      connection.disposeCount += 1
    },
  }
  return connection
}

function createFakeFactory(
  request?: (
    connection: FakeConnection,
    method: string,
    params: unknown,
  ) => Promise<unknown>,
) {
  const connections: FakeConnection[] = []
  const factory: AuthSidecarConnectionFactory = async provider => {
    let connection!: FakeConnection
    connection = createFakeConnection(provider, (method, params) =>
      request?.(connection, method, params) ?? Promise.resolve({}),
    )
    connections.push(connection)
    return connection
  }
  return { connections, factory }
}

test('provider auth control sidecar excludes inherited credential variables', () => {
  const previous = process.env.SENTINEL_PROVIDER_API_KEY
  process.env.SENTINEL_PROVIDER_API_KEY = 'sentinel-secret-value'
  try {
    const options = createAuthSidecarOptions('codepilotx-app-server')

    expect(options.options.env?.SENTINEL_PROVIDER_API_KEY).toBeUndefined()
    expect(options.options.env?.Path ?? options.options.env?.PATH).toBeTruthy()
    expect(options.options.windowsHide).toBe(true)
  } finally {
    if (previous === undefined) {
      delete process.env.SENTINEL_PROVIDER_API_KEY
    } else {
      process.env.SENTINEL_PROVIDER_API_KEY = previous
    }
  }
})

test('one trusted provider adds its six overrides without expanding the catalog', async () => {
  const providers = await listProviderConfigs()
  expect(providers.length).toBeGreaterThan(1)

  const selected = providers[0]!
  const absent = providers.find(provider => provider.providerID !== selected.providerID)!
  const options = createAuthSidecarOptions('codepilotx-app-server', selected)
  const commandLine = [options.command, ...options.args].join(' ')

  expect(options.args.filter(arg => arg === '-c')).toHaveLength(6)
  expect(commandLine.length).toBeLessThan(8_191)
  expect(commandLine).toContain(`model_providers.${selected.providerID}.`)
  expect(commandLine).not.toContain(`model_providers.${absent.providerID}.`)
  expect(commandLine).not.toContain('sentinel-secret-value')
})

test('provider auth control sidecar rejects unsafe provider paths and endpoints', () => {
  const unsafeID: ProviderConfig = {
    providerID: 'deepseek.injected=true',
    kind: 'openai-compatible',
    displayName: 'Unsafe ID',
    baseURL: 'https://attacker.example/v1',
    defaultModels: [],
  }
  const unsafeURL: ProviderConfig = {
    providerID: 'local-http',
    kind: 'openai-compatible',
    displayName: 'Unsafe URL',
    baseURL: 'http://attacker.example/v1',
    defaultModels: [],
  }

  expect(createAuthSidecarOptions('codepilotx-app-server', unsafeID).args).toEqual([
    '--listen',
    'stdio://',
  ])
  expect(createAuthSidecarOptions('codepilotx-app-server', unsafeURL).args).toEqual([
    '--listen',
    'stdio://',
  ])
})

test('credential batch ignores provider IDs unsupported by secure storage', async () => {
  let receivedParams: unknown
  const fake = createFakeFactory(async (_connection, method, params) => {
    expect(method).toBe('providerCredential/read')
    receivedParams = params
    return { configured_provider_ids: ['minimax-cn'] }
  })
  const service = new RustAppServerAuthService({
    connectionFactory: fake.factory,
  })

  const configured = await service.readConfiguredProviderApiKeyIDs([
    'minimax-cn',
    'wafer.ai',
    '../unsafe',
  ])

  expect(receivedParams).toEqual({ provider_ids: ['minimax-cn'] })
  expect(configured).toEqual(['minimax-cn'])
  await service.dispose()
})

test('concurrent core RPCs deduplicate an asynchronous connection open', async () => {
  const opening = deferred<AuthSidecarConnection>()
  const connection = createFakeConnection(undefined)
  let factoryCalls = 0
  const service = new RustAppServerAuthService({
    connectionFactory: async () => {
      factoryCalls += 1
      return opening.promise
    },
  })

  const first = service.readStatus('github')
  const second = service.readStatus('github')
  await Promise.resolve()
  await Promise.resolve()

  expect(factoryCalls).toBe(1)
  opening.resolve(connection)
  await Promise.all([first, second])
})

test('same provider shares a connection while different providers stay separate', async () => {
  const fake = createFakeFactory(async (_connection, method) => {
    if (method === 'providerCredential/models') return { models: [] }
    return { is_available: false, balances: [] }
  })
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })

  await service.fetchProviderModels({
    providerID: 'zhipu',
    baseURL: 'https://renderer.example/should-not-be-trusted',
    defaultModels: [],
  })
  await service.fetchProviderBalance({ providerID: 'zhipu' })
  await service.fetchProviderModels({ providerID: 'provider-two', defaultModels: [] })

  expect(fake.connections).toHaveLength(2)
  expect(fake.connections[0]!.provider?.providerID).toBe('zhipu')
  expect(fake.connections[0]!.provider?.baseURL).not.toBe(
    'https://renderer.example/should-not-be-trusted',
  )
  expect(fake.connections[1]!.provider?.providerID).toBe('provider-two')
})

test('fifth idle provider evicts the least recently used provider', async () => {
  const fake = createFakeFactory(async () => ({ models: [] }))
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })
  const fetch = (providerID: string) =>
    service.fetchProviderModels({ providerID, defaultModels: [] })

  await fetch('provider-one')
  await fetch('provider-two')
  await fetch('provider-three')
  await fetch('provider-four')
  await fetch('provider-one')
  await fetch('provider-five')

  expect(fake.connections).toHaveLength(5)
  expect(fake.connections[0]!.disposeCount).toBe(0)
  expect(fake.connections[1]!.disposeCount).toBe(1)
})

test('an in-flight provider connection is not evicted', async () => {
  const requests = new Map<string, Deferred<unknown>>()
  const fake = createFakeFactory(async connection => {
    const providerID = connection.provider!.providerID
    let request = requests.get(providerID)
    if (!request) {
      request = deferred<unknown>()
      requests.set(providerID, request)
    }
    return request.promise
  })
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })
  const providerIDs = [
    'provider-one',
    'provider-two',
    'provider-three',
    'provider-four',
    'provider-five',
  ]
  const inFlight = providerIDs.map(providerID =>
    service.fetchProviderModels({ providerID, defaultModels: [] }),
  )
  while (requests.size < 5) await Promise.resolve()

  expect(fake.connections.every(connection => connection.disposeCount === 0)).toBe(true)
  requests.get('provider-one')!.resolve({ models: [] })
  await inFlight[0]
  await Promise.resolve()

  expect(fake.connections[0]!.disposeCount).toBe(1)
  expect(fake.connections.filter(connection => connection.disposeCount === 0)).toHaveLength(4)
  for (const providerID of providerIDs.slice(1)) {
    requests.get(providerID)!.resolve({ models: [] })
  }
  await Promise.all(inFlight.slice(1))
})

test('connection closure removes the dead record before the next RPC', async () => {
  const fake = createFakeFactory()
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })

  await service.readStatus('github')
  fake.connections[0]!.close()
  await Promise.resolve()
  await service.readStatus('github')

  expect(fake.connections).toHaveLength(2)
  expect(fake.connections[0]!.disposeCount).toBe(1)
})

test('authoritative provider launch configuration changes open a new connection', async () => {
  const provider = await getProviderConfig('zhipu')
  const originalBaseURL = provider.baseURL
  const fake = createFakeFactory(async () => ({ models: [] }))
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })
  try {
    await service.fetchProviderModels({ providerID: 'zhipu', defaultModels: [] })
    provider.baseURL = 'https://updated.bigmodel.example/v1/'
    await service.fetchProviderModels({ providerID: 'zhipu', defaultModels: [] })

    expect(fake.connections).toHaveLength(2)
  } finally {
    provider.baseURL = originalBaseURL
    await service.dispose()
  }
})

test('transport failure invalidates the connection and the next call reconnects', async () => {
  let requests = 0
  const fake = createFakeFactory(async () => {
    requests += 1
    if (requests === 1) throw new Error('transport closed')
    return {}
  })
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })

  await expect(service.readStatus('github')).rejects.toThrow('transport closed')
  await service.readStatus('github')

  expect(fake.connections).toHaveLength(2)
  expect(fake.connections[0]!.disposeCount).toBe(1)
})

test('timeout invalidates the connection and the next call reconnects', async () => {
  let requests = 0
  const fake = createFakeFactory(async () => {
    requests += 1
    if (requests === 1) return new Promise(() => {})
    return {}
  })
  const service = new RustAppServerAuthService({
    connectionFactory: fake.factory,
    timeoutMs: 5,
  })

  await expect(service.readStatus('github')).rejects.toThrow('timed out after 5ms')
  await service.readStatus('github')

  expect(fake.connections).toHaveLength(2)
  expect(fake.connections[0]!.disposeCount).toBe(1)
})

test('RustJsonRpcError retains the healthy connection', async () => {
  let requests = 0
  const fake = createFakeFactory(async () => {
    requests += 1
    if (requests === 1) throw new RustJsonRpcError(400, 'invalid request', null)
    return {}
  })
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })

  await expect(service.readStatus('github')).rejects.toBeInstanceOf(RustJsonRpcError)
  await service.readStatus('github')

  expect(fake.connections).toHaveLength(1)
  expect(fake.connections[0]!.disposeCount).toBe(0)
})

test('dispose closes every pooled connection and is idempotent', async () => {
  const fake = createFakeFactory(async (_connection, method) => {
    if (method === 'providerCredential/models') return { models: [] }
    return {}
  })
  const service = new RustAppServerAuthService({ connectionFactory: fake.factory })
  await service.readStatus('github')
  await service.fetchProviderModels({ providerID: 'provider-one', defaultModels: [] })
  await service.fetchProviderModels({ providerID: 'provider-two', defaultModels: [] })

  await service.dispose()
  await service.dispose()

  expect(fake.connections.map(connection => connection.disposeCount)).toEqual([1, 1, 1])
})

test('dispose is a barrier for an in-progress open and rejects later RPCs without a factory call', async () => {
  const opening = deferred<AuthSidecarConnection>()
  const connection = createFakeConnection(undefined)
  let factoryCalls = 0
  const service = new RustAppServerAuthService({
    connectionFactory: async () => {
      factoryCalls += 1
      return opening.promise
    },
  })
  const request = service.readStatus('github')
  await Promise.resolve()
  const disposing = service.dispose()
  let disposeFinished = false
  void disposing.then(() => {
    disposeFinished = true
  })
  await Promise.resolve()
  expect(disposeFinished).toBe(false)

  opening.resolve(connection)
  await expect(request).rejects.toThrow('disposed')
  await disposing
  expect(connection.disposeCount).toBe(1)
  await expect(service.readStatus('github')).rejects.toThrow('disposed')
  expect(factoryCalls).toBe(1)
})

test('production connection drains redacted stderr, handshakes once, and waits for one termination', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  }) as unknown as ChildProcess
  let initializeCount = 0
  let initializedCount = 0
  let terminateCount = 0
  const diagnostics: string[] = []
  let buffered = ''
  child.stdin!.on('data', chunk => {
    buffered += chunk.toString('utf8')
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline < 0) break
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      const message = JSON.parse(line) as { id?: number; method: string }
      if (message.method === 'initialize') {
        initializeCount += 1
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })}\n`)
      } else if (message.method === 'initialized') {
        initializedCount += 1
      }
    }
  })
  const factory = authServiceModule.createProductionConnectionFactory('codepilotx-app-server', {
    spawnChild: () => child,
    terminateChild: async process => {
      terminateCount += 1
      await Promise.resolve()
      process.emit('exit', 0, null)
    },
    debug: (_event, fields) => diagnostics.push(String(fields.text ?? '')),
  })
  const connection = await factory()
  stderr.write('Authorization: Bearer super-secret sk-private-token')
  await Promise.resolve()

  expect(initializeCount).toBe(1)
  expect(initializedCount).toBe(1)
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]).not.toContain('super-secret')
  expect(diagnostics[0]).not.toContain('sk-private-token')
  await Promise.all([connection.dispose(), connection.dispose()])
  await connection.closed
  expect(terminateCount).toBe(1)
})

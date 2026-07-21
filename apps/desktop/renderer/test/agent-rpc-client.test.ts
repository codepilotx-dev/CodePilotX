import { describe, expect, test } from 'bun:test'
import {
  AgentRpcError,
  createAgentRpcClient,
} from '../src/services/agentRpcClient.js'

describe('agent RPC v3 client', () => {
  test('并发业务请求统一等待首次 initialized 握手完成', async () => {
    const methods: string[] = []
    let initialized = false
    const handshake = {
      initialize: {
        clientInfo: {
          name: 'renderer-test',
          version: '1.0.0',
          instanceId: 'renderer-automatic',
        },
        protocols: ['thread-rpc-v3'] as const,
        capabilities: ['rpc.typed.v1'],
        interactionDelivery: 'active' as const,
      },
      initialized: {
        protocol: 'thread-rpc-v3' as const,
        clientInstanceId: 'renderer-automatic',
      },
    }
    const client = createAgentRpcClient({
      handshake,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        methods.push(body.method ?? 'unknown')
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v3',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-automatic',
            },
          })
        }
        if (body.method === 'initialized') {
          expect(
            new Headers(init?.headers).get('x-codepilotx-connection-id'),
          ).toBe('connection-automatic')
          initialized = true
          return new Response(null, { status: 204 })
        }
        expect(initialized).toBe(true)
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { projects: [], nextCursor: null },
        })
      },
    })

    const results = await Promise.all([
      client.call('project/list', {}),
      client.call('project/list', {}),
    ])

    expect(results).toEqual([
      { projects: [], nextCursor: null },
      { projects: [], nextCursor: null },
    ])
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'project/list',
      'project/list',
    ])
  })

  test('initialized 通知收到 JSON-RPC error 时不会误判为握手成功', async () => {
    const client = createAgentRpcClient({
      handshake: {
        initialize: {
          clientInfo: {
            name: 'renderer-test',
            version: '1.0.0',
            instanceId: 'renderer-rejected',
          },
          protocols: ['thread-rpc-v3'],
          capabilities: ['rpc.typed.v1'],
          interactionDelivery: 'active',
        },
        initialized: {
          protocol: 'thread-rpc-v3',
          clientInstanceId: 'renderer-rejected',
        },
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v3',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-rejected',
            },
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32_000,
            message: 'RPC 连接尚未完成 initialized 握手',
            data: {
              code: 'UNAUTHORIZED',
              retryable: false,
            },
          },
        })
      },
    })

    await expect(client.call('project/list', {})).rejects.toBeInstanceOf(
      AgentRpcError,
    )
  })

  test('发送正式 initialize 参数并在 initialized 通知中携带连接标识', async () => {
    const requests: Array<{
      headers: Headers
      body: Record<string, unknown>
    }> = []
    const client = createAgentRpcClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push({
          headers: new Headers(init?.headers),
          body,
        })
        if (body.method === 'initialize') {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v3',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1', 'git.review.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: 'connection-1',
            },
          })
        }
        return new Response(null, { status: 204 })
      },
    })

    const initialized = await client.call('initialize', {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId: 'renderer-1',
      },
      protocols: ['thread-rpc-v3'],
      capabilities: ['rpc.typed.v1', 'git.review.v1'],
      interactionDelivery: 'active',
    })
    client.setConnectionId(initialized.connectionId)
    await client.initialized({
      protocol: 'thread-rpc-v3',
      clientInstanceId: 'renderer-1',
    })

    expect(requests[0]?.body).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocols: ['thread-rpc-v3'],
        interactionDelivery: 'active',
      },
    })
    expect(requests[1]?.body).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {
        protocol: 'thread-rpc-v3',
        clientInstanceId: 'renderer-1',
      },
    })
    expect(
      requests[1]?.headers.get('x-codepilotx-connection-id'),
    ).toBe('connection-1')
  })

  test('Agent 重启导致连接代次失效时重新握手并只重试当前请求一次', async () => {
    let generation = 0
    let activeConnectionId: string | null = null
    let initializedConnectionId: string | null = null
    const methods: string[] = []
    const client = createAgentRpcClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          id?: string
          method?: string
        }
        const requestConnectionId = new Headers(init?.headers).get(
          'x-codepilotx-connection-id',
        )
        methods.push(body.method ?? 'unknown')
        if (body.method === 'initialize') {
          activeConnectionId = `connection-${++generation}`
          initializedConnectionId = null
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocol: 'thread-rpc-v3',
              serverInfo: { name: 'test-agent', version: '1.0.0' },
              capabilities: ['rpc.typed.v1'],
              limits: {
                maxFrameBytes: 1024,
                maxSubscriptions: 4,
                maxStreamsPerSubscription: 4,
                maxPendingRequests: 8,
              },
              connectionId: activeConnectionId,
            },
          })
        }
        if (body.method === 'initialized') {
          if (requestConnectionId === activeConnectionId) {
            initializedConnectionId = requestConnectionId
            return new Response(null, { status: 204 })
          }
        }
        if (
          requestConnectionId !== activeConnectionId ||
          initializedConnectionId !== activeConnectionId
        ) {
          return Response.json({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32_000,
              message: 'RPC 连接尚未完成 initialized 握手',
              data: {
                code: 'UNAUTHORIZED',
                retryable: false,
                status: 401,
              },
            },
          })
        }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { projects: [], nextCursor: null },
        })
      },
    })

    const initialized = await client.call('initialize', {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId: 'renderer-1',
      },
      protocols: ['thread-rpc-v3'],
      capabilities: ['rpc.typed.v1'],
      interactionDelivery: 'active',
    })
    client.setConnectionId(initialized.connectionId)
    await client.initialized({
      protocol: 'thread-rpc-v3',
      clientInstanceId: 'renderer-1',
    })
    expect(await client.call('project/list', {})).toEqual({
      projects: [],
      nextCursor: null,
    })

    activeConnectionId = null
    initializedConnectionId = null

    expect(await client.call('project/list', {})).toEqual({
      projects: [],
      nextCursor: null,
    })
    expect(methods).toEqual([
      'initialize',
      'initialized',
      'project/list',
      'project/list',
      'initialize',
      'initialized',
      'project/list',
    ])
  })

  test('首次事件订阅从 latest 开始且 replayComplete 触发校准回调', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let replayCompleteCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-latest'),
      fetch: createSubscriptionFetcher(requests),
      eventReconnectDelay: () => 0,
      eventSourceFactory: url => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
    })

    const unsubscribe = client.subscribe(
      {
        onReplayComplete: () => {
          replayCompleteCount += 1
        },
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)

    const subscribeRequests = requests.filter(
      request => request.method === 'event/subscribe',
    )
    expect(subscribeRequests).toHaveLength(1)
    expect(subscribeRequests[0]?.params).toEqual({
      streams: [{ streamId: 'global', after: 'latest' }],
    })

    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-1',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(() => replayCompleteCount === 1)
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/subscriptionClosed',
      params: {
        subscriptionId: 'subscription-1',
        reason: 'server-shutdown',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(() => sources.length === 2)
    expect(
      requests.filter(request => request.method === 'event/subscribe').at(-1)
        ?.params,
    ).toEqual({ streams: [{ streamId: 'global', after: 'latest' }] })
    unsubscribe()
  })

  test('事件订阅初始化暂时失败时按退避策略重试', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    const fallbackFetcher = createSubscriptionFetcher(requests)
    let subscribeAttempts = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-subscribe-retry'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: url => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (body.method === 'event/subscribe') {
          subscribeAttempts += 1
          if (subscribeAttempts === 1) {
            requests.push(body)
            return new Response('temporary unavailable', { status: 503 })
          }
        }
        return fallbackFetcher(input, init)
      },
    })

    const unsubscribe = client.subscribe({}, () => {})
    await waitFor(() => sources.length === 1)
    expect(subscribeAttempts).toBe(2)
    expect(
      requests.filter(request => request.method === 'event/subscribe'),
    ).toHaveLength(2)
    unsubscribe()
  })

  test('SSE 断开后重新握手并从最后成功 ACK 的位置恢复', async () => {
    const requests: Array<{
      connectionId: string | null
      body: Record<string, unknown>
    }> = []
    const sources: FakeEventSource[] = []
    let serverGeneration = 0
    let activeConnectionId: string | null = null
    let initializedConnectionId: string | null = null
    let subscriptionCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-reconnect'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: url => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const requestConnectionId = new Headers(init?.headers).get(
          'x-codepilotx-connection-id',
        )
        requests.push({ connectionId: requestConnectionId, body })
        if (body.method === 'initialize') {
          activeConnectionId = `connection-${++serverGeneration}`
          initializedConnectionId = null
          return rpcResult(body.id, initializeResult(activeConnectionId))
        }
        if (body.method === 'initialized') {
          initializedConnectionId = requestConnectionId
          return new Response(null, { status: 204 })
        }
        if (body.method === 'event/unsubscribe') {
          return rpcResult(body.id, { ok: true })
        }
        if (
          requestConnectionId !== activeConnectionId ||
          initializedConnectionId !== activeConnectionId
        ) {
          return rpcError(body.id, 'UNAUTHORIZED')
        }
        if (body.method === 'event/subscribe') {
          subscriptionCount += 1
          return rpcResult(body.id, {
            subscriptionId: `subscription-${subscriptionCount}`,
            highWatermarks: [{ streamId: 'global', sequence: 12 }],
          })
        }
        if (body.method === 'event/ack') {
          const params = body.params as {
            subscriptionId: string
            positions: Array<{ streamId: string; sequence: number }>
          }
          return rpcResult(body.id, {
            subscriptionId: params.subscriptionId,
            acknowledged: params.positions,
          })
        }
        throw new Error(`Unhandled RPC method: ${String(body.method)}`)
      },
    })

    const unsubscribe = client.subscribe({}, () => {})
    await waitFor(() => sources.length === 1)
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-1',
        positions: [{ streamId: 'global', sequence: 12 }],
      },
    })
    await waitFor(
      () => requests.some(request => request.body.method === 'event/ack'),
      1_500,
    )

    activeConnectionId = null
    initializedConnectionId = null
    sources[0]?.fail()
    await waitFor(() => sources.length === 2)

    const acceptedSubscriptions = requests.filter(
      request =>
        request.body.method === 'event/subscribe' &&
        request.connectionId === activeConnectionId,
    )
    expect(serverGeneration).toBe(2)
    expect(acceptedSubscriptions.at(-1)?.body.params).toEqual({
      streams: [{ streamId: 'global', after: 12 }],
    })
    expect(sources[1]?.url).toContain('connectionId=connection-2')

    const subscribeRequestCount = requests.filter(
      request => request.body.method === 'event/subscribe',
    ).length
    unsubscribe()
    sources[1]?.fail()
    await sleep(10)
    expect(
      requests.filter(request => request.body.method === 'event/subscribe'),
    ).toHaveLength(subscribeRequestCount)
  })

  test('恢复游标过期时仅回退到 latest 并建立订阅', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sources: FakeEventSource[] = []
    let rejected = false
    let replayCompleteCount = 0
    const client = createAgentRpcClient({
      handshake: automaticHandshake('renderer-cursor-expired'),
      eventReconnectDelay: () => 0,
      eventSourceFactory: url => {
        const source = new FakeEventSource(url)
        sources.push(source)
        return source as unknown as EventSource
      },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requests.push(body)
        if (body.method === 'initialize') {
          return rpcResult(body.id, initializeResult('connection-1'))
        }
        if (body.method === 'initialized') {
          return new Response(null, { status: 204 })
        }
        if (body.method === 'event/subscribe') {
          const params = body.params as {
            streams: Array<{ after: number | 'latest' }>
          }
          if (!rejected && params.streams[0]?.after === 5) {
            rejected = true
            return rpcError(body.id, 'CURSOR_EXPIRED')
          }
          return rpcResult(body.id, {
            subscriptionId: 'subscription-latest',
            highWatermarks: [{ streamId: 'global', sequence: 20 }],
          })
        }
        if (body.method === 'event/ack') {
          const params = body.params as Record<string, unknown>
          return rpcResult(body.id, {
            subscriptionId: params.subscriptionId,
            acknowledged: params.positions,
          })
        }
        if (body.method === 'event/unsubscribe') {
          return rpcResult(body.id, { ok: true })
        }
        throw new Error(`Unhandled RPC method: ${String(body.method)}`)
      },
    })

    const unsubscribe = client.subscribe(
      {
        after: 5,
        onReplayComplete: () => {
          replayCompleteCount += 1
        },
      },
      () => {},
    )
    await waitFor(() => sources.length === 1)

    const subscribeRequests = requests.filter(
      request => request.method === 'event/subscribe',
    )
    expect(
      subscribeRequests.map(request => request.params),
    ).toEqual([
      { streams: [{ streamId: 'global', after: 5 }] },
      { streams: [{ streamId: 'global', after: 'latest' }] },
    ])
    sources[0]?.emit({
      jsonrpc: '2.0',
      method: 'event/replayComplete',
      params: {
        subscriptionId: 'subscription-latest',
        positions: [{ streamId: 'global', sequence: 20 }],
      },
    })
    await waitFor(() => replayCompleteCount === 1)
    unsubscribe()
  })
})

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
  }

  emit(notification: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify(notification),
    } as MessageEvent)
  }

  fail(): void {
    this.onerror?.()
  }

  close(): void {
    this.closed = true
  }
}

function automaticHandshake(instanceId: string) {
  return {
    initialize: {
      clientInfo: {
        name: 'renderer-test',
        version: '1.0.0',
        instanceId,
      },
      protocols: ['thread-rpc-v3'] as const,
      capabilities: ['rpc.typed.v1'],
      interactionDelivery: 'active' as const,
    },
    initialized: {
      protocol: 'thread-rpc-v3' as const,
      clientInstanceId: instanceId,
    },
  }
}

function initializeResult(connectionId: string) {
  return {
    protocol: 'thread-rpc-v3',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities: ['rpc.typed.v1'],
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 4,
      maxStreamsPerSubscription: 4,
      maxPendingRequests: 8,
    },
    connectionId,
  }
}

function createSubscriptionFetcher(requests: Array<Record<string, unknown>>) {
  let subscriptionCount = 0
  return async (_input: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push(body)
    if (body.method === 'initialize') {
      return rpcResult(body.id, initializeResult('connection-1'))
    }
    if (body.method === 'initialized') {
      return new Response(null, { status: 204 })
    }
    if (body.method === 'event/subscribe') {
      subscriptionCount += 1
      return rpcResult(body.id, {
        subscriptionId: `subscription-${subscriptionCount}`,
        highWatermarks: [{ streamId: 'global', sequence: 12 }],
      })
    }
    if (body.method === 'event/ack') {
      const params = body.params as Record<string, unknown>
      return rpcResult(body.id, {
        subscriptionId: params.subscriptionId,
        acknowledged: params.positions,
      })
    }
    if (body.method === 'event/unsubscribe') {
      return rpcResult(body.id, { ok: true })
    }
    throw new Error(`Unhandled RPC method: ${String(body.method)}`)
  }
}

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function rpcError(id: unknown, code: string): Response {
  return Response.json({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32_000,
      message: code,
      data: { code, retryable: code !== 'UNAUTHORIZED' },
    },
  })
}

async function waitFor(
  predicate: () => boolean,
  timeout = 500,
): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) {
      throw new Error('等待条件超时')
    }
    await sleep(5)
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

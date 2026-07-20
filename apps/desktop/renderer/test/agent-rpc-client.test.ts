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
})

import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktopClient.js'

const provider = {
  provider: {
    id: 'minimax-cn-coding-plan',
    integrationID: 'minimax-cn-coding-plan',
    name: 'MiniMax Token Plan (minimaxi.com)',
    api: {
      type: 'aisdk',
      package: '@ai-sdk/anthropic',
      url: 'https://api.minimaxi.com/anthropic/v1',
    },
    request: { headers: {}, body: {} },
  },
  models: [
    {
      id: 'MiniMax-M3',
      providerID: 'minimax-cn-coding-plan',
      name: 'MiniMax-M3',
      family: 'minimax',
      api: {
        id: 'MiniMax-M3',
        type: 'aisdk',
        package: '@ai-sdk/anthropic',
        url: 'https://api.minimaxi.com/anthropic/v1',
      },
      capabilities: { tools: true, input: ['text'], output: ['text'] },
      request: { headers: {}, body: {} },
      variants: [],
      time: { released: 0 },
      cost: [],
      status: 'active',
      enabled: true,
      limit: { context: 204_800, output: 131_072 },
    },
  ],
}

describe('desktop provider client', () => {
  test('分页目录启动只加载 provider 摘要和当前 provider 首页', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      requests.push({ method: body.method, params: body.params })
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [provider.provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
        })
      }
      if (body.method === 'model/list') {
        expect(body.params).toEqual({
          providerId: provider.provider.id,
          enabled: true,
          limit: 100,
        })
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'integration/list') {
        return rpc(body.id, {
          integrations: [{
            id: provider.provider.integrationID,
            name: provider.provider.name,
            methods: [{ type: 'key' }],
            connections: [{ type: 'credential', id: 'credential-1', label: 'API Key' }],
          }],
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    const [state, providers] = await Promise.all([
      client.getModelProviderState(),
      client.listModelProviders(),
    ])

    expect(state.model).toBe('MiniMax-M3')
    expect(providers).toHaveLength(1)
    expect(requests.filter(request => request.method === 'provider/list')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'model/list')).toHaveLength(1)
    expect(requests.some(request => request.method === 'model/list' && Object.keys(request.params ?? {}).length === 0)).toBe(false)
  })

  test('删除 API 密钥后重新读取 Integration，并返回真实未配置状态', async () => {
    const methods: string[] = []
    let connections: Array<Record<string, string>> = [
      { type: 'credential', id: 'credential-1', label: 'API Key' },
    ]
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') {
        return new Response(null, { status: 204 })
      }
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [provider],
          defaultModel: {
            providerID: 'minimax-cn-coding-plan',
            id: 'MiniMax-M3',
          },
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (body.method === 'integration/list') {
        return rpc(body.id, {
          integrations: [
            {
              id: 'minimax-cn-coding-plan',
              name: 'MiniMax Token Plan (minimaxi.com)',
              methods: [{ type: 'key' }],
              connections,
            },
          ],
        })
      }
      if (body.method === 'integration/disconnect') {
        expect(body.params).toEqual({
          integrationId: 'minimax-cn-coding-plan',
          credentialId: 'credential-1',
          operationId: expect.any(String),
        })
        connections = []
        return rpc(body.id, {
          integration: {
            id: 'minimax-cn-coding-plan',
            name: 'MiniMax Token Plan (minimaxi.com)',
            methods: [{ type: 'key' }],
            connections,
          },
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher })
      .deleteProviderApiKey('minimax-cn-coding-plan')

    expect(state.apiKeyConfigured).toBe(false)
    expect(state.apiKeySource).toBeNull()
    expect(methods.filter(method => method === 'integration/list').length).toBeGreaterThanOrEqual(2)
    expect(methods).toContain('integration/disconnect')
  })
})

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function initializedResult(capabilities: string[] = ['rpc.typed.v1']) {
  return {
    protocol: 'thread-rpc-v3',
    serverInfo: { name: 'test-agent', version: '1.0.0' },
    capabilities,
    limits: {
      maxFrameBytes: 1024,
      maxSubscriptions: 8,
      maxStreamsPerSubscription: 8,
      maxPendingRequests: 32,
    },
    connectionId: 'test-connection',
  }
}

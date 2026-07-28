import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

const provider = {
  provider: {
    id: 'minimax-cn-coding-plan',
    name: 'MiniMax Token Plan (minimaxi.com)',
    source: {
      type: 'pi',
      kind: 'custom',
      apis: ['anthropic-messages'],
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    },
    auth: { apiKey: true, oauth: false },
    config: {
      kind: 'custom',
      id: 'minimax-cn-coding-plan',
      name: 'MiniMax Token Plan (minimaxi.com)',
      enabled: true,
      baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      auth: 'api-key',
      env: ['MINIMAX_API_KEY'],
      allowInsecureHttp: false,
      headers: {},
      models: [{
        id: 'MiniMax-M3',
        api: 'anthropic-messages',
        enabled: true,
      }],
    },
  },
  models: [
    {
      id: 'MiniMax-M3',
      providerID: 'minimax-cn-coding-plan',
      name: 'MiniMax-M3',
      family: 'minimax',
      api: {
        id: 'MiniMax-M3',
        type: 'pi',
        name: 'anthropic-messages',
        baseUrl: 'https://api.minimaxi.com/anthropic/v1',
      },
      capabilities: { tools: true, input: ['text'], output: ['text'] },
      variants: [
        { id: 'off' },
        { id: 'medium' },
        { id: 'high' },
      ],
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
          issues: [],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3', variant: 'medium' },
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
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3', variant: 'medium' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, {
          credentials: [credential()],
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
    expect(state.variant).toBe('medium')
    expect(state.modelMetadata?.['MiniMax-M3']?.variants).toEqual(['off', 'medium', 'high'])
    expect(providers).toHaveLength(1)
    expect(requests.filter(request => request.method === 'provider/list')).toHaveLength(1)
    expect(requests.filter(request => request.method === 'model/list')).toHaveLength(1)
    expect(requests.some(request => request.method === 'model/list' && Object.keys(request.params ?? {}).length === 0)).toBe(false)
  })

  test('删除 API 密钥后重新读取凭据，并返回真实未配置状态', async () => {
    const methods: string[] = []
    let credentials = [credential()]
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
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [provider.provider],
          issues: [],
          defaultModel: {
            providerID: 'minimax-cn-coding-plan',
            id: 'MiniMax-M3',
          },
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, {
          credentials,
        })
      }
      if (body.method === 'provider/credential/delete') {
        expect(body.params).toEqual({
          credentialId: 'credential-1',
          operationId: expect.any(String),
        })
        credentials = []
        return rpc(body.id, { credentials })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher })
      .deleteProviderApiKey('minimax-cn-coding-plan')

    expect(state.apiKeyConfigured).toBe(false)
    expect(state.apiKeySource).toBeNull()
    expect(methods.filter(method => method === 'provider/credential/list').length).toBeGreaterThanOrEqual(2)
    expect(methods).toContain('provider/credential/delete')
  })

  test('通过只读 source catalog 加载用量来源且不触发计费查询', async () => {
    const methods: string[] = []
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
      if (body.method === 'usage/source/list') {
        expect(body.params).toEqual({})
        return rpc(body.id, {
          sources: [{
            sourceId: 'deepseek',
            canonicalProviderId: 'deepseek',
            providerIds: ['deepseek'],
            displayName: 'DeepSeek 余额',
            scope: 'api-key',
            stability: 'official',
            availability: 'queryable',
            capabilities: ['balance'],
            queryPolicy: 'cached',
            connection: {
              kind: 'provider-key',
              credentialId: 'credential-deepseek',
              maskedValue: '••••test',
              disconnectible: false,
            },
            connectionMethod: { kind: 'provider-credential' },
          }],
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const result = await createDesktopClient({ fetch: fetcher })
      .listUsageSources()

    expect(result.sources.map(source => source.sourceId)).toEqual(['deepseek'])
    expect(methods).toContain('usage/source/list')
    expect(methods).not.toContain('usage/provider/query')
  })

  test('uses Pi provider CRUD, discovery and generic AuthSession RPCs', async () => {
    const methods: string[] = []
    const session = {
      id: 'auth-1',
      target: { kind: 'provider', providerId: 'openai' },
      status: 'waiting',
      prompt: {
        id: 'prompt-1',
        type: 'manual_code',
        message: '输入授权码',
      },
      notices: [
        { type: 'auth_url', url: 'https://example.com/authorize' },
        {
          type: 'device_code',
          userCode: 'ABCD',
          verificationUri: 'https://example.com/device',
        },
        { type: 'progress', message: '等待授权' },
      ],
      createdAt: 1,
      expiresAt: 2,
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      methods.push(body.method)
      if (body.method === 'initialize') {
        expect(body.params.capabilities).toEqual(expect.arrayContaining([
          'provider.config.pi.v1',
          'provider.auth.pi.v1',
        ]))
        return rpc(body.id, initializedResult())
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/create') {
        expect(body.params.definition.kind).toBe('custom')
        return rpc(body.id, { providerId: 'local', catalogVersion: 2 })
      }
      if (body.method === 'provider/model/discover') {
        return rpc(body.id, {
          models: [{ id: 'llama-3.1', api: 'openai-completions' }],
        })
      }
      if (body.method.startsWith('auth/session/')) {
        return rpc(body.id, {
          session: body.method === 'auth/session/cancel'
            ? { ...session, status: 'cancelled' }
            : session,
        })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const client = createDesktopClient({ fetch: fetcher })
    await client.createProvider({
      kind: 'custom',
      id: 'local',
      name: 'Local',
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434/v1',
      auth: 'none',
      env: [],
      allowInsecureHttp: false,
      headers: {},
      models: [{ id: 'llama-3.1', api: 'openai-completions' }],
    } as never)
    expect(await client.discoverProviderModels(
      'local',
      'openai-completions',
    )).toEqual([{ id: 'llama-3.1', api: 'openai-completions' }])
    const started = await client.startAuthSession({
      kind: 'provider',
      providerId: 'openai',
    } as never)
    expect(started.prompt?.type).toBe('manual_code')
    expect(started.notices.map(notice => notice.type)).toEqual([
      'auth_url',
      'device_code',
      'progress',
    ])
    await client.respondAuthSession('auth-1', 'prompt-1', 'code')
    await client.getAuthSessionStatus('auth-1')
    expect((await client.cancelAuthSession('auth-1')).status).toBe('cancelled')
    expect(methods).toEqual(expect.arrayContaining([
      'provider/create',
      'provider/model/discover',
      'auth/session/start',
      'auth/session/respond',
      'auth/session/status',
      'auth/session/cancel',
    ]))
  })
})

function rpc(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  })
}

function credential() {
  return {
    id: 'credential-1',
    providerId: 'minimax-cn-coding-plan',
    kind: 'api-key',
    label: 'API Key',
    maskedValue: '••••test',
    enabled: true,
    active: true,
    order: 0,
    health: { status: 'untested' },
    createdAt: 1,
    updatedAt: 1,
  }
}

function initializedResult(capabilities: string[] = ['rpc.typed.v1']) {
  return {
    protocol: 'thread-rpc-v4',
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

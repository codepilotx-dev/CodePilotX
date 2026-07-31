import { describe, expect, test } from 'bun:test'
import { createDesktopClient } from '../src/services/desktop-client/index.js'
import { catalogProviderToDesktop } from '../src/services/desktop-client/provider-adapters.js'

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
  test('仅支持 OAuth 的 provider 未认证时不会被 adapter 视为已配置', () => {
    expect(catalogProviderToDesktop({
      provider: {
        ...provider.provider,
        auth: { apiKey: false, oauth: true },
      },
      models: provider.models,
    } as never).apiKeyConfigured).toBe(false)
  })

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
          providers: [{
            ...provider.provider,
            authConfigured: true,
          }],
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

  test('provider 摘要使用 Agent 认证状态且仅按需加载当前 provider 模型', async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
    const codexProvider = {
      ...provider.provider,
      id: 'openai-codex',
      name: 'OpenAI Codex',
      auth: { apiKey: false, oauth: true },
      config: {
        kind: 'builtin',
        id: 'openai-codex',
        enabled: true,
        allowModels: [],
        denyModels: [],
        models: [],
      },
    }
    const deepseekProvider = {
      ...provider.provider,
      id: 'deepseek',
      name: 'DeepSeek',
      auth: { apiKey: true, oauth: false },
      config: {
        ...provider.provider.config,
        id: 'deepseek',
        name: 'DeepSeek',
        env: ['DEEPSEEK_API_KEY'],
        models: [{
          id: 'deepseek-chat',
          api: 'openai-completions',
          enabled: true,
        }],
      },
    }
    const modelPage = (
      providerInfo: typeof codexProvider | typeof deepseekProvider,
      modelID: string,
    ) => ({
      provider: providerInfo,
      models: [{
        ...provider.models[0],
        id: modelID,
        providerID: providerInfo.id,
        name: modelID,
        api: {
          ...provider.models[0]!.api,
          id: modelID,
          name: providerInfo.id === 'openai-codex'
            ? 'openai-responses'
            : 'openai-completions',
        },
      }],
    })
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
          providers: [
            { ...codexProvider, authConfigured: true },
            { ...deepseekProvider, authConfigured: true },
          ],
          issues: [],
          defaultModel: { providerID: 'openai-codex', id: 'gpt-5' },
          reviewerModel: null,
          catalogVersion: 8,
        })
      }
      if (body.method === 'model/list') {
        const selectedProvider = body.params.providerId === 'deepseek'
          ? deepseekProvider
          : codexProvider
        const modelID = selectedProvider.id === 'deepseek'
          ? 'deepseek-chat'
          : 'gpt-5'
        return rpc(body.id, {
          providers: [modelPage(selectedProvider, modelID)],
          defaultModel: { providerID: 'openai-codex', id: 'gpt-5' },
          reviewerModel: null,
          catalogVersion: 8,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, { credentials: [] })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const client = createDesktopClient({ fetch: fetcher })
    const [state, providers] = await Promise.all([
      client.getModelProviderState(),
      client.listModelProviders(),
    ])

    expect(state).toMatchObject({
      selectedProviderID: 'openai-codex',
      model: 'gpt-5',
      apiKeyConfigured: true,
    })
    expect(providers.map(item => ({
      providerID: item.providerID,
      apiKeyConfigured: item.apiKeyConfigured,
    }))).toEqual([
      { providerID: 'openai-codex', apiKeyConfigured: true },
      { providerID: 'deepseek', apiKeyConfigured: true },
    ])
    expect(
      requests.filter(request => request.method === 'model/list'),
    ).toEqual([{
      method: 'model/list',
      params: {
        providerId: 'openai-codex',
        enabled: true,
        limit: 100,
      },
    }])

    expect(await client.getModelProviderState('deepseek')).toMatchObject({
      selectedProviderID: 'deepseek',
      model: 'deepseek-chat',
      apiKeyConfigured: true,
      apiKeySource: 'environment',
    })
  })

  test('凭据更新事件会清理 provider 目录缓存并通知工作台刷新', async () => {
    let authConfigured = false
    let providerListRequests = 0
    const source = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      close: () => {},
    }
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') return rpc(body.id, initializedResult())
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        providerListRequests += 1
        return rpc(body.id, {
          providers: [{
            ...provider.provider,
            authConfigured,
          }],
          issues: [],
          defaultModel: null,
          reviewerModel: null,
          catalogVersion: providerListRequests,
        })
      }
      if (body.method === 'event/subscribe') {
        return rpc(body.id, {
          subscriptionId: 'subscription-1',
          highWatermarks: [{ streamId: 'global', sequence: 0 }],
        })
      }
      if (body.method === 'event/ack') {
        return rpc(body.id, {
          subscriptionId: body.params.subscriptionId,
          acknowledged: body.params.positions,
        })
      }
      if (body.method === 'event/unsubscribe') {
        return rpc(body.id, { ok: true })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }
    const eventTarget = new EventTarget()
    let refreshEvents = 0
    eventTarget.addEventListener('desktop:model-provider-changed', () => {
      refreshEvents += 1
    })
    const globalObject = globalThis as typeof globalThis & {
      window?: Window
    }
    const previousWindow = globalObject.window
    globalObject.window = eventTarget as Window
    let unsubscribe = () => {}
    try {
      const client = createDesktopClient({
        fetch: fetcher,
        window: eventTarget as Window,
        eventSourceFactory: () => source as unknown as EventSource,
      })
      expect((await client.listModelProviders())[0]?.apiKeyConfigured).toBe(false)
      unsubscribe = client.onAgentEvent(() => {})
      for (let index = 0; index < 20 && !source.onmessage; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      authConfigured = true
      source.onmessage?.({
        data: JSON.stringify({
          method: 'event/next',
          params: {
            subscriptionId: 'subscription-1',
            event: {
              eventId: 'event-1',
              streamId: 'global',
              type: 'provider/credential/updated',
              version: 1,
              occurredAt: Date.now(),
              durability: 'live',
              sequence: null,
              afterSequence: 0,
              payload: { providerId: provider.provider.id },
            },
          },
        }),
      } as MessageEvent)
      for (let index = 0; index < 20 && refreshEvents === 0; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      expect(refreshEvents).toBe(1)
      expect((await client.listModelProviders())[0]?.apiKeyConfigured).toBe(true)
      expect(providerListRequests).toBe(2)
    } finally {
      unsubscribe()
      if (previousWindow) globalObject.window = previousWindow
      else delete globalObject.window
    }
  })

  test('环境变量凭据使 Pi 已启用模型保持可发送状态', async () => {
    const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path !== '/rpc') throw new Error(`Unhandled request: ${path}`)
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return rpc(body.id, initializedResult(['rpc.typed.v1', 'model.catalog.paged.v1']))
      }
      if (body.method === 'initialized') return new Response(null, { status: 204 })
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [{
            ...provider.provider,
            authConfigured: true,
          }],
          issues: [],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
        })
      }
      if (body.method === 'model/list') {
        return rpc(body.id, {
          providers: [provider],
          defaultModel: { providerID: provider.provider.id, id: 'MiniMax-M3' },
          reviewerModel: null,
          catalogVersion: 7,
          total: 1,
        })
      }
      if (body.method === 'provider/credential/list') {
        return rpc(body.id, { credentials: [] })
      }
      throw new Error(`Unhandled RPC method: ${body.method}`)
    }

    const state = await createDesktopClient({ fetch: fetcher })
      .getModelProviderState()

    expect(state).toMatchObject({
      model: 'MiniMax-M3',
      modelConfigured: true,
      apiKeyConfigured: true,
      apiKeySource: 'environment',
      provider: { apiKeyConfigured: true },
    })
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
        const models = credentials.length > 0 ? provider.models : []
        return rpc(body.id, {
          providers: [{ ...provider, models }],
          defaultModel: credentials.length > 0
            ? {
                providerID: 'minimax-cn-coding-plan',
                id: 'MiniMax-M3',
              }
            : null,
          reviewerModel: null,
          catalogVersion: 1,
        })
      }
      if (body.method === 'provider/list') {
        return rpc(body.id, {
          providers: [{
            ...provider.provider,
            authConfigured: credentials.length > 0,
          }],
          issues: [],
          defaultModel: credentials.length > 0
            ? {
                providerID: 'minimax-cn-coding-plan',
                id: 'MiniMax-M3',
              }
            : null,
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

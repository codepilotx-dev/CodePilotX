import { describe, expect, test } from 'bun:test'
import type {
  EventEnvelope,
  ProviderUsageSource,
  RpcResult,
  UsageSourceDescriptor,
} from '@codepilotx/agent-protocol'
import type {
  DesktopApiKeySummary,
  DesktopIntegration,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../shared/types.js'
import {
  createProviderManagementStore,
  selectAnalyticsSources,
  selectConfiguredProviderGroups,
  selectProviderConnections,
  type ProviderManagementClient,
} from '../src/features/provider-management/index.js'

const providers = [
  provider('openai', 'OpenAI', 'openai'),
  provider('anthropic', 'Anthropic', 'anthropic'),
  provider('environment', 'Environment', 'environment'),
  provider('cloudflare-ai-gateway', 'Cloudflare AI Gateway'),
  provider('vercel', 'Vercel AI Gateway'),
]

const currentProviderState = {
  selectedProviderID: 'openai',
  provider: providers[0]!,
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  apiKeySource: 'secureStorage',
  modelConfigured: true,
  models: ['gpt-5.6'],
} as DesktopModelProviderState

const disabledFailedKey = {
  id: 'openai-disabled',
  providerId: 'openai',
  label: '停用 Key',
  maskedValue: '••••test',
  enabled: false,
  active: false,
  priority: 1,
  health: { status: 'auth-failed' },
  createdAt: 1,
  updatedAt: 1,
} as DesktopApiKeySummary

const integrations = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    methods: [{
      id: 'oauth',
      type: 'oauth',
      label: 'OAuth',
      prompts: [],
    }],
    connections: [{
      type: 'credential',
      id: 'anthropic-oauth',
      label: 'Claude OAuth',
    }],
  },
  {
    id: 'environment',
    name: 'Environment',
    methods: [{ type: 'env', names: ['ENVIRONMENT_API_KEY'] }],
    connections: [{ type: 'env', name: 'ENVIRONMENT_API_KEY' }],
  },
] as DesktopIntegration[]

const sourceCatalog = [
  source({
    sourceId: 'openai-key',
    providerId: 'openai',
    displayName: 'OpenAI Key',
    connectionMethod: { kind: 'provider-credential' },
  }),
  source({
    sourceId: 'openai-console',
    providerId: 'openai',
    displayName: 'OpenAI Console',
    availability: 'unsupported',
    connectionMethod: {
      kind: 'external',
      consoleUrl: 'https://platform.openai.com/usage',
    },
  }),
  source({
    sourceId: 'anthropic-subscription',
    providerId: 'anthropic',
    displayName: 'Claude 订阅',
    scope: 'subscription',
    stability: 'experimental',
    connection: {
      kind: 'oauth',
      credentialId: 'anthropic-oauth',
      maskedValue: 'OAuth',
      disconnectible: true,
    },
    connectionMethod: {
      kind: 'oauth',
      integrationId: 'anthropic',
      methodId: 'oauth',
    },
  }),
  source({
    sourceId: 'cloudflare-ai-gateway',
    providerId: 'cloudflare-ai-gateway',
    displayName: 'Cloudflare Billing',
    scope: 'account',
    connection: {
      kind: 'billing-key',
      credentialId: 'cloudflare-billing',
      maskedValue: '••••bill',
      disconnectible: true,
    },
    connectionMethod: {
      kind: 'billing-key',
      sourceId: 'cloudflare-ai-gateway',
      fields: [
        { name: 'key', label: 'Token', secret: true, required: true },
        { name: 'accountId', label: 'Account ID', secret: false, required: true },
      ],
    },
  }),
  source({
    sourceId: 'vercel-report',
    providerId: 'vercel',
    displayName: 'Vercel Reporting',
    queryPolicy: 'metered',
    connectionMethod: { kind: 'provider-credential' },
  }),
]

describe('provider management store', () => {
  test('loads lazily and deduplicates concurrent full loads', async () => {
    let providerCalls = 0
    const client = createClient({
      listModelProviders: async () => {
        providerCalls += 1
        return providers
      },
    })
    const store = createProviderManagementStore(client)

    expect(providerCalls).toBe(0)
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])

    expect(providerCalls).toBe(1)
    expect(store.getSnapshot()).toMatchObject({
      loaded: true,
      loading: false,
      providers,
      currentProviderState,
      apiKeys: [disabledFailedKey],
      usageSources: sourceCatalog,
    })
  })

  test('treats disabled or failed keys, OAuth, env, and billing-only sources as configured', async () => {
    const store = createProviderManagementStore(createClient())
    await store.ensureLoaded()
    const snapshot = store.getSnapshot()
    const connections = selectProviderConnections(snapshot)
    const groups = selectConfiguredProviderGroups(snapshot)

    expect(connections.map(connection => connection.kind)).toEqual([
      'inference-key',
      'subscription',
      'env',
      'billing-key',
    ])
    expect(groups.map(group => group.provider.providerID)).toEqual([
      'openai',
      'anthropic',
      'cloudflare-ai-gateway',
      'environment',
    ])
    expect(groups.find(group => group.provider.providerID === 'openai')?.apiKeys)
      .toEqual([disabledFailedKey])
    expect(groups.find(group =>
      group.provider.providerID === 'cloudflare-ai-gateway',
    )?.activeConnection?.kind).toBe('billing-key')
  })

  test('only returns sources for configured providers while retaining unsupported sources', async () => {
    const store = createProviderManagementStore(createClient())
    await store.ensureLoaded()

    expect(selectAnalyticsSources(store.getSnapshot()).map(source =>
      source.descriptor.sourceId,
    )).toEqual([
      'anthropic-subscription',
      'cloudflare-ai-gateway',
      'openai-key',
      'openai-console',
    ])
  })

  test('queries exact source ids, merges the same range, and replaces results across ranges', async () => {
    const requests: Array<{
      range: string
      sourceIds?: readonly string[]
    }> = []
    const client = createClient({
      queryProviderUsage: async input => {
        requests.push({ range: input.range, sourceIds: input.sourceIds })
        const sourceId = String(input.sourceIds?.[0] ?? 'openai-key')
        return {
          range: input.range,
          timeZone: input.timeZone,
          generatedAt: requests.length,
          sources: [usageResult(sourceId)],
        } as RpcResult<'usage/provider/query'>
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()

    await store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['openai-key'],
    })
    await store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['cloudflare-ai-gateway'],
    })
    expect(store.getSnapshot()).toMatchObject({
      usageRange: '7d',
      usageTimeZone: 'Asia/Shanghai',
    })
    expect(store.getSnapshot().usageResults.map(source => source.sourceId))
      .toEqual(['openai-key', 'cloudflare-ai-gateway'])

    await store.querySources({
      range: '30d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['openai-key'],
    })
    expect(store.getSnapshot().usageResults.map(source => source.sourceId))
      .toEqual(['openai-key'])
    expect(requests).toEqual([
      { range: '7d', sourceIds: ['openai-key'] },
      { range: '7d', sourceIds: ['cloudflare-ai-gateway'] },
      { range: '30d', sourceIds: ['openai-key'] },
    ])
  })

  test('does not let a slower previous range overwrite the latest query context', async () => {
    const sevenDays = deferred<RpcResult<'usage/provider/query'>>()
    const thirtyDays = deferred<RpcResult<'usage/provider/query'>>()
    const client = createClient({
      queryProviderUsage: input =>
        input.range === '7d' ? sevenDays.promise : thirtyDays.promise,
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()

    const staleRequest = store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['openai-key'],
    })
    const currentRequest = store.querySources({
      range: '30d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['cloudflare-ai-gateway'],
    })
    thirtyDays.resolve({
      range: '30d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 2,
      sources: [usageResult('cloudflare-ai-gateway')],
    } as RpcResult<'usage/provider/query'>)
    await currentRequest
    expect(store.getSnapshot()).toMatchObject({
      usageRange: '30d',
      usageTimeZone: 'Asia/Shanghai',
    })

    sevenDays.resolve({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1,
      sources: [usageResult('openai-key')],
    } as RpcResult<'usage/provider/query'>)
    await staleRequest
    expect(store.getSnapshot().usageRange).toBe('30d')
    expect(store.getSnapshot().usageResults.map(source => source.sourceId))
      .toEqual(['cloudflare-ai-gateway'])
  })

  test('refreshes the relevant slices after live catalog, integration, and usage events', async () => {
    let eventCallback: ((event: EventEnvelope) => void) | undefined
    let providerCalls = 0
    let integrationCalls = 0
    let sourceCalls = 0
    const client = createClient({
      listModelProviders: async () => {
        providerCalls += 1
        return providers
      },
      listIntegrations: async () => {
        integrationCalls += 1
        return integrations
      },
      listUsageSources: async () => {
        sourceCalls += 1
        return { sources: sourceCatalog }
      },
      subscribeAgentEventEnvelopes: (_options, callback) => {
        eventCallback = callback
        return () => {}
      },
    })
    const store = createProviderManagementStore(client)
    const unsubscribeA = store.subscribe(() => {})
    const unsubscribeB = store.subscribe(() => {})
    await store.ensureLoaded()
    const baseline = { providerCalls, integrationCalls, sourceCalls }

    eventCallback?.(event('catalog/updated'))
    await flush()
    expect(providerCalls).toBe(baseline.providerCalls + 1)

    eventCallback?.(event('integration/updated'))
    await flush()
    expect(integrationCalls).toBe(baseline.integrationCalls + 1)
    expect(sourceCalls).toBe(baseline.sourceCalls + 1)

    eventCallback?.(event('usage/source/updated'))
    await flush()
    expect(sourceCalls).toBe(baseline.sourceCalls + 2)
    unsubscribeA()
    unsubscribeB()
  })

  test('keeps API key mutation feedback and refreshes keys and connections', async () => {
    const mutations: string[] = []
    let keyReads = 0
    let integrationReads = 0
    const client = createClient({
      listApiKeys: async () => {
        keyReads += 1
        return [disabledFailedKey]
      },
      listIntegrations: async () => {
        integrationReads += 1
        return integrations
      },
      createApiKey: async () => { mutations.push('create') },
      updateApiKey: async () => { mutations.push('update') },
      testApiKey: async () => {
        mutations.push('test')
        return { ok: false, message: 'Key 已失效，请更新后重试。' }
      },
      setActiveApiKey: async () => { mutations.push('active') },
      setApiKeyEnabled: async () => { mutations.push('enabled') },
      reorderApiKeys: async () => { mutations.push('reorder') },
      deleteApiKey: async () => { mutations.push('delete') },
      disconnectIntegration: async () => {
        mutations.push('disconnect')
        return { ok: true }
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    const baselineKeys = keyReads
    const baselineIntegrations = integrationReads

    await store.createApiKey({ providerId: 'openai', label: 'Key', key: 'secret' })
    await store.updateApiKey({ credentialId: 'openai-disabled', label: 'Updated' })
    await expect(store.testApiKey('openai-disabled')).resolves.toEqual({
      ok: false,
      message: 'Key 已失效，请更新后重试。',
    })
    await store.setActiveApiKey('openai', 'openai-disabled')
    await store.setApiKeyEnabled('openai-disabled', true)
    await store.reorderApiKeys('openai', ['openai-disabled'])
    await store.deleteApiKey('openai-disabled')
    await store.disconnectIntegration({
      integrationID: 'anthropic',
      credentialID: 'anthropic-oauth',
    })

    expect(mutations).toEqual([
      'create',
      'update',
      'test',
      'active',
      'enabled',
      'reorder',
      'delete',
      'disconnect',
    ])
    expect(keyReads).toBeGreaterThanOrEqual(baselineKeys + 8)
    expect(integrationReads).toBeGreaterThanOrEqual(baselineIntegrations + 2)
  })

  test('drops only the disconnected source result after connection refresh', async () => {
    let catalog = sourceCatalog
    const client = createClient({
      listUsageSources: async () => ({ sources: catalog }),
      queryProviderUsage: async input => ({
        range: input.range,
        timeZone: input.timeZone,
        generatedAt: 1,
        sources: (input.sourceIds ?? []).map(sourceId =>
          usageResult(String(sourceId)),
        ),
      }),
      disconnectIntegration: async () => {
        catalog = catalog.map(item =>
          item.sourceId === 'anthropic-subscription'
            ? {
                ...item,
                connection: {
                  kind: 'none' as const,
                  disconnectible: false,
                },
              }
            : item,
        )
        return { ok: true }
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    await store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['anthropic-subscription'],
    })
    await store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['cloudflare-ai-gateway'],
    })

    await store.disconnectIntegration({
      integrationID: 'anthropic',
      credentialID: 'anthropic-oauth',
    })

    expect(store.getSnapshot().usageResults.map(result => result.sourceId))
      .toEqual(['cloudflare-ai-gateway'])
  })

  test('invalidates provider-credential results when the active inference key changes', async () => {
    const connectedCatalog = sourceCatalog.map(item =>
      item.sourceId === 'openai-key'
        ? {
            ...item,
            connection: {
              kind: 'provider-key' as const,
              credentialId: 'openai-disabled',
              maskedValue: '••••test',
              disconnectible: false,
            },
          }
        : item,
    )
    const client = createClient({
      listUsageSources: async () => ({ sources: connectedCatalog }),
      queryProviderUsage: async input => ({
        range: input.range,
        timeZone: input.timeZone,
        generatedAt: 1,
        sources: [usageResult('openai-key')],
      }),
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    await store.querySources({
      range: '7d',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['openai-key'],
    })
    expect(store.getSnapshot().usageResults).toHaveLength(1)

    await store.setActiveApiKey('openai', 'openai-disabled')

    expect(store.getSnapshot().usageResults).toEqual([])
    expect(store.getSnapshot()).toMatchObject({
      usageRange: '7d',
      usageTimeZone: 'Asia/Shanghai',
    })
  })
})

function createClient(
  overrides: Partial<ProviderManagementClient> = {},
): ProviderManagementClient {
  const client: ProviderManagementClient = {
    listModelProviders: async () => providers,
    getModelProviderState: async () => currentProviderState,
    listIntegrations: async () => integrations,
    listApiKeys: async () => [disabledFailedKey],
    listUsageSources: async () => ({ sources: sourceCatalog }),
    queryProviderUsage: async input => ({
      range: input.range,
      timeZone: input.timeZone,
      generatedAt: 1,
      sources: [],
    }),
    connectUsageCredential: async input => ({
      sourceId: input.sourceId,
      connection: {
        kind: 'billing-key',
        credentialId: 'billing-credential',
        maskedValue: '••••test',
        disconnectible: true,
      },
    }),
    disconnectUsageCredential: async input => ({
      sourceId: input.sourceId,
      disconnected: true,
    }),
    createApiKey: async () => {},
    updateApiKey: async () => {},
    testApiKey: async () => ({ ok: true, message: 'API Key 可用。' }),
    setActiveApiKey: async () => {},
    setApiKeyEnabled: async () => {},
    reorderApiKeys: async () => {},
    deleteApiKey: async () => {},
    disconnectIntegration: async () => ({ ok: true }),
    subscribeAgentEventEnvelopes: () => () => {},
  }
  return { ...client, ...overrides }
}

function provider(
  providerID: string,
  displayName: string,
  integrationID?: string,
): DesktopModelProviderSummary {
  return {
    providerID,
    displayName,
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: false,
    ...(integrationID ? { integrationID } : {}),
  }
}

function source(input: {
  sourceId: string
  providerId: string
  displayName: string
  scope?: UsageSourceDescriptor['scope']
  stability?: UsageSourceDescriptor['stability']
  availability?: UsageSourceDescriptor['availability']
  queryPolicy?: UsageSourceDescriptor['queryPolicy']
  connection?: UsageSourceDescriptor['connection']
  connectionMethod: UsageSourceDescriptor['connectionMethod']
}): UsageSourceDescriptor {
  return {
    sourceId: input.sourceId,
    canonicalProviderId: input.providerId,
    providerIds: [input.providerId],
    displayName: input.displayName,
    scope: input.scope ?? 'api-key',
    stability: input.stability ?? 'official',
    availability: input.availability ?? 'queryable',
    capabilities: ['balance'],
    queryPolicy: input.queryPolicy ?? 'cached',
    connection: input.connection ?? {
      kind: 'none',
      disconnectible: false,
    },
    connectionMethod: input.connectionMethod,
  } as UsageSourceDescriptor
}

function usageResult(sourceId: string): ProviderUsageSource {
  return {
    sourceId,
    providerIds: ['openai'],
    displayName: sourceId,
    scope: 'api-key',
    stability: 'official',
    status: 'available',
    checkedAt: 1,
    connection: { kind: 'provider-key', disconnectible: false },
    groups: [],
  } as ProviderUsageSource
}

function event(type: EventEnvelope['type']): EventEnvelope {
  return {
    eventId: `event:${type}`,
    streamId: 'global',
    type,
    version: 1,
    occurredAt: 1,
    durability: 'live',
    sequence: null,
    afterSequence: 0,
    payload: {},
  } as EventEnvelope
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(next => {
    resolve = next
  })
  return { promise, resolve }
}

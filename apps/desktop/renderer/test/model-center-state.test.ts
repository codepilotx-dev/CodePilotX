import { describe, expect, test } from 'bun:test'
import type { DesktopApiKeySummary } from '../shared/types.js'
import {
  filterApiKeys,
  getApiKeyDeleteConfirmation,
  parseModelCenterSearchParams,
  projectProviderDirectory,
  updateModelCenterSearchParams,
} from '../src/features/models/modelCenterState.js'

const keys: DesktopApiKeySummary[] = [
  apiKey({
    id: 'primary',
    providerId: 'openai',
    label: '生产 Key',
    maskedValue: '••••a9K2',
    active: true,
    priority: 0,
    health: { status: 'healthy' },
  }),
  apiKey({
    id: 'backup',
    providerId: 'openai',
    label: '备用 Key',
    maskedValue: '••••b123',
    priority: 1,
    health: { status: 'untested' },
  }),
  apiKey({
    id: 'anthropic',
    providerId: 'anthropic',
    label: 'Claude 限流 Key',
    maskedValue: '••••c456',
    health: { status: 'rate-limited' },
  }),
]

describe('model center URL state', () => {
  test('parses valid workspace, provider and section', () => {
    const state = parseModelCenterSearchParams(
      new URLSearchParams('view=keys&provider=anthropic&section=models'),
      ['openai', 'anthropic'],
      'openai',
    )

    expect(state).toEqual({ view: 'keys', providerId: 'anthropic', section: 'models' })
  })

  test('falls back for invalid parameters and provider', () => {
    const state = parseModelCenterSearchParams(
      new URLSearchParams('view=other&provider=missing&section=usage'),
      ['openai', 'anthropic'],
      'anthropic',
    )

    expect(state).toEqual({ view: 'providers', providerId: null, section: 'connection' })
  })

  test('keeps the provider catalog open when provider is missing', () => {
    expect(parseModelCenterSearchParams(new URLSearchParams(), ['openai'], 'openai'))
      .toEqual({ view: 'providers', providerId: null, section: 'connection' })
    expect(parseModelCenterSearchParams(new URLSearchParams(), [], 'missing').providerId)
      .toBeNull()
  })

  test('updates model-center params without mutating unrelated params', () => {
    const current = new URLSearchParams('debug=1&view=providers&section=connection')
    const next = updateModelCenterSearchParams(current, {
      view: 'keys',
      providerId: 'openai',
      section: null,
    })

    expect(next.toString()).toBe('debug=1&view=keys&provider=openai')
    expect(current.toString()).toBe('debug=1&view=providers&section=connection')
  })
})

describe('model center Provider directory', () => {
  const providers = [
    provider({
      providerID: 'openai',
      displayName: 'OpenAI',
      providerKind: 'custom',
    }),
    provider({
      providerID: 'vercel',
      displayName: 'AI Gateway',
      gatewaySource: true,
    }),
    provider({ providerID: 'local', displayName: '本地模型' }),
  ]

  test('searches name, id and Pi catalog source', () => {
    expect(projectProviderDirectory(providers, { query: 'OpenAI' }).map(item => item.provider.providerID))
      .toEqual(['openai'])
    expect(projectProviderDirectory(providers, { query: 'gateway' }).map(item => item.provider.providerID))
      .toEqual(['vercel'])
    expect(projectProviderDirectory(providers, { query: '自定义' }).map(item => item.provider.providerID))
      .toEqual(['openai'])
    expect(projectProviderDirectory(providers, { query: '内置' }).map(item => item.provider.providerID))
      .toEqual(['local'])
  })

  test('projects current and stored Key status', () => {
    const projected = projectProviderDirectory(providers, {
      currentProviderId: 'openai',
      apiKeys: keys,
    })

    expect(projected[0]).toMatchObject({
      current: true,
      connectionStatus: 'stored-key',
      statuses: ['current', 'stored-key'],
    })
    expect(projected[1]).toMatchObject({ current: false, connectionStatus: 'unconfigured' })
  })

  test('keeps a provider configured when its saved Key is disabled', () => {
    const projected = projectProviderDirectory(providers, {
      apiKeys: [apiKey({
        id: 'disabled',
        providerId: 'openai',
        enabled: false,
      })],
    })

    expect(projected[0]?.connectionStatus).toBe('stored-key')
  })

  test('distinguishes OAuth, environment and configured connections', () => {
    const oauthProvider = provider({ providerID: 'oauth', displayName: 'OAuth' })
    const envProvider = provider({ providerID: 'env', displayName: 'Environment' })
    const configuredProvider = provider({ providerID: 'configured', displayName: 'Configured', apiKeyConfigured: true })
    const projected = projectProviderDirectory(
      [oauthProvider, envProvider, configuredProvider],
      {
        credentials: [
          {
            id: 'credential',
            providerId: 'oauth',
            kind: 'oauth',
            label: 'OAuth',
            enabled: true,
            active: true,
            order: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ] as never,
        currentProviderState: {
          selectedProviderID: 'env',
          provider: envProvider,
          model: 'model',
          apiKeyConfigured: true,
          apiKeySource: 'ENV_API_KEY',
          modelConfigured: true,
          models: ['model'],
        },
      },
    )

    expect(projected.map(item => item.connectionStatus))
      .toEqual(['oauth', 'environment', 'configured'])
  })
})

describe('model center API Key helpers', () => {
  test('filters by provider, query and health status', () => {
    expect(filterApiKeys(keys, { providerId: 'openai' }).map(key => key.id))
      .toEqual(['primary', 'backup'])
    expect(filterApiKeys(keys, { query: 'a9k2' }).map(key => key.id))
      .toEqual(['primary'])
    expect(filterApiKeys(keys, { query: '当前', health: 'healthy' }).map(key => key.id))
      .toEqual(['primary'])
    expect(filterApiKeys(keys, { health: 'rate-limited' }).map(key => key.id))
      .toEqual(['anthropic'])
  })

  test('does not auto-select a replacement when deleting the active Key', () => {
    const confirmation = getApiKeyDeleteConfirmation(keys[0]!, keys, 'OpenAI')

    expect(confirmation.description).toContain('不会自动切换其他凭据')
  })

  test('warns that provider becomes unconfigured without a backup', () => {
    const confirmation = getApiKeyDeleteConfirmation(keys[0]!, [keys[0]!], 'OpenAI')

    expect(confirmation.description).toContain('等待你手动选择活动凭据')
  })
})

function apiKey(
  overrides: Partial<DesktopApiKeySummary> & Pick<DesktopApiKeySummary, 'id' | 'providerId'>,
): DesktopApiKeySummary {
  return {
    id: overrides.id,
    providerId: overrides.providerId,
    label: 'API Key',
    maskedValue: '••••0000',
    enabled: true,
    active: false,
    priority: 0,
    health: { status: 'untested' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function provider(overrides: {
  providerID: string
  displayName: string
  providerKind?: 'builtin' | 'custom'
  gatewaySource?: boolean
  apiKeyConfigured?: boolean
}) {
  return {
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: false,
    ...overrides,
  }
}

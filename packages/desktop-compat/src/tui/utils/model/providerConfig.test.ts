import { expect, test } from 'bun:test'
import {
  clearProviderConfigCatalogCacheForTests,
  fetchProviderModels,
  listProviderConfigs,
  PROVIDER_CONFIGS,
  resolveAiSdkProviderRoute,
  resolveProviderApiKeyFromSources,
} from './providerConfig.js'

const ZHIPU_DEFAULT_MODELS = [
  'glm-5.2',
  'glm-5.1',
  'glm-5',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.7-flash',
  'glm-4.6',
  'glm-4.5-air',
  'glm-4-flash-250414',
  'glm-5v-turbo',
  'glm-4.6v-flash',
  'glm-4.1v-thinking-flash',
  'glm-4v-flash',
]

test('gateway catalog enriches model icons without exposing an AI Gateway provider', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async input => {
    const url = String(input)
    if (url.includes('models.dev')) {
      return new Response(
        JSON.stringify({
          openai: {
            name: 'OpenAI',
            env: ['OPENAI_API_KEY'],
            models: {
              'gpt-4.1': {
                name: 'GPT-4.1',
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
        }),
      )
    }
    if (url.includes('ai-gateway.vercel.sh')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'openai/gpt-4.1',
              owned_by: 'openai',
              name: 'GPT-4.1',
              type: 'language',
              tags: ['tool-use'],
            },
          ],
        }),
      )
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch
  try {
    const providers = await listProviderConfigs()
    const openai = providers.find(provider => provider.providerID === 'openai')

    expect(providers.some(provider => provider.providerID === 'ai-gateway')).toBe(false)
    expect(openai?.modelMetadata?.['gpt-4.1']).toMatchObject({
      gatewayModelId: 'openai/gpt-4.1',
      iconURL: 'https://models.dev/logos/openai.svg',
      catalogSources: ['models.dev', 'gateway'],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('zhipu is available as a built-in OpenAI-compatible provider', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('network disabled in test')
  }
  try {
    const providers = await listProviderConfigs()
    const zhipu = providers.find(provider => provider.providerID === 'zhipu')

    expect(zhipu).toMatchObject({
      providerID: 'zhipu',
      kind: 'openai-compatible',
      displayName: '智谱 BigModel',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
      apiKeyEnvVar: 'ZAI_API_KEY',
      envVars: ['ZAI_API_KEY'],
      defaultModels: ZHIPU_DEFAULT_MODELS,
    })
    expect(providers.some(provider => provider.providerID === 'anthropic')).toBe(false)
    expect(zhipu?.modelMetadata?.['glm-5.2']).toMatchObject({
      contextWindow: 1_000_000,
      outputTokens: 131_072,
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      vision: false,
    })
    expect(zhipu?.modelMetadata?.['glm-4.7-flash']).toMatchObject({
      contextWindow: 200_000,
      outputTokens: 131_072,
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      vision: false,
    })
    expect(zhipu?.modelMetadata?.['glm-4-flash-250414']).toMatchObject({
      contextWindow: 128_000,
      outputTokens: 32_768,
      toolCall: true,
      structuredOutput: true,
      vision: false,
    })
    expect(zhipu?.modelMetadata?.['glm-4.6v-flash']).toMatchObject({
      contextWindow: 128_000,
      outputTokens: 32_768,
      reasoning: true,
      toolCall: true,
      structuredOutput: true,
      vision: true,
    })
    expect(zhipu?.modelMetadata?.['glm-4.1v-thinking-flash']).toMatchObject({
      contextWindow: 64_000,
      outputTokens: 32_768,
      reasoning: true,
      vision: true,
    })
    expect(zhipu?.modelMetadata?.['glm-4v-flash']).toMatchObject({
      contextWindow: 16_000,
      outputTokens: 1_024,
      vision: true,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('models.dev providers keep catalog package and env vars', async () => {
  const originalFetch = globalThis.fetch
  clearProviderConfigCatalogCacheForTests()
  globalThis.fetch = (async input => {
    const url = String(input)
    if (url.includes('models.dev')) {
      return new Response(
        JSON.stringify({
          providers: {
            'minimax-cn-coding-plan': {
              name: 'MiniMax Token Plan (minimaxi.com)',
              api: 'https://api.minimaxi.com/anthropic',
              env: ['MINIMAX_API_KEY'],
              npm: '@ai-sdk/anthropic',
              models: {
                'MiniMax-M3': {
                  name: 'MiniMax-M3',
                  modalities: { input: ['text'], output: ['text'] },
                },
              },
            },
          },
        }),
      )
    }
    if (url.includes('ai-gateway.vercel.sh')) {
      return new Response(JSON.stringify({ data: [] }))
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch
  try {
    const providers = await listProviderConfigs()
    const minimax = providers.find(
      provider => provider.providerID === 'minimax-cn-coding-plan',
    )

    expect(minimax).toMatchObject({
      providerID: 'minimax-cn-coding-plan',
      kind: 'anthropic-compatible',
      baseURL: 'https://api.minimaxi.com/anthropic/v1',
      apiKeyEnvVar: 'MINIMAX_API_KEY',
      envVars: ['MINIMAX_API_KEY'],
      npmPackage: '@ai-sdk/anthropic',
    })
  } finally {
    globalThis.fetch = originalFetch
    clearProviderConfigCatalogCacheForTests()
  }
})

test('provider api keys prefer provider id and fall back to catalog env aliases', () => {
  const provider = {
    providerID: 'minimax-cn-coding-plan',
    kind: 'anthropic-compatible' as const,
    displayName: 'MiniMax',
    envVars: ['MINIMAX_API_KEY'],
    defaultModels: [],
  }

  expect(
    resolveProviderApiKeyFromSources(provider, {
      env: {},
      storedKeys: {
        'minimax-cn-coding-plan': 'provider-key',
        MINIMAX_API_KEY: 'env-alias-key',
      },
    }),
  ).toBe('provider-key')

  expect(
    resolveProviderApiKeyFromSources(provider, {
      env: {},
      storedKeys: { MINIMAX_API_KEY: 'env-alias-key' },
    }),
  ).toBe('env-alias-key')
})

test('ai sdk provider route is selected from npm package', () => {
  expect(
    resolveAiSdkProviderRoute({
      providerID: 'minimax-cn-coding-plan',
      kind: 'anthropic-compatible',
      displayName: 'MiniMax',
      npmPackage: '@ai-sdk/anthropic',
      defaultModels: [],
    }),
  ).toBe('anthropic-compatible')

  expect(
    resolveAiSdkProviderRoute({
      providerID: 'deepseek',
      kind: 'openai-compatible',
      displayName: 'DeepSeek',
      npmPackage: '@ai-sdk/openai-compatible',
      defaultModels: [],
    }),
  ).toBe('openai-compatible')

  expect(
    resolveAiSdkProviderRoute({
      providerID: 'openai',
      kind: 'openai-compatible',
      displayName: 'OpenAI',
      npmPackage: '@ai-sdk/openai',
      defaultModels: [],
    }),
  ).toBe('openai')
})

test('zhipu model listing merges live catalog with curated defaults', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: 'glm-5.2' },
          { id: 'glm-5.1' },
          { id: 'glm-5' },
          { id: 'glm-5-turbo' },
          { id: 'glm-4.7' },
          { id: 'glm-4.6' },
          { id: 'glm-4.5' },
          { id: 'glm-4.5-air' },
        ],
      }),
    )
  try {
    const result = await fetchProviderModels({
      providerID: 'zhipu',
      apiKey: 'test-key',
      baseURL: PROVIDER_CONFIGS.zhipu?.baseURL,
    })

    expect(result.models).toEqual([
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-5-turbo',
      'glm-4.7',
      'glm-4.6',
      'glm-4.5',
      'glm-4.5-air',
      'glm-4.7-flash',
      'glm-4-flash-250414',
      'glm-5v-turbo',
      'glm-4.6v-flash',
      'glm-4.1v-thinking-flash',
      'glm-4v-flash',
    ])
    expect(result.error).toBeUndefined()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('zhipu model listing uses configured proxy fetch options', async () => {
  const originalFetch = globalThis.fetch
  const originalHTTPProxy = process.env.HTTP_PROXY
  const originalHttpProxy = process.env.http_proxy
  const seenInits: RequestInit[] = []
  delete process.env.http_proxy
  process.env.HTTP_PROXY = 'http://127.0.0.1:7890'
  globalThis.fetch = (async (_input, init) => {
    seenInits.push(init ?? {})
    return new Response(JSON.stringify({ data: [{ id: 'glm-5.2' }] }))
  }) as typeof fetch
  try {
    await fetchProviderModels({
      providerID: 'zhipu',
      apiKey: 'test-key',
      baseURL: PROVIDER_CONFIGS.zhipu?.baseURL,
    })

    expect(seenInits[0]).toMatchObject(
      typeof Bun !== 'undefined'
        ? { proxy: 'http://127.0.0.1:7890' }
        : { dispatcher: expect.anything() },
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv('HTTP_PROXY', originalHTTPProxy)
    restoreEnv('http_proxy', originalHttpProxy)
  }
})

test('zhipu model listing falls back to curated defaults without an API key', async () => {
  const result = await fetchProviderModels({
    providerID: 'zhipu',
    apiKey: '',
    baseURL: PROVIDER_CONFIGS.zhipu?.baseURL,
  })

  expect(result.models).toEqual(ZHIPU_DEFAULT_MODELS)
  expect(result.error).toBe('智谱 BigModel API key is not configured.')
})

test('zhipu model listing formats API business errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: '1211',
          message: '模型不存在，请检查模型代码',
        },
      }),
      { status: 404, statusText: 'Not Found' },
    )
  try {
    const result = await fetchProviderModels({
      providerID: 'zhipu',
      apiKey: 'test-key',
      baseURL: PROVIDER_CONFIGS.zhipu?.baseURL,
    })

    expect(result.models).toEqual(ZHIPU_DEFAULT_MODELS)
    expect(result.error).toContain('404 model not found')
    expect(result.error).toContain('1211')
  } finally {
    globalThis.fetch = originalFetch
  }
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

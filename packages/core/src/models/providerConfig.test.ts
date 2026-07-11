import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../config/env.js'
import {
  clearProviderConfigCatalogCacheForTests,
  deleteProviderApiKey,
  fetchProviderModels,
  getProviderConfigCatalog,
  getProviderApiKey,
  getProviderApiKeySource,
  getProviderModelMetadata,
  getSelectedProviderConfig,
  getSelectedProviderModelMetadata,
  getSelectedProviderID,
  listProviderConfigs,
  PROVIDER_CONFIGS,
  resolveAiSdkProviderRoute,
  resolveProviderApiKeyFromSources,
  resolveProviderWireApi,
  saveProviderApiKey,
  saveSelectedProvider,
  shouldUseGitHubCopilotProvider,
  shouldUseMiniMaxProvider,
  shouldUseOpenAICompatibleProvider,
  validateApiKeyHeader,
  withProviderConfigRuntime,
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

test('core provider catalog matches TUI zhipu metadata coverage', async () => {
  await withProviderConfigDir(async () => {
    const providers = await listProviderConfigs()
    const zhipu = providers.find(provider => provider.providerID === 'zhipu')

    expect(zhipu).toMatchObject({
      providerID: 'zhipu',
      kind: 'openai-compatible',
      displayName: '智谱 BigModel',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
      apiKeyEnvVar: 'ZAI_API_KEY',
	    envVars: ['ZAI_API_KEY', 'ZHIPU_API_KEY'],
      defaultModels: ZHIPU_DEFAULT_MODELS,
    })
    expect(zhipu?.modelMetadata?.['glm-5.2']).toMatchObject({
      contextWindow: 1_000_000,
      outputTokens: 131_072,
      reasoning: true,
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
	})
})

test('core provider catalog deduplicates zhipu/zhipuai via normalizeLegacyProviderID alias', async () => {
  clearProviderConfigCatalogCacheForTests()
  const providers = await listProviderConfigs()

  // Should only have ONE core zhipu entry, not a duplicate under 'zhipuai'
  const zhipuEntries = providers.filter(
    p => p.providerID === 'zhipu' || p.providerID === 'zhipuai',
  )
  expect(zhipuEntries).toHaveLength(1)
  expect(zhipuEntries[0].providerID).toBe('zhipu')
  expect(zhipuEntries[0].displayName).toBe('智谱 BigModel')

  // zhipuai-coding-plan is a distinct provider (different API baseURL) and
  // should remain separate
  const codingPlan = providers.find(
    p => p.providerID === 'zhipuai-coding-plan',
  )
  expect(codingPlan).toBeDefined()
  expect(codingPlan?.displayName).toBe('Zhipu AI Coding Plan')
})

test('core provider catalog merges models.dev and AI Gateway metadata', async () => {
  await withProviderConfigDir(async () => {
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

    const catalog = await getProviderConfigCatalog()
    const providers = Object.values(catalog)
    const openai = providers.find(provider => provider.providerID === 'openai')

    expect(providers.some(provider => provider.providerID === 'ai-gateway')).toBe(false)
    expect(openai?.modelMetadata?.['gpt-4.1']).toMatchObject({
      gatewayModelId: 'openai/gpt-4.1',
      iconURL: 'https://models.dev/logos/openai.svg',
      catalogSources: ['models.dev', 'gateway'],
    })
  })
})

test('core provider routes and metadata helpers match TUI contract', async () => {
  await withProviderConfigDir(async () => {
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

    // ProviderWireApi resolution
    expect(
      resolveProviderWireApi({
        providerID: 'minimax',
        kind: 'minimax',
        npmPackage: undefined,
      }),
    ).toBe('anthropic_messages')

    expect(
      resolveProviderWireApi({
        providerID: 'deepseek',
        kind: 'openai-compatible',
        npmPackage: '@ai-sdk/openai-compatible',
      }),
    ).toBe('chat_completions')

    expect(
      resolveProviderWireApi({
        providerID: 'openai',
        kind: 'openai-compatible',
        npmPackage: '@ai-sdk/openai',
      }),
    ).toBe('responses')

    expect(
      resolveProviderWireApi({
        providerID: 'zhipu',
        kind: 'openai-compatible',
        npmPackage: '@ai-sdk/openai-compatible',
      }),
    ).toBe('chat_completions')

    expect(
      resolveProviderWireApi({
        providerID: 'anthropic',
        kind: 'anthropic',
        npmPackage: '@ai-sdk/anthropic',
      }),
    ).toBe('anthropic_messages')

    expect(
      resolveProviderWireApi({
        providerID: 'unknown-provider',
        kind: 'openai-compatible',
        npmPackage: undefined,
      }),
    ).toBe('chat_completions')

    saveSelectedProvider({
      providerID: 'zhipu',
      modelID: 'glm-5.2',
    })
    expect(shouldUseOpenAICompatibleProvider()).toBe(true)
    expect(shouldUseMiniMaxProvider()).toBe(false)
    expect(shouldUseGitHubCopilotProvider()).toBe(false)
    expect(getProviderModelMetadata('zhipu', 'glm-5.2')?.contextWindow).toBe(
      1_000_000,
    )
    expect(getSelectedProviderModelMetadata('glm-5.2')?.outputTokens).toBe(
      131_072,
    )
  })
})

test('core provider model listing preserves TUI merge and error formatting', async () => {
  await withProviderConfigDir(async () => {
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

    const errorResult = await fetchProviderModels({
      providerID: 'zhipu',
      apiKey: 'test-key',
      baseURL: PROVIDER_CONFIGS.zhipu?.baseURL,
    })
    expect(errorResult.models).toEqual(ZHIPU_DEFAULT_MODELS)
    expect(errorResult.error).toContain('404 model not found')
    expect(errorResult.error).toContain('1211')
  })
})

test('core provider config persists selected provider model and base URL', async () => {
  await withProviderConfigDir(async () => {
    const providers = await listProviderConfigs()
    const zhipu = providers.find(provider => provider.providerID === 'zhipu')

    expect(zhipu).toMatchObject({
      providerID: 'zhipu',
      displayName: '智谱 BigModel',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    })

    const result = saveSelectedProvider({
      providerID: 'custom-provider',
      modelID: 'custom-model',
      baseURL: 'https://example.test/v1/',
    })

    expect(result.error).toBeUndefined()
    expect(getSelectedProviderID()).toBe('custom-provider')
    expect(getSelectedProviderConfig()).toMatchObject({
      providerID: 'custom-provider',
      baseURL: 'https://example.test/v1/',
      requiresBaseURL: true,
    })
  })
})

test('core provider config resolves provider api keys from secure storage only', async () => {
  await withProviderConfigDir(async () => {
    await withMemoryProviderCredentials({ zhipu: 'stored-zhipu-key' }, async () => {
      expect(getProviderApiKey('zhipu')).toBe('stored-zhipu-key')
      expect(getProviderApiKeySource('zhipu')).toBe('secureStorage')

      const saveResult = saveProviderApiKey('zhipu', 'new-zhipu-key')
      expect(saveResult.success).toBe(true)
      expect(getProviderApiKey('zhipu')).toBe('new-zhipu-key')

      expect(deleteProviderApiKey('zhipu').success).toBe(true)
      process.env.ZAI_API_KEY = 'env-zhipu-key'
      expect(getProviderApiKey('zhipu')).toBeNull()
      expect(getProviderApiKeySource('zhipu')).toBeNull()
    })
  })
})

test('core provider api key save fails closed when credential adapter is missing', async () => {
  await withProviderConfigDir(async configDir => {
    const credentialsPath = join(configDir, '.credentials.json')

    const result = withProviderConfigRuntime({}, () =>
      saveProviderApiKey('zhipu', 'sentinel-provider-key'),
    )

    expect(result.success).toBe(false)
    expect(result.warning).toContain('secure credential storage')
    await expect(access(credentialsPath)).rejects.toThrow()
  })
})

test('core provider api keys are isolated by providerID', async () => {
  await withProviderConfigDir(async () => {
    await withMemoryProviderCredentials(
      {
        'minimax-cn-coding-plan': 'coding-plan-key',
        minimax: 'generic-minimax-key',
      },
      async () => {
        expect(getProviderApiKey('minimax-cn-coding-plan')).toBe('coding-plan-key')
        expect(getProviderApiKey('minimax')).toBe('generic-minimax-key')

        expect(deleteProviderApiKey('minimax').success).toBe(true)
        expect(getProviderApiKey('minimax')).toBeNull()
        expect(getProviderApiKey('minimax-cn-coding-plan')).toBe('coding-plan-key')
      },
    )
  })
})

test('core provider api key source helpers use providerID in storage only', () => {
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
  ).toBeUndefined()

  // Environment variable fallback is intentionally disabled —
  // env alone no longer resolves a key.
  expect(
    resolveProviderApiKeyFromSources(provider, {
      env: { MINIMAX_API_KEY: 'env-alias-key' },
      storedKeys: {},
    }),
  ).toBeUndefined()
})

test('validateApiKeyHeader rejects Chinese text', () => {
	  expect(validateApiKeyHeader('是的，执行此计划')).toBe(
	    'API Key 不能包含中文或换行，请粘贴实际密钥',
	  )
	})

	test('validateApiKeyHeader rejects key with newline', () => {
	  expect(validateApiKeyHeader('sk-key\n')).toBe(
	    'API Key 不能包含中文或换行，请粘贴实际密钥',
	  )
	  expect(validateApiKeyHeader('sk-key\r\n')).toBe(
	    'API Key 不能包含中文或换行，请粘贴实际密钥',
	  )
	})

	test('validateApiKeyHeader rejects empty key', () => {
	  expect(validateApiKeyHeader('')).toBe('API Key 不能为空')
	  expect(validateApiKeyHeader('   ')).toBe('API Key 不能为空')
	})

	test('validateApiKeyHeader accepts normal ASCII token', () => {
	  expect(validateApiKeyHeader('sk-test-key-12345')).toBeNull()
	  expect(validateApiKeyHeader('  sk-test-key  ')).toBeNull()
	})

	test('validateApiKeyHeader accepts token with Unicode surrogate pairs within Latin-1 range', () => {
	  // Latin-1 characters (code ≤ 255) like accented letters are valid
	  expect(validateApiKeyHeader('sk-test-key-café')).toBeNull()
	})

	test('saveProviderApiKey rejects Chinese text', async () => {
	  await withProviderConfigDir(async () => {
	    const result = saveProviderApiKey('minimax', '是的，执行此计划')
	    expect(result.success).toBe(false)
	    expect(result.warning).toBe(
	      'API Key 不能包含中文或换行，请粘贴实际密钥',
	    )
	  })
	})

	test('saveProviderApiKey saves normal ASCII token', async () => {
	  await withProviderConfigDir(async () => {
	    await withMemoryProviderCredentials({}, async () => {
	      const result = saveProviderApiKey('minimax', 'sk-minimax-test-key')
	      expect(result.success).toBe(true)
	      expect(getProviderApiKey('minimax')).toBe('sk-minimax-test-key')
	    })
	  })
	})

	test('fetchProviderModels returns validation error for Chinese API key', async () => {
	  await withProviderConfigDir(async () => {
	    const result = await fetchProviderModels({
	      providerID: 'zhipu',
	      apiKey: '是的，执行此计划',
	      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
	    })
	    expect(result.models).toEqual(ZHIPU_DEFAULT_MODELS)
	    expect(result.error).toBe(
	      'API Key 不能包含中文或换行，请粘贴实际密钥',
	    )
	  })
	})

async function withProviderConfigDir(
  run: (configDir: string) => Promise<void>,
): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'core-provider-config-'))
  const originalCodePilotXConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  const originalClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  const originalZaiApiKey = process.env.ZAI_API_KEY
  const originalFetch = globalThis.fetch

  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir
  delete process.env.ZAI_API_KEY
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test')
  }) as unknown as typeof fetch

  try {
    await run(configDir)
  } finally {
    globalThis.fetch = originalFetch
    clearProviderConfigCatalogCacheForTests()
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodePilotXConfig)
    restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
    restoreEnv('ZAI_API_KEY', originalZaiApiKey)
    await rm(configDir, { force: true, recursive: true })
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

async function withMemoryProviderCredentials<T>(
  initial: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  let keys = { ...initial }
  return withProviderConfigRuntime(
    {
      credentialStore: {
        readProviderApiKeys: () => ({ ...keys }),
        writeProviderApiKeys(nextKeys) {
          keys = { ...nextKeys }
          return { success: true }
        },
      },
    },
    run,
  )
}

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../config/env.js'
import {
  MODEL_CONTEXT_WINDOW_DEFAULT,
  getContextWindowForModel,
} from './context.js'
import {
  clearProviderConfigCatalogCacheForTests,
  getProviderConfigCatalog,
  getProviderModelMetadata,
} from './providerConfig.js'

test('context window defaults to the shared default', () => {
  expect(getContextWindowForModel('claude-sonnet-4-5')).toBe(
    MODEL_CONTEXT_WINDOW_DEFAULT,
  )
})

test('context window honors explicit 1m model suffix', () => {
  expect(getContextWindowForModel('claude-sonnet-4-5 [1m]')).toBe(1_000_000)
})

test('context window recognizes common third-party model families', () => {
  expect(getContextWindowForModel('openai/gpt-4o')).toBe(128_000)
  expect(getContextWindowForModel('deepseek-chat')).toBe(1_000_000)
})

test('context window returns 1M for known DeepSeek models', () => {
  expect(getContextWindowForModel('deepseek-v4-flash')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-reasoner')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek-chat')).toBe(1_000_000)
})

test('context window supports provider-prefixed model names', () => {
  expect(getContextWindowForModel('deepseek/deepseek-v4-flash')).toBe(1_000_000)
  expect(getContextWindowForModel('deepseek/deepseek-v4-pro')).toBe(1_000_000)
})

test('context window uses provider catalog metadata when provider is known', async () => {
  await withFakeCatalog(async () => {
    // Built-in zhipu provider has glm-5.2 with 1M context in metadata
    const metadata = getProviderModelMetadata('zhipu', 'glm-5.2')
    expect(metadata?.contextWindow).toBe(1_000_000)
    expect(getContextWindowForModel('glm-5.2', 'zhipu')).toBe(1_000_000)
  })
})

test('context window uses models.dev catalog for dynamic providers', async () => {
  await withFakeCatalog(async () => {
    // Load catalog with mocked models.dev response that includes minimax-cn
    await getProviderConfigCatalog()
    const metadata = getProviderModelMetadata('minimax-cn', 'MiniMax-M3')
    expect(metadata?.contextWindow).toBe(1_000_000)
    expect(getContextWindowForModel('MiniMax-M3', 'minimax-cn')).toBe(1_000_000)
  })
})

test('context window falls back to hardcoded patterns when provider has no metadata', async () => {
  await withFakeCatalog(async () => {
    // A provider with no matching model metadata should fall through
    // zhipu has metadata but not for 'unknown-model'
    expect(getContextWindowForModel('unknown-model', 'zhipu')).toBe(
      MODEL_CONTEXT_WINDOW_DEFAULT,
    )
  })
})

async function withFakeCatalog(
  run: () => Promise<void>,
): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'core-context-test-'))
  const originalCodePilotXConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  const originalClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  const originalFetch = globalThis.fetch

  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir

  // Mock models.dev to return a catalog with minimax-cn provider
  globalThis.fetch = (async input => {
    const url = String(input)
    if (url.includes('models.dev')) {
      return new Response(
        JSON.stringify({
          providers: {
            'minimax-cn': {
              name: 'MiniMax',
              env: ['MINIMAX_API_KEY'],
              models: {
                'MiniMax-M3': {
                  name: 'MiniMax-M3',
                  limit: { context: 1_000_000 },
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
  }) as unknown as typeof fetch

  try {
    clearProviderConfigCatalogCacheForTests()
    await run()
  } finally {
    globalThis.fetch = originalFetch
    clearProviderConfigCatalogCacheForTests()
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodePilotXConfig)
    restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
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

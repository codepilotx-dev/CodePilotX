import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  getProviderApiKey,
  getProviderApiKeySource,
  getSelectedProviderConfig,
  getSelectedProviderID,
  listProviderConfigs,
  saveProviderApiKey,
  saveSelectedProvider,
} from './providerConfig.js'

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

test('core provider config resolves provider api keys from storage and env', async () => {
  await withProviderConfigDir(async configDir => {
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, '.credentials.json'),
      JSON.stringify({
        providerApiKeys: {
          ZAI_API_KEY: 'stored-zhipu-key',
        },
      }),
      'utf8',
    )

    expect(getProviderApiKey('zhipu')).toBe('stored-zhipu-key')
    expect(getProviderApiKeySource('zhipu')).toBe('secureStorage')

    const saveResult = saveProviderApiKey('zhipu', 'new-zhipu-key')
    expect(saveResult.success).toBe(true)
    expect(getProviderApiKey('zhipu')).toBe('new-zhipu-key')

    expect(deleteProviderApiKey('zhipu').success).toBe(true)
    process.env.ZAI_API_KEY = 'env-zhipu-key'
    expect(getProviderApiKey('zhipu')).toBe('env-zhipu-key')
    expect(getProviderApiKeySource('zhipu')).toBe('ZAI_API_KEY')
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

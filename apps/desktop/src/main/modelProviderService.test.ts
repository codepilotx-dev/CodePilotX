import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/tui/utils/envUtils.js'
import {
  getModelProviderState,
  listModelProviders,
  saveModelProvider,
} from './modelProviderService.js'

test('desktop model provider service discovers and saves zhipu provider state', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'desktop-zhipu-provider-'))
  const originalCodePilotXConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  const originalClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  const originalFetch = globalThis.fetch

  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = configDir
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test')
  }) as unknown as typeof fetch
  await resetTuiSettingsCache()

  try {
    const providers = await listModelProviders()
    const zhipu = providers.find(provider => provider.providerID === 'zhipu')

    expect(zhipu).toMatchObject({
      providerID: 'zhipu',
      displayName: '智谱 BigModel',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
      apiKeyConfigured: false,
    })

    const saved = await saveModelProvider({
      providerID: 'zhipu',
      modelID: 'glm-4.7-flash',
    })
    expect(saved).toMatchObject({
      selectedProviderID: 'zhipu',
      model: 'glm-4.7-flash',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    })

    const reloaded = await getModelProviderState()
    expect(reloaded).toMatchObject({
      selectedProviderID: 'zhipu',
      model: 'glm-4.7-flash',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodePilotXConfig)
    restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
    await resetTuiSettingsCache()
    await rm(configDir, { force: true, recursive: true })
  }
})

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

async function resetTuiSettingsCache(): Promise<void> {
  const specifier = '@codepilotx/tui/utils/settings/settingsCache.js'
  const module = (await import(specifier)) as {
    resetSettingsCache(): void
  }
  module.resetSettingsCache()
}

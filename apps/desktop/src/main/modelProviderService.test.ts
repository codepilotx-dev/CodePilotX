import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  getModelProviderState,
  listModelProviders,
  configureModelProviderCredentialServiceForTests,
  fetchProviderModels,
  saveProviderApiKey,
  saveModelProvider,
} from './modelProviderService.js'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import { defaultDesktopStoredSettings } from '../shared/settingsSchema.js'

beforeEach(() => {
  configureModelProviderCredentialServiceForTests({
    async readConfiguredProviderApiKeyIDs() {
      return []
    },
    async saveProviderApiKey() {},
    async deleteProviderApiKey() {},
    async fetchProviderModels({ defaultModels }) {
      return { models: defaultModels }
    },
    async fetchProviderBalance() {
      return { isAvailable: false, balances: [] }
    },
  })
})

afterEach(() => {
  configureModelProviderCredentialServiceForTests(null)
})

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
    const settings = await readDesktopStoredSettings()
    expect(settings.selectedModelPreset).toBe('glm-4.7-flash')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodePilotXConfig)
    restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
    await resetTuiSettingsCache()
    await rm(configDir, { force: true, recursive: true })
  }
})

test('desktop provider API keys use Rust secure credential service without plaintext fallback', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'desktop-secure-provider-'))
  const originalCodePilotXConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  const configured = new Set<string>()
  let modelFetchOptions: { apiKey?: string; baseURL?: string } | undefined
  configureModelProviderCredentialServiceForTests({
    async readConfiguredProviderApiKeyIDs() {
      return [...configured]
    },
    async saveProviderApiKey(providerID) {
      configured.add(providerID)
    },
    async deleteProviderApiKey(providerID) {
      configured.delete(providerID)
    },
    async fetchProviderModels(options) {
      modelFetchOptions = options
      return { models: ['glm-secure'] }
    },
    async fetchProviderBalance() {
      return { isAvailable: false, balances: [] }
    },
  })
  try {
    const state = await saveProviderApiKey('zhipu', 'sentinel-provider-key')

    expect(state.apiKeyConfigured).toBe(true)
    expect(
      await fetchProviderModels({ providerID: 'zhipu' }),
    ).toEqual({ models: ['glm-secure'] })
    expect(modelFetchOptions?.apiKey).toBeUndefined()
    expect(modelFetchOptions?.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4/')
    await expect(access(join(configDir, '.credentials.json'))).rejects.toThrow()
  } finally {
    configureModelProviderCredentialServiceForTests(null)
    restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodePilotXConfig)
    await rm(configDir, { force: true, recursive: true })
  }
})

test('desktop model provider service reports empty provider as unconfigured', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'desktop-empty-provider-'))
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
    await saveDesktopStoredSettings({
      ...defaultDesktopStoredSettings(),
      providerID: '',
      model: '',
    })

    const state = await getModelProviderState()

    expect(state).toMatchObject({
      selectedProviderID: '',
      model: '',
      apiKeyConfigured: false,
      modelConfigured: false,
      configurationMessage: '未配置模型，请先在设置中配置模型。',
    })
    expect(state.provider.providerID).toBe('')
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

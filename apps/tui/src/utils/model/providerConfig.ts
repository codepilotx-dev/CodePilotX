import * as coreProviderConfig from '@codepilotx/core/models/providerConfig.js'
import {
  withProviderConfigRuntime,
  type ProviderConfigRuntime,
  type ProviderSettingsStore,
  type ProviderCredentialStore,
} from '@codepilotx/core/models/providerConfig.js'
import { getSecureStorage } from '../secureStorage/index.js'
import { proxyFetch } from '../proxy.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../settings/settings.js'

export type {
  AiSdkProviderRoute,
  ModelProviderID,
  ModelProviderKind,
  ProviderApiKeySaveResult,
  ProviderBalanceInfo,
  ProviderBalanceResult,
  ProviderCatalogDiagnostics,
  ProviderConfig,
  ProviderModelListResult,
  ProviderModelMetadata,
  ProviderTokenPlanUsageInfo,
  SaveSelectedProviderOptions,
  SaveSelectedProviderResult,
} from '@codepilotx/core/models/providerConfig.js'

export {
  clearProviderConfigCatalogCacheForTests,
  configureProviderConfigRuntime,
  DEEPSEEK_MODEL_METADATA,
  formatProviderModel,
  getProviderCatalogDiagnostics,
  GITHUB_COPILOT_PROVIDER_ID,
  isModelProviderID,
  PROVIDER_CONFIGS,
  resetProviderCatalogForTest,
  resolveAiSdkProviderRoute,
  resolveProviderApiKeyFromSources,
  resolveProviderApiKeySourceFromSources,
  splitProviderModel,
  validateApiKeyHeader,
  ZHIPU_MODEL_METADATA,
} from '@codepilotx/core/models/providerConfig.js'

const tuiProviderSettingsStore: ProviderSettingsStore = {
  read() {
    const settings = getSettings_DEPRECATED() || {}
    return {
      provider:
        typeof settings.provider === 'string' ? settings.provider : undefined,
      providerBaseURL:
        typeof settings.providerBaseURL === 'string'
          ? settings.providerBaseURL
          : undefined,
      model: typeof settings.model === 'string' ? settings.model : undefined,
    }
  },
  update(patch) {
    return updateSettingsForSource('userSettings', {
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'providerBaseURL')
        ? { providerBaseURL: patch.providerBaseURL }
        : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
    })
  },
}

const tuiProviderCredentialStore: ProviderCredentialStore = {
  readProviderApiKeys() {
    return getSecureStorage().read()?.providerApiKeys
  },
  writeProviderApiKeys(providerApiKeys) {
    const storage = getSecureStorage()
    const data = storage.read() || {}
    return storage.update({ ...data, providerApiKeys })
  },
}

function withTuiProviderRuntime<T>(run: () => T): T {
  const runtime: ProviderConfigRuntime = {
    fetch: proxyFetch,
    settingsStore: tuiProviderSettingsStore,
    credentialStore: tuiProviderCredentialStore,
    env: process.env,
  }
  return withProviderConfigRuntime(runtime, run)
}

export function getProviderConfigCatalog() {
  return withTuiProviderRuntime(() => coreProviderConfig.getProviderConfigCatalog())
}

export function listProviderConfigs() {
  return withTuiProviderRuntime(() => coreProviderConfig.listProviderConfigs())
}

export function getProviderConfig(providerID: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getProviderConfig(providerID),
  )
}

export function getSelectedProviderConfig() {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getSelectedProviderConfig(),
  )
}

export function getSelectedProviderID() {
  return withTuiProviderRuntime(() => coreProviderConfig.getSelectedProviderID())
}

export function saveSelectedProvider(params: {
  providerID: string
  modelID?: string
  baseURL?: string
}) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.saveSelectedProvider({
      providerID: params.providerID,
      modelID: params.modelID ?? '',
      baseURL: params.baseURL,
    }),
  )
}

export function saveProviderApiKey(providerID: string, apiKey: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.saveProviderApiKey(providerID, apiKey),
  )
}

export function deleteProviderApiKey(providerID: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.deleteProviderApiKey(providerID),
  )
}

export function getProviderApiKey(providerID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getProviderApiKey(
      providerID ?? coreProviderConfig.getSelectedProviderID(),
    ) ?? undefined,
  )
}

export function getProviderApiKeySource(providerID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getProviderApiKeySource(
      providerID ?? coreProviderConfig.getSelectedProviderID(),
    ) ?? undefined,
  )
}

export function getProviderDisplayName(providerID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getProviderDisplayName(providerID),
  )
}

export function getProviderModelMetadata(providerID: string, modelID: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getProviderModelMetadata(providerID, modelID),
  )
}

export function getSelectedProviderModelMetadata(modelID: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.getSelectedProviderModelMetadata(modelID),
  )
}

export function shouldUseOpenAICompatibleProvider(explicitProviderID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.shouldUseOpenAICompatibleProvider(explicitProviderID),
  )
}

export function shouldUseAnthropicCompatibleProvider(explicitProviderID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.shouldUseAnthropicCompatibleProvider(explicitProviderID),
  )
}

export function shouldUseMiniMaxProvider(explicitProviderID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.shouldUseMiniMaxProvider(explicitProviderID),
  )
}

export function shouldUseGitHubCopilotProvider(explicitProviderID?: string) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.shouldUseGitHubCopilotProvider(explicitProviderID),
  )
}

export function getCachedProviderModels(providerID?: string) {
  return withTuiProviderRuntime(
    () =>
      coreProviderConfig.getCachedProviderModels(
        providerID ?? coreProviderConfig.getSelectedProviderID(),
      ) ?? undefined,
  )
}

export function fetchProviderModels(
  params: {
    providerID?: string
    apiKey?: string
    baseURL?: string
  } = {},
) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.fetchProviderModels({
      providerID: params.providerID ?? coreProviderConfig.getSelectedProviderID(),
      apiKey: params.apiKey,
      baseURL: params.baseURL,
    }),
  )
}

export function fetchProviderBalance(
  params: {
    providerID?: string
    apiKey?: string
    baseURL?: string
  } = {},
) {
  return withTuiProviderRuntime(() =>
    coreProviderConfig.fetchProviderBalance({
      providerID: params.providerID ?? coreProviderConfig.getSelectedProviderID(),
      apiKey: params.apiKey,
      baseURL: params.baseURL,
    }),
  )
}

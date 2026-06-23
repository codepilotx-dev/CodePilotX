import { getSettings_DEPRECATED } from '@codepilotx/tui/utils/settings/settings.js'
import {
  deleteProviderApiKey as deleteTuiProviderApiKey,
  fetchProviderBalance as fetchTuiProviderBalance,
  fetchProviderModels as fetchTuiProviderModels,
  getCachedProviderModels,
  getProviderCatalogDiagnostics,
  getProviderApiKeySource,
  getProviderConfig,
  getSelectedProviderConfig,
  getSelectedProviderID,
  isModelProviderID,
  listProviderConfigs,
  saveProviderApiKey as saveTuiProviderApiKey,
  saveSelectedProvider,
} from '@codepilotx/tui/utils/model/providerConfig.js'
import { desktopDebug } from './desktopDebug.js'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderBalanceResult,
  DesktopProviderModelListResult,
  ModelProviderID,
  SaveDesktopModelProviderOptions,
} from '../shared/types.js'

export async function listModelProviders(): Promise<
  DesktopModelProviderSummary[]
> {
  desktopDebug('model_provider_list_start')
  const providers = await listProviderConfigs()
  const result = providers.map(provider => ({
    providerID: provider.providerID as ModelProviderID,
    kind: provider.kind,
    displayName: provider.displayName,
    baseURL: provider.baseURL,
    defaultModels: provider.defaultModels,
    modelMetadata: provider.modelMetadata,
    apiKeyConfigured: Boolean(
      getProviderApiKeySource(provider.providerID as ModelProviderID),
    ),
    envVars: provider.envVars,
    docURL: provider.docURL,
    logoURL: provider.logoURL,
    npmPackage: provider.npmPackage,
    modelsDevSource: provider.modelsDevSource,
    gatewaySource: provider.gatewaySource,
    requiresBaseURL: provider.requiresBaseURL,
  }))
  desktopDebug('model_provider_list_done', {
    count: result.length,
    firstProviderIds: result.slice(0, 10).map(provider => provider.providerID),
    diagnostics: getProviderCatalogDiagnostics(),
  })
  return result
}

export async function getModelProviderState(
  providerIDOverride?: ModelProviderID,
): Promise<DesktopModelProviderState> {
  const settings = getSettings_DEPRECATED() || {}
  const selectedProviderID =
    providerIDOverride ?? (getSelectedProviderID() as ModelProviderID)
  desktopDebug('model_provider_state_start', {
    providerIDOverride,
    settingsProvider: settings.provider,
    selectedProviderID,
    settingsModel: settings.model,
  })
  const provider = await getProviderConfig(selectedProviderID)
  const savedSelectedProviderID = getSelectedProviderID() as ModelProviderID
  const selectedProvider =
    selectedProviderID === savedSelectedProviderID
      ? getSelectedProviderConfig()
      : provider
  const model = typeof settings.model === 'string' ? settings.model : ''
  const apiKeySource = getProviderApiKeySource(selectedProviderID) ?? null
  const baseURL = selectedProvider.baseURL ?? provider.baseURL
  const configurationMessage = getProviderConfigurationMessage({
    model,
    apiKeySource,
    requiresBaseURL: provider.requiresBaseURL,
    baseURL,
  })
  const modelConfigured = configurationMessage === null
  const result: DesktopModelProviderState = {
    selectedProviderID,
    provider: {
      providerID: provider.providerID as ModelProviderID,
      kind: provider.kind,
      displayName: provider.displayName,
      baseURL,
      defaultModels: provider.defaultModels,
      modelMetadata: provider.modelMetadata,
      apiKeyConfigured: Boolean(apiKeySource),
      envVars: provider.envVars,
      docURL: provider.docURL,
      logoURL: provider.logoURL,
      npmPackage: provider.npmPackage,
      modelsDevSource: provider.modelsDevSource,
      gatewaySource: provider.gatewaySource,
      requiresBaseURL: provider.requiresBaseURL,
    },
    model: modelConfigured ? model : '',
    baseURL,
    apiKeyConfigured: Boolean(apiKeySource),
    apiKeySource,
    modelConfigured,
    ...(configurationMessage ? { configurationMessage } : {}),
    models:
      getCachedProviderModels(selectedProviderID) ?? provider.defaultModels,
    modelMetadata: provider.modelMetadata,
  }
  desktopDebug('model_provider_state_done', {
    selectedProviderID: result.selectedProviderID,
    providerID: result.provider.providerID,
    kind: result.provider.kind,
    displayName: result.provider.displayName,
    baseURL: result.baseURL,
    model: result.model,
    modelCount: result.models.length,
    apiKeyConfigured: result.apiKeyConfigured,
    source: result.provider.modelsDevSource ? 'models.dev' : 'fallback',
    diagnostics: getProviderCatalogDiagnostics(),
  })
  return result
}

export async function fetchProviderModels(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderModelListResult> {
  const providerID = normalizeProviderID(options.providerID)
  desktopDebug('model_provider_fetch_models_start', {
    providerID,
    hasApiKey: Boolean(options.apiKey),
    baseURL: options.baseURL,
  })
  const result = await fetchTuiProviderModels({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
  desktopDebug('model_provider_fetch_models_done', {
    providerID,
    modelCount: result.models.length,
    error: result.error,
  })
  return result
}

export async function fetchProviderBalance(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderBalanceResult> {
  const providerID = normalizeProviderID(options.providerID)
  desktopDebug('model_provider_fetch_balance_start', {
    providerID,
    hasApiKey: Boolean(options.apiKey),
    baseURL: options.baseURL,
  })
  const result = await fetchTuiProviderBalance({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
  desktopDebug('model_provider_fetch_balance_done', {
    providerID,
    isAvailable: result.isAvailable,
    balanceCount: result.balances.length,
    tokenPlanUsageCount: result.tokenPlanUsages?.length ?? 0,
    error: result.error,
  })
  return result
}

export async function saveModelProvider(
  options: SaveDesktopModelProviderOptions,
): Promise<DesktopModelProviderState> {
  const providerID = normalizeProviderID(options.providerID)
  const modelID =
    typeof options.modelID === 'string' ? options.modelID.trim() : undefined
  if (!modelID) {
    throw new Error('Model provider connection requires a specific model.')
  }
  const baseURL = normalizeOptionalText(options.baseURL)
  desktopDebug('model_provider_save_start', {
    providerID,
    modelID,
    baseURL,
  })
  const provider = await getProviderConfig(providerID)
  const selectedBaseURL = provider.requiresBaseURL ? baseURL : provider.baseURL
  const apiKeySource = getProviderApiKeySource(providerID)
  const configurationMessage = getProviderConfigurationMessage({
    model: modelID,
    apiKeySource: apiKeySource ?? null,
    requiresBaseURL: provider.requiresBaseURL,
    baseURL: selectedBaseURL,
  })
  if (configurationMessage) {
    throw new Error(configurationMessage)
  }
  const saveResult = saveSelectedProvider({
    providerID,
    modelID,
    baseURL,
  })
  if (saveResult.error) {
    throw saveResult.error
  }
  const settings = await readDesktopStoredSettings()
  await saveDesktopStoredSettings({
    ...settings,
    providerID,
    providerBaseURL: provider.requiresBaseURL ? baseURL ?? '' : '',
    model: modelID ?? '',
  })
  const state = await getModelProviderState()
  desktopDebug('model_provider_save_done', {
    providerID: state.selectedProviderID,
    model: state.model,
    baseURL: state.baseURL,
  })
  return state
}

export async function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): Promise<DesktopModelProviderState> {
  const normalizedProviderID = normalizeProviderID(providerID)
  const normalizedApiKey = requireNonEmptyString(apiKey, 'Provider API key')
  desktopDebug('model_provider_save_api_key_start', {
    providerID: normalizedProviderID,
    apiKeyLength: normalizedApiKey.length,
  })
  const result = saveTuiProviderApiKey(normalizedProviderID, normalizedApiKey)
  if (!result.success) {
    throw new Error(result.warning ?? 'Failed to save provider API key.')
  }
  const state = await getModelProviderState(normalizedProviderID)
  desktopDebug('model_provider_save_api_key_done', {
    providerID: normalizedProviderID,
    apiKeySource: state.apiKeySource,
  })
  return state
}

export async function deleteProviderApiKey(
  providerID: ModelProviderID,
): Promise<DesktopModelProviderState> {
  const normalizedProviderID = normalizeProviderID(providerID)
  desktopDebug('model_provider_delete_api_key_start', {
    providerID: normalizedProviderID,
  })
  const result = deleteTuiProviderApiKey(normalizedProviderID)
  if (!result.success) {
    throw new Error(result.warning ?? 'Failed to delete provider API key.')
  }
  const state = await getModelProviderState(normalizedProviderID)
  desktopDebug('model_provider_delete_api_key_done', {
    providerID: normalizedProviderID,
    apiKeySource: state.apiKeySource,
  })
  return state
}

function normalizeProviderID(providerID: ModelProviderID): ModelProviderID {
  if (!providerID || !isModelProviderID(providerID)) {
    throw new Error(`Unsupported model provider: ${providerID}`)
  }
  return providerID
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`)
  }
  return trimmed
}

function getProviderConfigurationMessage({
  model,
  apiKeySource,
  requiresBaseURL,
  baseURL,
}: {
  model: string | undefined
  apiKeySource: string | null
  requiresBaseURL?: boolean
  baseURL?: string
}): string | null {
  if (!apiKeySource) {
    return '未配置模型，请先在设置中配置模型。'
  }
  if (requiresBaseURL && !baseURL?.trim()) {
    return '未配置模型，请先在设置中配置 Base URL。'
  }
  if (!model?.trim()) {
    return '未配置模型，请先在设置中选择模型。'
  }
  return null
}

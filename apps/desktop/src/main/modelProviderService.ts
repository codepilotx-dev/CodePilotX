import { createHash } from 'crypto'
import {
  createModelProviderState,
  createModelProviderSummary,
  isModelProviderID,
} from '@codepilotx/core/models/provider.js'
import { getSettings_DEPRECATED } from '@codepilotx/tui/utils/settings/settings.js'
import {
  deleteProviderApiKey as deleteTuiProviderApiKey,
  fetchProviderBalance as fetchTuiProviderBalance,
  fetchProviderModels as fetchTuiProviderModels,
  getCachedProviderModels,
  getProviderApiKey,
  getProviderApiKeySource,
  getProviderConfig,
  getSelectedProviderConfig,
  getSelectedProviderID,
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
  const providers = await listProviderConfigs()
  const result = providers.map(provider =>
    createModelProviderSummary(provider, getProviderApiKeySource(provider.providerID)),
  )
  return result
}

export async function getModelProviderState(
  providerIDOverride?: ModelProviderID,
): Promise<DesktopModelProviderState> {
  const settings = getSettings_DEPRECATED() || {}
  const selectedProviderID =
    providerIDOverride ?? (getSelectedProviderID() as ModelProviderID)
  const provider = await getProviderConfig(selectedProviderID)
  const savedSelectedProviderID = getSelectedProviderID() as ModelProviderID
  const selectedProvider =
    selectedProviderID === savedSelectedProviderID
      ? getSelectedProviderConfig()
      : provider
  const effectiveSelectedProviderID = provider.providerID as ModelProviderID
  const model = typeof settings.model === 'string' ? settings.model : ''
  const apiKeySource = getProviderApiKeySource(selectedProviderID) ?? null
  const apiKey = getProviderApiKey(selectedProviderID)
  const baseURL = selectedProvider.baseURL ?? provider.baseURL
  const result = createModelProviderState({
    selectedProviderID: effectiveSelectedProviderID,
    provider,
    model,
    apiKeySource,
    baseURL,
    models: getCachedProviderModels(selectedProviderID) ?? provider.defaultModels,
  })
  desktopDebug('model_provider_key_state', {
    selectedProviderID,
    providerID: result.provider.providerID,
    kind: result.provider.kind,
    npmPackage: result.provider.npmPackage,
    envVars: result.provider.envVars,
    apiKeySource,
    apiKeyLength: apiKey?.length ?? 0,
    apiKeyFingerprint: apiKey ? fingerprintApiKey(apiKey) : null,
    apiKeyConfigured: Boolean(apiKey),
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
  if (provider.requiresBaseURL && !selectedBaseURL?.trim()) {
    throw new Error('未配置模型，请先在设置中配置 Base URL。')
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
    apiKeyFingerprint: fingerprintApiKey(normalizedApiKey),
  })
  const result = saveTuiProviderApiKey(normalizedProviderID, normalizedApiKey)
  if (!result.success) {
    throw new Error(result.warning ?? 'Failed to save provider API key.')
  }
  const state = await getModelProviderState(normalizedProviderID)
  const savedApiKey = getProviderApiKey(normalizedProviderID)
  desktopDebug('model_provider_save_api_key_done', {
    providerID: normalizedProviderID,
    apiKeySource: state.apiKeySource,
    apiKeyLength: savedApiKey?.length ?? 0,
    apiKeyFingerprint: savedApiKey ? fingerprintApiKey(savedApiKey) : null,
    apiKeyConfigured: Boolean(savedApiKey),
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

function fingerprintApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12)
}

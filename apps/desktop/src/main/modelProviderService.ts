import { getSettings_DEPRECATED } from '@claudecode/tui/utils/settings/settings.js'
import {
  fetchProviderBalance as fetchTuiProviderBalance,
  fetchProviderModels as fetchTuiProviderModels,
  getCachedProviderModels,
  getProviderApiKeySource,
  getProviderConfig,
  getSelectedProviderConfig,
  getSelectedProviderID,
  isModelProviderID,
  listProviderConfigs,
  saveProviderApiKey as saveTuiProviderApiKey,
  saveSelectedProvider,
} from '@claudecode/tui/utils/model/providerConfig.js'
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
  return providers.map(provider => ({
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
  const model = typeof settings.model === 'string' ? settings.model : ''
  const apiKeySource = getProviderApiKeySource(selectedProviderID) ?? null
  return {
    selectedProviderID,
    provider: {
      providerID: provider.providerID as ModelProviderID,
      kind: provider.kind,
      displayName: provider.displayName,
      baseURL: selectedProvider.baseURL ?? provider.baseURL,
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
    model,
    baseURL: selectedProvider.baseURL ?? provider.baseURL,
    apiKeyConfigured: Boolean(apiKeySource),
    apiKeySource,
    models:
      getCachedProviderModels(selectedProviderID) ?? provider.defaultModels,
    modelMetadata: provider.modelMetadata,
  }
}

export async function fetchProviderModels(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderModelListResult> {
  const providerID = normalizeProviderID(options.providerID)
  return fetchTuiProviderModels({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
}

export async function fetchProviderBalance(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderBalanceResult> {
  const providerID = normalizeProviderID(options.providerID)
  return fetchTuiProviderBalance({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
}

export async function saveModelProvider(
  options: SaveDesktopModelProviderOptions,
): Promise<DesktopModelProviderState> {
  const providerID = normalizeProviderID(options.providerID)
  const modelID =
    typeof options.modelID === 'string' ? options.modelID.trim() : undefined
  const baseURL = normalizeOptionalText(options.baseURL)
  const provider = await getProviderConfig(providerID)
  saveSelectedProvider({
    providerID,
    modelID,
    baseURL,
  })
  const settings = await readDesktopStoredSettings()
  await saveDesktopStoredSettings({
    ...settings,
    providerID,
    providerBaseURL:
      provider.requiresBaseURL || providerID === 'custom' ? baseURL ?? '' : '',
    model: modelID ?? '',
  })
  return await getModelProviderState()
}

export async function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): Promise<DesktopModelProviderState> {
  const normalizedProviderID = normalizeProviderID(providerID)
  const normalizedApiKey = requireNonEmptyString(apiKey, 'Provider API key')
  const result = saveTuiProviderApiKey(normalizedProviderID, normalizedApiKey)
  if (!result.success) {
    throw new Error(result.warning ?? 'Failed to save provider API key.')
  }
  return await getModelProviderState(normalizedProviderID)
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

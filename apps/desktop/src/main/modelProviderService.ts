import {
  createModelProviderState,
  createModelProviderSummary,
  isModelProviderID,
} from '@codepilotx/core/models/provider.js'
import {
  getCachedProviderModels,
  getProviderConfig,
  listProviderConfigs,
  saveSelectedProvider,
} from '@codepilotx/core/models/providerConfig.js'
import { desktopDebug } from './desktopDebug.js'
import {
  getRustAppServerAuthService,
  type RustAppServerAuthService,
} from './rustAppServerAuthService.js'
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

type ModelProviderCredentialService = Pick<
  RustAppServerAuthService,
  | 'readConfiguredProviderApiKeyIDs'
  | 'saveProviderApiKey'
  | 'deleteProviderApiKey'
  | 'fetchProviderModels'
  | 'fetchProviderBalance'
>

let credentialServiceOverride: ModelProviderCredentialService | null = null

export function configureModelProviderCredentialServiceForTests(
  service: ModelProviderCredentialService | null,
): void {
  credentialServiceOverride = service
}

function getCredentialService(): ModelProviderCredentialService {
  if (credentialServiceOverride) return credentialServiceOverride
  return getRustAppServerAuthService()
}

export async function listModelProviders(): Promise<
  DesktopModelProviderSummary[]
> {
  const providers = await listProviderConfigs()
  const configuredProviderIDs = new Set(
    await getCredentialService().readConfiguredProviderApiKeyIDs(
      providers.map(provider => provider.providerID),
    ),
  )
  const result = providers.map(provider =>
    createModelProviderSummary(
      provider,
      configuredProviderIDs.has(provider.providerID) ? 'secureStorage' : null,
    ),
  )
  return result
}

export async function getModelProviderState(
  providerIDOverride?: ModelProviderID,
): Promise<DesktopModelProviderState> {
  const settings = await readDesktopStoredSettings()
  const selectedProviderID = (providerIDOverride ?? settings.providerID).trim()
  if (!selectedProviderID) {
    return createUnconfiguredProviderState()
  }
  const provider = await getProviderConfig(selectedProviderID)
  const effectiveSelectedProviderID = provider.providerID as ModelProviderID
  const model = settings.model
  const configuredProviderIDs = await getCredentialService().readConfiguredProviderApiKeyIDs([
    selectedProviderID,
  ])
  const apiKeyConfigured = configuredProviderIDs.includes(selectedProviderID)
  const apiKeySource = apiKeyConfigured ? 'secureStorage' : null
  const baseURL =
    provider.requiresBaseURL && settings.providerBaseURL
      ? settings.providerBaseURL
      : provider.baseURL
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
    apiKeyConfigured,
  })
  return result
}

export async function fetchProviderModels(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderModelListResult> {
  const providerID = normalizeProviderID(options.providerID)
  const provider = await getProviderConfig(providerID)
  if (provider.kind !== 'openai-compatible') {
    return { models: provider.defaultModels }
  }
  return getCredentialService().fetchProviderModels({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL) ?? provider.baseURL,
    defaultModels: provider.defaultModels,
  })
}

export async function fetchProviderBalance(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderBalanceResult> {
  const providerID = normalizeProviderID(options.providerID)
  const provider = await getProviderConfig(providerID)
  return getCredentialService().fetchProviderBalance({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL) ?? provider.baseURL,
  })
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
    selectedModelPreset: modelID ?? '',
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
  await getCredentialService().saveProviderApiKey(normalizedProviderID, normalizedApiKey)
  const state = await getModelProviderState(normalizedProviderID)
  desktopDebug('model_provider_save_api_key_done', {
    providerID: normalizedProviderID,
    apiKeySource: state.apiKeySource,
    apiKeyConfigured: state.apiKeyConfigured,
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
  await getCredentialService().deleteProviderApiKey(normalizedProviderID)
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

function createUnconfiguredProviderState(): DesktopModelProviderState {
  return {
    selectedProviderID: '',
    provider: {
      providerID: '',
      kind: 'openai-compatible',
      displayName: '未配置',
      defaultModels: [],
      apiKeyConfigured: false,
      requiresBaseURL: false,
    },
    model: '',
    apiKeyConfigured: false,
    apiKeySource: null,
    modelConfigured: false,
    configurationMessage: '未配置模型，请先在设置中配置模型。',
    models: [],
    modelMetadata: {},
  }
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

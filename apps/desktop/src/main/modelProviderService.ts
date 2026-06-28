import { createHash } from 'crypto'
import {
  createModelProviderState,
  createModelProviderSummary,
  isModelProviderID,
  providerToCodexToml,
} from '@codepilotx/core/models/provider.js'
import { CodexAppServerClient } from '@codepilotx/codex-app-server-client'
import {
  deleteProviderApiKey as deleteTuiProviderApiKey,
  fetchProviderBalance as fetchTuiProviderBalance,
  fetchProviderModels as fetchTuiProviderModels,
  getCachedProviderModels,
  getProviderApiKey,
  getProviderApiKeySource,
  getProviderConfig,
  listProviderConfigs,
  saveProviderApiKey as saveTuiProviderApiKey,
  saveSelectedProvider,
} from '@codepilotx/core/models/providerConfig.js'
import { desktopDebug } from './desktopDebug.js'
import {
  getOpenAgentConfigHomeDir,
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
  const settings = await readDesktopStoredSettings()
  const selectedProviderID = providerIDOverride ?? settings.providerID
  const provider = await getProviderConfig(selectedProviderID)
  const effectiveSelectedProviderID = provider.providerID as ModelProviderID
  const model = settings.model
  const apiKeySource = getProviderApiKeySource(selectedProviderID) ?? null
  const apiKey = getProviderApiKey(selectedProviderID)
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
  await writeCodexProviderConfig(
    createModelProviderSummary(
      { ...provider, baseURL: selectedBaseURL },
      getProviderApiKeySource(providerID),
    ),
    modelID,
  ).catch(error => {
    desktopDebug('model_provider_codex_config_write_failed', {
      providerID,
      modelID,
      message: error instanceof Error ? error.message : String(error),
    })
  })
  const state = await getModelProviderState()
  desktopDebug('model_provider_save_done', {
    providerID: state.selectedProviderID,
    model: state.model,
    baseURL: state.baseURL,
  })
  return state
}

async function writeCodexProviderConfig(
  provider: ReturnType<typeof createModelProviderSummary>,
  modelID: string,
): Promise<void> {
  if (isTestEnvironment()) return
  const edits = providerToCodexToml(provider, modelID)
  if (edits.length === 0) return
  const client = new CodexAppServerClient({
    transport: { type: 'stdio' },
    codexHome: getOpenAgentConfigHomeDir(),
    clientInfo: {
      name: 'codepilotx_desktop',
      title: 'CodePilotX Desktop',
      version: '0.0.0-local',
    },
  })
  await client.start()
  try {
    await client.configBatchWrite(edits, { reloadUserConfig: true })
  } finally {
    await client.shutdown()
  }
}

function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.BUN_ENV === 'test' ||
    'Bun' in globalThis
  )
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

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../config/env.js'
import { MODELS_DEV_PROVIDERS } from './modelsDevSnapshot.js'
import {
  formatProviderModel,
  getProviderApiKeyEnvVar,
  isModelProviderID,
  normalizeLegacyProviderID,
  splitProviderModel,
  type ModelMetadata,
  type ModelProviderConfig,
  type ModelProviderID,
  type ModelProviderKind,
  type ProviderBalanceInfo,
  type ProviderTokenPlanUsageInfo,
} from './provider.js'

export type {
  ModelMetadata as ProviderModelMetadata,
  ModelProviderConfig as ProviderConfig,
  ModelProviderID,
  ModelProviderKind,
  ProviderBalanceInfo,
  ProviderTokenPlanUsageInfo,
} from './provider.js'

export { formatProviderModel, isModelProviderID, splitProviderModel }

export type AiSdkProviderRoute =
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'openai'
  | 'github-copilot'
  | 'unsupported'

export type ProviderApiKeySaveResult = {
  success: boolean
  warning?: string
}

export type SaveSelectedProviderOptions = {
  providerID: ModelProviderID
  modelID: string
  baseURL?: string
}

export type SaveSelectedProviderResult = {
  error?: Error
}

export type ProviderModelListResult = {
  models: string[]
  error?: string
}

export type ProviderBalanceResult = {
  isAvailable: boolean
  balances: ProviderBalanceInfo[]
  tokenPlanUsages?: ProviderTokenPlanUsageInfo[]
  error?: string
}

type ProviderSettings = {
  provider?: string
  providerBaseURL?: string
  model?: string
  [key: string]: unknown
}

type SecureStorageData = {
  providerApiKeys?: Record<string, string>
  [key: string]: unknown
}

export type ProviderSettingsStore = {
  read(): ProviderSettings
  update(patch: ProviderSettings): { error: Error | null }
}

export type ProviderCredentialStore = {
  readProviderApiKeys(): Record<string, string> | undefined
  writeProviderApiKeys(keys: Record<string, string>): ProviderApiKeySaveResult
}

export type ProviderConfigRuntime = {
  fetch?: typeof fetch
  settingsStore?: ProviderSettingsStore
  credentialStore?: ProviderCredentialStore
  env?: Record<string, string | undefined>
}

export type ProviderCatalogDiagnostics = {
  modelsDev: {
    status: 'idle' | 'builtin' | 'fulfilled' | 'rejected'
    providerCount?: number
    usableProviderCount?: number
    filteredMissingApiCount?: number
    error?: string
  }
  gateway: {
    status: 'idle' | 'fulfilled' | 'rejected'
    modelCount?: number
    error?: string
  }
  providerCount: number
  providerIds: string[]
}

type ModelsDevProvider = {
  name?: unknown
  api?: unknown
  env?: unknown
  doc?: unknown
  npm?: unknown
  models?: unknown
}

type ModelsDevModel = {
  id?: unknown
  name?: unknown
  attachment?: unknown
  cost?: {
    input?: unknown
    output?: unknown
    cache_read?: unknown
  }
  limit?: {
    context?: unknown
    output?: unknown
  }
  modalities?: {
    input?: unknown
    output?: unknown
  }
  reasoning?: unknown
  tool_call?: unknown
  structured_output?: unknown
}

type ModelsDevCatalog = {
  providers?: Record<string, ModelsDevProvider>
  models?: Record<string, ModelsDevModel>
}

type GatewayModel = {
  id?: unknown
  type?: unknown
  name?: unknown
  owned_by?: unknown
  description?: unknown
  icon?: unknown
  tags?: unknown
  input_modalities?: unknown
  output_modalities?: unknown
}

const MODELS_DEV_CATALOG_URL = 'https://models.dev/catalog.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const AI_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'

const providerModelCache = new Map<string, string[]>()
let providerCatalogCache: Record<string, ModelProviderConfig> | null = null
let providerCatalogPromise: Promise<Record<string, ModelProviderConfig>> | null =
  null
let runtime: ProviderConfigRuntime = {}
let providerCatalogDiagnostics: ProviderCatalogDiagnostics = {
  modelsDev: { status: 'idle' },
  gateway: { status: 'idle' },
  providerCount: 0,
  providerIds: [],
}

export function configureProviderConfigRuntime(
  nextRuntime: ProviderConfigRuntime,
): void {
  runtime = { ...nextRuntime }
  clearProviderConfigCatalogCacheForTests()
}

export function withProviderConfigRuntime<T>(
  nextRuntime: ProviderConfigRuntime,
  run: () => T,
): T {
  const previousRuntime = runtime
  runtime = { ...nextRuntime }
  try {
    const result = run()
    if (isPromiseLike(result)) {
      return result.finally(() => {
        runtime = previousRuntime
      }) as T
    }
    runtime = previousRuntime
    return result
  } catch (error) {
    runtime = previousRuntime
    throw error
  }
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> & {
  finally(onFinally: () => void): unknown
} {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { finally?: unknown }).finally === 'function'
  )
}

export const DEEPSEEK_MODEL_METADATA: Record<string, ModelMetadata> = {
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Complex agent and high-quality coding tasks',
    badge: 'Quality',
    catalogSources: ['models.dev'],
    modelsDevProviderId: 'deepseek',
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Fast responses, light tasks, and economical usage',
    badge: 'Fast',
    catalogSources: ['models.dev'],
    modelsDevProviderId: 'deepseek',
  },
}

export const ZHIPU_MODEL_METADATA: Record<string, ModelMetadata> = {
  'glm-5.2': {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    description: 'Flagship coding and long-context agent model',
    badge: 'Flagship',
    contextWindow: 1_000_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-5.1': {
    id: 'glm-5.1',
    label: 'GLM-5.1',
    description: 'High-intelligence base model for long-running agent work',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-5': {
    id: 'glm-5',
    label: 'GLM-5',
    description: 'Agentic planning and coding model',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-5-turbo': {
    id: 'glm-5-turbo',
    label: 'GLM-5-Turbo',
    description: 'Fast model for complex long tasks',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-4.7': {
    id: 'glm-4.7',
    label: 'GLM-4.7',
    description: 'General conversation, reasoning, coding, and agent model',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-4.7-flash': {
    id: 'glm-4.7-flash',
    label: 'GLM-4.7-Flash',
    description: 'Free general model based on GLM-4.7',
    badge: 'Free',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-4.6': {
    id: 'glm-4.6',
    label: 'GLM-4.6',
    description: 'Advanced coding, complex reasoning, and tool-use model',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-4.5-air': {
    id: 'glm-4.5-air',
    label: 'GLM-4.5-Air',
    description: 'Cost-effective lightweight reasoning and coding model',
    contextWindow: 128_000,
    outputTokens: 98_304,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-4-flash-250414': {
    id: 'glm-4-flash-250414',
    label: 'GLM-4-Flash-250414',
    description: 'Free long-context model for multilingual and tool-use tasks',
    badge: 'Free',
    contextWindow: 128_000,
    outputTokens: 32_768,
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ['text'], output: ['text'] },
  },
  'glm-5v-turbo': {
    id: 'glm-5v-turbo',
    label: 'GLM-5V-Turbo',
    description: 'Multimodal coding model with vision support',
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
  },
  'glm-4.6v-flash': {
    id: 'glm-4.6v-flash',
    label: 'GLM-4.6V-Flash',
    description: 'Free visual reasoning model with tool use and long context',
    badge: 'Free',
    contextWindow: 128_000,
    outputTokens: 32_768,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: true,
    modalities: { input: ['text', 'image', 'video', 'file'], output: ['text'] },
  },
  'glm-4.1v-thinking-flash': {
    id: 'glm-4.1v-thinking-flash',
    label: 'GLM-4.1V-Thinking-Flash',
    description: 'Free visual reasoning model for multimodal understanding',
    badge: 'Free',
    contextWindow: 64_000,
    outputTokens: 32_768,
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    vision: true,
    modalities: { input: ['text', 'image', 'video', 'file'], output: ['text'] },
  },
  'glm-4v-flash': {
    id: 'glm-4v-flash',
    label: 'GLM-4V-Flash',
    description: 'Free lightweight image understanding model',
    badge: 'Free',
    contextWindow: 16_000,
    outputTokens: 1_024,
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    vision: true,
    modalities: { input: ['text', 'image'], output: ['text'] },
  },
}

export const PROVIDER_CONFIGS: Record<string, ModelProviderConfig> = {
  zhipu: {
    providerID: 'zhipu',
    kind: 'openai-compatible',
    displayName: '智谱 BigModel',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    apiKeyEnvVar: 'ZAI_API_KEY',
    envVars: ['ZAI_API_KEY'],
    defaultModels: Object.keys(ZHIPU_MODEL_METADATA),
    modelMetadata: ZHIPU_MODEL_METADATA,
    docURL: 'https://open.bigmodel.cn/dev/api/normal-model/glm-4',
    logoURL: 'https://open.bigmodel.cn/favicon.ico',
  },
}

// Initialize provider catalog from hardcoded providers + built-in models.dev snapshot.
// This runs synchronously at module load, so listProviderConfigs() works immediately
// without waiting for a network fetch.
;(() => {
  const initialCatalog: Record<string, ModelProviderConfig> = {
    ...PROVIDER_CONFIGS,
  }
  mergeModelsDevCatalog(initialCatalog, { providers: MODELS_DEV_PROVIDERS })
  providerCatalogCache = initialCatalog
  providerCatalogDiagnostics = {
    modelsDev: {
      status: 'builtin',
      providerCount: Object.keys(MODELS_DEV_PROVIDERS).length,
    },
    gateway: { status: 'idle' },
    providerCount: Object.keys(initialCatalog).length,
    providerIds: Object.keys(initialCatalog).slice(0, 20),
  }
})()

export async function listProviderConfigs(): Promise<ModelProviderConfig[]> {
  const catalog = await getProviderConfigCatalog()
  return Object.values(catalog).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )
}

export async function getProviderConfig(
  providerID: ModelProviderID,
): Promise<ModelProviderConfig> {
  const catalog = await getProviderConfigCatalog()
  return getProviderConfigFromCatalog(catalog, providerID)
}

export function getSelectedProviderConfig(): ModelProviderConfig {
  const settings = readProviderSettings()
  const providerID = getSelectedProviderID()
  const provider = getCachedProviderConfig(providerID)
  return {
    ...provider,
    ...(provider.requiresBaseURL && settings.providerBaseURL
      ? { baseURL: settings.providerBaseURL }
      : {}),
  }
}

export function getSelectedProviderID(): ModelProviderID {
  const settings = readProviderSettings()
  const provider = settings.provider
  if (provider === 'zhipu') return 'zhipuai'
  return typeof provider === 'string' ? provider.trim() : ''
}

export function saveSelectedProvider(
  options: SaveSelectedProviderOptions,
): SaveSelectedProviderResult {
  try {
    const current = readProviderSettings()
    writeProviderSettings({
      ...current,
      provider: normalizeLegacyProviderID(options.providerID),
      model: options.modelID,
      ...(options.baseURL !== undefined
        ? { providerBaseURL: options.baseURL }
        : { providerBaseURL: undefined }),
    })
    return {}
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

export async function fetchProviderModels(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<ProviderModelListResult> {
  const providerID = options.providerID
  const provider =
    providerID === getSelectedProviderID()
      ? getSelectedProviderConfig()
      : await getProviderConfig(providerID)

  if (provider.kind !== 'openai-compatible') {
    return { models: provider.defaultModels }
  }

  const baseURL = options.baseURL ?? provider.baseURL
  const apiKey = options.apiKey ?? getProviderApiKey(providerID)
  if (!baseURL) {
    return {
      models: provider.defaultModels,
      error: `${provider.displayName} needs an OpenAI-compatible Base URL before connection testing.`,
    }
  }
  if (!apiKey) {
    return {
      models: provider.defaultModels,
      error: `${provider.displayName} API key is not configured.`,
    }
  }

  const validationError = validateApiKeyHeader(apiKey)
  if (validationError) {
    return {
      models: provider.defaultModels,
      error: validationError,
    }
  }

  try {
    const response = await providerFetch(joinURL(baseURL, '/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) {
      return {
        models: provider.defaultModels,
        error: await formatProviderHTTPError(providerID, response),
      }
    }
    const parsed = (await response.json()) as {
      data?: Array<{ id?: unknown }>
    }
    const models = Array.from(
      new Set(
        (parsed.data ?? [])
          .map(model => model.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    if (models.length === 0) {
      return {
        models: provider.defaultModels,
        error: 'Provider returned no models.',
      }
    }
    const mergedModels = mergeProviderModels(models, provider.defaultModels)
    providerModelCache.set(providerID, mergedModels)
    return { models: mergedModels }
  } catch (error) {
    return {
      models: provider.defaultModels,
      error: errorMessageOf(error),
    }
  }
}

export async function fetchProviderBalance(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<ProviderBalanceResult> {
  if (options.providerID !== 'deepseek') {
    const provider = await getProviderConfig(options.providerID)
    return {
      isAvailable: false,
      balances: [],
      error: `${provider.displayName} does not support balance checking yet.`,
    }
  }

  const provider = await getProviderConfig(options.providerID)
  const baseURL = options.baseURL ?? provider.baseURL
  const apiKey = options.apiKey ?? getProviderApiKey(options.providerID)
  if (!baseURL) {
    return {
      isAvailable: false,
      balances: [],
      error: 'DeepSeek Base URL is not configured.',
    }
  }
  if (!apiKey) {
    return {
      isAvailable: false,
      balances: [],
      error: 'DeepSeek API key is not configured.',
    }
  }

  try {
    const response = await providerFetch(joinURL(baseURL, '/user/balance'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) {
      return {
        isAvailable: false,
        balances: [],
        error: await formatProviderHTTPError(options.providerID, response),
      }
    }
    const parsed = (await response.json()) as {
      is_available?: unknown
      balance_infos?: Array<{
        currency?: unknown
        total_balance?: unknown
        granted_balance?: unknown
        topped_up_balance?: unknown
      }>
    }
    return {
      isAvailable: parsed.is_available === true,
      balances: (parsed.balance_infos ?? []).flatMap(info => {
        if (typeof info.currency !== 'string') return []
        return [
          {
            currency: info.currency,
            totalBalance:
              typeof info.total_balance === 'string' ? info.total_balance : '',
            grantedBalance:
              typeof info.granted_balance === 'string'
                ? info.granted_balance
                : '',
            toppedUpBalance:
              typeof info.topped_up_balance === 'string'
                ? info.topped_up_balance
                : '',
          },
        ]
      }),
    }
  } catch (error) {
    return {
      isAvailable: false,
      balances: [],
      error: errorMessageOf(error),
    }
  }
}

export function getCachedProviderModels(
  providerID: ModelProviderID,
): string[] | null {
  return providerModelCache.get(providerID) ?? null
}

export function getProviderApiKey(providerID: ModelProviderID): string | null {
  const provider = getCachedProviderConfig(providerID)
  return (
    resolveProviderApiKeyEntryFromSources(provider, {
      storedKeys: readSecureStorage()?.providerApiKeys,
      env: providerEnv(),
    })?.value ?? null
  )
}

export function getProviderApiKeySource(
  providerID: ModelProviderID,
): string | null {
  const provider = getCachedProviderConfig(providerID)
  return (
    resolveProviderApiKeyEntryFromSources(provider, {
      storedKeys: readSecureStorage()?.providerApiKeys,
      env: providerEnv(),
    })?.source ?? null
  )
}

/**
 * Validates that an API key string is safe for use as an HTTP header value.
 * HTTP headers must contain only Latin-1 (ByteString) characters (code ≤ 255).
 * Returns null if valid, or a user-friendly error message if invalid.
 */
export function validateApiKeyHeader(apiKey: string): string | null {
  if (!apiKey || apiKey.trim().length === 0) {
    return 'API Key 不能为空'
  }
  for (let i = 0; i < apiKey.length; i++) {
    if (apiKey.charCodeAt(i) > 255) {
      return 'API Key 不能包含中文或换行，请粘贴实际密钥'
    }
  }
  if (apiKey.includes('\r') || apiKey.includes('\n')) {
    return 'API Key 不能包含中文或换行，请粘贴实际密钥'
  }
  return null
}

export function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): ProviderApiKeySaveResult {
  const validationError = validateApiKeyHeader(apiKey)
  if (validationError) {
    return { success: false, warning: validationError }
  }
  try {
    const current = readSecureStorage() ?? {}
    const result = writeSecureStorage({
      ...current,
      providerApiKeys: {
        ...(current.providerApiKeys ?? {}),
        [providerID]: apiKey,
      },
    })
    if (result) return result
    return {
      success: true,
      warning: 'Warning: Storing credentials in plaintext.',
    }
  } catch {
    return { success: false }
  }
}

export function deleteProviderApiKey(
  providerID: ModelProviderID,
): ProviderApiKeySaveResult {
  try {
    const current = readSecureStorage() ?? {}
    const providerApiKeys = { ...(current.providerApiKeys ?? {}) }
    delete providerApiKeys[providerID]
    return writeSecureStorage({ ...current, providerApiKeys }) ?? { success: true }
  } catch {
    return { success: false }
  }
}

export function clearProviderConfigCatalogCacheForTests(): void {
  providerCatalogPromise = null
  providerModelCache.clear()
  const initialCatalog: Record<string, ModelProviderConfig> = {
    ...PROVIDER_CONFIGS,
  }
  mergeModelsDevCatalog(initialCatalog, { providers: MODELS_DEV_PROVIDERS })
  providerCatalogCache = initialCatalog
  providerCatalogDiagnostics = {
    modelsDev: {
      status: 'builtin',
      providerCount: Object.keys(MODELS_DEV_PROVIDERS).length,
    },
    gateway: { status: 'idle' },
    providerCount: Object.keys(initialCatalog).length,
    providerIds: Object.keys(initialCatalog).slice(0, 20),
  }
}

export function resetProviderCatalogForTest(): void {
  clearProviderConfigCatalogCacheForTests()
}

export function getProviderCatalogDiagnostics(): ProviderCatalogDiagnostics {
  return {
    modelsDev: { ...providerCatalogDiagnostics.modelsDev },
    gateway: { ...providerCatalogDiagnostics.gateway },
    providerCount: providerCatalogDiagnostics.providerCount,
    providerIds: [...providerCatalogDiagnostics.providerIds],
  }
}

export function getProviderDisplayName(
  providerID = getSelectedProviderID(),
): string {
  return getCachedProviderConfig(providerID).displayName ?? providerID
}

export function getProviderModelMetadata(
  providerID: ModelProviderID,
  modelID: string,
): ModelMetadata | undefined {
  return getCachedProviderConfig(providerID).modelMetadata?.[modelID]
}

export function getSelectedProviderModelMetadata(
  modelID: string,
): ModelMetadata | undefined {
  return getProviderModelMetadata(getSelectedProviderID(), modelID)
}

export function shouldUseOpenAICompatibleProvider(explicitProviderID?: string): boolean {
  const config = explicitProviderID
    ? getCachedProviderConfig(explicitProviderID)
    : getSelectedProviderConfig()
  const route = resolveAiSdkProviderRoute(config)
  return (
    route === 'openai-compatible' ||
    route === 'openai' ||
    route === 'unsupported'
  )
}

export function shouldUseAnthropicCompatibleProvider(explicitProviderID?: string): boolean {
  const config = explicitProviderID
    ? getCachedProviderConfig(explicitProviderID)
    : getSelectedProviderConfig()
  return resolveAiSdkProviderRoute(config) === 'anthropic-compatible'
}

export function shouldUseMiniMaxProvider(explicitProviderID?: string): boolean {
  return shouldUseAnthropicCompatibleProvider(explicitProviderID)
}

export function shouldUseGitHubCopilotProvider(explicitProviderID?: string): boolean {
  const config = explicitProviderID
    ? getCachedProviderConfig(explicitProviderID)
    : getSelectedProviderConfig()
  return resolveAiSdkProviderRoute(config) === 'github-copilot'
}

export function resolveAiSdkProviderRoute(
  provider: Pick<ModelProviderConfig, 'kind' | 'npmPackage' | 'providerID'>,
): AiSdkProviderRoute {
  switch (provider.npmPackage) {
    case '@ai-sdk/anthropic':
      return 'anthropic-compatible'
    case '@ai-sdk/openai-compatible':
      return 'openai-compatible'
    case '@ai-sdk/openai':
      return 'openai'
    default:
      break
  }
  if (provider.kind === 'anthropic' || provider.kind === 'anthropic-compatible') {
    return 'anthropic-compatible'
  }
  if (provider.kind === 'openai-compatible') return 'openai-compatible'
  if (provider.kind === 'github-copilot') return 'github-copilot'
  if (provider.kind === 'minimax') return 'anthropic-compatible'
  return 'unsupported'
}

export function resolveProviderApiKeyFromSources(
  provider: Pick<ModelProviderConfig, 'providerID' | 'apiKeyEnvVar' | 'envVars'>,
  sources: {
    storedKeys?: Record<string, string>
    env?: Record<string, string | undefined>
  },
): string | undefined {
  return resolveProviderApiKeyEntryFromSources(provider, sources)?.value
}

export function resolveProviderApiKeySourceFromSources(
  provider: Pick<ModelProviderConfig, 'providerID' | 'apiKeyEnvVar' | 'envVars'>,
  sources: {
    storedKeys?: Record<string, string>
    env?: Record<string, string | undefined>
  },
): string | undefined {
  return resolveProviderApiKeyEntryFromSources(provider, sources)?.source
}

export async function getProviderConfigCatalog(): Promise<
  Record<string, ModelProviderConfig>
> {
  // Cache is pre-populated from built-in snapshot at module load.
  // If a background refresh is in progress, return the cache immediately.
  if (providerCatalogCache && providerCatalogPromise) return providerCatalogCache
  // First call: kick off async fetch and await it.
  providerCatalogPromise ??= fetchProviderConfigCatalog()
  providerCatalogCache = await providerCatalogPromise
  return providerCatalogCache
}

function getCachedProviderConfig(providerID: ModelProviderID): ModelProviderConfig {
  return getProviderConfigFromCatalog(providerCatalogCache ?? PROVIDER_CONFIGS, providerID)
}

function getProviderConfigFromCatalog(
  catalog: Record<string, ModelProviderConfig>,
  providerID: ModelProviderID,
): ModelProviderConfig {
  const normalizedProviderID = normalizeLegacyProviderID(providerID)
  return (
    catalog[normalizedProviderID] ??
    (normalizedProviderID === 'zhipuai' ? catalog.zhipu : undefined) ??
    buildFallbackProviderConfig(normalizedProviderID)
  )
}

async function fetchProviderConfigCatalog(): Promise<
  Record<string, ModelProviderConfig>
> {
  // Start with hardcoded providers only.
  // Remote catalog is the primary source; built-in snapshot is fallback.
  const catalog: Record<string, ModelProviderConfig> = { ...PROVIDER_CONFIGS }
  const [modelsDevResult, gatewayResult] = await Promise.allSettled([
    fetchModelsDevCatalog(),
    fetchGatewayModels(),
  ])

  if (modelsDevResult.status === 'fulfilled') {
    const stats = mergeModelsDevCatalog(catalog, modelsDevResult.value)
    providerCatalogDiagnostics.modelsDev = {
      status: 'fulfilled',
      providerCount: stats.providerCount,
      usableProviderCount: stats.usableProviderCount,
      filteredMissingApiCount: stats.filteredMissingApiCount,
    }
  } else {
    // Remote fetch failed — use built-in snapshot as fallback so provider
    // list is not reduced to only the hardcoded zhipu entry.
    const stats = mergeModelsDevCatalog(catalog, {
      providers: MODELS_DEV_PROVIDERS,
    })
    providerCatalogDiagnostics.modelsDev = {
      status: 'builtin',
      providerCount: stats.providerCount,
      usableProviderCount: stats.usableProviderCount,
      filteredMissingApiCount: stats.filteredMissingApiCount,
      error: errorMessageOf(modelsDevResult.reason),
    }
  }
  if (gatewayResult.status === 'fulfilled') {
    mergeGatewayCatalog(catalog, gatewayResult.value)
    providerCatalogDiagnostics.gateway = {
      status: 'fulfilled',
      modelCount: gatewayResult.value.length,
    }
  } else {
    providerCatalogDiagnostics.gateway = {
      status: 'rejected',
      error: errorMessageOf(gatewayResult.reason),
    }
  }
  providerCatalogDiagnostics.providerCount = Object.keys(catalog).length
  providerCatalogDiagnostics.providerIds = Object.keys(catalog).slice(0, 20)
  return catalog
}

async function fetchModelsDevCatalog(): Promise<ModelsDevCatalog> {
  const response = await providerFetch(MODELS_DEV_CATALOG_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const parsed = (await response.json()) as ModelsDevCatalog &
    Record<string, ModelsDevProvider>
  if (parsed.providers) return parsed
  return { providers: parsed }
}

async function fetchGatewayModels(): Promise<GatewayModel[]> {
  const response = await providerFetch(AI_GATEWAY_MODELS_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const parsed = (await response.json()) as { data?: GatewayModel[] }
  return Array.isArray(parsed.data) ? parsed.data : []
}

function mergeModelsDevCatalog(
  catalog: Record<string, ModelProviderConfig>,
  modelsDevCatalog: ModelsDevCatalog,
): {
  providerCount: number
  usableProviderCount: number
  filteredMissingApiCount: number
} {
  const modelsDevProviders = modelsDevCatalog.providers ?? {}
  const modelsDevModels = modelsDevCatalog.models ?? {}
  let usableProviderCount = 0
  let filteredMissingApiCount = 0
  for (const [providerID, provider] of Object.entries(modelsDevProviders)) {
    if (providerID === 'anthropic') continue
    if (!provider || typeof provider !== 'object') continue
    if (!hasModelsDevAPI(provider)) {
      filteredMissingApiCount += 1
      continue
    }
    usableProviderCount += 1
    const fromModelsDev = providerFromModelsDev(
      providerID,
      provider,
      modelsDevModels,
    )
    // Look up by direct key first, then by normalized providerID equivalence
    // (e.g. 'zhipuai' from models.dev merges into catalog['zhipu'] since
    //  normalizeLegacyProviderID('zhipu') === 'zhipuai').
    const directKey =
      providerID in catalog
        ? providerID
        : Object.keys(catalog).find(
            k => normalizeLegacyProviderID(k) === providerID,
          )
    const existing = directKey ? catalog[directKey] : undefined
    catalog[providerID] = existing
      ? {
          ...existing,
          kind: fromModelsDev.kind ?? existing.kind,
          displayName: existing.displayName || fromModelsDev.displayName,
          baseURL: existing.baseURL ?? fromModelsDev.baseURL,
          envVars: mergeEnvVars(
            existing.envVars,
            fromModelsDev.envVars,
          ),
          apiKeyEnvVar: existing.apiKeyEnvVar ?? fromModelsDev.apiKeyEnvVar,
          docURL: existing.docURL ?? fromModelsDev.docURL,
          logoURL: fromModelsDev.logoURL ?? existing.logoURL,
          npmPackage: fromModelsDev.npmPackage ?? existing.npmPackage,
          requiresBaseURL:
            fromModelsDev.requiresBaseURL ?? existing.requiresBaseURL,
          defaultModels: fromModelsDev.defaultModels.length
            ? fromModelsDev.defaultModels
            : existing.defaultModels,
          modelMetadata: mergeModelMetadata(
            existing.modelMetadata,
            fromModelsDev.modelMetadata,
          ),
          modelsDevSource: true,
        }
      : fromModelsDev
  }
  return {
    providerCount: Object.keys(modelsDevProviders).length,
    usableProviderCount,
    filteredMissingApiCount,
  }
}

function providerFromModelsDev(
  providerID: string,
  provider: ModelsDevProvider,
  globalModels: Record<string, ModelsDevModel>,
): ModelProviderConfig {
  const envVars = normalizeStringArray(provider.env)
  const apiKeyEnvVar = envVars[0] ?? getProviderApiKeyEnvVar(providerID)
  const baseURL = normalizeModelsDevProviderBaseURL(providerID, provider.api)
  const modelMetadata = normalizeProviderModels(
    providerID,
    provider.models,
    globalModels,
  )
  return {
    providerID,
    kind: inferProviderKind(providerID, provider),
    displayName:
      typeof provider.name === 'string' && provider.name.trim()
        ? provider.name
        : providerID,
    baseURL,
    apiKeyEnvVar,
    envVars: envVars.length ? envVars : [apiKeyEnvVar],
    defaultModels: Object.keys(modelMetadata),
    modelMetadata,
    docURL: typeof provider.doc === 'string' ? provider.doc : undefined,
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerID}.svg`,
    npmPackage: typeof provider.npm === 'string' ? provider.npm : undefined,
    modelsDevSource: true,
    requiresBaseURL:
      !baseURL && inferProviderKind(providerID, provider) === 'openai-compatible',
  }
}

function normalizeModelsDevProviderBaseURL(
  providerID: string,
  api: unknown,
): string | undefined {
  if (typeof api !== 'string') return undefined
  const baseURL = api.trim()
  if (!baseURL) return undefined
  if (
    providerID === 'minimax' &&
    (baseURL === 'https://api.minimaxi.com/anthropic' ||
      baseURL === 'https://api.minimax.io/anthropic')
  ) {
    return `${baseURL}/v1`
  }
  return baseURL
}

function normalizeProviderModels(
  providerID: string,
  providerModels: unknown,
  globalModels: Record<string, ModelsDevModel>,
): Record<string, ModelMetadata> {
  const entries =
    providerModels && typeof providerModels === 'object'
      ? Object.entries(providerModels as Record<string, ModelsDevModel>)
      : Object.entries(globalModels).filter(([modelID]) =>
          modelID.startsWith(`${providerID}/`),
        )
  const result: Record<string, ModelMetadata> = {}
  for (const [rawModelID, model] of entries) {
    const split = splitProviderModel(rawModelID)
    const modelID = split?.providerID === providerID ? split.modelID : rawModelID
    if (!modelID) continue
    result[modelID] = {
      id: modelID,
      name: typeof model.name === 'string' ? model.name : undefined,
      label: typeof model.name === 'string' ? model.name : undefined,
      contextWindow: numberOrUndefined(model.limit?.context),
      outputTokens: numberOrUndefined(model.limit?.output),
      inputCost: numberOrUndefined(model.cost?.input),
      outputCost: numberOrUndefined(model.cost?.output),
      cacheReadCost: numberOrUndefined(model.cost?.cache_read),
      reasoning: booleanOrUndefined(model.reasoning),
      toolCall: booleanOrUndefined(model.tool_call),
      structuredOutput: booleanOrUndefined(model.structured_output),
      vision: normalizeStringArray(model.modalities?.input).includes('image'),
      modalities: {
        input: normalizeStringArray(model.modalities?.input),
        output: normalizeStringArray(model.modalities?.output),
      },
      catalogSources: ['models.dev'],
      modelsDevProviderId: providerID,
    }
  }
  return result
}

function mergeGatewayCatalog(
  catalog: Record<string, ModelProviderConfig>,
  gatewayModels: GatewayModel[],
): void {
  for (const model of gatewayModels.filter(model => model.type === 'language')) {
    if (typeof model.id !== 'string' || !model.id.trim()) continue
    const split = splitProviderModel(model.id)
    if (!split) continue
    const provider = catalog[split.providerID]
    if (!provider) continue
    const owner =
      typeof model.owned_by === 'string' && model.owned_by.trim()
        ? model.owned_by.trim().toLowerCase()
        : split.providerID
    catalog[split.providerID] = {
      ...provider,
      modelMetadata: mergeModelMetadata(provider.modelMetadata, {
        [split.modelID]: {
          id: split.modelID,
          name: typeof model.name === 'string' ? model.name : undefined,
          description:
            typeof model.description === 'string' ? model.description : undefined,
          iconURL:
            typeof model.icon === 'string'
              ? model.icon
              : `${MODELS_DEV_LOGO_BASE_URL}/${owner}.svg`,
          modalities: {
            input: normalizeStringArray(model.input_modalities),
            output: normalizeStringArray(model.output_modalities),
          },
          tags: normalizeStringArray(model.tags),
          catalogSources: ['gateway'],
          gatewayModelId: model.id,
          modelsDevProviderId: owner,
        },
      }),
    }
  }
}

function mergeModelMetadata(
  first: Record<string, ModelMetadata> | undefined,
  second: Record<string, ModelMetadata> | undefined,
): Record<string, ModelMetadata> | undefined {
  if (!first && !second) return undefined
  const merged = { ...(first ?? {}) }
  for (const [modelID, metadata] of Object.entries(second ?? {})) {
    const current = merged[modelID]
    merged[modelID] = current
      ? {
          ...current,
          ...metadata,
          catalogSources: Array.from(
            new Set([
              ...(current.catalogSources ?? []),
              ...(metadata.catalogSources ?? []),
            ]),
          ),
          tags: Array.from(new Set([...(current.tags ?? []), ...(metadata.tags ?? [])])),
        }
      : metadata
  }
  return merged
}

function hasModelsDevAPI(provider: ModelsDevProvider): boolean {
  if (typeof provider.api === 'string' && provider.api.trim().length > 0) {
    return true
  }
  return normalizeStringArray(provider.env).length > 0
}

function inferProviderKind(
  providerID: string,
  provider: ModelsDevProvider,
): ModelProviderKind {
  if (provider.npm === '@ai-sdk/anthropic') return 'anthropic-compatible'
  if (provider.npm === '@ai-sdk/openai-compatible') return 'openai-compatible'
  if (provider.npm === '@ai-sdk/openai') return 'openai-compatible'
  if (providerID === 'github-copilot') return 'github-copilot'
  if (providerID === 'minimax') return 'anthropic-compatible'
  if (isGitHubCopilotProviderID(providerID)) return 'github-copilot'
  return 'openai-compatible'
}

function isGitHubCopilotProviderID(providerID: string): boolean {
  return (
    providerID === GITHUB_COPILOT_PROVIDER_ID ||
    providerID === 'copilot' ||
    providerID.startsWith('github-')
  )
}

function buildFallbackProviderConfig(providerID: string): ModelProviderConfig {
  const settings = readProviderSettings()
  const baseURL =
    typeof settings.providerBaseURL === 'string'
      ? settings.providerBaseURL
      : undefined
  if (!providerID.trim()) {
    return {
      providerID: '',
      kind: 'openai-compatible',
      displayName: '未配置',
      baseURL,
      envVars: [],
      defaultModels: [],
      requiresBaseURL: false,
    }
  }
  const apiKeyEnvVar = getProviderApiKeyEnvVar(providerID)
  return {
    providerID,
    kind: 'openai-compatible',
    displayName: providerID,
    baseURL,
    apiKeyEnvVar,
    envVars: [apiKeyEnvVar],
    defaultModels: [],
    requiresBaseURL: true,
  }
}

function getProviderEnvVars(
  provider: Pick<ModelProviderConfig, 'providerID' | 'apiKeyEnvVar' | 'envVars'>,
): string[] {
  const values = provider.envVars?.length
    ? provider.envVars
    : [provider.apiKeyEnvVar ?? getProviderApiKeyEnvVar(provider.providerID)]
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value?.trim()))),
  )
}

function resolveProviderApiKeyEntryFromSources(
  provider: Pick<ModelProviderConfig, 'providerID' | 'apiKeyEnvVar' | 'envVars'>,
  sources: {
    storedKeys?: Record<string, string>
    env?: Record<string, string | undefined>
  },
): { value: string; source: string } | undefined {
  const credentialKeys = [
    provider.providerID,
  ]
  for (const key of Array.from(new Set(credentialKeys))) {
    const stored = sources.storedKeys?.[key]?.trim()
    if (stored) return { value: stored, source: 'secureStorage' }
  }
  for (const envKey of getProviderEnvVars(provider)) {
    const envValue = sources.env?.[envKey]?.trim()
    if (envValue) return { value: envValue, source: envKey }
  }
  return undefined
}

function readProviderSettings(): ProviderSettings {
  if (runtime.settingsStore) {
    return runtime.settingsStore.read()
  }
  return readJsonFile<ProviderSettings>(getSettingsPath()) ?? {}
}

function writeProviderSettings(settings: ProviderSettings): void {
  if (runtime.settingsStore) {
    const result = runtime.settingsStore.update(settings)
    if (result.error) throw result.error
    return
  }
  const cleanSettings: ProviderSettings = {}
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) cleanSettings[key] = value
  }
  writeJsonFile(getSettingsPath(), cleanSettings, 0o600)
}

function readSecureStorage(): SecureStorageData | null {
  if (runtime.credentialStore) {
    return { providerApiKeys: runtime.credentialStore.readProviderApiKeys() }
  }
  return readJsonFile<SecureStorageData>(getCredentialsPath())
}

function writeSecureStorage(data: SecureStorageData): ProviderApiKeySaveResult | void {
  if (runtime.credentialStore) {
    const result = runtime.credentialStore.writeProviderApiKeys(
      data.providerApiKeys ?? {},
    )
    if (!result.success) throw new Error(result.warning ?? 'Failed to write provider API keys.')
    return result
  }
  writeJsonFile(getCredentialsPath(), data, 0o600)
}

function providerFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  return (runtime.fetch ?? globalThis.fetch)(input, init)
}

function providerEnv(): Record<string, string | undefined> {
  return runtime.env ?? process.env
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJsonFile(path: string, value: unknown, mode: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
  if (existsSync(path)) chmodSync(path, mode)
}

function getSettingsPath(): string {
  return join(getConfigHomeDir(), 'settings.json')
}

function getCredentialsPath(): string {
  return join(getConfigHomeDir(), '.credentials.json')
}

function getConfigHomeDir(): string {
  return (
    process.env[CODEPILOTX_CONFIG_DIR_ENV] ??
    process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] ??
    join(homedir(), CODEPILOTX_CONFIG_DIR_NAME)
  ).normalize('NFC')
}

function mergeProviderModels(
  liveModels: string[],
  curatedModels: string[],
): string[] {
  return Array.from(new Set([...liveModels, ...curatedModels]))
}

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function formatProviderHTTPError(
  providerID: ModelProviderID,
  response: Response,
): Promise<string> {
  const rawText = await response.text()
  const apiError = extractProviderError(rawText)
  const prefix =
    providerID === 'deepseek'
      ? formatDeepSeekHTTPStatus(response.status)
      : isZhipuProviderID(providerID)
        ? formatZhipuHTTPStatus(response.status, apiError.code)
        : `${response.status} ${response.statusText}`
  const message = apiError.message
  if (!message) return prefix
  return `${prefix}: ${apiError.code ? `${apiError.code} ` : ''}${message}`
}

function errorMessageOf(error: unknown): string {
  const message = baseErrorMessageOf(error)
  const cause = errorCauseOf(error)
  if (!cause) return message
  return `${message}; cause: ${errorMessageOf(cause)}`
}

function extractProviderError(rawText: string): {
  code?: string
  message: string | null
} {
  if (!rawText.trim()) return { message: null }
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { code?: unknown; message?: unknown }
      code?: unknown
      message?: unknown
    }
    const message = parsed.error?.message ?? parsed.message
    const code = parsed.error?.code ?? parsed.code
    return {
      ...(typeof code === 'string' && code.trim() ? { code: code.trim() } : {}),
      message:
        typeof message === 'string' && message.trim() ? message.trim() : null,
    }
  } catch {
    return { message: rawText.trim() }
  }
}

function baseErrorMessageOf(error: unknown): string {
  const metadata = errorMetadataOf(error)
  if (error instanceof Error) {
    const message = error.message || error.name
    return metadata.length ? `${message} (${metadata.join(' ')})` : message
  }
  if (typeof error === 'string') return error
  try {
    const message = JSON.stringify(error)
    return metadata.length ? `${message} (${metadata.join(' ')})` : message
  } catch {
    const message = String(error)
    return metadata.length ? `${message} (${metadata.join(' ')})` : message
  }
}

function errorCauseOf(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return undefined
  }
  return (error as { cause?: unknown }).cause
}

function errorMetadataOf(error: unknown): string[] {
  if (!error || typeof error !== 'object') return []
  const candidate = error as Record<string, unknown>
  const metadata: string[] = []
  for (const key of ['code', 'syscall', 'address', 'port', 'errno']) {
    const value = candidate[key]
    if (typeof value === 'string' || typeof value === 'number') {
      metadata.push(`${key}=${value}`)
    }
  }
  return metadata
}

function formatDeepSeekHTTPStatus(status: number): string {
  switch (status) {
    case 400:
      return '400 request format error'
    case 401:
      return '401 invalid or unauthorized API key'
    case 402:
      return '402 insufficient DeepSeek balance'
    case 422:
      return '422 request parameter error'
    case 429:
      return '429 rate limit exceeded'
    case 500:
      return '500 DeepSeek service error'
    case 503:
      return '503 DeepSeek service busy'
    default:
      return `${status} DeepSeek request failed`
  }
}

function formatZhipuHTTPStatus(status: number, businessCode?: string): string {
  switch (businessCode) {
    case '1000':
    case '1002':
      return `${status} authentication failed`
    case '1211':
      return `${status} model not found`
    case '1261':
      return `${status} prompt too long`
    case '1302':
    case '1303':
      return `${status} rate limit exceeded`
    case '1311':
      return `${status} model access unavailable`
    case '1312':
      return `${status} model overloaded`
    case '1313':
      return `${status} fair-use rate limited`
  }
  switch (status) {
    case 400:
      return '400 request parameter error'
    case 401:
      return '401 authentication failed'
    case 429:
      return '429 rate limit or account quota exceeded'
    case 500:
      return '500 Zhipu service error'
    default:
      return `${status} Zhipu request failed`
  }
}

function isZhipuProviderID(providerID: string): boolean {
  return providerID === 'zhipu' || providerID === 'zhipuai'
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    )
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

// ── Background refresh ─────────────────────────────────────────────

const PROVIDER_REFRESH_INTERVAL_MS = 5 * 60 * 1000

/**
 * Start a background provider catalog refresh loop.
 *
 * Immediately triggers one fetch, then repeats every 5 minutes.
 * Timer is unref'd so it doesn't block process exit.
 * Failures are silently caught — the cache keeps its previous state.
 */
export function startProviderCatalogRefreshLoop(): { stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  async function refresh(): Promise<void> {
    if (stopped) return
    try {
      const freshCatalog = await fetchProviderConfigCatalog()
      if (!stopped) {
        providerCatalogCache = freshCatalog
        providerCatalogPromise = null
      }
    } catch {
      // Keep existing cache on failure
    }
  }

  // Fire immediately
  void refresh()

  timer = setInterval(refresh, PROVIDER_REFRESH_INTERVAL_MS)
  timer.unref()

  return {
    stop: () => {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

function mergeEnvVars(
  existing?: string[],
  fromDev?: string[],
): string[] | undefined {
  if (!existing?.length && !fromDev?.length) return undefined
  const set = new Set([...(existing ?? []), ...(fromDev ?? [])])
  return Array.from(set)
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

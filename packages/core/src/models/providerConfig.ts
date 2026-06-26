import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../config/env.js'
import {
  getProviderApiKeyEnvVar,
  normalizeLegacyProviderID,
  splitProviderModel,
  type ModelMetadata,
  type ModelProviderConfig,
  type ModelProviderID,
  type ModelProviderKind,
  type ProviderBalanceInfo,
  type ProviderTokenPlanUsageInfo,
} from './provider.js'

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
  description?: unknown
  icon?: unknown
  input_modalities?: unknown
  output_modalities?: unknown
}

const MODELS_DEV_CATALOG_URL = 'https://models.dev/catalog.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const AI_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const AI_GATEWAY_PROVIDER_ID = 'ai-gateway'

const providerModelCache = new Map<string, string[]>()
let providerCatalogCache: Record<string, ModelProviderConfig> | null = null
let providerCatalogPromise: Promise<Record<string, ModelProviderConfig>> | null =
  null

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
  if (provider === AI_GATEWAY_PROVIDER_ID) return 'minimax'
  if (provider === 'zhipu') return 'zhipuai'
  if (provider === 'custom') return 'minimax'
  return typeof provider === 'string' && provider.trim() ? provider : 'minimax'
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

  try {
    const response = await fetch(joinURL(baseURL, '/models'), {
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
    const response = await fetch(joinURL(baseURL, '/user/balance'), {
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
      env: process.env,
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
      env: process.env,
    })?.source ?? null
  )
}

export function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): ProviderApiKeySaveResult {
  try {
    const current = readSecureStorage() ?? {}
    writeSecureStorage({
      ...current,
      providerApiKeys: {
        ...(current.providerApiKeys ?? {}),
        [providerID]: apiKey,
      },
    })
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
    const provider = getCachedProviderConfig(providerID)
    const providerApiKeys = { ...(current.providerApiKeys ?? {}) }
    delete providerApiKeys[providerID]
    delete providerApiKeys[getProviderApiKeyEnvVar(providerID)]
    for (const envKey of getProviderEnvVars(provider)) {
      delete providerApiKeys[envKey]
    }
    writeSecureStorage({ ...current, providerApiKeys })
    return { success: true }
  } catch {
    return { success: false }
  }
}

export function clearProviderConfigCatalogCacheForTests(): void {
  providerCatalogCache = null
  providerCatalogPromise = null
  providerModelCache.clear()
}

async function getProviderConfigCatalog(): Promise<
  Record<string, ModelProviderConfig>
> {
  if (providerCatalogCache) return providerCatalogCache
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
  const catalog: Record<string, ModelProviderConfig> = { ...PROVIDER_CONFIGS }
  const [modelsDevResult, gatewayResult] = await Promise.allSettled([
    fetchModelsDevCatalog(),
    fetchGatewayModels(),
  ])

  if (modelsDevResult.status === 'fulfilled') {
    mergeModelsDevCatalog(catalog, modelsDevResult.value)
  }
  if (gatewayResult.status === 'fulfilled') {
    mergeGatewayCatalog(catalog, gatewayResult.value)
  }
  return catalog
}

async function fetchModelsDevCatalog(): Promise<ModelsDevCatalog> {
  const response = await fetch(MODELS_DEV_CATALOG_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const parsed = (await response.json()) as ModelsDevCatalog &
    Record<string, ModelsDevProvider>
  if (parsed.providers) return parsed
  return { providers: parsed }
}

async function fetchGatewayModels(): Promise<GatewayModel[]> {
  const response = await fetch(AI_GATEWAY_MODELS_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const parsed = (await response.json()) as { data?: GatewayModel[] }
  return Array.isArray(parsed.data) ? parsed.data : []
}

function mergeModelsDevCatalog(
  catalog: Record<string, ModelProviderConfig>,
  modelsDevCatalog: ModelsDevCatalog,
): void {
  const modelsDevProviders = modelsDevCatalog.providers ?? {}
  const modelsDevModels = modelsDevCatalog.models ?? {}
  for (const [providerID, provider] of Object.entries(modelsDevProviders)) {
    if (providerID === 'anthropic') continue
    if (!provider || typeof provider !== 'object') continue
    if (!hasModelsDevAPI(provider)) continue
    const fromModelsDev = providerFromModelsDev(
      providerID,
      provider,
      modelsDevModels,
    )
    const existing = catalog[providerID]
    catalog[providerID] = existing
      ? {
          ...existing,
          displayName: fromModelsDev.displayName || existing.displayName,
          baseURL: fromModelsDev.baseURL ?? existing.baseURL,
          envVars: fromModelsDev.envVars?.length
            ? fromModelsDev.envVars
            : existing.envVars,
          apiKeyEnvVar: fromModelsDev.apiKeyEnvVar ?? existing.apiKeyEnvVar,
          docURL: fromModelsDev.docURL ?? existing.docURL,
          logoURL: fromModelsDev.logoURL ?? existing.logoURL,
          npmPackage: fromModelsDev.npmPackage ?? existing.npmPackage,
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
}

function providerFromModelsDev(
  providerID: string,
  provider: ModelsDevProvider,
  globalModels: Record<string, ModelsDevModel>,
): ModelProviderConfig {
  const envVars = normalizeStringArray(provider.env)
  const apiKeyEnvVar = envVars[0] ?? getProviderApiKeyEnvVar(providerID)
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
    baseURL:
      typeof provider.api === 'string' && provider.api.trim()
        ? provider.api.trim()
        : undefined,
    apiKeyEnvVar,
    envVars: envVars.length ? envVars : [apiKeyEnvVar],
    defaultModels: Object.keys(modelMetadata),
    modelMetadata,
    docURL: typeof provider.doc === 'string' ? provider.doc : undefined,
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerID}.svg`,
    npmPackage: typeof provider.npm === 'string' ? provider.npm : undefined,
    modelsDevSource: true,
    requiresBaseURL:
      !(typeof provider.api === 'string' && provider.api.trim()) &&
      inferProviderKind(providerID, provider) === 'openai-compatible',
  }
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
    catalog[split.providerID] = {
      ...provider,
      modelMetadata: mergeModelMetadata(provider.modelMetadata, {
        [split.modelID]: {
          id: split.modelID,
          name: typeof model.name === 'string' ? model.name : undefined,
          description:
            typeof model.description === 'string' ? model.description : undefined,
          iconURL: typeof model.icon === 'string' ? model.icon : undefined,
          modalities: {
            input: normalizeStringArray(model.input_modalities),
            output: normalizeStringArray(model.output_modalities),
          },
          catalogSources: ['gateway'],
          gatewayModelId: model.id,
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
        }
      : metadata
  }
  return merged
}

function hasModelsDevAPI(provider: ModelsDevProvider): boolean {
  return typeof provider.api === 'string' && provider.api.trim().length > 0
}

function inferProviderKind(
  providerID: string,
  provider: ModelsDevProvider,
): ModelProviderKind {
  if (providerID === 'github-copilot') return 'github-copilot'
  if (providerID === 'minimax') return 'minimax'
  if (provider.npm === '@ai-sdk/anthropic') return 'anthropic-compatible'
  if (provider.npm === '@ai-sdk/openai') return 'openai-compatible'
  return 'openai-compatible'
}

function buildFallbackProviderConfig(providerID: string): ModelProviderConfig {
  const settings = readProviderSettings()
  const baseURL =
    typeof settings.providerBaseURL === 'string'
      ? settings.providerBaseURL
      : undefined
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

function getProviderEnvVars(provider: ModelProviderConfig): string[] {
  const values = provider.envVars?.length
    ? provider.envVars
    : [provider.apiKeyEnvVar ?? getProviderApiKeyEnvVar(provider.providerID)]
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value?.trim()))),
  )
}

function resolveProviderApiKeyEntryFromSources(
  provider: ModelProviderConfig,
  sources: {
    storedKeys?: Record<string, string>
    env?: Record<string, string | undefined>
  },
): { value: string; source: string } | undefined {
  const credentialKeys = [
    provider.providerID,
    getProviderApiKeyEnvVar(provider.providerID),
    ...getProviderEnvVars(provider),
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
  return readJsonFile<ProviderSettings>(getSettingsPath()) ?? {}
}

function writeProviderSettings(settings: ProviderSettings): void {
  const cleanSettings: ProviderSettings = {}
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) cleanSettings[key] = value
  }
  writeJsonFile(getSettingsPath(), cleanSettings, 0o600)
}

function readSecureStorage(): SecureStorageData | null {
  return readJsonFile<SecureStorageData>(getCredentialsPath())
}

function writeSecureStorage(data: SecureStorageData): void {
  writeJsonFile(getCredentialsPath(), data, 0o600)
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
  providerID: string,
  response: Response,
): Promise<string> {
  let body = ''
  try {
    body = await response.text()
  } catch {
    body = ''
  }
  const detail = body ? `: ${body.slice(0, 500)}` : ''
  return `${providerID} request failed with ${response.status} ${response.statusText}${detail}`
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

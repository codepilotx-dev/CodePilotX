import { getSecureStorage } from '../secureStorage/index.js'
import { getSettings_DEPRECATED, updateSettingsForSource } from '../settings/settings.js'

export type ModelProviderID = string

export type ModelProviderKind =
  | 'anthropic'
  | 'openai-compatible'
  | 'minimax'
  | 'ai-gateway'

export type ProviderModelMetadata = {
  id: string
  name?: string
  label?: string
  description?: string
  badge?: string
  contextWindow?: number
  outputTokens?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  reasoning?: boolean
  toolCall?: boolean
  structuredOutput?: boolean
  vision?: boolean
  modalities?: {
    input: string[]
    output: string[]
  }
  catalogSources?: Array<'models.dev' | 'gateway'>
  gatewayModelId?: string
  modelsDevProviderId?: string
  modelType?: string
  tags?: string[]
}

export type ProviderConfig = {
  providerID: ModelProviderID
  kind: ModelProviderKind
  displayName: string
  baseURL?: string
  apiKeyEnvVar?: string
  envVars?: string[]
  defaultModels: string[]
  modelMetadata?: Record<string, ProviderModelMetadata>
  docURL?: string
  logoURL?: string
  npmPackage?: string
  modelsDevSource?: boolean
  gatewaySource?: boolean
  requiresBaseURL?: boolean
}

export type ProviderModelListResult = {
  models: string[]
  error?: string
}

export type ProviderBalanceInfo = {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type ProviderBalanceResult = {
  isAvailable: boolean
  balances: ProviderBalanceInfo[]
  error?: string
}

const MODELS_DEV_API_URL = 'https://models.dev/api.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const AI_GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const AI_GATEWAY_DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh/v3/ai'
const AI_GATEWAY_PROVIDER_ID = 'ai-gateway'

const providerModelCache = new Map<string, string[]>()
let providerCatalogCache: Record<string, ProviderConfig> | null = null
let providerCatalogPromise: Promise<Record<string, ProviderConfig>> | null = null

export const DEEPSEEK_MODEL_METADATA: Record<string, ProviderModelMetadata> = {
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    label: 'V4 Pro',
    description: 'Complex agent and high-quality coding tasks',
    badge: 'Quality',
    catalogSources: ['models.dev'],
    modelsDevProviderId: 'deepseek',
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    label: 'V4 Flash',
    description: 'Fast responses, light tasks, and economical usage',
    badge: 'Fast',
    catalogSources: ['models.dev'],
    modelsDevProviderId: 'deepseek',
  },
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  [AI_GATEWAY_PROVIDER_ID]: {
    providerID: AI_GATEWAY_PROVIDER_ID,
    kind: 'ai-gateway',
    displayName: 'AI Gateway',
    baseURL: AI_GATEWAY_DEFAULT_BASE_URL,
    apiKeyEnvVar: 'AI_GATEWAY_API_KEY',
    envVars: ['AI_GATEWAY_API_KEY'],
    defaultModels: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4.5'],
    docURL: 'https://vercel.com/docs/ai-gateway',
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/vercel.svg`,
    gatewaySource: true,
  },
  anthropic: {
    providerID: 'anthropic',
    kind: 'anthropic',
    displayName: 'Anthropic',
    envVars: ['ANTHROPIC_API_KEY'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/anthropic.svg`,
    defaultModels: [],
  },
  openai: {
    providerID: 'openai',
    kind: 'openai-compatible',
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    envVars: ['OPENAI_API_KEY'],
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/openai.svg`,
    defaultModels: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  },
  openrouter: {
    providerID: 'openrouter',
    kind: 'openai-compatible',
    displayName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    envVars: ['OPENROUTER_API_KEY'],
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/openrouter.svg`,
    defaultModels: [
      'anthropic/claude-sonnet-4.5',
      'openai/gpt-4.1',
      'deepseek/deepseek-chat',
    ],
  },
  deepseek: {
    providerID: 'deepseek',
    kind: 'openai-compatible',
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    envVars: ['DEEPSEEK_API_KEY'],
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/deepseek.svg`,
    defaultModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    modelMetadata: DEEPSEEK_MODEL_METADATA,
  },
  minimax: {
    providerID: 'minimax',
    kind: 'minimax',
    displayName: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    envVars: ['MINIMAX_API_KEY'],
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/minimax.svg`,
    defaultModels: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
  },
  groq: {
    providerID: 'groq',
    kind: 'openai-compatible',
    displayName: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    envVars: ['GROQ_API_KEY'],
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/groq.svg`,
    defaultModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  },
  custom: {
    providerID: 'custom',
    kind: 'openai-compatible',
    displayName: 'Custom OpenAI-compatible',
    apiKeyEnvVar: 'CUSTOM_PROVIDER_API_KEY',
    envVars: ['CUSTOM_PROVIDER_API_KEY'],
    defaultModels: [],
    requiresBaseURL: true,
  },
}

export function isModelProviderID(value: string): value is ModelProviderID {
  return typeof value === 'string' && value.trim().length > 0
}

export async function getProviderConfigCatalog(): Promise<Record<string, ProviderConfig>> {
  if (providerCatalogCache) return providerCatalogCache
  providerCatalogPromise ??= fetchProviderConfigCatalog()
  providerCatalogCache = await providerCatalogPromise
  return providerCatalogCache
}

export async function listProviderConfigs(): Promise<ProviderConfig[]> {
  const catalog = await getProviderConfigCatalog()
  return Object.values(catalog).sort((a, b) => {
    if (a.providerID === AI_GATEWAY_PROVIDER_ID) return -1
    if (b.providerID === AI_GATEWAY_PROVIDER_ID) return 1
    const aBuiltIn = a.providerID in PROVIDER_CONFIGS ? 0 : 1
    const bBuiltIn = b.providerID in PROVIDER_CONFIGS ? 0 : 1
    return aBuiltIn - bBuiltIn || a.displayName.localeCompare(b.displayName)
  })
}

export async function getProviderConfig(providerID: ModelProviderID): Promise<ProviderConfig> {
  const catalog = await getProviderConfigCatalog()
  return catalog[providerID] ?? buildFallbackProviderConfig(providerID)
}

function getCachedProviderConfig(providerID: ModelProviderID): ProviderConfig {
  return providerCatalogCache?.[providerID] ?? PROVIDER_CONFIGS[providerID] ?? buildFallbackProviderConfig(providerID)
}

async function fetchProviderConfigCatalog(): Promise<Record<string, ProviderConfig>> {
  const catalog: Record<string, ProviderConfig> = { ...PROVIDER_CONFIGS }
  const [modelsDevResult, gatewayResult] = await Promise.allSettled([
    fetchModelsDevProviders(),
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

async function fetchModelsDevProviders(): Promise<Record<string, ModelsDevProvider>> {
  const response = await fetch(MODELS_DEV_API_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as Record<string, ModelsDevProvider>
}

async function fetchGatewayModels(): Promise<GatewayModel[]> {
  const response = await fetch(AI_GATEWAY_MODELS_URL)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const parsed = (await response.json()) as { data?: GatewayModel[] }
  return Array.isArray(parsed.data) ? parsed.data : []
}

function mergeModelsDevCatalog(
  catalog: Record<string, ProviderConfig>,
  modelsDevProviders: Record<string, ModelsDevProvider>,
): void {
  for (const [providerID, provider] of Object.entries(modelsDevProviders)) {
    if (!provider || typeof provider !== 'object') continue
    const fromModelsDev = providerFromModelsDev(providerID, provider)
    const existing = catalog[providerID]
    catalog[providerID] = existing
      ? {
          ...existing,
          displayName: fromModelsDev.displayName || existing.displayName,
          envVars: fromModelsDev.envVars?.length ? fromModelsDev.envVars : existing.envVars,
          apiKeyEnvVar: fromModelsDev.apiKeyEnvVar ?? existing.apiKeyEnvVar,
          docURL: fromModelsDev.docURL ?? existing.docURL,
          logoURL: fromModelsDev.logoURL ?? existing.logoURL,
          npmPackage: fromModelsDev.npmPackage ?? existing.npmPackage,
          defaultModels: fromModelsDev.defaultModels.length ? fromModelsDev.defaultModels : existing.defaultModels,
          modelMetadata: mergeModelMetadata(existing.modelMetadata, fromModelsDev.modelMetadata),
          modelsDevSource: true,
        }
      : fromModelsDev
  }
}

function mergeGatewayCatalog(
  catalog: Record<string, ProviderConfig>,
  gatewayModels: GatewayModel[],
): void {
  const gatewayProvider = catalog[AI_GATEWAY_PROVIDER_ID] ?? PROVIDER_CONFIGS[AI_GATEWAY_PROVIDER_ID]!
  const languageModels = gatewayModels.filter(model => model.type === 'language')
  const gatewayMetadata: Record<string, ProviderModelMetadata> = {}
  for (const model of languageModels) {
    if (typeof model.id !== 'string' || !model.id.trim()) continue
    gatewayMetadata[model.id] = normalizeGatewayModelMetadata(model)
  }
  catalog[AI_GATEWAY_PROVIDER_ID] = {
    ...gatewayProvider,
    defaultModels: Object.keys(gatewayMetadata).length
      ? Object.keys(gatewayMetadata)
      : gatewayProvider.defaultModels,
    modelMetadata: mergeModelMetadata(gatewayProvider.modelMetadata, gatewayMetadata),
    gatewaySource: true,
  }
}

function mergeModelMetadata(
  first: Record<string, ProviderModelMetadata> | undefined,
  second: Record<string, ProviderModelMetadata> | undefined,
): Record<string, ProviderModelMetadata> | undefined {
  if (!first && !second) return undefined
  const merged = { ...(first ?? {}) }
  for (const [modelID, metadata] of Object.entries(second ?? {})) {
    const current = merged[modelID]
    merged[modelID] = current
      ? {
          ...current,
          ...metadata,
          catalogSources: mergeSources(current.catalogSources, metadata.catalogSources),
          tags: Array.from(new Set([...(current.tags ?? []), ...(metadata.tags ?? [])])),
        }
      : metadata
  }
  return merged
}

function providerFromModelsDev(providerID: string, provider: ModelsDevProvider): ProviderConfig {
  const envVars = normalizeStringArray(provider.env)
  const modelMetadata = normalizeProviderModels(providerID, provider.models)
  return {
    providerID,
    kind: inferProviderKind(providerID),
    displayName: typeof provider.name === 'string' && provider.name.trim() ? provider.name : providerID,
    apiKeyEnvVar: envVars[0],
    envVars,
    defaultModels: Object.keys(modelMetadata),
    modelMetadata,
    docURL: typeof provider.doc === 'string' ? provider.doc : undefined,
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerID}.svg`,
    npmPackage: typeof provider.npm === 'string' ? provider.npm : undefined,
    modelsDevSource: true,
    requiresBaseURL: !(providerID in PROVIDER_CONFIGS),
  }
}

function normalizeProviderModels(
  providerID: string,
  models: unknown,
): Record<string, ProviderModelMetadata> {
  if (!models || typeof models !== 'object') return {}
  const normalized: Record<string, ProviderModelMetadata> = {}
  for (const [modelID, model] of Object.entries(models as Record<string, ModelsDevModel>)) {
    normalized[modelID] = normalizeModelsDevModelMetadata(providerID, modelID, model)
  }
  return normalized
}

function normalizeModelsDevModelMetadata(
  providerID: string,
  modelID: string,
  model: ModelsDevModel,
): ProviderModelMetadata {
  const inputModalities = normalizeModalities(model?.modalities?.input)
  const outputModalities = normalizeModalities(model?.modalities?.output)
  return {
    id: modelID,
    name: typeof model?.name === 'string' ? model.name : undefined,
    label: typeof model?.name === 'string' ? model.name : modelID,
    contextWindow: numberOrUndefined(model?.limit?.context),
    outputTokens: numberOrUndefined(model?.limit?.output),
    inputCost: numberOrUndefined(model?.cost?.input),
    outputCost: numberOrUndefined(model?.cost?.output),
    cacheReadCost: numberOrUndefined(model?.cost?.cache_read),
    reasoning: model?.reasoning === true,
    toolCall: model?.tool_call === true,
    structuredOutput: model?.structured_output === true,
    vision: inputModalities.includes('image'),
    modalities: { input: inputModalities, output: outputModalities },
    catalogSources: ['models.dev'],
    modelsDevProviderId: providerID,
  }
}

function normalizeGatewayModelMetadata(model: GatewayModel): ProviderModelMetadata {
  const tags = normalizeStringArray(model.tags)
  return {
    id: model.id,
    name: typeof model.name === 'string' ? model.name : undefined,
    label: typeof model.name === 'string' ? model.name : model.id,
    description: typeof model.description === 'string' ? model.description : undefined,
    contextWindow: numberOrUndefined(model.context_window),
    outputTokens: numberOrUndefined(model.max_tokens),
    inputCost: gatewayCostPerMillion(model.pricing?.input),
    outputCost: gatewayCostPerMillion(model.pricing?.output),
    cacheReadCost: gatewayCostPerMillion(model.pricing?.input_cache_read),
    reasoning: tags.includes('reasoning'),
    toolCall: tags.includes('tool-use'),
    structuredOutput: tags.includes('structured-output'),
    vision: tags.includes('vision'),
    modalities: {
      input: [
        'text',
        ...(tags.includes('vision') ? ['image'] : []),
        ...(tags.includes('file-input') ? ['file'] : []),
      ],
      output: ['text'],
    },
    catalogSources: ['gateway'],
    gatewayModelId: model.id,
    modelsDevProviderId: typeof model.owned_by === 'string' ? model.owned_by : undefined,
    modelType: typeof model.type === 'string' ? model.type : undefined,
    tags,
  }
}

function inferProviderKind(providerID: string): ModelProviderKind {
  if (providerID === AI_GATEWAY_PROVIDER_ID) return 'ai-gateway'
  if (providerID === 'anthropic') return 'anthropic'
  if (providerID === 'minimax') return 'minimax'
  return 'openai-compatible'
}

function buildFallbackProviderConfig(providerID: string): ProviderConfig {
  const settings = getSettings_DEPRECATED() || {}
  const baseURL = typeof settings.providerBaseURL === 'string' ? settings.providerBaseURL : undefined
  return {
    providerID,
    kind: 'openai-compatible',
    displayName: providerID,
    baseURL,
    defaultModels: [],
    requiresBaseURL: true,
  }
}

export function getSelectedProviderID(): ModelProviderID {
  const settings = getSettings_DEPRECATED() || {}
  const provider = settings.provider
  return typeof provider === 'string' && provider.trim() ? provider : 'anthropic'
}

export function getSelectedProviderConfig(): ProviderConfig {
  const settings = getSettings_DEPRECATED() || {}
  const providerID = getSelectedProviderID()
  const provider = getCachedProviderConfig(providerID)
  return {
    ...provider,
    ...((provider.requiresBaseURL || provider.providerID === 'custom') && settings.providerBaseURL
      ? { baseURL: settings.providerBaseURL }
      : {}),
  }
}

export function getProviderDisplayName(providerID = getSelectedProviderID()): string {
  return getCachedProviderConfig(providerID).displayName ?? providerID
}

export function getProviderModelMetadata(
  providerID: ModelProviderID,
  modelID: string,
): ProviderModelMetadata | undefined {
  return getCachedProviderConfig(providerID).modelMetadata?.[modelID]
}

export function getSelectedProviderModelMetadata(
  modelID: string,
): ProviderModelMetadata | undefined {
  return getProviderModelMetadata(getSelectedProviderID(), modelID)
}

export function splitProviderModel(input: string): {
  providerID: ModelProviderID
  modelID: string
} | null {
  const slash = input.indexOf('/')
  if (slash <= 0 || slash === input.length - 1) return null
  const provider = input.slice(0, slash).toLowerCase()
  if (!isModelProviderID(provider)) return null
  return { providerID: provider, modelID: input.slice(slash + 1) }
}

export function formatProviderModel(
  providerID: ModelProviderID,
  modelID: string | null | undefined,
): string {
  return `${providerID}/${modelID || 'default'}`
}

export function saveSelectedProvider(params: {
  providerID: ModelProviderID
  modelID?: string
  baseURL?: string
}): void {
  const provider = getCachedProviderConfig(params.providerID)
  updateSettingsForSource('userSettings', {
    provider: params.providerID,
    providerBaseURL:
      provider.requiresBaseURL || params.providerID === 'custom'
        ? params.baseURL || undefined
        : undefined,
    ...(params.modelID !== undefined ? { model: params.modelID } : {}),
  })
}

export function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage()
  const data = storage.read() || {}
  const providerApiKeys = {
    ...(data.providerApiKeys ?? {}),
    [providerID]: apiKey,
  }
  return storage.update({ ...data, providerApiKeys })
}

export function getProviderApiKey(providerID = getSelectedProviderID()):
  | string
  | undefined {
  const provider = getCachedProviderConfig(providerID)
  for (const envKey of getProviderEnvVars(provider)) {
    if (process.env[envKey]) return process.env[envKey]
  }
  return getSecureStorage().read()?.providerApiKeys?.[providerID]
}

export function getProviderApiKeySource(providerID = getSelectedProviderID()):
  | string
  | undefined {
  const provider = getCachedProviderConfig(providerID)
  for (const envKey of getProviderEnvVars(provider)) {
    if (process.env[envKey]) return envKey
  }
  return getSecureStorage().read()?.providerApiKeys?.[providerID]
    ? 'secureStorage'
    : undefined
}

function getProviderEnvVars(provider: ProviderConfig): string[] {
  return Array.from(
    new Set(
      [...(provider.envVars ?? []), provider.apiKeyEnvVar].filter(
        (item): item is string => Boolean(item),
      ),
    ),
  )
}

export function shouldUseAiGatewayProvider(): boolean {
  return getSelectedProviderConfig().kind === 'ai-gateway'
}

export function shouldUseOpenAICompatibleProvider(): boolean {
  return getSelectedProviderConfig().kind === 'openai-compatible'
}

export function shouldUseMiniMaxProvider(): boolean {
  return getSelectedProviderConfig().kind === 'minimax'
}

export function getCachedProviderModels(
  providerID = getSelectedProviderID(),
): string[] | undefined {
  return providerModelCache.get(providerID)
}

export async function fetchProviderModels(params: {
  providerID?: ModelProviderID
  apiKey?: string
  baseURL?: string
} = {}): Promise<ProviderModelListResult> {
  const providerID = params.providerID ?? getSelectedProviderID()
  const provider =
    providerID === getSelectedProviderID()
      ? getSelectedProviderConfig()
      : await getProviderConfig(providerID)

  if (provider.kind === 'ai-gateway') {
    providerModelCache.set(providerID, provider.defaultModels)
    return { models: provider.defaultModels }
  }
  if (provider.kind !== 'openai-compatible') return { models: provider.defaultModels }

  const baseURL = params.baseURL ?? provider.baseURL
  const apiKey = params.apiKey ?? getProviderApiKey(providerID)
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
    const parsed = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const models = Array.from(
      new Set(
        (parsed.data ?? [])
          .map(model => model.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    if (models.length === 0) {
      return { models: provider.defaultModels, error: 'Provider returned no models.' }
    }
    providerModelCache.set(providerID, models)
    return { models }
  } catch (error) {
    return {
      models: provider.defaultModels,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function fetchProviderBalance(params: {
  providerID?: ModelProviderID
  apiKey?: string
  baseURL?: string
} = {}): Promise<ProviderBalanceResult> {
  const providerID = params.providerID ?? getSelectedProviderID()
  const provider =
    providerID === getSelectedProviderID()
      ? getSelectedProviderConfig()
      : await getProviderConfig(providerID)

  if (providerID !== 'deepseek') {
    return {
      isAvailable: false,
      balances: [],
      error: `${provider.displayName} does not support balance checking yet.`,
    }
  }

  const baseURL = params.baseURL ?? provider.baseURL
  const apiKey = params.apiKey ?? getProviderApiKey(providerID)
  if (!baseURL) return { isAvailable: false, balances: [], error: 'DeepSeek Base URL is not configured.' }
  if (!apiKey) return { isAvailable: false, balances: [], error: 'DeepSeek API key is not configured.' }

  try {
    const response = await fetch(joinURL(baseURL, '/user/balance'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) {
      return {
        isAvailable: false,
        balances: [],
        error: await formatProviderHTTPError(providerID, response),
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
            totalBalance: typeof info.total_balance === 'string' ? info.total_balance : '',
            grantedBalance: typeof info.granted_balance === 'string' ? info.granted_balance : '',
            toppedUpBalance: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '',
          },
        ]
      }),
    }
  } catch (error) {
    return {
      isAvailable: false,
      balances: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function mergeSources(
  first: ProviderModelMetadata['catalogSources'],
  second: ProviderModelMetadata['catalogSources'],
): ProviderModelMetadata['catalogSources'] {
  return Array.from(new Set([...(first ?? []), ...(second ?? [])]))
}

function gatewayCostPerMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined
}

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function formatProviderHTTPError(
  providerID: ModelProviderID,
  response: Response,
): Promise<string> {
  const rawText = await response.text()
  const apiMessage = extractProviderErrorMessage(rawText)
  const prefix =
    providerID === 'deepseek'
      ? formatDeepSeekHTTPStatus(response.status)
      : `${response.status} ${response.statusText}`
  return apiMessage ? `${prefix}: ${apiMessage}` : prefix
}

function extractProviderErrorMessage(rawText: string): string | null {
  if (!rawText.trim()) return null
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { message?: unknown }
      message?: unknown
    }
    const message = parsed.error?.message ?? parsed.message
    return typeof message === 'string' && message.trim() ? message.trim() : null
  } catch {
    return rawText.trim()
  }
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

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function normalizeModalities(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return []
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

type ModelsDevProvider = {
  id?: string
  env?: unknown
  npm?: unknown
  name?: unknown
  doc?: unknown
  models?: unknown
}

type ModelsDevModel = {
  name?: unknown
  reasoning?: unknown
  tool_call?: unknown
  structured_output?: unknown
  modalities?: {
    input?: unknown
    output?: unknown
  }
  limit?: {
    context?: unknown
    output?: unknown
  }
  cost?: {
    input?: unknown
    output?: unknown
    cache_read?: unknown
  }
}

type GatewayModel = {
  id: string
  owned_by?: unknown
  name?: unknown
  description?: unknown
  context_window?: unknown
  max_tokens?: unknown
  type?: unknown
  tags?: unknown
  pricing?: {
    input?: unknown
    output?: unknown
    input_cache_read?: unknown
  }
}

import { getSecureStorage } from '../secureStorage/index.js'
import { getSettings_DEPRECATED, updateSettingsForSource } from '../settings/settings.js'

export type ModelProviderID =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'minimax'
  | 'groq'
  | 'custom'

export type ModelProviderKind = 'anthropic' | 'openai-compatible' | 'minimax'

export type ProviderConfig = {
  providerID: ModelProviderID
  kind: ModelProviderKind
  displayName: string
  baseURL?: string
  apiKeyEnvVar?: string
  defaultModels: string[]
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

export type ProviderModelMetadata = {
  label: string
  description: string
  badge?: string
}

const providerModelCache = new Map<string, string[]>()

export const DEEPSEEK_MODEL_METADATA: Record<string, ProviderModelMetadata> = {
  'deepseek-v4-pro': {
    label: 'V4 Pro',
    description: '适合复杂 Agent、长上下文和高质量代码任务',
    badge: '高质量',
  },
  'deepseek-v4-flash': {
    label: 'V4 Flash',
    description: '适合快速响应、轻量任务和经济使用',
    badge: '快速',
  },
}

export const PROVIDER_CONFIGS: Record<ModelProviderID, ProviderConfig> = {
  anthropic: {
    providerID: 'anthropic',
    kind: 'anthropic',
    displayName: 'Anthropic',
    defaultModels: [],
  },
  openai: {
    providerID: 'openai',
    kind: 'openai-compatible',
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    defaultModels: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  },
  openrouter: {
    providerID: 'openrouter',
    kind: 'openai-compatible',
    displayName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
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
    defaultModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  minimax: {
    providerID: 'minimax',
    kind: 'minimax',
    displayName: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/anthropic/v1',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
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
    defaultModels: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
  },
  custom: {
    providerID: 'custom',
    kind: 'openai-compatible',
    displayName: 'Custom OpenAI-compatible',
    apiKeyEnvVar: 'CUSTOM_PROVIDER_API_KEY',
    defaultModels: [],
  },
}

export function isModelProviderID(value: string): value is ModelProviderID {
  return value in PROVIDER_CONFIGS
}

export function getSelectedProviderID(): ModelProviderID {
  const settings = getSettings_DEPRECATED() || {}
  const provider = settings.provider
  return provider && isModelProviderID(provider) ? provider : 'anthropic'
}

export function getSelectedProviderConfig(): ProviderConfig {
  const settings = getSettings_DEPRECATED() || {}
  const provider = PROVIDER_CONFIGS[getSelectedProviderID()]
  return {
    ...provider,
    ...(provider.providerID === 'custom' && settings.providerBaseURL
      ? { baseURL: settings.providerBaseURL }
      : {}),
  }
}

export function getProviderDisplayName(providerID = getSelectedProviderID()): string {
  return PROVIDER_CONFIGS[providerID]?.displayName ?? providerID
}

export function getProviderModelMetadata(
  providerID: ModelProviderID,
  modelID: string,
): ProviderModelMetadata | undefined {
  if (providerID !== 'deepseek') {
    return undefined
  }
  return DEEPSEEK_MODEL_METADATA[modelID]
}

export function splitProviderModel(input: string): {
  providerID: ModelProviderID
  modelID: string
} | null {
  const slash = input.indexOf('/')
  if (slash <= 0 || slash === input.length - 1) return null
  const provider = input.slice(0, slash).toLowerCase()
  if (!isModelProviderID(provider)) return null
  return {
    providerID: provider,
    modelID: input.slice(slash + 1),
  }
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
  updateSettingsForSource('userSettings', {
    provider: params.providerID,
    providerBaseURL:
      params.providerID === 'custom' ? params.baseURL || undefined : undefined,
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
  const provider = PROVIDER_CONFIGS[providerID]
  const envKey = provider.apiKeyEnvVar
  if (envKey && process.env[envKey]) {
    return process.env[envKey]
  }
  return getSecureStorage().read()?.providerApiKeys?.[providerID]
}

export function getProviderApiKeySource(providerID = getSelectedProviderID()):
  | string
  | undefined {
  const provider = PROVIDER_CONFIGS[providerID]
  if (provider.apiKeyEnvVar && process.env[provider.apiKeyEnvVar]) {
    return provider.apiKeyEnvVar
  }
  return getSecureStorage().read()?.providerApiKeys?.[providerID]
    ? 'secureStorage'
    : undefined
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
      : PROVIDER_CONFIGS[providerID]

  if (provider.kind !== 'openai-compatible') {
    return { models: provider.defaultModels }
  }

  const baseURL = params.baseURL ?? provider.baseURL
  const apiKey = params.apiKey ?? getProviderApiKey(providerID)
  if (!baseURL) {
    return {
      models: provider.defaultModels,
      error: 'Provider base URL is not configured.',
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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
      : PROVIDER_CONFIGS[providerID]

  if (providerID !== 'deepseek') {
    return {
      isAvailable: false,
      balances: [],
      error: `${provider.displayName} 暂不支持余额检测。`,
    }
  }

  const baseURL = params.baseURL ?? provider.baseURL
  const apiKey = params.apiKey ?? getProviderApiKey(providerID)
  if (!baseURL) {
    return {
      isAvailable: false,
      balances: [],
      error: 'DeepSeek Base URL 未配置。',
    }
  }
  if (!apiKey) {
    return {
      isAvailable: false,
      balances: [],
      error: 'DeepSeek API key 未配置。',
    }
  }

  try {
    const response = await fetch(joinURL(baseURL, '/user/balance'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
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
        if (typeof info.currency !== 'string') {
          return []
        }
        return [
          {
            currency: info.currency,
            totalBalance:
              typeof info.total_balance === 'string'
                ? info.total_balance
                : '',
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
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
  return apiMessage ? `${prefix}：${apiMessage}` : prefix
}

function extractProviderErrorMessage(rawText: string): string | null {
  if (!rawText.trim()) {
    return null
  }
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
      return '400 请求格式错误'
    case 401:
      return '401 API key 无效或未授权'
    case 402:
      return '402 DeepSeek 余额不足'
    case 422:
      return '422 请求参数错误'
    case 429:
      return '429 请求过快，已触发限速'
    case 500:
      return '500 DeepSeek 服务异常'
    case 503:
      return '503 DeepSeek 服务繁忙'
    default:
      return `${status} DeepSeek 请求失败`
  }
}

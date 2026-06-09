import { getSecureStorage } from '../secureStorage/index.js'
import { getSettings_DEPRECATED, updateSettingsForSource } from '../settings/settings.js'

export type ModelProviderID =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'groq'
  | 'custom'

export type ModelProviderKind = 'anthropic' | 'openai-compatible'

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

const providerModelCache = new Map<string, string[]>()

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
    defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
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
        error: `${response.status} ${response.statusText}`,
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

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

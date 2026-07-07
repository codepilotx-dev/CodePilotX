export type ModelProviderID = string

export type ModelProviderKind =
  | 'anthropic'
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'minimax'
  | 'github-copilot'

export type ProviderWireApi =
  | 'responses'
  | 'chat_completions'
  | 'anthropic_messages'

export type ModelMetadata = {
  id: string
  name?: string
  label?: string
  description?: string
  badge?: string
  iconURL?: string
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

export type ModelProviderSummary = {
  providerID: ModelProviderID
  kind: ModelProviderKind
  displayName: string
  baseURL?: string
  defaultModels: string[]
  modelMetadata?: Record<string, ModelMetadata>
  apiKeyConfigured: boolean
  envVars?: string[]
  docURL?: string
  logoURL?: string
  npmPackage?: string
  modelsDevSource?: boolean
  gatewaySource?: boolean
  requiresBaseURL?: boolean
  wireApi?: ProviderWireApi
}

export type ModelProviderConfig = Omit<
  ModelProviderSummary,
  'apiKeyConfigured'
> & {
  apiKeyEnvVar?: string
}

export type ModelProviderState = {
  selectedProviderID: ModelProviderID
  provider: ModelProviderSummary
  model: string
  baseURL?: string
  apiKeyConfigured: boolean
  apiKeySource: string | null
  modelConfigured: boolean
  configurationMessage?: string
  models: string[]
  modelMetadata?: Record<string, ModelMetadata>
  error?: string
}

export type ProviderStreamMessage =
  | { type: 'message_start'; model?: string }
  | { type: 'text_delta'; text: string }
  | {
      type: 'tool_call_delta'
      id: string
      name?: string
      argumentsDelta?: string
    }
  | {
      type: 'usage'
      inputTokens?: number
      outputTokens?: number
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }
  | { type: 'error'; error: ProviderDisplayError }
  | { type: 'done'; finishReason?: string }

export type ProviderStreamRequest = {
  model: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
  }>
  tools?: unknown[]
  signal?: AbortSignal
}

export type ProviderBalanceInfo = {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type ProviderTokenPlanUsageInfo = {
  modelName: string
  currentIntervalTotalCount: number | null
  currentIntervalRemainingCount: number | null
  currentIntervalStartTime: number | null
  currentIntervalEndTime: number | null
  currentIntervalRemainingTime: number | null
  currentIntervalStatus: number | null
  currentIntervalRemainingPercent: number | null
  currentWeeklyTotalCount: number | null
  currentWeeklyRemainingCount: number | null
  currentWeeklyStatus: number | null
  currentWeeklyRemainingPercent: number | null
  weeklyStartTime: number | null
  weeklyEndTime: number | null
  weeklyRemainingTime: number | null
  weeklyBoostPermille: number | null
}

export type ProviderDisplayErrorCode =
  | 'authentication_failed'
  | 'insufficient_quota'
  | 'model_not_found'
  | 'invalid_base_url'
  | 'stream_interrupted'
  | 'rate_limited'
  | 'unknown'

export type ProviderDisplayError = {
  code: ProviderDisplayErrorCode
  message: string
  providerID?: ModelProviderID
  status?: number
  retryable: boolean
}

export type ModelProviderAdapter = {
  providerID: ModelProviderID
  kind: ModelProviderKind
  listModels(): Promise<ModelMetadata[]>
  streamResponse(
    request: ProviderStreamRequest,
  ): AsyncIterable<ProviderStreamMessage>
  supportsTools(model?: string): boolean
  supportsVision(model?: string): boolean
  getUsage(message: unknown): ProviderStreamMessage | null
  fetchBalance?(): Promise<ProviderBalanceInfo[]>
}

export function isModelProviderID(value: unknown): value is ModelProviderID {
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeLegacyProviderID(
  providerID: ModelProviderID,
): ModelProviderID {
  if (providerID === 'zhipu') return 'zhipuai'
  return providerID
}

export function getProviderApiKeyEnvVar(providerID: ModelProviderID): string {
  return `${providerID
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}_API_KEY`
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

export function createModelProviderSummary(
  provider: ModelProviderConfig,
  apiKeySource?: string | null,
): ModelProviderSummary {
  return {
    providerID: provider.providerID,
    kind: provider.kind,
    displayName: provider.displayName,
    baseURL: provider.baseURL,
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
    wireApi: provider.wireApi,
  }
}

export function createModelProviderState(params: {
  selectedProviderID: ModelProviderID
  provider: ModelProviderConfig
  model?: string
  baseURL?: string
  apiKeySource?: string | null
  models?: string[]
}): ModelProviderState {
  const model = params.model ?? ''
  const apiKeySource = params.apiKeySource ?? null
  const baseURL = params.baseURL ?? params.provider.baseURL
  const configurationMessage = getProviderConfigurationMessage({
    model,
    apiKeySource,
    requiresBaseURL: params.provider.requiresBaseURL,
    baseURL,
  })
  const modelConfigured = configurationMessage === null
  return {
    selectedProviderID: params.selectedProviderID,
    provider: createModelProviderSummary(
      { ...params.provider, baseURL },
      apiKeySource,
    ),
    model,
    baseURL,
    apiKeyConfigured: Boolean(apiKeySource),
    apiKeySource,
    modelConfigured,
    ...(configurationMessage ? { configurationMessage } : {}),
    models: params.models ?? params.provider.defaultModels,
    modelMetadata: params.provider.modelMetadata,
  }
}

export function normalizeProviderError(
  error: unknown,
  providerID?: ModelProviderID,
): ProviderDisplayError {
  if (isProviderDisplayError(error)) return error

  const status = extractStatus(error)
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()
  const code: ProviderDisplayErrorCode =
    status === 401 || status === 403 || lowerMessage.includes('api key')
      ? 'authentication_failed'
      : status === 402 ||
          lowerMessage.includes('quota') ||
          lowerMessage.includes('credit')
        ? 'insufficient_quota'
        : status === 404 || lowerMessage.includes('model')
          ? 'model_not_found'
          : lowerMessage.includes('base url') || lowerMessage.includes('url')
            ? 'invalid_base_url'
            : lowerMessage.includes('stream') || lowerMessage.includes('eof')
              ? 'stream_interrupted'
              : status === 429 || lowerMessage.includes('rate limit')
                ? 'rate_limited'
                : 'unknown'

  return {
    code,
    message,
    providerID,
    status,
    retryable: code === 'stream_interrupted' || code === 'rate_limited',
  }
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

function isProviderDisplayError(value: unknown): value is ProviderDisplayError {
  if (!value || typeof value !== 'object') return false
  const error = value as Partial<ProviderDisplayError>
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.retryable === 'boolean'
  )
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  return typeof record.status === 'number'
    ? record.status
    : typeof record.statusCode === 'number'
      ? record.statusCode
      : undefined
}

export type ModelProviderID = string

export type ModelProviderKind =
  | 'anthropic'
  | 'openai-compatible'
  | 'minimax'
  | 'ai-gateway'

export type ModelMetadata = {
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

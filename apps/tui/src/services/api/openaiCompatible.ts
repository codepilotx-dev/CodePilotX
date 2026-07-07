import { createHash, randomUUID } from 'crypto'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { APIUserAbortError } from '@anthropic-ai/sdk/error'
import type { Options } from './claude.js'
import type { NonNullableUsage } from './logging.js'
import { EMPTY_USAGE } from './logging.js'
import type { Tools } from '../../Tool.js'
import type { Message, AssistantMessage, StreamEvent } from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { errorMessage } from '../../utils/errors.js'
import {
  createAssistantAPIErrorMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import {
  getProviderModelMetadata,
  getProviderApiKey,
  getProviderApiKeySource,
  getSelectedProviderConfig,
  getSelectedProviderID,
  validateApiKeyHeader,
} from '../../utils/model/providerConfig.js'
import { getProxyFetchOptions, proxyFetch } from '../../utils/proxy.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import {
  recordConversationDebugApi,
  recordConversationDebugStreamEvent,
  setConversationDebugProvider,
} from '../../utils/conversationDebugDump.js'

const DEFAULT_OPENAI_MAX_TOKENS = 8192
// DeepSeek v4 输出上限 384K，模型端默认截断粒度比 OpenAI 大。
// 16K 足够覆盖绝大多数 agent 单轮输出（含思考模式 + 工具调用 + 长回答），
// 避免被截断后整轮重试浪费已经命中的缓存前缀。
const DEEPSEEK_PRO_MAX_TOKENS = 16384
const DEEPSEEK_FLASH_MAX_TOKENS = 8192

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
    strict?: boolean
  }
}

type ChatCompletionChunk = {
  id?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

type ChatCompletionResponse = {
  id?: string
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning?: string | null
      reasoning_content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

type OpenAICompatibleUsage = NonNullableUsage & {
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  reasoning_tokens?: number
}

type OpenAICompatibleProviderRequestParams = {
  thinking?: { type: 'enabled' | 'disabled' }
  reasoning_effort?: 'high' | 'max'
  reasoning?: { effort: 'none' | 'high' | 'xhigh' }
  temperature?: number
  do_sample?: false
}

export function buildOpenAICompatibleProviderRequestParams({
  providerID,
  model,
  thinkingConfig,
  temperatureOverride,
}: {
  providerID: string
  model: string
  thinkingConfig?: ThinkingConfig
  temperatureOverride?: number
}): OpenAICompatibleProviderRequestParams {
  const thinkingParams = isDeepSeekProvider(providerID)
    ? deepSeekThinkingRequestParams(thinkingConfig)
    : isDeepSeekReasoningGatewayModel(providerID, model)
      ? deepSeekGatewayReasoningRequestParams(thinkingConfig)
      : isZhipuProvider(providerID)
        ? zhipuThinkingRequestParams(thinkingConfig)
        : {}
  const deepSeekThinkingEnabled =
    isDeepSeekProvider(providerID) &&
    (thinkingParams as ReturnType<typeof deepSeekThinkingRequestParams>)
      .thinking?.type === 'enabled'
  const temperatureParams =
    temperatureOverride === undefined || deepSeekThinkingEnabled
      ? {}
      : isZhipuProvider(providerID) && temperatureOverride === 0
        ? { do_sample: false as const }
        : { temperature: temperatureOverride }
  return {
    ...thinkingParams,
    ...temperatureParams,
  }
}

export async function* queryOpenAICompatibleModelWithStreaming({
  messages,
  systemPrompt,
  tools,
  signal,
  thinkingConfig,
  options,
  explicitProviderID,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  thinkingConfig?: ThinkingConfig
  options: Options
  explicitProviderID?: string
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  const effectiveProviderID = explicitProviderID ?? getSelectedProviderID()
  const provider = explicitProviderID
    ? getProviderConfig(explicitProviderID)
    : getSelectedProviderConfig()
  const apiKey = getProviderApiKey(effectiveProviderID)
  const apiKeySource = getProviderApiKeySource(effectiveProviderID) ?? null
  const baseURL = provider.baseURL

  if (!baseURL) {
    yield createAssistantAPIErrorMessage({
      content:
        'OpenAI-compatible provider is missing a base URL. Run /connect and configure the provider again.',
      apiError: 'api_error',
    })
    return
  }
  if (!apiKey) {
    yield createAssistantAPIErrorMessage({
      content: `${provider.displayName} API key is not configured. Run /connect to save it, or set ${provider.apiKeyEnvVar ?? 'the provider API key environment variable'}.`,
      apiError: 'authentication_error',
    })
    return
  }

  try {
    const normalizedMessages = ensureToolResultPairing(
      normalizeMessagesForAPI(messages, tools),
    )
    const apiTools = await buildOpenAITools(tools, options)
    const isDeepSeek = isDeepSeekProvider(effectiveProviderID)
    const providerParams = buildOpenAICompatibleProviderRequestParams({
      providerID: effectiveProviderID,
      model: options.model,
      thinkingConfig,
      temperatureOverride: options.temperatureOverride,
    })
    const toolParams =
      apiTools.length > 0
        ? {
            tools: apiTools,
            ...(isDeepSeek ? {} : { tool_choice: 'auto' as const }),
          }
        : {}
    const sysPromptBlocks = isDeepSeek
      ? buildDeepSeekSystemBlocks(systemPrompt)
      : [
          {
            role: 'system' as const,
            content: asSystemPrompt(systemPrompt).join('\n\n'),
          },
        ]
    const requestBody = {
      model: options.model,
      messages: [
        ...sysPromptBlocks,
        ...toOpenAIMessages(normalizedMessages, effectiveProviderID),
      ],
      ...toolParams,
      max_tokens:
        options.maxOutputTokensOverride ?? defaultMaxTokensForModel(options.model, effectiveProviderID),
      stream: true,
      stream_options: { include_usage: true },
      ...providerParams,
      ...(isDeepSeek && {
        user_id: resolveDeepSeekUserId(options),
      }),
    }
    const requestURL = joinURL(baseURL, '/chat/completions')
    const fetchInit = buildOpenAICompatibleFetchInit({
      apiKey,
      isDeepSeek,
      signal,
      userID: isDeepSeek ? resolveDeepSeekUserId(options) : undefined,
    })
    setConversationDebugProvider({
      providerID: effectiveProviderID,
      baseURL,
      model: options.model,
      apiKeySource,
      apiKeyFingerprint: createHash('sha256')
        .update(apiKey)
        .digest('hex')
        .slice(0, 12),
    })
    recordConversationDebugApi('openai_compatible_request', {
      providerID: effectiveProviderID,
      url: requestURL,
      headers: fetchInit.headers,
      body: requestBody,
    })

    const response = await proxyFetch(requestURL, {
      ...fetchInit,
      body: JSON.stringify(requestBody),
    })
    recordConversationDebugApi('openai_compatible_response', {
      url: response.url || requestURL,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })

    if (!response.ok) {
      throw new Error(await formatOpenAIError(response))
    }
    if (!response.body) {
      throw new Error('Provider returned an empty response body')
    }

    const { content, reasoningContent, toolCalls, usage, finishReason, requestID } =
      await readOpenAIStream(response)
    recordConversationDebugStreamEvent('openai_compatible_stream_result', {
      content,
      reasoningContent,
      toolCalls,
      usage,
      finishReason,
      requestID,
    })

    const assistant = createAssistantMessage({
      model: options.model,
      content,
      reasoningContent,
      toolCalls,
      usage,
      finishReason,
      requestID,
      tools,
      agentId: options.agentId,
    })
    yield assistant
  } catch (error) {
    if (signal.aborted) {
      throw error as APIUserAbortError
    }
    yield createAssistantAPIErrorMessage({
      content: errorMessage(error),
      apiError: 'api_error',
    })
  }
}

export function buildOpenAICompatibleFetchInit({
  apiKey,
  isDeepSeek,
  signal,
  userID,
}: {
  apiKey: string
  isDeepSeek: boolean
  signal: AbortSignal
  userID?: string
}): RequestInit {
  const headerError = validateApiKeyHeader(apiKey)
  if (headerError) {
    throw new TypeError(headerError)
  }
  return {
    ...(getProxyFetchOptions() as RequestInit),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(isDeepSeek && userID ? { 'X-User-Id': userID } : {}),
    },
    signal,
  }
}

async function buildOpenAITools(
  tools: Tools,
  options: Options,
): Promise<OpenAITool[]> {
  const schemas = await Promise.all(
    tools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
      }),
    ),
  )
  return schemas
    .filter(isOpenAIToolCompatible)
    .map(schema => betaToolToOpenAITool(schema))
}

function isOpenAIToolCompatible(schema: BetaToolUnion): boolean {
  return (
    'name' in schema &&
    typeof schema.name === 'string' &&
    'input_schema' in schema
  )
}

function betaToolToOpenAITool(schema: BetaToolUnion): OpenAITool {
  const record = schema as Record<string, unknown>
  return {
    type: 'function',
    function: {
      name: String(record.name),
      ...(typeof record.description === 'string' && {
        description: record.description,
      }),
      parameters: record.input_schema ?? { type: 'object' },
      ...(record.strict === true && { strict: true }),
    },
  }
}

export function toOpenAIMessages(
  messages: (Message & { message?: unknown })[],
  providerID: string,
): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const message of messages) {
    if (message.type === 'user') {
      result.push(...userMessageToOpenAI(message))
    } else if (message.type === 'assistant') {
      result.push(assistantMessageToOpenAI(message, providerID))
    }
  }
  return coalesceAdjacentAssistantToolCalls(result)
}

function userMessageToOpenAI(message: Message): ChatMessage[] {
  const content = message.message.content
  if (typeof content === 'string') {
    return [{ role: 'user', content }]
  }

  const messages: ChatMessage[] = []
  const userParts: OpenAIContentPart[] = []

  for (const block of content) {
    if (block.type === 'tool_result') {
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: stringifyToolResult(block.content),
      })
    } else if (block.type === 'text') {
      userParts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image' && block.source?.type === 'base64') {
      userParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      })
    } else if (block.type === 'document') {
      userParts.push({ type: 'text', text: '[Document attachment omitted]' })
    }
  }

  if (userParts.length > 0) {
    messages.push({
      role: 'user',
      content:
        userParts.length === 1 && userParts[0]?.type === 'text'
          ? userParts[0].text
          : userParts,
    })
  }

  return messages
}

function coalesceAdjacentAssistantToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (let i = 0; i < messages.length; ) {
    const message = messages[i]!
    if (message.role !== 'assistant') {
      result.push(message)
      i++
      continue
    }

    const run = [message]
    let hasToolCalls = Boolean(message.tool_calls?.length)
    let j = i + 1
    while (messages[j]?.role === 'assistant') {
      const next = messages[j] as Extract<ChatMessage, { role: 'assistant' }>
      run.push(next)
      hasToolCalls ||= Boolean(next.tool_calls?.length)
      j++
    }

    if (run.length > 1 && hasToolCalls) {
      result.push(mergeAssistantMessages(run))
    } else {
      result.push(...run)
    }
    i = j
  }
  return result
}

function mergeAssistantMessages(
  messages: Array<Extract<ChatMessage, { role: 'assistant' }>>,
): Extract<ChatMessage, { role: 'assistant' }> {
  const content = messages
    .flatMap(message =>
      typeof message.content === 'string' && message.content.trim()
        ? [message.content]
        : [],
    )
    .join('\n\n')
  const reasoningContent = messages
    .flatMap(message => (message.reasoning_content ? [message.reasoning_content] : []))
    .join('\n')
  const toolCalls = messages.flatMap(message => message.tool_calls ?? [])
  return {
    role: 'assistant',
    content: content || (toolCalls.length > 0 ? '' : null),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    ...(reasoningContent && { reasoning_content: reasoningContent }),
  }
}

function assistantMessageToOpenAI(message: Message, providerID: string): ChatMessage {
  const content = message.message.content
  const text: string[] = []
  const toolCalls: OpenAIToolCall[] = []
  const reasoningParts: string[] = []

  for (const block of content) {
    if (block.type === 'text') {
      text.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      })
    } else if (block.type === 'thinking') {
      const thinkingText = (block as { thinking?: string }).thinking
      if (typeof thinkingText === 'string' && thinkingText.length > 0) {
        reasoningParts.push(thinkingText)
      }
    }
  }

  const contentText = text.join('\n\n')
  return {
    role: 'assistant',
    content:
      contentText ||
      (isDeepSeekProvider(providerID) && toolCalls.length > 0 ? '' : null),
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    ...(toolCalls.length > 0 &&
      reasoningParts.length > 0 && { reasoning_content: reasoningParts.join('\n') }),
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (item?.type === 'text') return item.text
        return JSON.stringify(item)
      })
      .join('\n')
  }
  return JSON.stringify(content ?? '')
}

type OpenAIStreamResult = {
  content: string
  reasoningContent: string
  toolCalls: OpenAIToolCall[]
  usage: NonNullableUsage
  finishReason: string | null
  requestID?: string
}

type FrameBoundary = {
  index: number
  length: number
}

function findOpenAIStreamFrameBoundary(buffer: string): FrameBoundary | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
  return match ? { index: match.index, length: match[0].length } : null
}

/**
 * @internal exported for regression coverage of OpenAI-compatible SSE parsing.
 */
export async function readOpenAIStream(
  response: Response,
): Promise<OpenAIStreamResult> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoningContent = ''
  let finishReason: string | null = null
  let usage = EMPTY_USAGE as NonNullableUsage
  const toolCalls: OpenAIToolCall[] = []

  const result = (): OpenAIStreamResult => ({
    content,
    reasoningContent,
    toolCalls: toolCalls.filter(call => call.function.name),
    usage,
    finishReason,
    requestID: response.headers.get('x-request-id') ?? undefined,
  })

  const processFrame = (frame: string): boolean => {
    for (const line of frame.split(/\r\n|\n|\r/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') return true
      const chunk = JSON.parse(data) as ChatCompletionChunk
      recordConversationDebugStreamEvent('openai_compatible_chunk', chunk)
      const choice = chunk.choices?.[0]
      if (choice?.delta?.content) {
        content += choice.delta.content
      }
      if (choice?.delta?.reasoning_content) {
        reasoningContent += choice.delta.reasoning_content
      }
      if (choice?.delta?.reasoning) {
        reasoningContent += choice.delta.reasoning
      }
      if (choice?.delta?.tool_calls) {
        mergeToolCallDeltas(toolCalls, choice.delta.tool_calls)
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason
      }
      if (chunk.usage) {
        usage = usageFromOpenAI(chunk.usage)
      }
    }
    return false
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      buffer += decoder.decode()
      if (buffer.trim() && processFrame(buffer)) return result()
      break
    }
    buffer += decoder.decode(value, { stream: true })

    let boundary = findOpenAIStreamFrameBoundary(buffer)
    while (boundary) {
      const frame = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.length)
      if (processFrame(frame)) {
        await reader.cancel().catch(() => {})
        return result()
      }
      boundary = findOpenAIStreamFrameBoundary(buffer)
    }
  }

  return result()
}

function mergeToolCallDeltas(
  toolCalls: OpenAIToolCall[],
  deltas: NonNullable<ChatCompletionChunk['choices']>[number]['delta']['tool_calls'],
): void {
  for (const delta of deltas ?? []) {
    const index = delta.index ?? toolCalls.length
    toolCalls[index] ??= {
      id: delta.id ?? randomUUID(),
      type: 'function',
      function: { name: '', arguments: '' },
    }
    const current = toolCalls[index]!
    if (delta.id) current.id = delta.id
    if (delta.function?.name) current.function.name += delta.function.name
    if (delta.function?.arguments) {
      current.function.arguments += delta.function.arguments
    }
  }
}

function usageFromOpenAI(usage: {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}): OpenAICompatibleUsage {
  const promptTokens = usage.prompt_tokens ?? 0
  const hit =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0
  const miss =
    usage.prompt_cache_miss_tokens ??
    (usage.prompt_cache_hit_tokens !== undefined ||
    usage.prompt_tokens_details?.cached_tokens !== undefined
      ? Math.max(0, promptTokens - hit)
      : promptTokens)
  return {
    ...EMPTY_USAGE,
    input_tokens: promptTokens,
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_input_tokens: hit,
    cache_creation_input_tokens: 0,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  }
}

function createAssistantMessage({
  model,
  content,
  reasoningContent,
  toolCalls,
  usage,
  finishReason,
  requestID,
  tools,
  agentId,
}: {
  model: string
  content: string
  reasoningContent: string
  toolCalls: OpenAIToolCall[]
  usage: NonNullableUsage
  finishReason: string | null
  requestID?: string
  tools: Tools
  agentId?: Options['agentId']
}): AssistantMessage {
  const blocks: BetaContentBlock[] = []
  if (reasoningContent) {
    blocks.push({
      type: 'thinking',
      thinking: reasoningContent,
      signature: '',
    } as BetaContentBlock)
  }
  if (content) {
    blocks.push({ type: 'text', text: content })
  }
  for (const call of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: call.id || randomUUID(),
      name: call.function.name,
      input: call.function.arguments || '{}',
    })
  }

  const message: BetaMessage = {
    id: requestID ?? randomUUID(),
    type: 'message',
    role: 'assistant',
    model,
    content: normalizeContentFromAPI(blocks, tools, agentId),
    stop_reason: toAnthropicStopReason(finishReason),
    stop_sequence: null,
    usage,
  }

  return {
    message,
    requestId: requestID,
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

function toAnthropicStopReason(reason: string | null): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop') return 'end_turn'
  return null
}

async function formatOpenAIError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; type?: string }
    }
    if (parsed.error?.message) {
      return `${response.status} ${response.statusText}: ${parsed.error.message}`
    }
  } catch {
    // Use the raw text below.
  }
  return `${response.status} ${response.statusText}${text ? `: ${text}` : ''}`
}

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function isDeepSeekProvider(providerID: string): boolean {
  return providerID === 'deepseek'
}

function isZhipuProvider(providerID: string): boolean {
  return providerID === 'zhipuai' || providerID === 'zhipu'
}

function isDeepSeekReasoningGatewayModel(
  providerID: string,
  model: string,
): boolean {
  if (providerID !== 'openrouter') {
    return false
  }
  return (
    model.toLowerCase().includes('deepseek') &&
    getProviderModelMetadata(providerID, model)?.reasoning === true
  )
}

function deepSeekThinkingRequestParams(
  thinkingConfig: ThinkingConfig | undefined,
): {
  thinking?: { type: 'enabled' | 'disabled' }
  reasoning_effort?: 'high' | 'max'
} {
  switch (thinkingConfig?.type) {
    case 'disabled':
      return { thinking: { type: 'disabled' } }
    case 'adaptive':
      return { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
    case 'enabled':
      return { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
    default:
      return {}
  }
}

function deepSeekGatewayReasoningRequestParams(
  thinkingConfig: ThinkingConfig | undefined,
): {
  reasoning: { effort: 'none' | 'high' | 'xhigh' }
} {
  switch (thinkingConfig?.type) {
    case 'disabled':
      return { reasoning: { effort: 'none' } }
    case 'enabled':
      return { reasoning: { effort: 'xhigh' } }
    default:
      return { reasoning: { effort: 'high' } }
  }
}

function zhipuThinkingRequestParams(
  thinkingConfig: ThinkingConfig | undefined,
): {
  thinking?: { type: 'enabled' | 'disabled' }
  reasoning_effort?: 'high' | 'max'
} {
  switch (thinkingConfig?.type) {
    case 'disabled':
      return { thinking: { type: 'disabled' } }
    case 'adaptive':
      return { thinking: { type: 'enabled' }, reasoning_effort: 'high' }
    case 'enabled':
      return { thinking: { type: 'enabled' }, reasoning_effort: 'max' }
    default:
      return {}
  }
}

function defaultMaxTokensForModel(
  model: string,
  providerID: string,
): number {
  const metadataOutputTokens = getProviderModelMetadata(providerID, model)?.outputTokens
  if (metadataOutputTokens && metadataOutputTokens > 0) {
    return metadataOutputTokens
  }
  if (!isDeepSeekProvider(providerID)) {
    return DEFAULT_OPENAI_MAX_TOKENS
  }
  if (model.includes('flash')) return DEEPSEEK_FLASH_MAX_TOKENS
  if (model.includes('pro')) return DEEPSEEK_PRO_MAX_TOKENS
  return DEEPSEEK_PRO_MAX_TOKENS
}

// DeepSeek 文档：缓存命中要求"从 token 0 起完全匹配"。
// 单一 system 字符串会把所有动态段（attribution、user context）混在一起，
// 任何微小变化都会让整段前缀失配；拆成 [稳定段, 动态段] 后，
// 至少前 N 个 system token 跨请求保持不变，从而命中硬盘缓存。
function buildDeepSeekSystemBlocks(
  systemPrompt: SystemPrompt,
): Array<{ role: 'system'; content: string }> {
  const blocks = asSystemPrompt(systemPrompt)
  if (blocks.length <= 1) {
    return [
      {
        role: 'system' as const,
        content: blocks.join('\n\n'),
      },
    ]
  }
  // 第一个 block 通常是 CLI 身份前缀（"You are CodePilotX..."），
  // 跨 session 不变；其余 block 在多轮中可能动态追加（user context 等）。
  const [stable, ...rest] = blocks
  const out: Array<{ role: 'system'; content: string }> = [
    { role: 'system', content: stable },
  ]
  const restJoined = rest.join('\n\n')
  if (restJoined.length > 0) {
    out.push({ role: 'system', content: restJoined })
  }
  return out
}

// user_id 字符集 [a-zA-Z0-9\-_]，长度 ≤ 512。
// 固定常量足以让同 CLI 进程多轮请求共享 cache prefix 单元，
// 同时把不同 CLI 实例的缓存空间彼此隔离。
function resolveDeepSeekUserId(_options: Options): string {
  return 'codepilotx-cli'
}

import { createHash, randomUUID } from 'crypto'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { APIUserAbortError } from '@anthropic-ai/sdk/error'
import { createAnthropic } from '@ai-sdk/anthropic'
import { jsonSchema, streamText, tool, type ModelMessage } from 'ai'
import type { Options } from './claude.js'
import { EMPTY_USAGE, type NonNullableUsage } from './logging.js'
import type { Tools } from '../../Tool.js'
import type { AssistantMessage, Message, StreamEvent } from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { errorMessage } from '../../utils/errors.js'
import {
  createAssistantAPIErrorMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import {
  getProviderApiKey,
  getProviderApiKeySource,
  type ProviderConfig,
  getSelectedProviderConfig,
  getSelectedProviderID,
} from '../../utils/model/providerConfig.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'

const DEFAULT_MINIMAX_MAX_TOKENS = 16384

type AiSdkToolCall = {
  toolCallId?: string
  toolName?: string
  input?: unknown
}

type AiSdkUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  raw?: {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
}

export async function* queryMiniMaxWithAiSdkStreaming({
  messages,
  systemPrompt,
  tools,
  signal,
  _thinkingConfig,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  _thinkingConfig?: ThinkingConfig
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  const providerID = getSelectedProviderID()
  const provider = getSelectedProviderConfig()
  const apiKey = getProviderApiKey(providerID)
  if (!apiKey) {
    yield createAssistantAPIErrorMessage({
      content:
        `${provider.displayName} API key is not configured. Run /connect to save it, or set ${provider.apiKeyEnvVar ?? 'the provider API key environment variable'}.`,
      apiError: 'authentication_error',
    })
    return
  }

  const unsupported = findUnsupportedMiniMaxInput(messages)
  if (unsupported) {
    yield createAssistantAPIErrorMessage({
      content: unsupported,
      apiError: 'invalid_request_error',
    })
    return
  }

  try {
    const normalizedMessages = ensureToolResultPairing(
      normalizeMessagesForAPI(messages, tools),
    )
    const aiTools = await buildMiniMaxAiSdkTools(tools, options)
    logMiniMaxRequestKeyDiagnostics({
      provider,
      apiKey,
      apiKeySource: getProviderApiKeySource(providerID) ?? null,
    })
    const anthropicCompatible = createAnthropicCompatibleAiSdkProvider({
      provider,
      apiKey,
    })
    const result = streamText({
      model: anthropicCompatible(resolveMiniMaxModel(options.model)),
      system: asSystemPrompt(systemPrompt).join('\n\n'),
      messages: toAiSdkMessages(normalizedMessages, tools),
      tools: aiTools,
      toolChoice: Object.keys(aiTools).length > 0 ? 'auto' : undefined,
      maxOutputTokens:
        options.maxOutputTokensOverride ?? DEFAULT_MINIMAX_MAX_TOKENS,
      temperature: options.temperatureOverride ?? 1,
      abortSignal: signal,
    })

    let text = ''
    let reasoningText = ''
    let finishReason: string | null = null
    let requestID: string | undefined
    let usage = EMPTY_USAGE as NonNullableUsage
    const toolCalls: AiSdkToolCall[] = []

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text
          break
        case 'reasoning-delta':
          reasoningText += part.text
          break
        case 'tool-call':
          toolCalls.push(part)
          break
        case 'finish-step':
          finishReason = part.finishReason
          requestID = part.response.id
          usage = usageFromAiSdk(part.usage as AiSdkUsage)
          break
        case 'finish':
          finishReason = part.finishReason
          usage = usageFromAiSdk(part.totalUsage as AiSdkUsage)
          break
        case 'error':
          throw part.error
      }
    }

    const resolvedToolCalls =
      toolCalls.length > 0 ? toolCalls : ((await result.toolCalls) as AiSdkToolCall[])
    const resolvedReasoning = reasoningText || (await result.reasoningText) || ''
    const resolvedUsage = usage.input_tokens || usage.output_tokens
      ? usage
      : usageFromAiSdk((await result.totalUsage) as AiSdkUsage)

    yield createMiniMaxAssistantMessage({
      model: resolveMiniMaxModel(options.model),
      content: text,
      reasoningContent: resolvedReasoning,
      toolCalls: resolvedToolCalls,
      usage: resolvedUsage,
      finishReason,
      requestID,
      tools,
      agentId: options.agentId,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error as APIUserAbortError
    }
    yield createAssistantAPIErrorMessage({
      content: formatMiniMaxError(error),
      apiError: 'api_error',
    })
  }
}

async function buildMiniMaxAiSdkTools(
  tools: Tools,
  options: Options,
): Promise<Record<string, ReturnType<typeof tool>>> {
  const schemas = await Promise.all(
    tools.map(item =>
      toolToAPISchema(item, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: resolveMiniMaxModel(options.model),
      }),
    ),
  )
  const result: Record<string, ReturnType<typeof tool>> = {}
  for (const schema of schemas) {
    if (!isMiniMaxToolCompatible(schema)) continue
    const record = schema as Record<string, unknown>
    result[String(record.name)] = tool({
      description:
        typeof record.description === 'string' ? record.description : undefined,
      inputSchema: jsonSchema(record.input_schema as Parameters<typeof jsonSchema>[0]),
    })
  }
  return result
}

function isMiniMaxToolCompatible(schema: BetaToolUnion): boolean {
  return (
    'name' in schema &&
    typeof schema.name === 'string' &&
    'input_schema' in schema
  )
}

export function toAiSdkMessages(
  messages: (Message & { message?: unknown })[],
  _tools: Tools,
): ModelMessage[] {
  const result: ModelMessage[] = []
  const toolNamesByID = new Map<string, string>()
  for (const message of messages) {
    if (message.type === 'user') {
      result.push(...userMessageToAiSdk(message, toolNamesByID))
    } else if (message.type === 'assistant') {
      recordAssistantToolNames(message, toolNamesByID)
      result.push(assistantMessageToAiSdk(message))
    }
  }
  return coalesceAdjacentAssistantToolCalls(result)
}

function userMessageToAiSdk(
  message: Message,
  toolNamesByID: Map<string, string>,
): ModelMessage[] {
  const content = message.message.content
  if (typeof content === 'string') {
    return [{ role: 'user', content }]
  }

  const result: ModelMessage[] = []
  const textParts: Array<{ type: 'text'; text: string }> = []

  for (const block of content) {
    if (block.type === 'tool_result') {
      result.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            toolName: toolNamesByID.get(block.tool_use_id) ?? 'tool',
            output: { type: 'text', value: stringifyToolResult(block.content) },
          },
        ],
      })
    } else if (block.type === 'text') {
      textParts.push({ type: 'text', text: block.text })
    }
  }

  if (textParts.length > 0) {
    result.push({
      role: 'user',
      content: textParts.length === 1 ? textParts[0]!.text : textParts,
    })
  }
  return result
}

function coalesceAdjacentAssistantToolCalls(
  messages: ModelMessage[],
): ModelMessage[] {
  const result: ModelMessage[] = []
  for (let i = 0; i < messages.length; ) {
    const message = messages[i]!
    if (message.role !== 'assistant') {
      result.push(message)
      i++
      continue
    }

    const run = [message]
    let hasToolCall = assistantMessageHasToolCall(message)
    let j = i + 1
    while (messages[j]?.role === 'assistant') {
      const next = messages[j]!
      run.push(next)
      hasToolCall ||= assistantMessageHasToolCall(next)
      j++
    }

    if (run.length > 1 && hasToolCall) {
      result.push(mergeAssistantMessages(run))
    } else {
      result.push(...run)
    }
    i = j
  }
  return result
}

function assistantMessageHasToolCall(message: ModelMessage): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return false
  }
  return message.content.some(part => part.type === 'tool-call')
}

function mergeAssistantMessages(messages: ModelMessage[]): ModelMessage {
  const parts = messages.flatMap(message =>
    typeof message.content === 'string'
      ? message.content
        ? [{ type: 'text' as const, text: message.content }]
        : []
      : message.content,
  )
  return {
    role: 'assistant',
    content:
      parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts,
  }
}

export function createAnthropicCompatibleAiSdkProvider({
  provider,
  apiKey,
  fetch,
}: {
  provider: Pick<ProviderConfig, 'providerID' | 'displayName' | 'baseURL'>
  apiKey: string
  fetch?: typeof globalThis.fetch
}) {
  const fetchImpl = fetch ?? globalThis.fetch
  const isMiniMax = isMiniMaxProviderID(provider.providerID)
  return createAnthropic({
    apiKey,
    baseURL: provider.baseURL ?? 'https://api.anthropic.com/v1',
    name: `${provider.providerID}.messages`,
    headers: isMiniMax
      ? { 'X-Api-Key': apiKey, 'x-api-key': apiKey }
      : undefined,
    fetch: async (input, init) => {
      if (isMiniMax) {
        logMiniMaxWireHeaderDiagnostics(provider, init?.headers)
      }
      return fetchImpl(input, init)
    },
  })
}

function isMiniMaxProviderID(providerID: string): boolean {
  return providerID === 'minimax' || providerID.startsWith('minimax-')
}

function logMiniMaxRequestKeyDiagnostics({
  provider,
  apiKey,
  apiKeySource,
}: {
  provider: Pick<
    ProviderConfig,
    'providerID' | 'kind' | 'npmPackage' | 'baseURL' | 'envVars'
  >
  apiKey: string
  apiKeySource: string | null
}): void {
  const headerNames = isMiniMaxProviderID(provider.providerID)
    ? ['X-Api-Key', 'x-api-key', 'anthropic-version']
    : ['x-api-key']
  writeDesktopStyleDebug('minimax_request_key_diagnostics', {
    providerID: provider.providerID,
    kind: provider.kind,
    npmPackage: provider.npmPackage,
    baseURL: provider.baseURL,
    envVars: provider.envVars,
    apiKeySource,
    apiKeyLength: apiKey.length,
    apiKeyFingerprint: fingerprintApiKey(apiKey),
    headerNames,
  })
}

function logMiniMaxWireHeaderDiagnostics(
  provider: Pick<ProviderConfig, 'providerID' | 'baseURL'>,
  headers: HeadersInit | undefined,
): void {
  const headerNames = getHeaderNames(headers)
  writeDesktopStyleDebug('minimax_wire_header_diagnostics', {
    providerID: provider.providerID,
    baseURL: provider.baseURL,
    headerNames,
    hasXApiKey: headerNames.some(name => name.toLowerCase() === 'x-api-key'),
    hasExactXApiKey: headerNames.includes('X-Api-Key'),
  })
}

function getHeaderNames(headers: HeadersInit | undefined): string[] {
  if (!headers) return []
  if (headers instanceof Headers) return Array.from(headers.keys())
  if (Array.isArray(headers)) return headers.map(([name]) => name)
  return Object.keys(headers)
}

function writeDesktopStyleDebug(
  event: string,
  fields: Record<string, unknown>,
): void {
  const line = `[desktop-debug] ${new Date().toISOString()} ${event} ${JSON.stringify(fields)}\n`
  try {
    process.stderr.write(line)
  } catch {
    // Best-effort diagnostics only.
  }
}

function fingerprintApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12)
}

function assistantMessageToAiSdk(message: Message): ModelMessage {
  const content = message.message.content
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = []

  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'thinking') {
      const thinkingText = (block as { thinking?: string }).thinking
      if (thinkingText) {
        parts.push({ type: 'reasoning', text: thinkingText })
      }
    } else if (block.type === 'tool_use') {
      parts.push({
        type: 'tool-call',
        toolCallId: block.id,
        toolName: block.name,
        input: parseToolInput(block.input),
      })
    }
  }

  return {
    role: 'assistant',
    content:
      parts.length === 1 && parts[0]?.type === 'text'
        ? parts[0].text
        : parts,
  }
}

function recordAssistantToolNames(
  message: Message,
  toolNamesByID: Map<string, string>,
): void {
  const content = message.message.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (
      block?.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      toolNamesByID.set(block.id, block.name)
    }
  }
}

function createMiniMaxAssistantMessage({
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
  toolCalls: AiSdkToolCall[]
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
    if (!call.toolName) continue
    blocks.push({
      type: 'tool_use',
      id: call.toolCallId || randomUUID(),
      name: call.toolName,
      input: call.input ?? {},
    })
  }

  const message: BetaMessage = {
    id: requestID ?? randomUUID(),
    type: 'message',
    role: 'assistant',
    model,
    content: normalizeContentFromAPI(blocks, tools, agentId),
    stop_reason: finishReason === 'tool-calls' ? 'tool_use' : 'end_turn',
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

function findUnsupportedMiniMaxInput(messages: Message[]): string | null {
  for (const message of messages) {
    const content = message?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'image') {
        return 'MiniMax main chat uses the Anthropic-compatible text API and does not support image input. Use the MiniMaxVision or MiniMaxImage tool for image workflows.'
      }
      if (block?.type === 'document') {
        return 'MiniMax main chat uses the Anthropic-compatible text API and does not support document input. Upload or inspect files with MiniMaxFile, then pass text into chat.'
      }
    }
  }
  return null
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

function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {}
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

function usageFromAiSdk(usage: AiSdkUsage | undefined): NonNullableUsage {
  const raw = usage?.raw ?? {}
  const cacheRead = raw.cache_read_input_tokens ?? 0
  const cacheCreate = raw.cache_creation_input_tokens ?? 0
  const input = usage?.inputTokens ?? raw.input_tokens ?? 0
  return {
    ...EMPTY_USAGE,
    input_tokens: input,
    output_tokens: usage?.outputTokens ?? raw.output_tokens ?? 0,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
  }
}

function resolveMiniMaxModel(model: string | null | undefined): string {
  const trimmed = model?.trim()
  return trimmed || 'MiniMax-M2.7'
}

export function formatMiniMaxError(error: unknown): string {
  const message = errorMessage(error)
  const code = extractMiniMaxErrorCode(error) ?? extractMiniMaxErrorCode(message)
  const mapped = code ? MINIMAX_ERROR_MESSAGES[code] : undefined
  return mapped ? `${mapped} (${code})${message ? `: ${message}` : ''}` : message
}

function extractMiniMaxErrorCode(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const match = value.match(/\b(1002|1004|1008|1039|2013)\b/)
    return match?.[1] ?? null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const code = record.code ?? record.status_code
    if (typeof code === 'number' || typeof code === 'string') {
      return String(code)
    }
    for (const child of Object.values(record)) {
      const nested = extractMiniMaxErrorCode(child)
      if (nested) return nested
    }
  }
  return null
}

const MINIMAX_ERROR_MESSAGES: Record<string, string> = {
  '1002': 'MiniMax 请求触发限流，请稍后重试',
  '1004': 'MiniMax API key 鉴权失败，请检查 MINIMAX_API_KEY',
  '1008': 'MiniMax 账户余额不足',
  '1039': 'MiniMax token 或 TPM 限制已触发，请减少输入或稍后重试',
  '2013': 'MiniMax 请求参数格式不正确，请检查工具入参或模型设置',
}

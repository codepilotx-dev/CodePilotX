import { randomUUID } from 'crypto'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { APIUserAbortError } from '@anthropic-ai/sdk/error'
import { createGateway, jsonSchema, streamText, tool, type ModelMessage } from 'ai'
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
  getSelectedProviderConfig,
} from '../../utils/model/providerConfig.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'

const DEFAULT_GATEWAY_MODEL = 'openai/gpt-4.1'
const DEFAULT_GATEWAY_MAX_TOKENS = 8192

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

export async function* queryAIGatewayWithStreaming({
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
  const provider = getSelectedProviderConfig()
  const apiKey = getProviderApiKey('ai-gateway')
  if (!apiKey) {
    yield createAssistantAPIErrorMessage({
      content:
        'AI Gateway API key is not configured. Save it in Settings, or set AI_GATEWAY_API_KEY.',
      apiError: 'authentication_error',
    })
    return
  }

  try {
    const normalizedMessages = ensureToolResultPairing(
      normalizeMessagesForAPI(messages, tools),
    )
    const aiTools = await buildAiSdkTools(tools, options)
    const gateway = createGateway({
      apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    })
    const model = resolveGatewayModel(options.model, provider.defaultModels[0])
    const result = streamText({
      model: gateway(model),
      system: asSystemPrompt(systemPrompt).join('\n\n'),
      messages: toAiSdkMessages(normalizedMessages),
      tools: aiTools,
      toolChoice: Object.keys(aiTools).length > 0 ? 'auto' : undefined,
      maxOutputTokens:
        options.maxOutputTokensOverride ?? DEFAULT_GATEWAY_MAX_TOKENS,
      temperature: options.temperatureOverride,
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

    yield createAiSdkAssistantMessage({
      model,
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
      content: errorMessage(error),
      apiError: 'api_error',
    })
  }
}

async function buildAiSdkTools(
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
        model: options.model,
      }),
    ),
  )
  const result: Record<string, ReturnType<typeof tool>> = {}
  for (const schema of schemas) {
    if (!isToolCompatible(schema)) continue
    const record = schema as Record<string, unknown>
    result[String(record.name)] = tool({
      description:
        typeof record.description === 'string' ? record.description : undefined,
      inputSchema: jsonSchema(record.input_schema as Parameters<typeof jsonSchema>[0]),
    })
  }
  return result
}

function isToolCompatible(schema: BetaToolUnion): boolean {
  return (
    'name' in schema &&
    typeof schema.name === 'string' &&
    'input_schema' in schema
  )
}

function toAiSdkMessages(messages: (Message & { message?: unknown })[]): ModelMessage[] {
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
  return result
}

function userMessageToAiSdk(
  message: Message,
  toolNamesByID: Map<string, string>,
): ModelMessage[] {
  const content = message.message.content
  if (typeof content === 'string') return [{ role: 'user', content }]

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
    } else if (block.type === 'image') {
      textParts.push({ type: 'text', text: '[Image input omitted by desktop Gateway adapter]' })
    } else if (block.type === 'document') {
      textParts.push({ type: 'text', text: '[Document input omitted by desktop Gateway adapter]' })
    }
  }

  if (textParts.length > 0) {
    result.unshift({
      role: 'user',
      content: textParts.length === 1 ? textParts[0]!.text : textParts,
    })
  }
  return result
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
      if (thinkingText) parts.push({ type: 'reasoning', text: thinkingText })
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

function createAiSdkAssistantMessage({
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
  if (content) blocks.push({ type: 'text', text: content })
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
  return {
    ...EMPTY_USAGE,
    input_tokens: usage?.inputTokens ?? raw.input_tokens ?? 0,
    output_tokens: usage?.outputTokens ?? raw.output_tokens ?? 0,
    cache_read_input_tokens: raw.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: raw.cache_creation_input_tokens ?? 0,
  }
}

function resolveGatewayModel(
  model: string | null | undefined,
  providerDefault: string | undefined,
): string {
  const trimmed = model?.trim()
  return trimmed || providerDefault || DEFAULT_GATEWAY_MODEL
}

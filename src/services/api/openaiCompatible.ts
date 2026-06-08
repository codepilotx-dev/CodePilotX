import { randomUUID } from 'crypto'
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
  getProviderApiKey,
  getSelectedProviderConfig,
  getSelectedProviderID,
} from '../../utils/model/providerConfig.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'

const DEFAULT_OPENAI_MAX_TOKENS = 8192

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
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
  }
}

type ChatCompletionResponse = {
  id?: string
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

export async function* queryOpenAICompatibleModelWithStreaming({
  messages,
  systemPrompt,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  const providerID = getSelectedProviderID()
  const provider = getSelectedProviderConfig()
  const apiKey = getProviderApiKey(providerID)
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
    const requestBody = {
      model: options.model,
      messages: [
        {
          role: 'system' as const,
          content: asSystemPrompt(systemPrompt).join('\n\n'),
        },
        ...toOpenAIMessages(normalizedMessages),
      ],
      ...(apiTools.length > 0 && { tools: apiTools, tool_choice: 'auto' }),
      max_tokens: options.maxOutputTokensOverride ?? DEFAULT_OPENAI_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.temperatureOverride !== undefined && {
        temperature: options.temperatureOverride,
      }),
    }

    const response = await fetch(joinURL(baseURL, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    })

    if (!response.ok) {
      throw new Error(await formatOpenAIError(response))
    }
    if (!response.body) {
      throw new Error('Provider returned an empty response body')
    }

    const { content, toolCalls, usage, finishReason, requestID } =
      await readOpenAIStream(response)

    const assistant = createAssistantMessage({
      model: options.model,
      content,
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

function toOpenAIMessages(messages: (Message & { message?: unknown })[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const message of messages) {
    if (message.type === 'user') {
      result.push(...userMessageToOpenAI(message))
    } else if (message.type === 'assistant') {
      result.push(assistantMessageToOpenAI(message))
    }
  }
  return result
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
    messages.unshift({
      role: 'user',
      content:
        userParts.length === 1 && userParts[0]?.type === 'text'
          ? userParts[0].text
          : userParts,
    })
  }

  return messages
}

function assistantMessageToOpenAI(message: Message): ChatMessage {
  const content = message.message.content
  const text: string[] = []
  const toolCalls: OpenAIToolCall[] = []

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
    }
  }

  return {
    role: 'assistant',
    content: text.join('\n\n') || null,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
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

async function readOpenAIStream(response: Response): Promise<{
  content: string
  toolCalls: OpenAIToolCall[]
  usage: NonNullableUsage
  finishReason: string | null
  requestID?: string
}> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finishReason: string | null = null
  let usage = EMPTY_USAGE as NonNullableUsage
  const toolCalls: OpenAIToolCall[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of frame.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        const chunk = JSON.parse(data) as ChatCompletionChunk
        const choice = chunk.choices?.[0]
        if (choice?.delta?.content) {
          content += choice.delta.content
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
      boundary = buffer.indexOf('\n\n')
    }
  }

  return {
    content,
    toolCalls: toolCalls.filter(call => call.function.name),
    usage,
    finishReason,
    requestID: response.headers.get('x-request-id') ?? undefined,
  }
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
}): NonNullableUsage {
  return {
    ...EMPTY_USAGE,
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
  }
}

function createAssistantMessage({
  model,
  content,
  toolCalls,
  usage,
  finishReason,
  requestID,
  tools,
  agentId,
}: {
  model: string
  content: string
  toolCalls: OpenAIToolCall[]
  usage: NonNullableUsage
  finishReason: string | null
  requestID?: string
  tools: Tools
  agentId?: Options['agentId']
}): AssistantMessage {
  const blocks: BetaContentBlock[] = []
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

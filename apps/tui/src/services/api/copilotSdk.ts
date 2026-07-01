import { randomUUID } from 'crypto'
import type {
  BetaContentBlock,
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { APIUserAbortError } from '@anthropic-ai/sdk/error'
import {
  CopilotClient,
  type AssistantUsageData,
  type SessionEvent,
} from '@github/copilot-sdk'
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
import { getProviderConfig, getSelectedProviderConfig, getSelectedProviderID } from '../../utils/model/providerConfig.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'

let sharedClient: CopilotClient | null = null
let sharedClientPromise: Promise<CopilotClient> | null = null

async function getCopilotClient(): Promise<CopilotClient> {
  if (sharedClient) return sharedClient
  if (!sharedClientPromise) {
    sharedClientPromise = (async () => {
      const client = new CopilotClient({
        useLoggedInUser: true,
        logLevel: 'error',
      })
      await client.start()
      sharedClient = client
      return client
    })()
  }
  return sharedClientPromise
}

export async function stopCopilotClient(): Promise<void> {
  if (!sharedClient) return
  const client = sharedClient
  sharedClient = null
  sharedClientPromise = null
  try {
    await client.stop()
  } catch {
    try {
      await client.forceStop()
    } catch {
      // best-effort cleanup
    }
  }
}

export async function* queryCopilotSdkWithStreaming({
  messages,
  systemPrompt,
  tools,
  signal,
  options,
  explicitProviderID,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  tools: Tools
  signal: AbortSignal
  options: Options
  explicitProviderID?: string
}): AsyncGenerator<StreamEvent | AssistantMessage, void> {
  const effectiveProviderID = explicitProviderID ?? getSelectedProviderID()
  const provider = explicitProviderID
    ? getProviderConfig(explicitProviderID)
    : getSelectedProviderConfig()
  void provider // hint: provider may only be used by future extensions
  const model = options.model?.trim() || 'claude-sonnet-4.5'

  let session: Awaited<ReturnType<CopilotClient['createSession']>> | null = null
  try {
    const client = await getCopilotClient()
    const normalizedMessages = ensureToolResultPairing(
      normalizeMessagesForAPI(messages, tools),
    )
    const apiTools = await buildCopilotTools(tools, options)

    session = await client.createSession({
      model,
      streaming: true,
      systemMessage: {
        content: asSystemPrompt(systemPrompt).join('\n\n'),
      },
      onPermissionRequest: () => ({ kind: 'reject', feedback: 'Tool calls are handled outside this provider.' }),
    })

    const prompt = buildCopilotPrompt(normalizedMessages, apiTools)

    let content = ''
    let reasoningContent = ''
    let usage = EMPTY_USAGE as NonNullableUsage
    let finishReason: string | null = null
    let requestID: string | undefined
    let aborted = false

    const idlePromise = new Promise<void>(resolve => {
      session!.on('session.idle', () => resolve())
    })

    const sessionErrorPromise = new Promise<never>((_, reject) => {
      session!.on('session.error', (event: SessionEvent) => {
        const message = (event as { data?: { message?: string } }).data?.message
        reject(new Error(message || 'Copilot session error'))
      })
    })

    session.on('assistant.message_delta', (event: SessionEvent) => {
      const data = event.data as { deltaContent?: string }
      if (typeof data.deltaContent === 'string' && data.deltaContent.length > 0) {
        content += data.deltaContent
      }
    })

    session.on('assistant.reasoning_delta', (event: SessionEvent) => {
      const data = event.data as { deltaContent?: string }
      if (typeof data.deltaContent === 'string' && data.deltaContent.length > 0) {
        reasoningContent += data.deltaContent
      }
    })

    session.on('assistant.usage', (event: SessionEvent) => {
      const data = event.data as AssistantUsageData
      usage = usageFromCopilot(data)
      requestID = data.providerCallId ?? data.apiCallId ?? requestID
      if (typeof data.finishReason === 'string') {
        finishReason = data.finishReason
      }
    })

    const abortHandler = () => {
      aborted = true
      session?.abort().catch(() => {})
    }
    if (signal.aborted) {
      abortHandler()
    } else {
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    try {
      const sendPromise = session.send({ prompt })
      await Promise.race([
        sendPromise,
        idlePromise,
        sessionErrorPromise,
        abortPromise(signal),
      ])
    } finally {
      signal.removeEventListener('abort', abortHandler)
    }

    if (aborted || signal.aborted) {
      throw new Error('aborted') as APIUserAbortError
    }

    yield createCopilotAssistantMessage({
      model,
      content,
      reasoningContent,
      usage,
      finishReason,
      requestID,
      tools,
      agentId: options.agentId,
      providerID: effectiveProviderID,
    })
  } catch (error) {
    if (signal.aborted) {
      yield createAssistantAPIErrorMessage({
        content: 'Request was aborted.',
        apiError: 'api_error',
      })
      return
    }
    yield createAssistantAPIErrorMessage({
      content: formatCopilotError(error, provider.displayName),
      apiError: 'api_error',
    })
  } finally {
    if (session) {
      try {
        await session.disconnect()
      } catch {
        // session may already be torn down
      }
    }
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

type CopilotToolSpec = {
  name: string
  description?: string
  input_schema?: unknown
}

async function buildCopilotTools(
  tools: Tools,
  options: Options,
): Promise<CopilotToolSpec[]> {
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
  return schemas.filter(isCopilotToolCompatible).map(toCopilotSpec)
}

function isCopilotToolCompatible(schema: BetaToolUnion): boolean {
  return (
    'name' in schema &&
    typeof schema.name === 'string' &&
    'input_schema' in schema
  )
}

function toCopilotSpec(schema: BetaToolUnion): CopilotToolSpec {
  const record = schema as Record<string, unknown>
  return {
    name: String(record.name),
    description:
      typeof record.description === 'string' ? record.description : undefined,
    input_schema: record.input_schema,
  }
}

function buildCopilotPrompt(
  messages: (Message & { message?: unknown })[],
  tools: CopilotToolSpec[],
): string {
  const blocks: string[] = []
  if (tools.length > 0) {
    blocks.push(
      'You are operating as a text-only model. Do not attempt to invoke tools or emit function calls; respond with plain text only.',
    )
  }
  for (const message of messages) {
    if (message.type === 'user') {
      const text = renderUserMessage(message)
      if (text) blocks.push(`User:\n${text}`)
    } else if (message.type === 'assistant') {
      const text = renderAssistantMessage(message)
      if (text) blocks.push(`Assistant:\n${text}`)
    }
  }
  blocks.push('Assistant:')
  return blocks.join('\n\n')
}

function renderUserMessage(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block?.type === 'text') parts.push(block.text ?? '')
    else if (block?.type === 'tool_result') {
      parts.push(`[Tool result for ${block.tool_use_id}]\n${stringifyToolResult(block.content)}`)
    } else if (block?.type === 'image') {
      parts.push('[Image attachment omitted]')
    } else if (block?.type === 'document') {
      parts.push('[Document attachment omitted]')
    }
  }
  return parts.join('\n')
}

function renderAssistantMessage(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block?.type === 'text') parts.push(block.text ?? '')
    else if (block?.type === 'thinking') {
      const thinking = (block as { thinking?: string }).thinking
      if (thinking) parts.push(`<thinking>\n${thinking}\n</thinking>`)
    } else if (block?.type === 'tool_use') {
      const input = block.input
      const args =
        typeof input === 'string' ? input : JSON.stringify(input ?? {})
      parts.push(`[Tool call ${block.name}(${args})]`)
    }
  }
  return parts.join('\n')
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

function usageFromCopilot(data: AssistantUsageData): NonNullableUsage {
  return {
    ...EMPTY_USAGE,
    input_tokens: data.inputTokens ?? 0,
    output_tokens: data.outputTokens ?? 0,
    cache_read_input_tokens: data.cacheReadTokens ?? 0,
    cache_creation_input_tokens: data.cacheWriteTokens ?? 0,
    reasoning_tokens: data.reasoningTokens ?? 0,
  }
}

function createCopilotAssistantMessage({
  model,
  content,
  reasoningContent,
  usage,
  finishReason,
  requestID,
  tools,
  agentId,
  providerID,
}: {
  model: string
  content: string
  reasoningContent: string
  usage: NonNullableUsage
  finishReason: string | null
  requestID: string | undefined
  tools: Tools
  agentId?: Options['agentId']
  providerID: string
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
    providerID,
  } as AssistantMessage
}

function toAnthropicStopReason(reason: string | null): BetaMessage['stop_reason'] {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop') return 'end_turn'
  return null
}

function formatCopilotError(error: unknown, providerName: string): string {
  const message = errorMessage(error)
  if (
    /auth/i.test(message) ||
    /login/i.test(message) ||
    /token/i.test(message)
  ) {
    return `${providerName} authentication failed. Run \`copilot auth login\` or set GITHUB_TOKEN / GH_TOKEN. (${message})`
  }
  return message || 'Unknown GitHub Copilot error'
}

import type {
  AgentMessageTurnItem,
  ErrorTurnItem,
  ReasoningTurnItem,
  ThreadEvent,
  ToolCallTurnItem,
  ToolResultTurnItem,
  TurnItem,
  TurnItemType,
  UserMessageTurnItem,
  WorkflowEventIds,
} from '@codepilotx/core/agent/workflow.js'
import {
  createWorkflowId,
  normalizeThreadEvent,
} from '@codepilotx/core/agent/workflow.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

type UnknownRecord = Record<string, unknown>

export function sdkMessageToThreadEvents(
  message: SDKMessage,
  ids: WorkflowEventIds,
): ThreadEvent[] {
  if (!isRecord(message)) return []

  const createdAt = readString(message.timestamp) ?? ids.now?.() ?? defaultNow()
  const itemId = (kind: TurnItemType | string, seed?: string) =>
    ids.itemId?.(kind, seed) ?? createWorkflowId(kind, seed)

  switch (message.type) {
    case 'assistant':
      return assistantMessageToEvents(message, ids, itemId, createdAt)
    case 'user':
      return userMessageToEvents(message, ids, itemId, createdAt)
    case 'result':
      return resultMessageToEvents(message, ids, createdAt)
    case 'system':
      return systemMessageToEvents(message, ids, itemId, createdAt)
    case 'tool_progress':
      return toolProgressToEvents(message, ids, itemId, createdAt)
    default:
      return []
  }
}

function assistantMessageToEvents(
  message: UnknownRecord,
  ids: WorkflowEventIds,
  itemId: (kind: TurnItemType | string, seed?: string) => string,
  createdAt: string,
): ThreadEvent[] {
  const events: ThreadEvent[] = []
  const assistant = isRecord(message.message) ? message.message : undefined
  const content = Array.isArray(assistant?.content) ? assistant.content : []

  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      const item: AgentMessageTurnItem = {
        id: itemId('agent_message', readString(message.uuid)),
        type: 'agent_message',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'completed',
        createdAt,
        text: block.text,
        metadata: messageMetadata(message),
      }
      events.push(decorateThreadEvent(itemEvent('item.completed', ids, item, createdAt), ids))
    } else if (
      (block.type === 'thinking' || block.type === 'redacted_thinking') &&
      typeof block.thinking === 'string'
    ) {
      const item: ReasoningTurnItem = {
        id: itemId('reasoning', readString(block.signature)),
        type: 'reasoning',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'completed',
        createdAt,
        text: block.thinking,
        metadata: messageMetadata(message),
      }
      events.push(decorateThreadEvent(itemEvent('item.completed', ids, item, createdAt), ids))
    } else if (
      block.type === 'tool_use' &&
      typeof block.name === 'string' &&
      typeof block.id === 'string'
    ) {
      const item: ToolCallTurnItem = {
        id: itemId('tool_call', block.id),
        type: 'tool_call',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'in_progress',
        createdAt,
        toolName: block.name,
        summary: block.name,
        toolUseId: block.id,
        metadata: {
          ...messageMetadata(message),
          toolUseId: block.id,
          input: block.input,
        },
      }
      events.push(decorateThreadEvent(itemEvent('item.started', ids, item, createdAt), ids))
    }
  }

  if (events.length === 0 && readString(message.error)) {
    const item: ErrorTurnItem = {
      id: itemId('error', readString(message.uuid)),
      type: 'error',
      threadId: ids.threadId,
      turnId: ids.turnId,
      status: 'failed',
      createdAt,
      message: readString(message.error) ?? 'Assistant message failed',
    }
    events.push(decorateThreadEvent(itemEvent('item.completed', ids, item, createdAt), ids))
  }

  return events
}

function userMessageToEvents(
  message: UnknownRecord,
  ids: WorkflowEventIds,
  itemId: (kind: TurnItemType | string, seed?: string) => string,
  createdAt: string,
): ThreadEvent[] {
  const user = isRecord(message.message) ? message.message : undefined
  const content = user?.content
  const events: ThreadEvent[] = []

  for (const block of contentToBlocks(content)) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') {
      const item: UserMessageTurnItem = {
        id: itemId('user_message', readString(message.uuid)),
        type: 'user_message',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'completed',
        createdAt,
        text: block.text,
        metadata: messageMetadata(message),
      }
      events.push(itemEvent('item.completed', ids, item, createdAt))
    } else if (block.type === 'tool_result') {
      const toolUseId = readString(block.tool_use_id)
      const contentText = extractText(block.content)
      const resultMetadata = toolResultMetadata(
        message.tool_use_result,
        contentText,
      )
      const item: ToolResultTurnItem = {
        id: itemId('tool_result', toolUseId),
        type: 'tool_result',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: block.is_error ? 'failed' : 'completed',
        createdAt,
        toolName: toolUseId ?? 'tool',
        summary: contentText ?? '',
        ...(toolUseId ? { toolUseId } : {}),
        ...(block.is_error ? { isError: true } : {}),
        metadata: {
          ...messageMetadata(message),
          toolUseId,
          ...resultMetadata,
          result: message.tool_use_result,
        },
      }
      events.push(decorateThreadEvent(itemEvent('item.completed', ids, item, createdAt), ids))
    }
  }

  return events
}

function resultMessageToEvents(
  message: UnknownRecord,
  ids: WorkflowEventIds,
  createdAt: string,
): ThreadEvent[] {
  const isError = Boolean(message.is_error) || message.subtype === 'error'
  const result = readString(message.result) ?? ''
  if (isError) {
    return [
      normalizeThreadEvent({
        type: 'turn.failed',
        threadId: ids.threadId,
        turnId: ids.turnId,
        createdAt,
        error: {
          message: result || readString(message.error) || 'Query failed',
          ...(readString(message.subtype)
            ? { code: readString(message.subtype) }
            : {}),
        },
      }, nextEnvelope(ids)),
    ]
  }

  return [
    normalizeThreadEvent({
      type: 'turn.completed',
      threadId: ids.threadId,
      turnId: ids.turnId,
      createdAt,
      finalResponse: result,
      usage: isRecord(message.usage) ? message.usage : undefined,
      stopReason: readString(message.stop_reason) ?? null,
      costUsd:
        typeof message.total_cost_usd === 'number'
          ? message.total_cost_usd
          : undefined,
      metadata: {
        subtype: message.subtype,
        durationMs: message.duration_ms,
        durationApiMs: message.duration_api_ms,
        numTurns: message.num_turns,
        modelUsage: message.modelUsage,
        permissionDenials: message.permission_denials,
        structuredOutput: message.structured_output,
        fastModeState: message.fast_mode_state,
        uuid: message.uuid,
      },
    }, nextEnvelope(ids)),
  ]
}

function systemMessageToEvents(
  message: UnknownRecord,
  ids: WorkflowEventIds,
  itemId: (kind: TurnItemType | string, seed?: string) => string,
  createdAt: string,
): ThreadEvent[] {
  if (message.subtype !== 'compact_boundary') return []
  const item: ReasoningTurnItem = {
    id: itemId('reasoning', readString(message.uuid) ?? 'compact-boundary'),
    type: 'reasoning',
    threadId: ids.threadId,
    turnId: ids.turnId,
    status: 'completed',
    createdAt,
    text: 'Conversation compacted',
    metadata: {
      subtype: message.subtype,
      compactMetadata: message.compact_metadata,
    },
  }
  return [decorateThreadEvent(itemEvent('item.completed', ids, item, createdAt), ids)]
}

function toolProgressToEvents(
  message: UnknownRecord,
  ids: WorkflowEventIds,
  itemId: (kind: TurnItemType | string, seed?: string) => string,
  createdAt: string,
): ThreadEvent[] {
  const toolUseId = readString(message.tool_use_id)
  const toolName = readString(message.tool_name) ?? 'tool'
  const item: ToolCallTurnItem = {
    id: itemId('tool_call', toolUseId),
    type: 'tool_call',
    threadId: ids.threadId,
    turnId: ids.turnId,
    status: 'in_progress',
    createdAt,
    updatedAt: createdAt,
    toolName,
    summary: `${toolName} running`,
    ...(toolUseId ? { toolUseId } : {}),
    metadata: messageMetadata(message),
  }
  return [decorateThreadEvent(itemEvent('item.updated', ids, item, createdAt), ids)]
}

function itemEvent(
  type: 'item.started' | 'item.updated' | 'item.completed',
  ids: Pick<WorkflowEventIds, 'threadId' | 'turnId'>,
  item: TurnItem,
  createdAt: string,
): ThreadEvent {
  return {
    type,
    threadId: ids.threadId,
    turnId: ids.turnId,
    item,
    createdAt,
  }
}

function decorateThreadEvent(
  event: ThreadEvent,
  ids: Pick<WorkflowEventIds, 'eventId' | 'sequence'>,
): ThreadEvent {
  const envelope = nextEnvelope(ids)
  return normalizeThreadEvent(event, {
    ...envelope,
    eventId: ids.eventId?.(event, envelope.sequence),
  })
}

function nextEnvelope(
  ids: Pick<WorkflowEventIds, 'sequence'>,
): { sequence?: number } {
  return { sequence: ids.sequence?.() }
}

function contentToBlocks(content: unknown): unknown[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content
  }
  return []
}

function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (isRecord(block) && typeof block.text === 'string') return block.text
      return undefined
    })
    .filter((part): part is string => Boolean(part))
    .join('\n')
}

function toolResultMetadata(
  result: unknown,
  contentText: string | undefined,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (contentText) metadata.content = contentText
  if (!isRecord(result)) return metadata

  for (const key of [
    'stdout',
    'stderr',
    'output',
    'error',
    'message',
    'text',
    'content',
  ]) {
    const value = result[key]
    const text = metadataValueToText(value)
    if (text) metadata[key] = text
  }

  return metadata
}

function metadataValueToText(value: unknown): string | undefined {
  const direct = readString(value)
  if (direct) return direct
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    const text = value
      .map(item => metadataArrayItemToText(item))
      .filter((part): part is string => Boolean(part))
      .join('\n')
    return text || undefined
  }

  if (!isRecord(value)) return undefined

  const recordDirect = readString(value.text) ?? readString(value.content)
  if (recordDirect) return recordDirect

  const details = ['message', 'error', 'stderr', 'stdout', 'output']
    .map(key => {
      const text = metadataValueToText(value[key])
      return text ? `${key}=${text}` : undefined
    })
    .filter((part): part is string => Boolean(part))
  if (details.length > 0) return details.join('; ')

  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function metadataArrayItemToText(value: unknown): string | undefined {
  if (isRecord(value)) {
    return (
      readString(value.text) ??
      readString(value.content) ??
      readString(value.message) ??
      metadataValueToText(value)
    )
  }
  return metadataValueToText(value)
}

function messageMetadata(message: UnknownRecord): Record<string, unknown> {
  return {
    sessionId: message.session_id,
    uuid: message.uuid,
    parentToolUseId: message.parent_tool_use_id,
    isSynthetic: message.isSynthetic,
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object'
}

function defaultNow(): string {
  return new Date().toISOString()
}

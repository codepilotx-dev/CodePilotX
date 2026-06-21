import type { AgentPermissionRequest } from './permissions.js'
import type {
  AgentContextUsage,
  AgentRuntimeEvent,
  AgentSessionStatus,
} from './runtime.js'

export type ThreadId = string
export type TurnId = string
export type TurnItemId = string

export type TurnStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'interrupted'

export type TurnItemType =
  | 'user_message'
  | 'agent_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'file_change'
  | 'error'

export type TurnItemStatus = 'in_progress' | 'completed' | 'failed'

type TurnItemCommon = {
  id: TurnItemId
  threadId: ThreadId
  turnId: TurnId
  status: TurnItemStatus
  createdAt: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}

export type UserMessageTurnItem = TurnItemCommon & {
  type: 'user_message'
  text: string
}

export type AgentMessageTurnItem = TurnItemCommon & {
  type: 'agent_message'
  text: string
  streaming?: boolean
}

export type ReasoningTurnItem = TurnItemCommon & {
  type: 'reasoning'
  text: string
}

export type ToolCallTurnItem = TurnItemCommon & {
  type: 'tool_call'
  toolName: string
  summary: string
}

export type ToolResultTurnItem = TurnItemCommon & {
  type: 'tool_result'
  toolName: string
  summary: string
  isError?: boolean
}

export type PermissionRequestTurnItem = TurnItemCommon & {
  type: 'permission_request'
  request: AgentPermissionRequest
}

export type FileChangeTurnItem = TurnItemCommon & {
  type: 'file_change'
  filePath: string
  patch: string
}

export type ErrorTurnItem = TurnItemCommon & {
  type: 'error'
  message: string
  code?: string
}

export type TurnItem =
  | UserMessageTurnItem
  | AgentMessageTurnItem
  | ReasoningTurnItem
  | ToolCallTurnItem
  | ToolResultTurnItem
  | PermissionRequestTurnItem
  | FileChangeTurnItem
  | ErrorTurnItem

export type ThreadStartedEvent = {
  type: 'thread.started'
  threadId: ThreadId
  createdAt: string
  metadata?: Record<string, unknown>
}

export type TurnStartedEvent = {
  type: 'turn.started'
  threadId: ThreadId
  turnId: TurnId
  createdAt: string
  input?: unknown
  metadata?: Record<string, unknown>
}

export type TurnItemEvent = {
  type: 'item.started' | 'item.updated' | 'item.completed'
  threadId: ThreadId
  turnId: TurnId
  item: TurnItem
  createdAt: string
}

export type TurnCompletedEvent = {
  type: 'turn.completed'
  threadId: ThreadId
  turnId: TurnId
  createdAt: string
  finalResponse: string
  usage?: AgentContextUsage | Record<string, unknown>
  stopReason?: string | null
  costUsd?: number
  metadata?: Record<string, unknown>
}

export type TurnFailedEvent = {
  type: 'turn.failed'
  threadId: ThreadId
  turnId: TurnId
  createdAt: string
  error: {
    message: string
    code?: string
  }
}

export type TurnInterruptedEvent = {
  type: 'turn.interrupted'
  threadId: ThreadId
  turnId: TurnId
  createdAt: string
  reason?: string
}

export type ThreadEvent =
  | ThreadStartedEvent
  | TurnStartedEvent
  | TurnItemEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnInterruptedEvent

export type WorkflowEventIds = {
  threadId: ThreadId
  turnId: TurnId
  now?: () => string
  itemId?: (kind: TurnItemType | string, seed?: string) => TurnItemId
}

export function createWorkflowId(prefix: string, seed?: string): string {
  const suffix = seed
    ? seed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${suffix || 'item'}`
}

export function createThreadStartedEvent(
  threadId: ThreadId,
  metadata?: Record<string, unknown>,
  now: () => string = defaultNow,
): ThreadStartedEvent {
  return {
    type: 'thread.started',
    threadId,
    createdAt: now(),
    ...(metadata ? { metadata } : {}),
  }
}

export function createTurnStartedEvent(
  threadId: ThreadId,
  turnId: TurnId,
  input?: unknown,
  now: () => string = defaultNow,
): TurnStartedEvent {
  return {
    type: 'turn.started',
    threadId,
    turnId,
    createdAt: now(),
    ...(input === undefined ? {} : { input }),
  }
}

export function agentRuntimeEventToThreadEvents(
  event: AgentRuntimeEvent,
  ids: WorkflowEventIds,
): ThreadEvent[] {
  const createdAt = eventCreatedAt(event) ?? ids.now?.() ?? defaultNow()
  const metadata = sourceMetadata(event)
  const itemId = (kind: TurnItemType | string, seed?: string) =>
    ids.itemId?.(kind, seed) ?? createWorkflowId(kind, seed)

  switch (event.type) {
    case 'message': {
      const type =
        event.role === 'user'
          ? 'user_message'
          : ('agent_message' as 'agent_message')
      const item: UserMessageTurnItem | AgentMessageTurnItem =
        type === 'user_message'
          ? {
              id: itemId(type),
              type,
              threadId: ids.threadId,
              turnId: ids.turnId,
              status: 'completed',
              createdAt,
              text: event.text,
              ...(metadata ? { metadata } : {}),
            }
          : {
              id: itemId(type),
              type,
              threadId: ids.threadId,
              turnId: ids.turnId,
              status: 'completed',
              createdAt,
              text: event.text,
              metadata: { ...(metadata ?? {}), role: event.role },
            }
      return [itemEvent('item.completed', ids, item, createdAt)]
    }
    case 'partial_message': {
      const item: AgentMessageTurnItem = {
        id: itemId('agent_message', 'partial'),
        type: 'agent_message',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'in_progress',
        createdAt,
        updatedAt: createdAt,
        text: event.text,
        streaming: true,
        ...(metadata ? { metadata } : {}),
      }
      return [itemEvent('item.updated', ids, item, createdAt)]
    }
    case 'tool_start': {
      const item: ToolCallTurnItem = {
        id: itemId('tool_call', `${event.toolName}-start`),
        type: 'tool_call',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'in_progress',
        createdAt,
        toolName: event.toolName,
        summary: event.summary,
        ...(metadata ? { metadata } : {}),
      }
      return [itemEvent('item.started', ids, item, createdAt)]
    }
    case 'tool_result': {
      const item: ToolResultTurnItem = {
        id: itemId('tool_result', `${event.toolName}-result`),
        type: 'tool_result',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: event.isError ? 'failed' : 'completed',
        createdAt,
        toolName: event.toolName,
        summary: event.summary,
        ...(event.isError ? { isError: true } : {}),
        ...(metadata ? { metadata } : {}),
      }
      return [itemEvent('item.completed', ids, item, createdAt)]
    }
    case 'permission_request': {
      const item: PermissionRequestTurnItem = {
        id: itemId('permission_request', event.request.requestId),
        type: 'permission_request',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'in_progress',
        createdAt,
        request: event.request,
        ...(metadata ? { metadata } : {}),
      }
      return [itemEvent('item.started', ids, item, createdAt)]
    }
    case 'diff': {
      const item: FileChangeTurnItem = {
        id: itemId('file_change', event.filePath),
        type: 'file_change',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'completed',
        createdAt,
        filePath: event.filePath,
        patch: event.patch,
        ...(metadata ? { metadata } : {}),
      }
      return [itemEvent('item.completed', ids, item, createdAt)]
    }
    case 'error': {
      const item: ErrorTurnItem = {
        id: itemId('error'),
        type: 'error',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'failed',
        createdAt,
        message: event.message,
      }
      return [
        itemEvent('item.completed', ids, item, createdAt),
        {
          type: 'turn.failed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          error: { message: event.message },
        },
      ]
    }
    case 'status':
      return statusToThreadEvents(event.status, ids, createdAt)
    case 'done':
      return [
        {
          type: 'turn.completed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          finalResponse: '',
          stopReason: 'done',
        },
      ]
    case 'context_usage':
    case 'session_title':
      return []
  }
}

function itemEvent(
  type: TurnItemEvent['type'],
  ids: Pick<WorkflowEventIds, 'threadId' | 'turnId'>,
  item: TurnItem,
  createdAt: string,
): TurnItemEvent {
  return {
    type,
    threadId: ids.threadId,
    turnId: ids.turnId,
    item,
    createdAt,
  }
}

function statusToThreadEvents(
  status: AgentSessionStatus,
  ids: WorkflowEventIds,
  createdAt: string,
): ThreadEvent[] {
  switch (status) {
    case 'running':
      return [
        {
          type: 'turn.started',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
        },
      ]
    case 'done':
      return [
        {
          type: 'turn.completed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          finalResponse: '',
          stopReason: 'status.done',
        },
      ]
    case 'error':
      return [
        {
          type: 'turn.failed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          error: { message: 'Agent session failed' },
        },
      ]
    case 'idle':
    case 'waiting':
      return []
  }
}

function sourceMetadata(
  event: AgentRuntimeEvent,
): Record<string, unknown> | undefined {
  if (!('sourceThreadId' in event || 'sourceLabel' in event)) {
    return undefined
  }
  return {
    ...(event.sourceThreadId ? { sourceThreadId: event.sourceThreadId } : {}),
    ...(event.sourceLabel ? { sourceLabel: event.sourceLabel } : {}),
  }
}

function eventCreatedAt(event: AgentRuntimeEvent): string | undefined {
  return 'createdAt' in event ? event.createdAt : undefined
}

function defaultNow(): string {
  return new Date().toISOString()
}

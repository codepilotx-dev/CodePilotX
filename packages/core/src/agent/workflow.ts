import type { AgentPermissionRequest } from './permissions.js'
import type {
  AgentGuardianReviewAction,
  AgentGuardianReviewStatus,
  AgentGuardianRiskLevel,
  AgentGuardianUserAuthorization,
  AgentContextUsage,
  AgentRuntimeEvent,
  AgentSessionStatus,
} from './runtime.js'

export type ThreadId = string
export type TurnId = string
export type TurnItemId = string
export type WorkflowEventId = string

export const WorkflowEventSchemaVersion = 1 as const

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
  | 'proposed_plan'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'guardian_review'
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

export type ProposedPlanTurnItem = TurnItemCommon & {
  type: 'proposed_plan'
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
  toolUseId?: string
}

export type ToolResultTurnItem = TurnItemCommon & {
  type: 'tool_result'
  toolName: string
  summary: string
  toolUseId?: string
  isError?: boolean
}

export type PermissionRequestTurnItem = TurnItemCommon & {
  type: 'permission_request'
  request: AgentPermissionRequest
}

export type GuardianReviewTurnItem = TurnItemCommon & {
  type: 'guardian_review'
  reviewId: string
  targetRequestId?: string
  reviewStatus: AgentGuardianReviewStatus
  riskLevel?: AgentGuardianRiskLevel
  userAuthorization?: AgentGuardianUserAuthorization
  rationale?: string
  action: AgentGuardianReviewAction
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
  | ProposedPlanTurnItem
  | ReasoningTurnItem
  | ToolCallTurnItem
  | ToolResultTurnItem
  | PermissionRequestTurnItem
  | GuardianReviewTurnItem
  | FileChangeTurnItem
  | ErrorTurnItem

export type ThreadStartedEvent = {
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
  type: 'thread.started'
  threadId: ThreadId
  createdAt: string
  metadata?: Record<string, unknown>
}

export type TurnStartedEvent = {
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
  type: 'turn.started'
  threadId: ThreadId
  turnId: TurnId
  createdAt: string
  input?: unknown
  metadata?: Record<string, unknown>
}

export type TurnItemEvent = {
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
  type: 'item.started' | 'item.updated' | 'item.completed'
  threadId: ThreadId
  turnId: TurnId
  item: TurnItem
  createdAt: string
}

export type TurnCompletedEvent = {
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
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
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
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
  eventId?: WorkflowEventId
  schemaVersion?: typeof WorkflowEventSchemaVersion
  sequence?: number
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
  eventId?: (event: ThreadEvent, sequence?: number) => WorkflowEventId
  sequence?: () => number
}

export type WorkflowEventEnvelopeOptions = {
  eventId?: WorkflowEventId
  sequence?: number
}

export type WorkflowContractFixtureName =
  | 'minimal_success'
  | 'streaming_message'
  | 'tool_lifecycle'
  | 'permission_lifecycle'
  | 'file_change'
  | 'turn_failure'

export type WorkflowContractFixtureOptions = {
  threadId?: ThreadId
  turnId?: TurnId
  createdAt?: string
}

export function createWorkflowId(prefix: string, seed?: string): string {
  const suffix = seed
    ? seed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${suffix || 'item'}`
}

export function normalizeThreadEvent(
  event: ThreadEvent,
  options: WorkflowEventEnvelopeOptions = {},
): ThreadEvent {
  const sequence = event.sequence ?? options.sequence
  return {
    ...event,
    schemaVersion: event.schemaVersion ?? WorkflowEventSchemaVersion,
    ...(sequence === undefined ? {} : { sequence }),
    eventId:
      event.eventId ??
      options.eventId ??
      createWorkflowId('event', workflowEventSeed(event, sequence)),
  } as ThreadEvent
}

export function createPermissionRequestDecisionEvent(params: {
  threadId: ThreadId
  turnId: TurnId
  request: AgentPermissionRequest
  behavior: 'allow' | 'deny' | 'cancel'
  createdAt?: string
  sequence?: number
  eventId?: string
}): TurnItemEvent {
  const createdAt = params.createdAt ?? defaultNow()
  const item: PermissionRequestTurnItem = {
    id: createWorkflowId('permission_request', params.request.requestId),
    type: 'permission_request',
    threadId: params.threadId,
    turnId: params.turnId,
    status: params.behavior === 'allow' ? 'completed' : 'failed',
    createdAt,
    updatedAt: createdAt,
    request: params.request,
    metadata: { decision: params.behavior },
  }
  return normalizeThreadEvent(
    itemEvent(
      'item.completed',
      { threadId: params.threadId, turnId: params.turnId },
      item,
      createdAt,
    ),
    { eventId: params.eventId, sequence: params.sequence },
  ) as TurnItemEvent
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

export function createWorkflowContractFixture(
  name: WorkflowContractFixtureName,
  options: WorkflowContractFixtureOptions = {},
): ThreadEvent[] {
  const threadId = options.threadId ?? 'thread-contract'
  const turnId = options.turnId ?? 'turn-contract'
  const createdAt = options.createdAt ?? '2026-06-22T00:00:00.000Z'
  const ids = { threadId, turnId }
  const base: ThreadEvent[] = [
    {
      type: 'thread.started',
      threadId,
      createdAt,
      metadata: { fixture: name },
    },
    {
      type: 'turn.started',
      threadId,
      turnId,
      createdAt,
      input: 'contract input',
      metadata: { fixture: name },
    },
  ]

  switch (name) {
    case 'minimal_success':
      base.push(
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-agent-message',
            type: 'agent_message',
            threadId,
            turnId,
            status: 'completed',
            createdAt,
            text: 'contract response',
          },
          createdAt,
        ),
        {
          type: 'turn.completed',
          threadId,
          turnId,
          createdAt,
          finalResponse: 'contract response',
          stopReason: 'fixture',
        },
      )
      break
    case 'streaming_message':
      base.push(
        itemEvent(
          'item.updated',
          ids,
          {
            id: 'item-agent-message-streaming',
            type: 'agent_message',
            threadId,
            turnId,
            status: 'in_progress',
            createdAt,
            updatedAt: createdAt,
            text: 'contract',
            streaming: true,
          },
          createdAt,
        ),
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-agent-message-streaming',
            type: 'agent_message',
            threadId,
            turnId,
            status: 'completed',
            createdAt,
            updatedAt: createdAt,
            text: 'contract response',
          },
          createdAt,
        ),
        {
          type: 'turn.completed',
          threadId,
          turnId,
          createdAt,
          finalResponse: 'contract response',
          stopReason: 'fixture',
        },
      )
      break
    case 'tool_lifecycle':
      base.push(
        itemEvent(
          'item.started',
          ids,
          {
            id: 'item-tool-call',
            type: 'tool_call',
            threadId,
            turnId,
            status: 'in_progress',
            createdAt,
            toolName: 'Read',
            summary: 'Read file',
            toolUseId: 'tool-use-contract',
          },
          createdAt,
        ),
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-tool-result',
            type: 'tool_result',
            threadId,
            turnId,
            status: 'completed',
            createdAt,
            toolName: 'Read',
            summary: 'Read complete',
            toolUseId: 'tool-use-contract',
            metadata: { content: 'file contents' },
          },
          createdAt,
        ),
        {
          type: 'turn.completed',
          threadId,
          turnId,
          createdAt,
          finalResponse: 'Read complete',
          stopReason: 'fixture',
        },
      )
      break
    case 'permission_lifecycle': {
      const request: AgentPermissionRequest = {
        requestId: 'permission-contract',
        toolName: 'Edit',
        input: { file_path: 'a.ts' },
        description: 'Edit a.ts',
      }
      base.push(
        itemEvent(
          'item.started',
          ids,
          {
            id: 'item-permission-request',
            type: 'permission_request',
            threadId,
            turnId,
            status: 'in_progress',
            createdAt,
            request,
          },
          createdAt,
        ),
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-permission-request',
            type: 'permission_request',
            threadId,
            turnId,
            status: 'completed',
            createdAt,
            updatedAt: createdAt,
            request,
            metadata: { decision: 'allow' },
          },
          createdAt,
        ),
        {
          type: 'turn.completed',
          threadId,
          turnId,
          createdAt,
          finalResponse: 'Permission handled',
          stopReason: 'fixture',
        },
      )
      break
    }
    case 'file_change':
      base.push(
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-file-change',
            type: 'file_change',
            threadId,
            turnId,
            status: 'completed',
            createdAt,
            filePath: 'a.ts',
            patch: '@@ -1 +1 @@',
          },
          createdAt,
        ),
        {
          type: 'turn.completed',
          threadId,
          turnId,
          createdAt,
          finalResponse: 'Changed a.ts',
          stopReason: 'fixture',
        },
      )
      break
    case 'turn_failure':
      base.push(
        itemEvent(
          'item.completed',
          ids,
          {
            id: 'item-error',
            type: 'error',
            threadId,
            turnId,
            status: 'failed',
            createdAt,
            message: 'Fixture failure',
            code: 'fixture_error',
          },
          createdAt,
        ),
        {
          type: 'turn.failed',
          threadId,
          turnId,
          createdAt,
          error: { message: 'Fixture failure', code: 'fixture_error' },
        },
      )
      break
  }

  return base.map((event, index) =>
    normalizeThreadEvent(event, {
      sequence: index + 1,
      eventId: `event-contract-${name}-${index + 1}`,
    }),
  )
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
      return decorateThreadEvents([itemEvent('item.completed', ids, item, createdAt)], ids)
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
      return decorateThreadEvents([itemEvent('item.updated', ids, item, createdAt)], ids)
    }
    case 'proposed_plan': {
      const item: ProposedPlanTurnItem = {
        id: itemId('proposed_plan', event.streaming ? 'partial' : 'final'),
        type: 'proposed_plan',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: event.streaming ? 'in_progress' : 'completed',
        createdAt,
        updatedAt: createdAt,
        text: event.text,
        ...(event.streaming ? { streaming: true } : {}),
        ...(metadata ? { metadata } : {}),
      }
      return decorateThreadEvents(
        [itemEvent(event.streaming ? 'item.updated' : 'item.completed', ids, item, createdAt)],
        ids,
      )
    }
    case 'tool_start': {
      const toolUseId =
        event.toolUseId ?? createWorkflowId('tool_use', `${event.toolName}-start`)
      const itemMetadata = { ...(metadata ?? {}), toolUseId }
      const item: ToolCallTurnItem = {
        id: itemId('tool_call', event.toolUseId ?? `${event.toolName}-start`),
        type: 'tool_call',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: 'in_progress',
        createdAt,
        toolName: event.toolName,
        summary: event.summary,
        toolUseId,
        metadata: itemMetadata,
      }
      return decorateThreadEvents([itemEvent('item.started', ids, item, createdAt)], ids)
    }
    case 'tool_result': {
      const toolUseId =
        event.toolUseId ?? createWorkflowId('tool_use', `${event.toolName}-result`)
      const itemMetadata = { ...(metadata ?? {}), toolUseId }
      const item: ToolResultTurnItem = {
        id: itemId('tool_result', event.toolUseId ?? `${event.toolName}-result`),
        type: 'tool_result',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: event.isError ? 'failed' : 'completed',
        createdAt,
        toolName: event.toolName,
        summary: event.summary,
        toolUseId,
        ...(event.isError ? { isError: true } : {}),
        metadata: itemMetadata,
      }
      return decorateThreadEvents([itemEvent('item.completed', ids, item, createdAt)], ids)
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
      return decorateThreadEvents([itemEvent('item.started', ids, item, createdAt)], ids)
    }
    case 'guardian_review': {
      const item: GuardianReviewTurnItem = {
        id: itemId('guardian_review', event.reviewId),
        type: 'guardian_review',
        threadId: ids.threadId,
        turnId: ids.turnId,
        status: guardianItemStatus(event.status),
        createdAt,
        updatedAt: createdAt,
        reviewId: event.reviewId,
        ...(event.targetRequestId ? { targetRequestId: event.targetRequestId } : {}),
        reviewStatus: event.status,
        ...(event.riskLevel ? { riskLevel: event.riskLevel } : {}),
        ...(event.userAuthorization
          ? { userAuthorization: event.userAuthorization }
          : {}),
        ...(event.rationale ? { rationale: event.rationale } : {}),
        action: event.action,
        ...(metadata ? { metadata } : {}),
      }
      const lifecycle =
        event.status === 'in_progress' ? 'item.started' : 'item.completed'
      return decorateThreadEvents([itemEvent(lifecycle, ids, item, createdAt)], ids)
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
      return decorateThreadEvents([itemEvent('item.completed', ids, item, createdAt)], ids)
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
      return decorateThreadEvents([
        itemEvent('item.completed', ids, item, createdAt),
        {
          type: 'turn.failed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          error: { message: event.message },
        },
      ], ids)
    }
    case 'status':
      return decorateThreadEvents(statusToThreadEvents(event.status, ids, createdAt), ids)
    case 'done':
      return decorateThreadEvents([
        {
          type: 'turn.completed',
          threadId: ids.threadId,
          turnId: ids.turnId,
          createdAt,
          finalResponse: '',
          stopReason: 'done',
        },
      ], ids)
    case 'tool_output_delta':
    case 'context_usage':
    case 'session_title':
      return []
  }
}

function guardianItemStatus(
  status: AgentGuardianReviewStatus,
): TurnItemStatus {
  switch (status) {
    case 'in_progress':
      return 'in_progress'
    case 'approved':
      return 'completed'
    case 'denied':
    case 'timed_out':
    case 'aborted':
      return 'failed'
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

function decorateThreadEvents(
  events: ThreadEvent[],
  ids: Pick<WorkflowEventIds, 'eventId' | 'sequence'>,
): ThreadEvent[] {
  return events.map(event => {
    const sequence = event.sequence ?? ids.sequence?.()
    return normalizeThreadEvent(event, {
      sequence,
      eventId: ids.eventId?.(event, sequence),
    })
  })
}

function workflowEventSeed(event: ThreadEvent, sequence?: number): string {
  const turnId = 'turnId' in event ? event.turnId : 'thread'
  const itemId = 'item' in event ? event.item.id : undefined
  return [
    event.threadId,
    turnId,
    event.type,
    itemId,
    sequence ?? event.createdAt,
  ]
    .filter((part): part is string | number => part !== undefined)
    .join('-')
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
  const metadata =
    'metadata' in event && isRecord(event.metadata) ? event.metadata : undefined
  const source: Record<string, unknown> = {}

  if ('sourceThreadId' in event && event.sourceThreadId) {
    source.sourceThreadId = event.sourceThreadId
  }
  if ('sourceLabel' in event && event.sourceLabel) {
    source.sourceLabel = event.sourceLabel
  }
  if ('streamId' in event && event.streamId) source.streamId = event.streamId
  if ('delta' in event && event.delta === true) source.delta = true

  return mergeMetadata(metadata, source)
}

function mergeMetadata(
  ...parts: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = Object.assign({}, ...parts.filter(Boolean))
  return Object.keys(merged).length > 0 ? merged : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function eventCreatedAt(event: AgentRuntimeEvent): string | undefined {
  return 'createdAt' in event ? event.createdAt : undefined
}

function defaultNow(): string {
  return new Date().toISOString()
}

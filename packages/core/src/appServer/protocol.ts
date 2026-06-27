import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  ThreadEvent,
  ThreadId,
  TurnId,
  TurnItem,
} from '../agent/workflow.js'
import type { WorkflowSessionView } from '../agent/workflowView.js'

export const APP_SERVER_PROTOCOL_VERSION = 1 as const

export const THREAD_EVENT_NOTIFICATION = 'thread/event' as const
export const SESSION_SNAPSHOT_UPDATED_NOTIFICATION =
  'session/snapshot.updated' as const

export const APP_SERVER_METHODS = [
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'turn/start',
  'turn/interrupt',
  'turn/rollback',
  'item/inject',
  'session/getSnapshot',
] as const

export type JsonRpcAppServerMethod = (typeof APP_SERVER_METHODS)[number]

export type JsonRpcThreadRuntimeSettings = Record<string, unknown>

export type JsonRpcThreadRuntimeState = {
  threadId: ThreadId
  status: string
  createdAt: string
  currentTurnId?: TurnId
}

export type JsonRpcThreadRuntimeResumeState =
  Partial<JsonRpcThreadRuntimeState> & {
    nextSequence?: number
    startedEventEmitted?: boolean
    metadata?: Record<string, unknown>
  }

export type JsonRpcThreadRuntimeForkOptions = {
  threadId?: ThreadId
  settings?: JsonRpcThreadRuntimeSettings
  metadata?: Record<string, unknown>
}

export type JsonRpcInitializeResult = {
  protocolVersion: typeof APP_SERVER_PROTOCOL_VERSION
  capabilities: {
    transports: ['stdio']
    methods: readonly JsonRpcAppServerMethod[]
    notifications: [
      typeof THREAD_EVENT_NOTIFICATION,
      typeof SESSION_SNAPSHOT_UPDATED_NOTIFICATION,
    ]
  }
}

export type JsonRpcThreadStartParams = {
  threadId?: ThreadId
  settings: JsonRpcThreadRuntimeSettings
}

export type JsonRpcThreadStartResult = {
  threadId: ThreadId
  status: string
  createdAt: string
}

export type JsonRpcThreadResumeParams = {
  threadId: ThreadId
  settings: JsonRpcThreadRuntimeSettings
  state?: JsonRpcThreadRuntimeResumeState
}

export type JsonRpcThreadForkParams = {
  sourceThreadId: ThreadId
  options?: JsonRpcThreadRuntimeForkOptions
}

export type JsonRpcTurnStartParams = {
  threadId: ThreadId
  turnId?: TurnId
  input: string | ContentBlockParam[]
  uuid?: string
  isMeta?: boolean
}

export type JsonRpcTurnStartResult = {
  threadId: ThreadId
  turnId: TurnId
  eventCount: number
}

export type JsonRpcTurnInterruptParams = {
  threadId: ThreadId
  turnId?: TurnId
}

export type JsonRpcTurnRollbackParams = {
  threadId: ThreadId
  turnId: TurnId
}

export type JsonRpcItemInjectParams = {
  threadId: ThreadId
  turnId: TurnId
  item: TurnItem
  eventType?: 'item.started' | 'item.updated' | 'item.completed'
}

export type JsonRpcSessionGetSnapshotParams = {
  threadId: ThreadId
}

export type JsonRpcSessionSnapshot = {
  threadId: ThreadId
  eventCount: number
  updatedAt: string | null
  view: WorkflowSessionView
}

export type JsonRpcThreadEventNotificationParams = {
  event: ThreadEvent
}

export type JsonRpcSessionSnapshotUpdatedNotificationParams = {
  snapshot: JsonRpcSessionSnapshot
}

export type JsonRpcErrorData = {
  threadId?: ThreadId
  turnId?: TurnId
  cause?: string
}

export function createInitializeResult(): JsonRpcInitializeResult {
  return {
    protocolVersion: APP_SERVER_PROTOCOL_VERSION,
    capabilities: {
      transports: ['stdio'],
      methods: APP_SERVER_METHODS,
      notifications: [
        THREAD_EVENT_NOTIFICATION,
        SESSION_SNAPSHOT_UPDATED_NOTIFICATION,
      ],
    },
  }
}

export function createJsonRpcProtocolFixtures() {
  return {
    initializeRequest: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    },
    initializeResponse: {
      jsonrpc: '2.0',
      id: 1,
      result: createInitializeResult(),
    },
    threadEventNotification: {
      jsonrpc: '2.0',
      method: THREAD_EVENT_NOTIFICATION,
      params: {
        event: {
          schemaVersion: 1,
          eventId: 'event-thread-1',
          sequence: 1,
          type: 'thread.started',
          threadId: 'thread-1',
          createdAt: '2026-06-22T00:00:00.000Z',
          metadata: { createdAt: '2026-06-22T00:00:00.000Z' },
        },
      },
    },
  }
}

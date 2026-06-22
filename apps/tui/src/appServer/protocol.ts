import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  ThreadEvent,
  ThreadId,
  TurnId,
  TurnItem,
} from '@codepilotx/core/agent/workflow.js'
import type {
  ThreadRuntimeForkOptions,
  ThreadRuntimeResumeState,
  ThreadRuntimeSettings,
} from '../workflow/ThreadRuntime.js'

export const APP_SERVER_PROTOCOL_VERSION = 1 as const

export const THREAD_EVENT_NOTIFICATION = 'thread/event' as const

export const APP_SERVER_METHODS = [
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'turn/start',
  'turn/interrupt',
  'turn/rollback',
  'item/inject',
] as const

export type JsonRpcAppServerMethod = (typeof APP_SERVER_METHODS)[number]

export type JsonRpcInitializeResult = {
  protocolVersion: typeof APP_SERVER_PROTOCOL_VERSION
  capabilities: {
    transports: ['stdio']
    methods: readonly JsonRpcAppServerMethod[]
    notifications: [typeof THREAD_EVENT_NOTIFICATION]
  }
}

export type JsonRpcThreadStartParams = {
  threadId?: ThreadId
  settings: ThreadRuntimeSettings
}

export type JsonRpcThreadStartResult = {
  threadId: ThreadId
  status: string
  createdAt: string
}

export type JsonRpcThreadResumeParams = {
  threadId: ThreadId
  settings: ThreadRuntimeSettings
  state?: ThreadRuntimeResumeState
}

export type JsonRpcThreadForkParams = {
  sourceThreadId: ThreadId
  options?: ThreadRuntimeForkOptions
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

export type JsonRpcThreadEventNotificationParams = {
  event: ThreadEvent
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
      notifications: [THREAD_EVENT_NOTIFICATION],
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

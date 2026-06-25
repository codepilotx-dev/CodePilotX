import type {
  ThreadEvent,
  ThreadId,
  TurnItemEvent,
} from '@codepilotx/core/agent/workflow.js'
import { deriveWorkflowSessionView } from '@codepilotx/core/agent/workflowView.js'
import { ThreadRuntime } from '../workflow/ThreadRuntime.js'
import type {
  ThreadRuntimeLifecycleResult,
  ThreadRuntimeSettings,
  ThreadRuntimeStartResult,
} from '../workflow/ThreadRuntime.js'
import type {
  JsonRpcItemInjectParams,
  JsonRpcSessionGetSnapshotParams,
  JsonRpcSessionSnapshot,
  JsonRpcThreadForkParams,
  JsonRpcThreadResumeParams,
  JsonRpcThreadStartParams,
  JsonRpcTurnInterruptParams,
  JsonRpcTurnRollbackParams,
  JsonRpcTurnStartParams,
} from './protocol.js'

export type ThreadRuntimeLike = {
  startThread(settings: ThreadRuntimeSettings): ThreadRuntimeStartResult
  resumeThread(
    threadId: ThreadId,
    settings: ThreadRuntimeSettings,
    state?: JsonRpcThreadResumeParams['state'],
  ): ThreadRuntimeLifecycleResult
  forkThread(
    sourceThreadId: ThreadId,
    options?: JsonRpcThreadForkParams['options'],
  ): ThreadRuntimeLifecycleResult
  sendTurn(
    threadId: ThreadId,
    input: JsonRpcTurnStartParams['input'],
    options?: {
      uuid?: string
      isMeta?: boolean
      turnId?: string
    },
  ): AsyncGenerator<ThreadEvent, void, unknown>
  interruptTurn(threadId: ThreadId, turnId?: string): ThreadEvent
  rollbackTurn(threadId: ThreadId, turnId: string): ThreadEvent
  injectItem(
    threadId: ThreadId,
    turnId: string,
    item: JsonRpcItemInjectParams['item'],
    type?: JsonRpcItemInjectParams['eventType'],
  ): TurnItemEvent
}

export class AppServerThreadRegistry {
  constructor(private readonly runtime: ThreadRuntimeLike = new ThreadRuntime()) {}

  private readonly eventsByThreadId = new Map<ThreadId, ThreadEvent[]>()

  startThread(params: JsonRpcThreadStartParams): ThreadRuntimeStartResult {
    const result = this.runtime.startThread({
      ...params.settings,
      ...(params.threadId ? { threadId: params.threadId } : {}),
    })
    this.recordEvent(result.event)
    return result
  }

  resumeThread(params: JsonRpcThreadResumeParams): ThreadRuntimeLifecycleResult {
    const result = this.runtime.resumeThread(
      params.threadId,
      params.settings,
      params.state,
    )
    this.recordEvent(result.event)
    return result
  }

  forkThread(params: JsonRpcThreadForkParams): ThreadRuntimeLifecycleResult {
    const result = this.runtime.forkThread(params.sourceThreadId, params.options)
    this.recordEvent(result.event)
    return result
  }

  async *startTurn(
    params: JsonRpcTurnStartParams,
  ): AsyncGenerator<ThreadEvent, void, unknown> {
    for await (const event of this.runtime.sendTurn(params.threadId, params.input, {
      ...(params.uuid === undefined ? {} : { uuid: params.uuid }),
      ...(params.isMeta === undefined ? {} : { isMeta: params.isMeta }),
      ...(params.turnId === undefined ? {} : { turnId: params.turnId }),
    })) {
      this.recordEvent(event)
      yield event
    }
  }

  interruptTurn(params: JsonRpcTurnInterruptParams): ThreadEvent {
    const event = this.runtime.interruptTurn(params.threadId, params.turnId)
    this.recordEvent(event)
    return event
  }

  rollbackTurn(params: JsonRpcTurnRollbackParams): ThreadEvent {
    const event = this.runtime.rollbackTurn(params.threadId, params.turnId)
    this.recordEvent(event)
    return event
  }

  injectItem(params: JsonRpcItemInjectParams): TurnItemEvent {
    const event = this.runtime.injectItem(
      params.threadId,
      params.turnId,
      params.item,
      params.eventType,
    )
    this.recordEvent(event)
    return event
  }

  getSessionSnapshot(
    params: JsonRpcSessionGetSnapshotParams,
  ): JsonRpcSessionSnapshot {
    const events = this.eventsByThreadId.get(params.threadId)
    if (!events) {
      throw new Error(`Unknown thread ${params.threadId}`)
    }
    return {
      threadId: params.threadId,
      eventCount: events.length,
      updatedAt: events.at(-1)?.createdAt ?? null,
      view: deriveWorkflowSessionView(events, params.threadId),
    }
  }

  private recordEvent(event: ThreadEvent): void {
    const events = this.eventsByThreadId.get(event.threadId) ?? []
    events.push(event)
    this.eventsByThreadId.set(event.threadId, events)
  }
}

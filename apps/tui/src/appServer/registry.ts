import type {
  ThreadEvent,
  ThreadId,
  TurnItemEvent,
} from '@codepilotx/core/agent/workflow.js'
import { ThreadRuntime } from '../workflow/ThreadRuntime.js'
import type {
  ThreadRuntimeLifecycleResult,
  ThreadRuntimeSettings,
  ThreadRuntimeStartResult,
} from '../workflow/ThreadRuntime.js'
import type {
  JsonRpcItemInjectParams,
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

  startThread(params: JsonRpcThreadStartParams): ThreadRuntimeStartResult {
    return this.runtime.startThread({
      ...params.settings,
      ...(params.threadId ? { threadId: params.threadId } : {}),
    })
  }

  resumeThread(params: JsonRpcThreadResumeParams): ThreadRuntimeLifecycleResult {
    return this.runtime.resumeThread(params.threadId, params.settings, params.state)
  }

  forkThread(params: JsonRpcThreadForkParams): ThreadRuntimeLifecycleResult {
    return this.runtime.forkThread(params.sourceThreadId, params.options)
  }

  async *startTurn(
    params: JsonRpcTurnStartParams,
  ): AsyncGenerator<ThreadEvent, void, unknown> {
    yield* this.runtime.sendTurn(params.threadId, params.input, {
      ...(params.uuid === undefined ? {} : { uuid: params.uuid }),
      ...(params.isMeta === undefined ? {} : { isMeta: params.isMeta }),
      ...(params.turnId === undefined ? {} : { turnId: params.turnId }),
    })
  }

  interruptTurn(params: JsonRpcTurnInterruptParams): ThreadEvent {
    return this.runtime.interruptTurn(params.threadId, params.turnId)
  }

  rollbackTurn(params: JsonRpcTurnRollbackParams): ThreadEvent {
    return this.runtime.rollbackTurn(params.threadId, params.turnId)
  }

  injectItem(params: JsonRpcItemInjectParams): TurnItemEvent {
    return this.runtime.injectItem(
      params.threadId,
      params.turnId,
      params.item,
      params.eventType,
    )
  }
}

import type {
  ThreadEvent,
  ThreadId,
  TurnItemEvent,
} from '@codepilotx/core/agent/workflow.js'
import { deriveWorkflowSessionView } from '@codepilotx/core/agent/workflowView.js'
import type { JsonRpcAppServerRegistry } from '@codepilotx/core/appServer/server.js'
import { InMemoryEventStore } from '@codepilotx/core/agent/eventStore.js'
import { EventStoreSnapshotHelper } from '@codepilotx/core/agent/snapshotHelper.js'
import type { EventStorePort } from '@codepilotx/core/agent/ports.js'
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

/**
 * AppServerThreadRegistry —— 将 TUI 的 ThreadRuntime 适配为 JsonRpcAppServerRegistry。
 *
 * v2 迁移：事件存储使用 core 的 InMemoryEventStore，快照推导使用
 * EventStoreSnapshotHelper，逐步减少 registry 内部的自维护逻辑。
 */
export class AppServerThreadRegistry implements JsonRpcAppServerRegistry {
  private readonly eventStore: EventStorePort
  private readonly snapshotHelper: EventStoreSnapshotHelper

  constructor(private readonly runtime: ThreadRuntimeLike = new ThreadRuntime()) {
    this.eventStore = new InMemoryEventStore()
    this.snapshotHelper = new EventStoreSnapshotHelper(this.eventStore)
  }

  /**
   * 注：params.settings 来自 core 协议定义的 JsonRpcThreadRuntimeSettings
   * （即 Record<string, unknown>），运行时侧期望 ThreadRuntimeSettings。
   * 此处作为适配层做窄化转换，运行时结构保持兼容。
   */
  startThread(params: JsonRpcThreadStartParams): ThreadRuntimeStartResult {
    const result = this.runtime.startThread({
      ...(params.settings as ThreadRuntimeSettings),
      ...(params.threadId ? { threadId: params.threadId } : {}),
    })
    this.recordEvent(result.event)
    return result
  }

  resumeThread(params: JsonRpcThreadResumeParams): ThreadRuntimeLifecycleResult {
    const result = this.runtime.resumeThread(
      params.threadId,
      params.settings as ThreadRuntimeSettings,
      params.state,
    )
    this.recordEvent(result.event)
    return result
  }

  forkThread(params: JsonRpcThreadForkParams): ThreadRuntimeLifecycleResult {
    const result = this.runtime.forkThread(
      params.sourceThreadId,
      params.options as ThreadRuntimeForkOptions,
    )
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
    return this.snapshotHelper.getSnapshot(params.threadId)
  }

  private recordEvent(event: ThreadEvent): void {
    this.eventStore.append(event)
  }
}

// Helper type: core JsonRpcThreadRuntimeForkOptions 的 settings 字段是
// Record<string, unknown>，但 ThreadRuntime 需要 ThreadRuntimeSettings。
// 此处用于 registry 内部适配，不暴露到协议层。
type ThreadRuntimeForkOptions = {
  threadId?: ThreadId
  settings?: ThreadRuntimeSettings
  metadata?: Record<string, unknown>
}

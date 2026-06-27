import { ResponseError } from 'vscode-jsonrpc/node'
import type { ThreadEvent, ThreadId, TurnItemEvent } from '../agent/workflow.js'
import { unsupportedCoreFeature } from '../errors/unsupported.js'
import {
  createInitializeResult,
  type JsonRpcErrorData,
  type JsonRpcInitializeResult,
  type JsonRpcItemInjectParams,
  type JsonRpcSessionGetSnapshotParams,
  type JsonRpcSessionSnapshot,
  type JsonRpcThreadForkParams,
  type JsonRpcThreadResumeParams,
  type JsonRpcThreadRuntimeState,
  type JsonRpcThreadStartParams,
  type JsonRpcThreadStartResult,
  type JsonRpcTurnInterruptParams,
  type JsonRpcTurnRollbackParams,
  type JsonRpcTurnStartParams,
  type JsonRpcTurnStartResult,
} from './protocol.js'

const UNKNOWN_THREAD_ERROR_CODE = -32004
const APP_SERVER_ERROR_CODE = -32000

type JsonRpcThreadStartedLifecycleResult = JsonRpcThreadStartResult & {
  event: ThreadEvent
}

type JsonRpcThreadLifecycleResult = {
  threadId: ThreadId
  state: JsonRpcThreadRuntimeState
  event: ThreadEvent
}

export type JsonRpcAppServerRegistry = {
  startThread(params: JsonRpcThreadStartParams): JsonRpcThreadStartedLifecycleResult
  resumeThread(params: JsonRpcThreadResumeParams): JsonRpcThreadLifecycleResult
  forkThread(params: JsonRpcThreadForkParams): JsonRpcThreadLifecycleResult
  startTurn(
    params: JsonRpcTurnStartParams,
  ): AsyncGenerator<ThreadEvent, void, unknown>
  interruptTurn(params: JsonRpcTurnInterruptParams): ThreadEvent
  rollbackTurn(params: JsonRpcTurnRollbackParams): ThreadEvent
  injectItem(params: JsonRpcItemInjectParams): TurnItemEvent
  getSessionSnapshot(
    params: JsonRpcSessionGetSnapshotParams,
  ): JsonRpcSessionSnapshot
}

export type JsonRpcAppServerOptions = {
  onThreadEvent?: (event: ThreadEvent) => void | Promise<void>
  onSessionSnapshotUpdated?: (
    snapshot: JsonRpcSessionSnapshot,
  ) => void | Promise<void>
}

export class JsonRpcAppServer {
  constructor(
    private readonly registry: JsonRpcAppServerRegistry = unsupportedRegistry(),
    private readonly options: JsonRpcAppServerOptions = {},
  ) {}

  async initialize(): Promise<JsonRpcInitializeResult> {
    return createInitializeResult()
  }

  async startThread(
    params: JsonRpcThreadStartParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(async () => {
      const result = this.registry.startThread(params)
      await this.emitThreadEvent(result.event)
      await this.emitSessionSnapshot(result.threadId)
      return threadLifecycleResult(result)
    }, { threadId: params.threadId })
  }

  async resumeThread(
    params: JsonRpcThreadResumeParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(async () => {
      const result = this.registry.resumeThread(params)
      await this.emitThreadEvent(result.event)
      await this.emitSessionSnapshot(result.state.threadId)
      return lifecycleResult(result)
    }, { threadId: params.threadId })
  }

  async forkThread(
    params: JsonRpcThreadForkParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(async () => {
      const result = this.registry.forkThread(params)
      await this.emitThreadEvent(result.event)
      await this.emitSessionSnapshot(result.state.threadId)
      return lifecycleResult(result)
    }, { threadId: params.sourceThreadId })
  }

  async startTurn(
    params: JsonRpcTurnStartParams,
  ): Promise<JsonRpcTurnStartResult> {
    return this.withJsonRpcErrors(async () => {
      let eventCount = 0
      let resolvedTurnId: string | undefined = params.turnId
      for await (const event of this.registry.startTurn(params)) {
        eventCount += 1
        if ('turnId' in event) {
          resolvedTurnId = event.turnId
        }
        await this.emitThreadEvent(event)
      }
      await this.emitSessionSnapshot(params.threadId)
      return {
        threadId: params.threadId,
        turnId: resolvedTurnId ?? params.turnId ?? '',
        eventCount,
      }
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async interruptTurn(params: JsonRpcTurnInterruptParams): Promise<ThreadEvent> {
    return this.withJsonRpcErrors(async () => {
      const event = this.registry.interruptTurn(params)
      await this.emitThreadEvent(event)
      await this.emitSessionSnapshot(event.threadId)
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async rollbackTurn(params: JsonRpcTurnRollbackParams): Promise<ThreadEvent> {
    return this.withJsonRpcErrors(async () => {
      const event = this.registry.rollbackTurn(params)
      await this.emitThreadEvent(event)
      await this.emitSessionSnapshot(event.threadId)
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async injectItem(params: JsonRpcItemInjectParams): Promise<ThreadEvent> {
    return this.withJsonRpcErrors(async () => {
      const event = this.registry.injectItem(params)
      await this.emitThreadEvent(event)
      await this.emitSessionSnapshot(event.threadId)
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async getSessionSnapshot(
    params: JsonRpcSessionGetSnapshotParams,
  ): Promise<JsonRpcSessionSnapshot> {
    return this.withJsonRpcErrors(
      () => this.registry.getSessionSnapshot(params),
      { threadId: params.threadId },
    )
  }

  private async emitThreadEvent(event: ThreadEvent): Promise<void> {
    await this.options.onThreadEvent?.(event)
  }

  private async emitSessionSnapshot(threadId: string): Promise<void> {
    const snapshot = this.registry.getSessionSnapshot({ threadId })
    await this.options.onSessionSnapshotUpdated?.(snapshot)
  }

  private async withJsonRpcErrors<T>(
    action: () => T | Promise<T>,
    context: Pick<JsonRpcErrorData, 'threadId' | 'turnId'> = {},
  ): Promise<T> {
    try {
      return await action()
    } catch (error) {
      throw toJsonRpcError(error, context)
    }
  }
}

function threadLifecycleResult(
  result: JsonRpcThreadStartResult,
): JsonRpcThreadStartResult {
  return {
    threadId: result.threadId,
    status: result.status,
    createdAt: result.createdAt,
  }
}

function lifecycleResult(
  result: JsonRpcThreadLifecycleResult,
): JsonRpcThreadStartResult {
  return threadLifecycleResult(result.state)
}

function toJsonRpcError(
  error: unknown,
  context: Pick<JsonRpcErrorData, 'threadId' | 'turnId'>,
): ResponseError<JsonRpcErrorData> {
  if (error instanceof ResponseError) return error
  const message = error instanceof Error ? error.message : String(error)
  const unknownThread = message.match(/^Unknown thread (.+)$/)
  return new ResponseError<JsonRpcErrorData>(
    unknownThread ? UNKNOWN_THREAD_ERROR_CODE : APP_SERVER_ERROR_CODE,
    message,
    {
      ...context,
      ...(unknownThread ? { threadId: unknownThread[1] } : {}),
      cause: message,
    },
  )
}

function unsupportedRegistry(): JsonRpcAppServerRegistry {
  return {
    startThread: () => unsupportedCoreFeature('appServer registry'),
    resumeThread: () => unsupportedCoreFeature('appServer registry'),
    forkThread: () => unsupportedCoreFeature('appServer registry'),
    startTurn: async function* () {
      unsupportedCoreFeature('appServer registry')
    },
    interruptTurn: () => unsupportedCoreFeature('appServer registry'),
    rollbackTurn: () => unsupportedCoreFeature('appServer registry'),
    injectItem: () => unsupportedCoreFeature('appServer registry'),
    getSessionSnapshot: () => unsupportedCoreFeature('appServer registry'),
  }
}

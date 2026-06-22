import { ResponseError } from 'vscode-jsonrpc/node'
import type { ThreadEvent, TurnId } from '@codepilotx/core/agent/workflow.js'
import type { ThreadRuntimeLifecycleResult } from '../workflow/ThreadRuntime.js'
import { AppServerThreadRegistry } from './registry.js'
import type { AppServerThreadRegistry as AppServerThreadRegistryType } from './registry.js'
import {
  createInitializeResult,
  type JsonRpcErrorData,
  type JsonRpcInitializeResult,
  type JsonRpcItemInjectParams,
  type JsonRpcThreadForkParams,
  type JsonRpcThreadResumeParams,
  type JsonRpcThreadStartParams,
  type JsonRpcThreadStartResult,
  type JsonRpcTurnInterruptParams,
  type JsonRpcTurnRollbackParams,
  type JsonRpcTurnStartParams,
  type JsonRpcTurnStartResult,
} from './protocol.js'

const UNKNOWN_THREAD_ERROR_CODE = -32004
const APP_SERVER_ERROR_CODE = -32000

export type JsonRpcAppServerOptions = {
  onThreadEvent?: (event: ThreadEvent) => void | Promise<void>
}

export class JsonRpcAppServer {
  constructor(
    private readonly registry: Pick<
      AppServerThreadRegistryType,
      | 'startThread'
      | 'resumeThread'
      | 'forkThread'
      | 'startTurn'
      | 'interruptTurn'
      | 'rollbackTurn'
      | 'injectItem'
    > = new AppServerThreadRegistry(),
    private readonly options: JsonRpcAppServerOptions = {},
  ) {}

  async initialize(): Promise<JsonRpcInitializeResult> {
    return createInitializeResult()
  }

  async startThread(
    params: JsonRpcThreadStartParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(() => {
      const result = this.registry.startThread(params)
      void this.emitThreadEvent(result.event)
      return threadLifecycleResult(result)
    }, { threadId: params.threadId })
  }

  async resumeThread(
    params: JsonRpcThreadResumeParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(() => {
      const result = this.registry.resumeThread(params)
      void this.emitThreadEvent(result.event)
      return lifecycleResult(result)
    }, { threadId: params.threadId })
  }

  async forkThread(
    params: JsonRpcThreadForkParams,
  ): Promise<JsonRpcThreadStartResult> {
    return this.withJsonRpcErrors(() => {
      const result = this.registry.forkThread(params)
      void this.emitThreadEvent(result.event)
      return lifecycleResult(result)
    }, { threadId: params.sourceThreadId })
  }

  async startTurn(
    params: JsonRpcTurnStartParams,
  ): Promise<JsonRpcTurnStartResult> {
    return this.withJsonRpcErrors(async () => {
      let eventCount = 0
      let resolvedTurnId: TurnId | undefined = params.turnId
      for await (const event of this.registry.startTurn(params)) {
        eventCount += 1
        if ('turnId' in event) {
          resolvedTurnId = event.turnId
        }
        await this.emitThreadEvent(event)
      }
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
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async rollbackTurn(params: JsonRpcTurnRollbackParams): Promise<ThreadEvent> {
    return this.withJsonRpcErrors(async () => {
      const event = this.registry.rollbackTurn(params)
      await this.emitThreadEvent(event)
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  async injectItem(params: JsonRpcItemInjectParams): Promise<ThreadEvent> {
    return this.withJsonRpcErrors(async () => {
      const event = this.registry.injectItem(params)
      await this.emitThreadEvent(event)
      return event
    }, { threadId: params.threadId, turnId: params.turnId })
  }

  private async emitThreadEvent(event: ThreadEvent): Promise<void> {
    await this.options.onThreadEvent?.(event)
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

function threadLifecycleResult(result: {
  threadId: string
  status: string
  createdAt: string
}): JsonRpcThreadStartResult {
  return {
    threadId: result.threadId,
    status: result.status,
    createdAt: result.createdAt,
  }
}

function lifecycleResult(
  result: ThreadRuntimeLifecycleResult,
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

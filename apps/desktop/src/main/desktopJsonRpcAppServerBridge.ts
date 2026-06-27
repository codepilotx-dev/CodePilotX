import {
  createThreadStartedEvent,
  createTurnStartedEvent,
  createWorkflowId,
  normalizeThreadEvent,
} from '@codepilotx/core/agent/workflow.js'
import type { ThreadEvent, ThreadId, TurnId } from '@codepilotx/core/agent/workflow.js'
import { JsonRpcAppServer } from '@codepilotx/core/appServer/server.js'
import type { JsonRpcTurnStartResult } from '@codepilotx/core/appServer/protocol.js'
import type { DesktopWorkflowEvent } from '../shared/types.js'
import type { DesktopUserMessageContent } from '../shared/types.js'

export const DESKTOP_JSON_RPC_APP_SERVER_ENV =
  'CODEPILOTX_JSON_RPC_APP_SERVER' as const

export type DesktopJsonRpcAppServerBridge = {
  startThread(threadId: ThreadId): Promise<void>
  startTurn(
    threadId: ThreadId,
    input: DesktopUserMessageContent,
    turnId?: TurnId,
  ): Promise<JsonRpcTurnStartResult>
}

export type DesktopJsonRpcAppServerBridgeOptions = {
  env?: Record<string, string | undefined>
  onWorkflowEvent(event: DesktopWorkflowEvent): void | Promise<void>
  now?: () => string
  createId?: (prefix: string, seed?: string) => string
}

export function isDesktopJsonRpcAppServerBridgeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[DESKTOP_JSON_RPC_APP_SERVER_ENV] === '1'
}

export function createDesktopJsonRpcAppServerBridge({
  createId,
  env = process.env,
  now,
  onWorkflowEvent,
}: DesktopJsonRpcAppServerBridgeOptions): DesktopJsonRpcAppServerBridge | null {
  if (!isDesktopJsonRpcAppServerBridgeEnabled(env)) {
    return null
  }

  const registry = new DesktopJsonRpcAppServerMirrorRegistry({ createId, now })
  const server = new JsonRpcAppServer(registry as never, {
    onThreadEvent: event => onWorkflowEvent(event),
  })

  return {
    async startThread(threadId) {
      await server.startThread({ threadId, settings: {} as never })
    },
    startTurn(threadId, input, turnId) {
      return server.startTurn({
        threadId,
        input,
        ...(turnId ? { turnId } : {}),
      })
    },
  }
}

class DesktopJsonRpcAppServerMirrorRegistry {
  private readonly threads = new Set<ThreadId>()
  private readonly sequences = new Map<ThreadId, number>()
  private readonly now: () => string
  private readonly createId: (prefix: string, seed?: string) => string

  constructor(options: Pick<DesktopJsonRpcAppServerBridgeOptions, 'createId' | 'now'> = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? ((prefix, seed) => createWorkflowId(prefix, seed))
  }

  startThread(params: { threadId?: ThreadId }) {
    const threadId = params.threadId ?? this.createId('thread')
    const createdAt = this.now()
    this.threads.add(threadId)
    const event = this.decorate(
      threadId,
      createThreadStartedEvent(
        threadId,
        { source: 'desktop-json-rpc-app-server', createdAt },
        () => createdAt,
      ),
    )
    return {
      threadId,
      status: 'idle',
      createdAt,
      event,
    }
  }

  resumeThread(params: { threadId: ThreadId }) {
    return this.startThread({ threadId: params.threadId })
  }

  forkThread(params: { sourceThreadId: ThreadId; options?: { threadId?: ThreadId } }) {
    this.requireThread(params.sourceThreadId)
    return this.startThread({
      threadId: params.options?.threadId ?? this.createId('thread'),
    })
  }

  async *startTurn(params: {
    threadId: ThreadId
    turnId?: TurnId
    input?: unknown
  }): AsyncGenerator<ThreadEvent, void, unknown> {
    this.requireThread(params.threadId)
    const turnId = params.turnId ?? this.createId('turn', params.threadId)
    const createdAt = this.now()
    yield this.decorate(
      params.threadId,
      createTurnStartedEvent(params.threadId, turnId, params.input, () => createdAt),
    )
    yield this.decorate(params.threadId, {
      type: 'turn.completed',
      threadId: params.threadId,
      turnId,
      createdAt,
      finalResponse: '',
      stopReason: 'desktop-json-rpc-app-server',
    })
  }

  interruptTurn(params: { threadId: ThreadId; turnId?: TurnId }): ThreadEvent {
    this.requireThread(params.threadId)
    return this.decorate(params.threadId, {
      type: 'turn.interrupted',
      threadId: params.threadId,
      turnId: params.turnId ?? this.createId('turn', params.threadId),
      createdAt: this.now(),
      reason: 'desktop-json-rpc-app-server',
    })
  }

  rollbackTurn(params: { threadId: ThreadId; turnId: TurnId }): ThreadEvent {
    return this.interruptTurn(params)
  }

  injectItem(): never {
    throw new Error('Desktop JSON-RPC app-server bridge does not inject items')
  }

  private requireThread(threadId: ThreadId): void {
    if (!this.threads.has(threadId)) {
      throw new Error(`Unknown thread ${threadId}`)
    }
  }

  private decorate(threadId: ThreadId, event: ThreadEvent): ThreadEvent {
    const sequence = (this.sequences.get(threadId) ?? 0) + 1
    this.sequences.set(threadId, sequence)
    return normalizeThreadEvent(event, {
      sequence,
      eventId: this.createId('workflow-event', `${threadId}-${sequence}`),
    })
  }
}

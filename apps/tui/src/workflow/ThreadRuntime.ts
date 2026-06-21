import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import type {
  ThreadEvent,
  ThreadId,
  TurnId,
  TurnStatus,
} from '@codepilotx/core/agent/workflow.js'
import {
  createThreadStartedEvent,
  createTurnStartedEvent,
  createWorkflowId,
  normalizeThreadEvent,
} from '@codepilotx/core/agent/workflow.js'
import { QueryEngine, type QueryEngineConfig } from '../QueryEngine.js'
import { sdkMessageToThreadEvents } from './sdkEventMapping.js'

export type ThreadRuntimeSettings = QueryEngineConfig & {
  threadId?: ThreadId
}

export type ThreadRuntimeStartResult = {
  threadId: ThreadId
  status: TurnStatus
  createdAt: string
}

export type ThreadRuntimeTurnOptions = {
  uuid?: string
  isMeta?: boolean
  turnId?: TurnId
}

export type ThreadRuntimeState = {
  threadId: ThreadId
  status: TurnStatus
  createdAt: string
  currentTurnId?: TurnId
}

type ThreadRecord = ThreadRuntimeState & {
  engine: QueryEngine
  startedEventEmitted: boolean
  nextSequence: number
}

export class ThreadRuntime {
  private readonly threads = new Map<ThreadId, ThreadRecord>()

  constructor(
    private readonly createId: (prefix: string) => string = prefix =>
      createWorkflowId(prefix, randomUUID()),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  startThread(settings: ThreadRuntimeSettings): ThreadRuntimeStartResult {
    const threadId = settings.threadId ?? this.createId('thread')
    const createdAt = this.now()
    const engine = new QueryEngine(settings)
    this.threads.set(threadId, {
      threadId,
      status: 'idle',
      createdAt,
      engine,
      startedEventEmitted: false,
      nextSequence: 0,
    })
    return { threadId, status: 'idle', createdAt }
  }

  async *sendTurn(
    threadId: ThreadId,
    input: string | ContentBlockParam[],
    options: ThreadRuntimeTurnOptions = {},
  ): AsyncGenerator<ThreadEvent, void, unknown> {
    const record = this.requireThread(threadId)
    const turnId = options.turnId ?? this.createId('turn')
    record.status = 'running'
    record.currentTurnId = turnId

    if (!record.startedEventEmitted) {
      record.startedEventEmitted = true
      yield this.decorateEvent(
        record,
        createThreadStartedEvent(
          threadId,
          { createdAt: record.createdAt },
          this.now,
        ),
      )
    }
    yield this.decorateEvent(
      record,
      createTurnStartedEvent(threadId, turnId, input, this.now),
    )

    try {
      for await (const sdkMessage of record.engine.submitMessage(input, {
        ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
        ...(options.isMeta === undefined ? {} : { isMeta: options.isMeta }),
      })) {
        const events = sdkMessageToThreadEvents(sdkMessage, {
          threadId,
          turnId,
          now: this.now,
          sequence: () => this.nextSequence(record),
          itemId: (kind, seed) =>
            this.createId(seed ? `${kind}-${seed}` : String(kind)),
        })
        for (const event of events) {
          if (event.type === 'turn.completed') {
            record.status = 'completed'
            record.currentTurnId = undefined
          } else if (event.type === 'turn.failed') {
            record.status = 'failed'
            record.currentTurnId = undefined
          }
          yield event
        }
      }
    } catch (error) {
      record.status = 'failed'
      record.currentTurnId = undefined
      yield this.decorateEvent(record, {
        type: 'turn.failed',
        threadId,
        turnId,
        createdAt: this.now(),
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  interruptTurn(threadId: ThreadId, turnId?: TurnId): ThreadEvent {
    const record = this.requireThread(threadId)
    if (turnId && record.currentTurnId && record.currentTurnId !== turnId) {
      throw new Error(`Turn ${turnId} is not active for thread ${threadId}`)
    }
    record.engine.interrupt()
    const interruptedTurnId = record.currentTurnId ?? turnId ?? this.createId('turn')
    record.status = 'interrupted'
    record.currentTurnId = undefined
    return this.decorateEvent(record, {
      type: 'turn.interrupted',
      threadId,
      turnId: interruptedTurnId,
      createdAt: this.now(),
      reason: 'interruptTurn',
    })
  }

  getThreadState(threadId: ThreadId): ThreadRuntimeState {
    const {
      engine: _engine,
      startedEventEmitted: _startedEventEmitted,
      ...state
    } = this.requireThread(threadId)
    return state
  }

  private requireThread(threadId: ThreadId): ThreadRecord {
    const record = this.threads.get(threadId)
    if (!record) {
      throw new Error(`Unknown thread ${threadId}`)
    }
    return record
  }

  private decorateEvent(record: ThreadRecord, event: ThreadEvent): ThreadEvent {
    const sequence = this.nextSequence(record)
    return normalizeThreadEvent(event, {
      sequence,
      eventId: this.createId(`event-${record.threadId}-${sequence}`),
    })
  }

  private nextSequence(record: ThreadRecord): number {
    record.nextSequence += 1
    return record.nextSequence
  }
}

import {
  agentRuntimeEventToThreadEvents,
  createPermissionRequestDecisionEvent,
  createThreadStartedEvent,
  createWorkflowId,
  normalizeThreadEvent,
} from '@codepilotx/core/agent/workflow.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopWorkflowEvent,
} from '../shared/types.js'

export type DesktopWorkflowProjectorOptions = {
  now?: () => string
  createId?: (prefix: string, seed?: string) => string
}

export class DesktopWorkflowProjector {
  private readonly workflowThreads = new Set<string>()
  private readonly workflowTurns = new Map<string, string>()
  private readonly workflowSequences = new Map<string, number>()
  private readonly workflowToolUseIds = new Map<string, string[]>()
  private readonly workflowToolCounters = new Map<string, number>()
  private readonly now: () => string
  private readonly createId: (prefix: string, seed?: string) => string

  constructor(options: DesktopWorkflowProjectorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId =
      options.createId ?? ((prefix, seed) => createWorkflowId(prefix, seed))
  }

  project(event: DesktopAgentEvent): DesktopWorkflowEvent[] {
    const createdAt = this.now()
    const threadId = threadIdForAgentEvent(event)
    const events: DesktopWorkflowEvent[] = []

    if (!this.workflowThreads.has(threadId)) {
      this.workflowThreads.add(threadId)
      events.push(
        createThreadStartedEvent(
          threadId,
          { sessionId: event.sessionId, source: 'desktop-runtime' },
          () => createdAt,
        ),
      )
    }

    if (event.type === 'status') {
      if (event.status !== 'running') {
        return this.decorateEvents(threadId, events)
      }
      if (this.workflowTurns.has(event.sessionId)) {
        return this.decorateEvents(threadId, events)
      }
      const turnId = this.createTurn(event.sessionId)
      events.push(turnStartedEvent(threadId, turnId, createdAt))
      return this.decorateEvents(threadId, events)
    }

    if (event.type === 'message' && event.role === 'system') {
      return this.decorateEvents(threadId, events)
    }

    if (event.type === 'context_usage' || event.type === 'session_title') {
      return this.decorateEvents(threadId, events)
    }

    const turnId = this.workflowTurns.get(event.sessionId)
    const activeTurnId = turnId ?? this.createTurn(event.sessionId)
    if (!turnId) {
      events.push(turnStartedEvent(threadId, activeTurnId, createdAt))
    }

    const projectedEvents = agentRuntimeEventToThreadEvents(event, {
        threadId,
        turnId: activeTurnId,
        now: () => createdAt,
        itemId: (kind, seed) => this.createId(String(kind), seed),
      }).map(workflowEvent =>
        this.reconcileToolUseId(event, workflowEvent, activeTurnId),
      )
    events.push(
      ...projectedEvents,
    )

    if (event.type === 'done' || event.type === 'error') {
      this.cleanupTurn(event.sessionId, activeTurnId)
    }

    return this.decorateEvents(threadId, events)
  }

  projectPermissionDecision(
    sessionId: string,
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): DesktopWorkflowEvent[] {
    const createdAt = this.now()
    const threadId = sessionId
    if (!this.workflowThreads.has(threadId)) {
      this.workflowThreads.add(threadId)
    }
    const turnId = this.workflowTurns.get(sessionId) ?? this.createTurn(sessionId)
    const behavior = decision.behavior === 'allow' ? 'allow' : 'deny'
    return [
      createPermissionRequestDecisionEvent({
        threadId,
        turnId,
        request,
        behavior,
        createdAt,
      }),
    ].map(event => this.decorateEvent(threadId, event))
  }

  private createTurn(sessionId: string): string {
    const turnId = this.createId('turn')
    this.workflowTurns.set(sessionId, turnId)
    return turnId
  }

  private reconcileToolUseId(
    sourceEvent: DesktopAgentEvent,
    workflowEvent: DesktopWorkflowEvent,
    turnId: string,
  ): DesktopWorkflowEvent {
    if (
      !('item' in workflowEvent) ||
      (workflowEvent.item.type !== 'tool_call' &&
        workflowEvent.item.type !== 'tool_result')
    ) {
      return workflowEvent
    }
    if (sourceEvent.type !== 'tool_start' && sourceEvent.type !== 'tool_result') {
      return workflowEvent
    }
    const key = toolQueueKey(sourceEvent.sessionId, sourceEvent.toolName)
    const toolUseId =
      sourceEvent.type === 'tool_start'
        ? this.pushToolUseId(key, sourceEvent, turnId)
        : this.shiftToolUseId(key) ??
          this.createId(
            'tool-use',
            toolUseSeed(
              turnId,
              sourceEvent.toolName,
              this.nextToolOccurrence(
                sourceEvent.sessionId,
                turnId,
                sourceEvent.toolName,
              ),
            ),
          )
    return {
      ...workflowEvent,
      item: {
        ...workflowEvent.item,
        id: this.createId(workflowEvent.item.type, toolUseId),
        toolUseId,
        metadata: {
          ...(workflowEvent.item.metadata ?? {}),
          toolUseId,
        },
      },
    }
  }

  private pushToolUseId(
    key: string,
    event: Extract<DesktopAgentEvent, { type: 'tool_start' }>,
    turnId: string,
  ): string {
    const toolUseId = this.createId(
      'tool-use',
      toolUseSeed(
        turnId,
        event.toolName,
        this.nextToolOccurrence(event.sessionId, turnId, event.toolName),
      ),
    )
    const queue = this.workflowToolUseIds.get(key) ?? []
    this.workflowToolUseIds.set(key, [...queue, toolUseId])
    return toolUseId
  }

  private shiftToolUseId(key: string): string | undefined {
    const queue = this.workflowToolUseIds.get(key)
    const toolUseId = queue?.[0]
    if (!queue || queue.length <= 1) {
      this.workflowToolUseIds.delete(key)
    } else {
      this.workflowToolUseIds.set(key, queue.slice(1))
    }
    return toolUseId
  }

  private nextToolOccurrence(
    sessionId: string,
    turnId: string,
    toolName: string,
  ): number {
    const key = toolCounterKey(sessionId, turnId, toolName)
    const next = (this.workflowToolCounters.get(key) ?? 0) + 1
    this.workflowToolCounters.set(key, next)
    return next
  }

  private cleanupTurn(sessionId: string, turnId: string): void {
    this.workflowTurns.delete(sessionId)
    for (const key of this.workflowToolUseIds.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.workflowToolUseIds.delete(key)
      }
    }
    for (const key of this.workflowToolCounters.keys()) {
      if (key.startsWith(`${sessionId}:${turnId}:`)) {
        this.workflowToolCounters.delete(key)
      }
    }
  }

  private decorateEvent(
    threadId: string,
    event: DesktopWorkflowEvent,
  ): DesktopWorkflowEvent {
    const sequence = (this.workflowSequences.get(threadId) ?? 0) + 1
    this.workflowSequences.set(threadId, sequence)
    return normalizeThreadEvent(event, {
      sequence,
      eventId: this.createId('workflow-event', `${threadId}-${sequence}`),
    })
  }

  private decorateEvents(
    threadId: string,
    events: DesktopWorkflowEvent[],
  ): DesktopWorkflowEvent[] {
    return events.map(event => this.decorateEvent(threadId, event))
  }
}

function threadIdForAgentEvent(event: DesktopAgentEvent): string {
  return 'sourceThreadId' in event && event.sourceThreadId
    ? event.sourceThreadId
    : event.sessionId
}

function toolQueueKey(sessionId: string, toolName: string): string {
  return `${sessionId}:${toolName}`
}

function toolCounterKey(
  sessionId: string,
  turnId: string,
  toolName: string,
): string {
  return `${sessionId}:${turnId}:${toolName}`
}

function toolUseSeed(
  turnId: string,
  toolName: string,
  occurrence: number,
): string {
  return `${turnId}-${toolName}-${occurrence}`
}

function turnStartedEvent(
  threadId: string,
  turnId: string,
  createdAt: string,
): DesktopWorkflowEvent {
  return {
    type: 'turn.started',
    threadId,
    turnId,
    createdAt,
  }
}

import { deriveWorkflowSessionState } from '../../../shared/workflowReducer.js'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import type { SessionViewState } from '../../uiTypes.js'
import { dedupeWorkflowEvents } from './workflowEventDedup.js'

export type WorkflowFinalResponseMismatch = {
  workflow: string
  transcript: string
}

export type WorkflowMissingTurnCompletion = {
  turnId: string
  lastEventType: string
  lastEventCreatedAt: string
  likelyStillRunning: boolean
}

export type WorkflowConsistencyDiagnostics = {
  missingTurnCompletions: string[]
  missingTurnCompletionDetails: WorkflowMissingTurnCompletion[]
  unpairedToolCalls: string[]
  unpairedToolResults: string[]
  pendingPermissionRequests: string[]
  finalResponseMismatches: WorkflowFinalResponseMismatch[]
  mixedThreadIds: string[]
}

export function deriveWorkflowConsistencyDiagnostics({
  activeSessionId,
  currentView,
  workflowEvents,
}: {
  activeSessionId: string | null
  currentView: Pick<SessionViewState, 'messages'>
  workflowEvents: DesktopWorkflowEvent[]
}): WorkflowConsistencyDiagnostics {
  const uniqueEvents = dedupeWorkflowEvents(workflowEvents)
  const scopedEvents = activeSessionId
    ? uniqueEvents.filter(event => event.threadId === activeSessionId)
    : uniqueEvents
  const mixedThreadIds = activeSessionId
    ? uniqueEvents
        .filter(event => event.threadId !== activeSessionId)
        .map(event => event.threadId)
        .filter(uniqueString)
    : []
  const derived = deriveWorkflowSessionState(scopedEvents, activeSessionId)

  return {
    missingTurnCompletions: findMissingTurnCompletions(scopedEvents),
    missingTurnCompletionDetails: findMissingTurnCompletionDetails(scopedEvents),
    unpairedToolCalls: findUnpairedToolCalls(scopedEvents),
    unpairedToolResults: findUnpairedToolResults(scopedEvents),
    pendingPermissionRequests: derived.pendingPermissions
      .map(request => request.requestId)
      .filter(uniqueString),
    finalResponseMismatches: findFinalResponseMismatches(
      scopedEvents,
      currentView.messages,
    ),
    mixedThreadIds,
  }
}

export function workflowConsistencyIssueCount(
  diagnostics: WorkflowConsistencyDiagnostics,
): number {
  return (
    diagnostics.missingTurnCompletions.length +
    diagnostics.unpairedToolCalls.length +
    diagnostics.unpairedToolResults.length +
    diagnostics.pendingPermissionRequests.length +
    diagnostics.finalResponseMismatches.length +
    diagnostics.mixedThreadIds.length
  )
}

function findMissingTurnCompletions(
  events: DesktopWorkflowEvent[],
): string[] {
  const started = new Set<string>()
  const terminal = new Set<string>()

  for (const event of events) {
    if (!('turnId' in event)) continue
    if (event.type === 'turn.started') started.add(event.turnId)
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.interrupted'
    ) {
      terminal.add(event.turnId)
    }
  }

  return [...started].filter(turnId => !terminal.has(turnId))
}

function findMissingTurnCompletionDetails(
  events: DesktopWorkflowEvent[],
): WorkflowMissingTurnCompletion[] {
  const missing = new Set(findMissingTurnCompletions(events))
  return [...missing].map(turnId => {
    const turnEvents = events.filter(
      event => 'turnId' in event && event.turnId === turnId,
    )
    const lastEvent = turnEvents[turnEvents.length - 1]
    return {
      turnId,
      lastEventType: lastEvent?.type ?? 'unknown',
      lastEventCreatedAt: lastEvent?.createdAt ?? '',
      likelyStillRunning: Boolean(lastEvent),
    }
  })
}

function findUnpairedToolCalls(events: DesktopWorkflowEvent[]): string[] {
  const calls = new Set<string>()
  const results = new Set<string>()

  for (const event of events) {
    if (!('item' in event)) continue
    if (event.item.type === 'tool_call') {
      calls.add(event.item.toolUseId ?? event.item.id)
    }
    if (event.item.type === 'tool_result') {
      results.add(event.item.toolUseId ?? event.item.id)
    }
  }

  return [...calls].filter(toolUseId => !results.has(toolUseId))
}

function findUnpairedToolResults(events: DesktopWorkflowEvent[]): string[] {
  const calls = new Set<string>()
  const results = new Set<string>()

  for (const event of events) {
    if (!('item' in event)) continue
    if (event.item.type === 'tool_call') {
      calls.add(event.item.toolUseId ?? event.item.id)
    }
    if (event.item.type === 'tool_result') {
      results.add(event.item.toolUseId ?? event.item.id)
    }
  }

  return [...results].filter(toolUseId => !calls.has(toolUseId))
}

function findFinalResponseMismatches(
  events: DesktopWorkflowEvent[],
  messages: SessionViewState['messages'],
): WorkflowFinalResponseMismatch[] {
  const workflowFinal = lastWorkflowFinalResponse(events)
  const transcriptFinal = lastAssistantMessage(messages)
  if (!workflowFinal || !transcriptFinal) return []
  return normalizeText(workflowFinal) === normalizeText(transcriptFinal)
    ? []
    : [{ workflow: workflowFinal, transcript: transcriptFinal }]
}

function lastWorkflowFinalResponse(
  events: DesktopWorkflowEvent[],
): string | null {
  for (const event of [...events].reverse()) {
    if (event.type === 'turn.completed' && event.finalResponse.trim()) {
      return event.finalResponse
    }
  }
  return null
}

function lastAssistantMessage(
  messages: SessionViewState['messages'],
): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant' && message.text.trim()) {
      return message.text
    }
  }
  return null
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniqueString(
  value: string,
  index: number,
  array: string[],
): boolean {
  return array.indexOf(value) === index
}

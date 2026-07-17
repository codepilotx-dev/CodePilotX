import { useEffect, useMemo, useState } from 'react'
import { deriveWorkflowSessionState } from '../../../shared/workflowReducer.js'
import type {
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../../../shared/types.js'
import type { Message } from '../../uiTypes.js'
import {
  deriveAssistantActionMessageIds,
  deriveConversationTurnNavItems,
  deriveTimelineSourceEvents,
  foldTimelineEvents,
  groupTimelineExecutionPhases,
  groupTimelineToolEvents,
} from './timelineModel.js'

type Options = {
  activeSessionId: string | null
  conversationMessages: Message[]
  debugMode: boolean
  events: DesktopSessionEvent[]
  pendingPermissions: DesktopPermissionRequest[]
  sessionStatus: DesktopSessionStatus
  workflowEvents: DesktopSessionEvent[]
}

export function useConversationController({
  activeSessionId,
  conversationMessages,
  debugMode,
  events,
  pendingPermissions,
  sessionStatus,
  workflowEvents,
}: Options) {
  const workflowDerivedState = useMemo(
    () => deriveWorkflowSessionState(workflowEvents, activeSessionId),
    [activeSessionId, workflowEvents],
  )
  const [debugPlanCardSummary, setDebugPlanCardSummary] =
    useState<string | null>(null)
  const [debugAskUserQuestionRequest, setDebugAskUserQuestionRequest] =
    useState<DesktopPermissionRequest | null>(null)

  useEffect(() => {
    if (!debugMode || pendingPermissions.length > 0) {
      setDebugAskUserQuestionRequest(null)
    }
    if (!debugMode) setDebugPlanCardSummary(null)
  }, [debugMode, pendingPermissions.length])

  const timelineEvents = useMemo(() => {
    const sourceEvents = deriveTimelineSourceEvents({
      conversationMessages,
      events,
      sessionStatus,
      workflowEvents: workflowDerivedState.events,
    })
    const folded = foldTimelineEvents(sourceEvents)
    if (!debugPlanCardSummary) return folded
    const hasRealPlan = folded.some(event => event.type === 'proposed_plan')
    if (hasRealPlan) return folded
    return [
      ...folded,
      {
        id: 'debug-plan-card',
        sessionId: activeSessionId ?? 'debug',
        type: 'proposed_plan' as const,
        role: 'assistant' as const,
        content: debugPlanCardSummary,
        createdAt: new Date().toISOString(),
        metadata: {},
      },
    ]
  }, [
    activeSessionId,
    conversationMessages,
    debugPlanCardSummary,
    events,
    sessionStatus,
    workflowDerivedState.events,
  ])
  const timelineItems = useMemo(
    () => groupTimelineToolEvents(timelineEvents),
    [timelineEvents],
  )
  const phaseItems = useMemo(
    () => groupTimelineExecutionPhases(timelineItems, sessionStatus),
    [sessionStatus, timelineItems],
  )
  const turnNavItems = useMemo(
    () => deriveConversationTurnNavItems(phaseItems),
    [phaseItems],
  )
  const assistantActionMessageIds = useMemo(
    () => deriveAssistantActionMessageIds({ sessionStatus, timelineEvents }),
    [sessionStatus, timelineEvents],
  )
  const showThinking = deriveWorkflowThinkingVisible({
    pendingPermissions,
    sessionStatus,
    timelineEvents,
  })

  return {
    assistantActionMessageIds,
    debugAskUserQuestionRequest,
    debugPlanCardSummary,
    phaseItems,
    setDebugAskUserQuestionRequest,
    setDebugPlanCardSummary,
    showThinking,
    timelineEvents,
    timelineItems,
    turnNavItems,
    workflowDerivedState,
  }
}

function deriveWorkflowThinkingVisible({
  pendingPermissions,
  sessionStatus,
  timelineEvents,
}: {
  pendingPermissions: DesktopPermissionRequest[]
  sessionStatus: DesktopSessionStatus
  timelineEvents: DesktopSessionEvent[]
}): boolean {
  if (sessionStatus !== 'running' && sessionStatus !== 'waiting') return false
  if (pendingPermissions.length > 0) return false

  const lastUserMessageIndex = findLastIndex(
    timelineEvents,
    event =>
      event.type === 'message' &&
      event.role === 'user' &&
      Boolean(event.content?.trim()),
  )
  if (lastUserMessageIndex === -1) return false

  for (const event of timelineEvents.slice(lastUserMessageIndex + 1)) {
    const type = event.type as string
    if (
      type === 'checkpoint' ||
      type === 'error' ||
      type === 'turn.interrupted'
    ) {
      return false
    }
    if (
      (event.type === 'message' || event.type === 'assistant_delta') &&
      event.role === 'assistant' &&
      Boolean(event.content?.trim())
    ) {
      return false
    }
  }
  return true
}

function findLastIndex<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index
  }
  return -1
}

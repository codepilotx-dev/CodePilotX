import { useEffect, useMemo, useState } from 'react'
import { deriveWorkflowSessionState } from '../../../../shared/workflowReducer.js'
import type {
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../../../../shared/types.js'
import type { Message } from '../../../uiTypes.js'
import {
  deriveTimelineSourceEvents,
  foldTimelineEvents,
} from '../timeline/timelineModel.js'

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
  return {
    debugAskUserQuestionRequest,
    debugPlanCardSummary,
    setDebugAskUserQuestionRequest,
    setDebugPlanCardSummary,
    timelineEvents,
    workflowDerivedState,
  }
}

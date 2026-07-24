import type {
  AgentPermissionRequest,
  AgentSessionEvent,
  AgentSessionMessage,
  AgentSessionStatus,
} from './runtime.js'
import type { ThreadEvent } from './workflow.js'

export type WorkflowToolRun = {
  id: string
  toolUseId: string
  toolName: string
  callContent: string
  resultContent: string
  callCreatedAt?: string
  resultCreatedAt?: string
  isError: boolean
  isRunning: boolean
}

export type WorkflowSessionViewDiagnostics = {
  duplicateEventIds: string[]
  missingToolResults: string[]
  outOfOrderSequences: Array<{ previous: number; current: number }>
}

export type WorkflowSessionView = {
  messages: AgentSessionMessage[]
  events: AgentSessionEvent[]
  toolRuns: WorkflowToolRun[]
  pendingPermissions: AgentPermissionRequest[]
  completedPermissionRequestIds: Set<string>
  turnStatus: AgentSessionStatus
  diagnostics: WorkflowSessionViewDiagnostics
}

export function deriveWorkflowSessionView(
  workflowEvents: ThreadEvent[],
  threadId?: string | null,
): WorkflowSessionView {
  const events = workflowEvents
    .filter(event => !threadId || event.threadId === threadId)
    .map((event, index): AgentSessionEvent => ({
      id: event.eventId ?? `workflow-${index}`,
      sessionId: event.threadId,
      type: event.type,
      content: event.type,
      createdAt: event.createdAt,
      metadata: { item: event.item },
    }))

  return {
    messages: [],
    events,
    toolRuns: [],
    pendingPermissions: [],
    completedPermissionRequestIds: new Set(),
    turnStatus: 'idle',
    diagnostics: {
      duplicateEventIds: [],
      missingToolResults: [],
      outOfOrderSequences: [],
    },
  }
}

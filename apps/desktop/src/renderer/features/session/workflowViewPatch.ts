import { deriveWorkflowSessionState } from '../../../shared/workflowReducer.js'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import type { SessionViewState, ToolLogEntry } from '../../uiTypes.js'
import { dedupeWorkflowEvents } from './workflowEventDedup.js'

export type WorkflowViewPatch = Pick<
  SessionViewState,
  'workflowEvents' | 'pendingPermissions' | 'toolLog'
>

export function deriveWorkflowViewPatch(
  workflowEvents: DesktopWorkflowEvent[],
  currentView: SessionViewState,
  threadId?: string | null,
): WorkflowViewPatch {
  const uniqueWorkflowEvents = dedupeWorkflowEvents(workflowEvents)
  const derived = deriveWorkflowSessionState(uniqueWorkflowEvents, threadId)
  const hasPermissionEvents = uniqueWorkflowEvents.some(
    event =>
      isThreadEvent(event, threadId) &&
      'item' in event &&
      event.item.type === 'permission_request',
  )
  const hasToolEvents = uniqueWorkflowEvents.some(
    event =>
      isThreadEvent(event, threadId) &&
      'item' in event &&
      (event.item.type === 'tool_call' || event.item.type === 'tool_result'),
  )

  return {
    workflowEvents: uniqueWorkflowEvents,
    pendingPermissions: hasPermissionEvents
      ? derived.pendingPermissions
      : currentView.pendingPermissions,
    toolLog: hasToolEvents
      ? workflowToolRunsToToolLog(derived.toolRuns, currentView.toolLog)
      : currentView.toolLog,
  }
}

function workflowToolRunsToToolLog(
  toolRuns: ReturnType<typeof deriveWorkflowSessionState>['toolRuns'],
  currentToolLog: ToolLogEntry[],
): ToolLogEntry[] {
  const expandedById = new Map(
    currentToolLog.map(entry => [entry.id, entry.expanded] as const),
  )
  const chronologicalEntries: ToolLogEntry[] = []

  for (const run of toolRuns) {
    if (run.callContent) {
      const id = workflowToolLogId('start', run.toolUseId)
      chronologicalEntries.push({
        id,
        toolName: run.toolName,
        summary: run.callContent,
        kind: 'start',
        expanded: expandedById.get(id) ?? false,
        createdAt: formatToolLogTime(run.callCreatedAt),
      })
    }
    if (run.resultContent) {
      const id = workflowToolLogId('result', run.toolUseId)
      chronologicalEntries.push({
        id,
        toolName: run.toolName,
        summary: run.resultContent,
        kind: 'result',
        isError: run.isError,
        expanded: expandedById.get(id) ?? run.isError,
        createdAt: formatToolLogTime(run.resultCreatedAt ?? run.callCreatedAt),
      })
    }
  }

  return chronologicalEntries.reverse()
}

function workflowToolLogId(kind: 'start' | 'result', toolUseId: string): string {
  return `workflow-tool-${kind}-${toolUseId}`
}

function formatToolLogTime(value: string | undefined): string {
  if (!value) return new Date().toLocaleTimeString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function isThreadEvent(
  event: DesktopWorkflowEvent,
  threadId: string | null | undefined,
): boolean {
  return !threadId || event.threadId === threadId
}

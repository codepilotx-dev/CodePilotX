import { expect, test } from 'bun:test'
import { createPermissionRequestDecisionEvent } from '@codepilotx/core/agent/workflow.js'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import type { SessionViewState, ToolLogEntry } from '../../uiTypes.js'
import { deriveWorkflowViewPatch } from './workflowViewPatch.js'

const base = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  createdAt: '2026-06-22T00:00:00.000Z',
} as const

test('workflow tool events replace legacy tool log with stable entries', () => {
  const currentView = emptyView({
    toolLog: [
      {
        id: 'workflow-tool-result-tool-a',
        toolName: 'Read',
        summary: 'old result',
        kind: 'result',
        expanded: true,
        createdAt: 'old',
      },
      legacyToolLog(),
    ],
  })
  const patch = deriveWorkflowViewPatch(
    [
      toolCall('e1', 1, 'tool-a', 'Read', 'read a.ts'),
      toolResult('e2', 2, 'tool-a', 'Read', 'a ok'),
    ],
    currentView,
    'thread-1',
  )

  expect(patch.toolLog.map(entry => entry.id)).toEqual([
    'workflow-tool-result-tool-a',
    'workflow-tool-start-tool-a',
  ])
  expect(patch.toolLog).toMatchObject([
    {
      toolName: 'Read',
      summary: 'a ok',
      kind: 'result',
      expanded: true,
    },
    {
      toolName: 'Read',
      summary: 'read a.ts',
      kind: 'start',
      expanded: false,
    },
  ])
})

test('workflow view patch preserves legacy tool log when no workflow tool events exist', () => {
  const legacy = legacyToolLog()
  const patch = deriveWorkflowViewPatch(
    [
      {
        eventId: 'e1',
        sequence: 1,
        type: 'turn.started',
        ...base,
      },
    ],
    emptyView({ toolLog: [legacy] }),
    'thread-1',
  )

  expect(patch.toolLog).toEqual([legacy])
})

test('workflow error tool results default expanded', () => {
  const patch = deriveWorkflowViewPatch(
    [
      toolCall('e1', 1, 'tool-a', 'Bash', 'bun test'),
      toolResult('e2', 2, 'tool-a', 'Bash', 'failed', true),
    ],
    emptyView(),
    'thread-1',
  )

  expect(patch.toolLog[0]).toMatchObject({
    id: 'workflow-tool-result-tool-a',
    kind: 'result',
    isError: true,
    expanded: true,
  })
})

test('workflow permission events replace pending permissions and close on decision', () => {
  const request = {
    requestId: 'permission-1',
    toolName: 'Edit',
    input: { file_path: 'a.ts' },
    description: 'Edit a.ts',
  }
  const started: DesktopWorkflowEvent = {
    eventId: 'e1',
    sequence: 1,
    type: 'item.started',
    ...base,
    item: {
      id: 'permission_request-permission-1',
      type: 'permission_request',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      request,
    },
  }
  const denied = createPermissionRequestDecisionEvent({
    ...base,
    request,
    behavior: 'deny',
    sequence: 2,
    eventId: 'e2',
  })

  const pendingPatch = deriveWorkflowViewPatch(
    [started],
    emptyView({ pendingPermissions: [] }),
    'thread-1',
  )
  const closedPatch = deriveWorkflowViewPatch(
    [started, denied],
    emptyView({ pendingPermissions: [request] }),
    'thread-1',
  )

  expect(pendingPatch.pendingPermissions).toEqual([request])
  expect(closedPatch.pendingPermissions).toEqual([])
})

function emptyView(
  patch: Partial<SessionViewState> = {},
): SessionViewState {
  return {
    events: [],
    workflowEvents: [],
    messages: [],
    toolLog: [],
    pendingPermissions: [],
    contextUsage: null,
    selectedFile: null,
    ...patch,
  }
}

function legacyToolLog(): ToolLogEntry {
  return {
    id: 'legacy-tool-log',
    toolName: 'Read',
    summary: 'legacy',
    kind: 'start',
    expanded: false,
    createdAt: 'old',
  }
}

function toolCall(
  eventId: string,
  sequence: number,
  toolUseId: string,
  toolName: string,
  summary: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.started',
    ...base,
    item: {
      id: `tool_call-${toolUseId}`,
      type: 'tool_call',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      toolName,
      toolUseId,
      summary,
    },
  }
}

function toolResult(
  eventId: string,
  sequence: number,
  toolUseId: string,
  toolName: string,
  summary: string,
  isError = false,
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.completed',
    ...base,
    item: {
      id: `tool_result-${toolUseId}`,
      type: 'tool_result',
      status: isError ? 'failed' : 'completed',
      createdAt: base.createdAt,
      ...base,
      toolName,
      toolUseId,
      summary,
      isError,
    },
  }
}

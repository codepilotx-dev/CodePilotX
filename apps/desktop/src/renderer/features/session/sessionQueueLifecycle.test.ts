import { expect, mock, test } from 'bun:test'
import type { DesktopQueuedFollowUp } from '../../../shared/types.js'
import { closeSessionAction, updateSessionMetadataAction } from './sessionActions.js'
import { createSessionQueueLifecycleController } from './sessionQueueLifecycle.js'
import { desktopClient } from '../../services/desktopClient.js'
import type { SessionActionContext } from './sessionActions.js'
import type { SessionListItem } from '../../uiTypes.js'

test('closing or archiving the active session deletes its queue and displays the next session queue', async () => {
  const originalDisposeSession = desktopClient.disposeSession
  const originalUpdateSessionMetadata = desktopClient.updateSessionMetadata
  const queues: Record<string, DesktopQueuedFollowUp[]> = {
    'session-1': [followUp('follow-up-1')],
    'session-2': [followUp('follow-up-2')],
  }
  const displayed: DesktopQueuedFollowUp[][] = []
  const lifecycle = createSessionQueueLifecycleController(
    { current: queues },
    value => displayed.push(value),
  )
  const context = actionContext(lifecycle.removeSession)

  desktopClient.disposeSession = mock(async () => {})
  await closeSessionAction(context, [item('session-1'), item('session-2')], 'session-1')

  expect(queues).toEqual({ 'session-2': [followUp('follow-up-2')] })
  expect(displayed.at(-1)).toEqual([followUp('follow-up-2')])

  const archivedQueues: Record<string, DesktopQueuedFollowUp[]> = {
    'session-1': [followUp('follow-up-1')],
    'session-2': [followUp('follow-up-2')],
  }
  const archivedDisplayed: DesktopQueuedFollowUp[][] = []
  const archivedLifecycle = createSessionQueueLifecycleController(
    { current: archivedQueues },
    value => archivedDisplayed.push(value),
  )
  desktopClient.updateSessionMetadata = mock(async () => ({
    item: { ...item('session-1'), archivedAt: '2026-01-02T00:00:00.000Z' },
  })) as never
  await updateSessionMetadataAction(
    actionContext(archivedLifecycle.removeSession),
    [item('session-1'), item('session-2')],
    'session-1',
    { archivedAt: '2026-01-02T00:00:00.000Z' },
  )

  expect(archivedQueues).toEqual({ 'session-2': [followUp('follow-up-2')] })
  expect(archivedDisplayed.at(-1)).toEqual([followUp('follow-up-2')])

  desktopClient.disposeSession = originalDisposeSession
  desktopClient.updateSessionMetadata = originalUpdateSessionMetadata
})

test('removing a noncurrent session preserves the active session queue', async () => {
  const originalUpdateSessionMetadata = desktopClient.updateSessionMetadata
  const queues: Record<string, DesktopQueuedFollowUp[]> = {
    'session-1': [followUp('follow-up-1')],
    'session-2': [followUp('follow-up-2')],
  }
  const displayed: DesktopQueuedFollowUp[][] = []
  const lifecycle = createSessionQueueLifecycleController(
    { current: queues },
    value => displayed.push(value),
  )
  desktopClient.updateSessionMetadata = mock(async () => ({
    item: { ...item('session-2'), archivedAt: '2026-01-02T00:00:00.000Z' },
  })) as never

  await updateSessionMetadataAction(
    actionContext(lifecycle.removeSession),
    [item('session-1'), item('session-2')],
    'session-2',
    { archivedAt: '2026-01-02T00:00:00.000Z' },
  )

  expect(queues).toEqual({ 'session-1': [followUp('follow-up-1')] })
  expect(displayed.at(-1)).toEqual([followUp('follow-up-1')])
  desktopClient.updateSessionMetadata = originalUpdateSessionMetadata
})

function actionContext(
  onSessionRemoved: (sessionId: string, activeSessionId: string | null) => void,
): SessionActionContext {
  return {
    activeSessionIdRef: { current: 'session-1' },
    sessionViewsRef: { current: {} },
    sessionWorkspacesRef: { current: {} },
    onErrorRef: { current: mock() },
    viewSetters: {
      setEvents: mock(), setWorkflowEvents: mock(), setMessages: mock(),
      setToolLog: mock(), setPendingPermissions: mock(), setContextUsage: mock(),
    },
    setSessions: mock(), setSessionId: mock(), setSessionStatus: mock(),
    onSessionRemoved,
  } as unknown as SessionActionContext
}

function followUp(id: string): DesktopQueuedFollowUp {
  return { id, input: { text: id }, previewText: id, createdAt: '2026-01-01T00:00:00.000Z' }
}

function item(id: string): SessionListItem {
  return {
    id, sessionName: null, aiTitle: null, workspaceName: 'workspace',
    workspacePath: 'C:/workspace', standalone: false, permissionMode: 'default',
    planModeActive: false, localRouterMode: 'off', model: null, reviewModel: null,
    thinkingMode: 'default', hasSystemPrompt: false, hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0, status: 'idle', lastMessageAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as SessionListItem
}

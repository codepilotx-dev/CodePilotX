import { beforeAll, expect, test } from 'bun:test'
import type { DesktopSessionEvent, DesktopSessionStatus } from '../../../shared/types.js'

const idleStatus: DesktopSessionStatus = 'idle'
const runningStatus: DesktopSessionStatus = 'running'
let deriveAssistantActionMessageIds: typeof import('./ConversationPage.js').deriveAssistantActionMessageIds
let groupTimelineToolEvents: typeof import('./ConversationPage.js').groupTimelineToolEvents
let commandRunView: typeof import('./ConversationPage.js').commandRunView
let toggleOpenCommandRunIds: typeof import('./ConversationPage.js').toggleOpenCommandRunIds

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { desktopApi: {} },
  })
  const conversationPage = await import('./ConversationPage.js')
  deriveAssistantActionMessageIds =
    conversationPage.deriveAssistantActionMessageIds
  groupTimelineToolEvents = conversationPage.groupTimelineToolEvents
  commandRunView = conversationPage.commandRunView
  toggleOpenCommandRunIds = conversationPage.toggleOpenCommandRunIds
})

test('marks only the final assistant message after a completed turn', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'Build it'),
      assistantEvent('assistant-1', 'I will inspect files'),
      assistantEvent('assistant-2', 'Implemented'),
      checkpointEvent('done-1'),
    ],
  })

  expect([...visible]).toEqual(['assistant-2'])
})

test('keeps mid-turn user follow-ups in the original turn', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'Build it'),
      assistantEvent('assistant-1', 'First answer'),
      userEvent('user-2', 'Also adjust the color'),
      assistantEvent('assistant-2', 'Updated answer'),
      checkpointEvent('done-1'),
    ],
  })

  expect([...visible]).toEqual(['assistant-2'])
})

test('starts a new turn after a completed turn', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'First task'),
      assistantEvent('assistant-1', 'First done'),
      checkpointEvent('done-1'),
      userEvent('user-2', 'Second task'),
      assistantEvent('assistant-2', 'Second progress'),
      assistantEvent('assistant-3', 'Second done'),
      checkpointEvent('done-2'),
    ],
  })

  expect([...visible]).toEqual(['assistant-1', 'assistant-3'])
})

test('does not show assistant actions for active turns without a checkpoint', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: runningStatus,
    timelineEvents: [
      userEvent('user-1', 'Build it'),
      assistantEvent('assistant-1', 'Working on it'),
    ],
  })

  expect([...visible]).toEqual([])
})

test('treats legacy idle transcripts without checkpoints as completed', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'Build it'),
      assistantEvent('assistant-1', 'First answer'),
      assistantEvent('assistant-2', 'Final answer'),
    ],
  })

  expect([...visible]).toEqual(['assistant-2'])
})

test('keeps permission requests inside the running command shell', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    permissionRequestEvent('permission-1', 'Bash', 'Allow npm test?'),
  ])

  expect(items).toHaveLength(1)
  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(group.runs).toHaveLength(1)
  expect(commandRunView(group.runs[0]!).statusLabel).toBe('等待权限')
})

test('keeps permission requests with commands across invisible status events', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    statusEvent('status-1', 'waiting'),
    permissionRequestEvent('permission-1', 'Bash', 'Allow npm test?'),
    statusEvent('status-2', 'running'),
    toolResultEvent('result-1', 'Bash', 'Permission denied', true),
  ])

  expect(items).toHaveLength(1)
  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(group.runs).toHaveLength(1)
  expect(commandRunView(group.runs[0]!).statusLabel).toBe('失败')
})

test('updates a permission-gated command to failed when the tool result errors', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    permissionRequestEvent('permission-1', 'Bash', 'Allow npm test?'),
    toolResultEvent('result-1', 'Bash', 'Permission denied', true),
  ])

  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(group.runs).toHaveLength(1)
  expect(commandRunView(group.runs[0]!).statusLabel).toBe('失败')
})

test('keeps standalone errors as system timeline events', () => {
  const items = groupTimelineToolEvents([
    errorEvent('error-1', 'Something failed'),
  ])

  expect(items).toHaveLength(1)
  expect(items[0]?.type).toBe('error')
})

test('keeps previously opened command shells open when another run opens', () => {
  const firstOpen = toggleOpenCommandRunIds(new Set(), 'run-1')
  const secondOpen = toggleOpenCommandRunIds(firstOpen, 'run-2')
  const firstClosed = toggleOpenCommandRunIds(secondOpen, 'run-1')

  expect([...firstOpen]).toEqual(['run-1'])
  expect([...secondOpen]).toEqual(['run-1', 'run-2'])
  expect([...firstClosed]).toEqual(['run-2'])
})

function userEvent(id: string, content: string): DesktopSessionEvent {
  return messageEvent(id, 'user', content)
}

function assistantEvent(id: string, content: string): DesktopSessionEvent {
  return messageEvent(id, 'assistant', content)
}

function messageEvent(
  id: string,
  role: 'user' | 'assistant',
  content: string,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'message',
    role,
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
  }
}

function checkpointEvent(id: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'checkpoint',
    content: 'done',
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: { status: 'done' },
  }
}

function toolCallEvent(
  id: string,
  toolName: string,
  content: string,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'tool_call',
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
    metadata: { toolName, toolUseId: 'tool-use-1' },
  }
}

function permissionRequestEvent(
  id: string,
  toolName: string,
  description: string,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'permission_request',
    content: description,
    createdAt: '2026-06-26T00:00:00.500Z',
    metadata: {
      request: {
        requestId: id,
        toolName,
        description,
      },
      toolName,
      toolUseId: 'tool-use-1',
    },
  }
}

function toolResultEvent(
  id: string,
  toolName: string,
  content: string,
  isError: boolean,
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'tool_result',
    content,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: { toolName, toolUseId: 'tool-use-1', isError },
  }
}

function statusEvent(id: string, content: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'status',
    content,
    createdAt: '2026-06-26T00:00:00.750Z',
    metadata: { status: content },
  }
}

function errorEvent(id: string, content: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'error',
    role: 'system',
    content,
    createdAt: '2026-06-26T00:00:01.000Z',
  }
}

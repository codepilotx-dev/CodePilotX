import { beforeAll, expect, test } from 'bun:test'
import type { DesktopSessionEvent, DesktopSessionStatus } from '../../../shared/types.js'

const idleStatus: DesktopSessionStatus = 'idle'
const runningStatus: DesktopSessionStatus = 'running'
let deriveAssistantActionMessageIds: typeof import('./ConversationPage.js').deriveAssistantActionMessageIds
let groupTimelineToolEvents: typeof import('./ConversationPage.js').groupTimelineToolEvents
let commandRunView: typeof import('./ConversationPage.js').commandRunView
let toggleOpenCommandRunIds: typeof import('./ConversationPage.js').toggleOpenCommandRunIds
let parseAskUserQuestionTimelineResult: typeof import('./ConversationPage.js').parseAskUserQuestionTimelineResult
let planTitleFromSummary: typeof import('./ConversationPage.js').planTitleFromSummary
let planCardPresentation: typeof import('./ConversationPage.js').planCardPresentation
let buildDebugAskUserQuestionRequest: typeof import('./ConversationPage.js').buildDebugAskUserQuestionRequest

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
  parseAskUserQuestionTimelineResult =
    conversationPage.parseAskUserQuestionTimelineResult
  planTitleFromSummary = conversationPage.planTitleFromSummary
  planCardPresentation = conversationPage.planCardPresentation
  buildDebugAskUserQuestionRequest =
    conversationPage.buildDebugAskUserQuestionRequest
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

test('stops an unfinished command when a terminal error arrives', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    errorEvent('error-1', 'This operation was aborted'),
  ])

  expect(items).toHaveLength(2)
  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(group.runs).toHaveLength(1)
  expect(group.runs[0]?.isRunning).toBe(false)
  expect(commandRunView(group.runs[0]!).statusLabel).toBe('失败')
  expect(items[1]?.type).toBe('error')
})

test('stops an unfinished command when the turn checkpoint arrives', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    checkpointEvent('done-1'),
  ])

  expect(items).toHaveLength(2)
  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(group.runs[0]?.isRunning).toBe(false)
  expect(commandRunView(group.runs[0]!).statusLabel).toBe('失败')
  expect(items[1]?.type).toBe('checkpoint')
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

test('parses AskUserQuestion timeline runs into question answers', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-question', 'AskUserQuestion', 'AskUserQuestion'),
    askUserQuestionPermissionEvent('permission-question'),
    toolResultEvent('result-question', 'AskUserQuestion', 'AskUserQuestion', false, {
      result: {
        answers: {
          'Which files should be reviewed?': 'All modified files',
          'Which checks matter?': 'Logic, tests',
        },
      },
    }),
  ])

  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(parseAskUserQuestionTimelineResult(group.runs[0]!)).toEqual({
    count: 2,
    items: [
      {
        question: 'Which files should be reviewed?',
        answer: 'All modified files',
      },
      {
        question: 'Which checks matter?',
        answer: 'Logic, tests',
      },
    ],
  })
})

test('AskUserQuestion timeline parser ignores ordinary command runs', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'ok', false),
  ])

  const group = items[0]
  expect(group?.type).toBe('tool_group')
  if (group?.type !== 'tool_group') throw new Error('Expected tool group')
  expect(parseAskUserQuestionTimelineResult(group.runs[0]!)).toBe(null)
})

test('extracts the first markdown heading as the plan title', () => {
  expect(planTitleFromSummary('# 计划书右侧边栏展示逻辑\n\n## Summary')).toBe(
    '计划书右侧边栏展示逻辑',
  )
})

test('plan card hides right dock action while streaming', () => {
  expect(planCardPresentation({ streaming: true, isDocked: false })).toEqual({
    compact: false,
    label: '编写计划',
    showOpenInRightDock: false,
    showFoldControls: false,
  })
})

test('plan card exposes right dock action after completion', () => {
  expect(planCardPresentation({ streaming: false, isDocked: false })).toEqual({
    compact: false,
    label: '套餐',
    showOpenInRightDock: true,
    showFoldControls: false,
  })
})

test('plan card becomes a compact summary when docked', () => {
  expect(planCardPresentation({ streaming: false, isDocked: true })).toEqual({
    compact: true,
    label: '套餐',
    showOpenInRightDock: true,
    showFoldControls: false,
  })
})

test('buildDebugAskUserQuestionRequest creates a three-question card fixture', () => {
  const request = buildDebugAskUserQuestionRequest()
  const questions = request.input.questions as Array<{
    question: string
    multiSelect?: boolean
  }>

  expect(request.toolName).toBe('AskUserQuestion')
  expect(questions.map(question => question.question)).toEqual([
    'Model Router 功能指的是哪一种？',
    '哪些交互需要覆盖？',
    '最后一题应该如何提交？',
  ])
  expect(questions[1]?.multiSelect).toBe(true)
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

function askUserQuestionPermissionEvent(id: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'permission_request',
    content: 'Answer questions?',
    createdAt: '2026-06-26T00:00:00.500Z',
    metadata: {
      request: {
        requestId: id,
        toolName: 'AskUserQuestion',
        description: 'Answer questions?',
        input: {
          questions: [
            {
              question: 'Which files should be reviewed?',
              header: 'Files',
              options: [
                { label: 'All', description: 'All modified files' },
                { label: 'Core', description: 'Core files only' },
              ],
            },
            {
              question: 'Which checks matter?',
              header: 'Checks',
              options: [
                { label: 'Logic', description: 'Logic and tests' },
                { label: 'Style', description: 'Style only' },
              ],
              multiSelect: true,
            },
          ],
        },
      },
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-use-1',
    },
  }
}

function toolResultEvent(
  id: string,
  toolName: string,
  content: string,
  isError: boolean,
  metadata: Record<string, unknown> = {},
): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'tool_result',
    content,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: { ...metadata, toolName, toolUseId: 'tool-use-1', isError },
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

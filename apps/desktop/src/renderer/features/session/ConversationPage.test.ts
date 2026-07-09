import { beforeAll, expect, test } from 'bun:test'
import type { DesktopSessionEvent, DesktopSessionStatus } from '../../../shared/types.js'

const idleStatus: DesktopSessionStatus = 'idle'
const runningStatus: DesktopSessionStatus = 'running'
let deriveAssistantActionMessageIds: typeof import('./ConversationPage.js').deriveAssistantActionMessageIds
let deriveTimelineSourceEvents: typeof import('./ConversationPage.js').deriveTimelineSourceEvents
let groupTimelineToolEvents: typeof import('./ConversationPage.js').groupTimelineToolEvents
let groupTimelineExecutionPhases: typeof import('./ConversationPage.js').groupTimelineExecutionPhases
let commandRunView: typeof import('./ConversationPage.js').commandRunView
let toggleOpenCommandRunIds: typeof import('./ConversationPage.js').toggleOpenCommandRunIds
let parseAskUserQuestionTimelineResult: typeof import('./ConversationPage.js').parseAskUserQuestionTimelineResult
let planTitleFromSummary: typeof import('./ConversationPage.js').planTitleFromSummary
let planCardPresentation: typeof import('./ConversationPage.js').planCardPresentation
let buildDebugAskUserQuestionRequest: typeof import('./ConversationPage.js').buildDebugAskUserQuestionRequest
let buildDebugPlanCardSummary: typeof import('./ConversationPage.js').buildDebugPlanCardSummary
let deriveConversationTurnNavItems: typeof import('./ConversationPage.js').deriveConversationTurnNavItems

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { desktopApi: {} },
  })
  const conversationPage = await import('./ConversationPage.js')
  deriveAssistantActionMessageIds =
    conversationPage.deriveAssistantActionMessageIds
  deriveTimelineSourceEvents = conversationPage.deriveTimelineSourceEvents
  groupTimelineToolEvents = conversationPage.groupTimelineToolEvents
  groupTimelineExecutionPhases = conversationPage.groupTimelineExecutionPhases
  commandRunView = conversationPage.commandRunView
  toggleOpenCommandRunIds = conversationPage.toggleOpenCommandRunIds
  parseAskUserQuestionTimelineResult =
    conversationPage.parseAskUserQuestionTimelineResult
  planTitleFromSummary = conversationPage.planTitleFromSummary
  planCardPresentation = conversationPage.planCardPresentation
  buildDebugAskUserQuestionRequest =
    conversationPage.buildDebugAskUserQuestionRequest
  buildDebugPlanCardSummary =
    conversationPage.buildDebugPlanCardSummary
  deriveConversationTurnNavItems =
    conversationPage.deriveConversationTurnNavItems
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

test('prefers live session events while a workflow-backed turn is active', () => {
  const workflowEvents = [
    userEvent('workflow-user-1', 'Previous task'),
    assistantEvent('workflow-assistant-1', 'Previous answer'),
    checkpointEvent('workflow-done-1'),
  ]
  const liveEvents = [
    userEvent('live-user-1', 'New task'),
    assistantEvent('live-assistant-1', 'Working now'),
  ]

  expect(
    deriveTimelineSourceEvents({
      conversationMessages: [],
      events: liveEvents,
      sessionStatus: runningStatus,
      workflowEvents,
    }),
  ).toBe(liveEvents)
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
    label: '计划',
    showOpenInRightDock: true,
    showFoldControls: false,
  })
})

test('plan card becomes a compact summary when docked', () => {
  expect(planCardPresentation({ streaming: false, isDocked: true })).toEqual({
    compact: true,
    label: '计划',
    showOpenInRightDock: true,
    showFoldControls: false,
  })
})

test('shows assistant actions for the final message in a plan turn', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'Implement feature'),
      assistantEvent('assistant-1', 'I will inspect code first'),
      proposedPlanEvent('plan-1', '# Implementation Plan\n\nStep 1...'),
      assistantEvent('assistant-2', 'Done with implementation'),
      checkpointEvent('done-1'),
    ],
  })

  expect([...visible]).toEqual(['assistant-2'])
})

test('still shows actions for final assistant message when turn has no proposed_plan', () => {
  const visible = deriveAssistantActionMessageIds({
    sessionStatus: idleStatus,
    timelineEvents: [
      userEvent('user-1', 'Build it'),
      assistantEvent('assistant-1', 'First answer'),
      assistantEvent('assistant-2', 'Final answer'),
      checkpointEvent('done-1'),
    ],
  })

  expect([...visible]).toEqual(['assistant-2'])
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

test('buildDebugPlanCardSummary returns a markdown summary with heading and steps', () => {
  const summary = buildDebugPlanCardSummary()
  expect(summary).toContain('# Model Router 实现计划')
  expect(summary).toContain('## Summary')
  expect(summary).toContain('### 1.')
  expect(summary).toContain('### 2.')
  expect(summary).toContain('### 3.')
  expect(summary).toContain('### 4.')
})

test('parseAskUserQuestionTimelineResult reads answers by question id', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-q', 'AskUserQuestion', 'AskUserQuestion'),
    askUserQuestionPermissionEventWithId('permission-q'),
    toolResultEvent('result-q', 'AskUserQuestion', 'AskUserQuestion', false, {
      result: {
        answers: {
          q1: { answers: ['All modified files'] },
          q2: { answers: ['Logic, tests'] },
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

test('parseAskUserQuestionTimelineResult falls back to question text key', () => {
  const items = groupTimelineToolEvents([
    toolCallEvent('tool-q', 'AskUserQuestion', 'AskUserQuestion'),
    askUserQuestionPermissionEvent('permission-q'),
    toolResultEvent('result-q', 'AskUserQuestion', 'AskUserQuestion', false, {
      result: {
        answers: {
          'Which files should be reviewed?': 'Core only',
          'Which checks matter?': 'Style',
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
        answer: 'Core only',
      },
      {
        question: 'Which checks matter?',
        answer: 'Style',
      },
    ],
  })
})

// --- groupTimelineExecutionPhases ---

function toolGroupItem(id: string, toolName: string, isRunning = false): ReturnType<typeof import('./ConversationPage.js')['groupTimelineToolEvents']>[number] & { type: 'tool_group' } {
  return {
    id: `tool-group-${id}`,
    type: 'tool_group' as const,
    runs: [
      {
        id: `${id}-run`,
        toolUseId: `${id}-tool-use`,
        toolName,
        callContent: toolName === 'Bash' ? 'npm test' : '',
        resultContent: isRunning ? '' : 'done',
        isError: false,
        isRunning,
        isWaitingForPermission: false,
      },
    ],
  }
}

const idleSessionStatus: DesktopSessionStatus = 'idle'
const runningSessionStatus: DesktopSessionStatus = 'running'

test('groupTimelineExecutionPhases passes through items in a non-plan turn unchanged', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Hello'),
    assistantEvent('assistant-1', 'Hi there'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleSessionStatus)

  // All items pass through unchanged (includes checkpoint which is invisible in rendering)
  expect(phaseItems).toHaveLength(3)
  expect(phaseItems[0]).toBe(items[0])
  expect(phaseItems[1]).toBe(items[1])
  expect(phaseItems[2]).toBe(items[2])
})

test('groupTimelineExecutionPhases wraps execution items after a plan into a phase', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan'),
    assistantEvent('assistant-1', 'Starting implementation...'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'passed', false),
    filePatchEvent('file-1', '/src/index.ts'),
    assistantEvent('assistant-2', 'Done with feature'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleSessionStatus)

  // Expected: [user, plan, execution_phase, file_patch, final_summary, checkpoint]
  expect(phaseItems[0]).toBe(items[0]) // user message
  expect(phaseItems[1]).toBe(items[1]) // proposed_plan

  // Execution phase
  const phase = phaseItems[2]
  expect(phase?.type).toBe('execution_phase')
  if (phase?.type !== 'execution_phase') throw new Error('Expected execution phase')
  expect(phase.isComplete).toBe(true)
  expect(phase.items).toHaveLength(2) // assistant-1 + tool_group
  expect(phase.items[0]).toBe(items[2]) // assistant-1

  // File patch stays outside
  expect(phaseItems[3]).toBe(items[4]) // file_patch

  // Final summary
  expect(phaseItems[4]).toBe(items[5]) // assistant-2
})

test('groupTimelineExecutionPhases keeps execution phase expanded while running', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan'),
    assistantEvent('assistant-1', 'Working...'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    // No checkpoint — turn is still active
  ])
  const phaseItems = groupTimelineExecutionPhases(items, runningSessionStatus)

  const phase = phaseItems[2]
  expect(phase?.type).toBe('execution_phase')
  if (phase?.type !== 'execution_phase') throw new Error('Expected execution phase')
  expect(phase.isComplete).toBe(false) // not complete while running
})

test('groupTimelineExecutionPhases handles plan turn without execution items', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan'),
    assistantEvent('assistant-1', 'Done'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleSessionStatus)

  // No execution phase since there are no intermediate items between plan and final
  // Result: [user, plan, assistant (final), checkpoint]
  expect(phaseItems).toHaveLength(4)
  // Assistant is the final summary (outside phase)
  expect(phaseItems[2]).toBe(items[2])
})

test('groupTimelineExecutionPhases handles plan turn without final assistant message', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'passed', false),
    filePatchEvent('file-1', '/src/index.ts'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleSessionStatus)

  // Expected: [user, plan, execution_phase, file_patch, checkpoint]
  const phase = phaseItems[2]
  expect(phase?.type).toBe('execution_phase')
  if (phase?.type !== 'execution_phase') throw new Error('Expected execution phase')
  expect(phase.items).toHaveLength(1) // just the tool group

  // No final summary message — file patch is the last visible item
  expect(phaseItems[3]).toBe(items[3]) // file_patch
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

function proposedPlanEvent(id: string, content: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'proposed_plan',
    role: 'assistant',
    content,
    createdAt: '2026-06-26T00:00:00.500Z',
    metadata: {},
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

function askUserQuestionPermissionEventWithId(id: string): DesktopSessionEvent {
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
              id: 'q1',
              question: 'Which files should be reviewed?',
              header: 'Files',
              options: [
                { label: 'All', description: 'All modified files' },
                { label: 'Core', description: 'Core files only' },
              ],
            },
            {
              id: 'q2',
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

function filePatchEvent(id: string, filePath: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'file_patch',
    content: `Edited ${filePath}`,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: {
      files: [{ path: filePath, additions: 5, deletions: 2 }],
      additions: 5,
      deletions: 2,
      turnScoped: true,
    },
  }
}

function filePatchEventNonTurnScoped(id: string, filePath: string): DesktopSessionEvent {
  return {
    id,
    sessionId: 'session-1',
    type: 'file_patch',
    content: `Edited ${filePath}`,
    createdAt: '2026-06-26T00:00:01.000Z',
    metadata: {
      files: [{ path: filePath, additions: 3, deletions: 1 }],
      additions: 3,
      deletions: 1,
      turnScoped: false,
    },
  }
}

// --- deriveConversationTurnNavItems ---

test('deriveConversationTurnNavItems produces one nav item per user message', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build the feature'),
    assistantEvent('assistant-1', 'I will start coding'),
    assistantEvent('assistant-2', 'Done with feature'),
    checkpointEvent('done-1'),
    userEvent('user-2', 'Add tests'),
    assistantEvent('assistant-3', 'Tests added'),
    checkpointEvent('done-2'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(2)
  expect(nav[0]!.id).toBe('user-1')
  expect(nav[0]!.rowIndex).toBe(0)
  expect(nav[0]!.userText).toBe('Build the feature')
  // Last assistant text in first turn
  expect(nav[0]!.assistantText).toBe('Done with feature')
  expect(nav[1]!.id).toBe('user-2')
  expect(nav[1]!.rowIndex).toBe(4)
  expect(nav[1]!.userText).toBe('Add tests')
  expect(nav[1]!.assistantText).toBe('Tests added')
})

test('deriveConversationTurnNavItems sets assistantText to the last assistant message in each turn', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Implement feature'),
    assistantEvent('assistant-1', 'I will inspect code first'),
    assistantEvent('assistant-2', 'Making progress'),
    assistantEvent('assistant-3', 'Done with implementation'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(1)
  // Should be the last assistant message in the turn
  expect(nav[0]!.assistantText).toBe('Done with implementation')
})

test('deriveConversationTurnNavItems sets assistantText to null when no assistant reply exists', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Is anyone there?'),
    // No assistant reply
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(1)
  expect(nav[0]!.assistantText).toBeNull()
})

test('deriveConversationTurnNavItems collects only turnScoped file_patch files', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Refactor the code'),
    assistantEvent('assistant-1', 'Refactored'),
    filePatchEvent('file-1', '/src/index.ts'),
    filePatchEventNonTurnScoped('file-2', '/src/utils.ts'),
    filePatchEvent('file-3', '/src/main.ts'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(1)
  // Only turnScoped file paths are collected
  expect(nav[0]!.files).toEqual(['/src/index.ts', '/src/main.ts'])
})

test('deriveConversationTurnNavItems returns empty files array for turns without file changes', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Question only'),
    assistantEvent('assistant-1', 'Answer'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(1)
  expect(nav[0]!.files).toEqual([])
})

test('deriveConversationTurnNavItems handles execution phases with nested items', () => {
  const items = groupTimelineToolEvents([
    userEvent('user-1', 'Build feature'),
    proposedPlanEvent('plan-1', '# Plan'),
    assistantEvent('assistant-1', 'Starting implementation...'),
    toolCallEvent('tool-1', 'Bash', 'npm test'),
    toolResultEvent('result-1', 'Bash', 'passed', false),
    filePatchEvent('file-1', '/src/feature.ts'),
    assistantEvent('assistant-2', 'Done with feature'),
    checkpointEvent('done-1'),
    userEvent('user-2', 'Deploy it'),
    assistantEvent('assistant-3', 'Deployed'),
    checkpointEvent('done-2'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)

  expect(nav).toHaveLength(2)

  // First turn: user-1 at index 0
  expect(nav[0]!.id).toBe('user-1')
  expect(nav[0]!.rowIndex).toBe(0)
  expect(nav[0]!.assistantText).toBe('Done with feature')
  // file_patch after execution_phase is still part of the same turn
  expect(nav[0]!.files).toEqual(['/src/feature.ts'])

  // Second turn: user-2
  expect(nav[1]!.id).toBe('user-2')
  expect(nav[1]!.rowIndex).toBe(6)
  expect(nav[1]!.assistantText).toBe('Deployed')
  expect(nav[1]!.files).toEqual([])
})

test('deriveConversationTurnNavItems returns empty array when there are no user messages', () => {
  const items = groupTimelineToolEvents([
    assistantEvent('assistant-1', 'Hello'),
    checkpointEvent('done-1'),
  ])
  const phaseItems = groupTimelineExecutionPhases(items, idleStatus)
  const nav = deriveConversationTurnNavItems(phaseItems)
  expect(nav).toEqual([])
})

import { expect, test } from 'bun:test'
import type {
  DesktopComposerAttachment,
  DesktopQueuedFollowUp,
  DesktopSessionSnapshot,
  DesktopThreadGoal,
} from '../../../shared/types.js'
import type { SessionListItem } from '../../uiTypes.js'
import { createSessionQueueGoalActions } from './sessionQueueGoalActions.js'

test('queue remove and edit use the active session id and restore the intended composer only after removal', async () => {
  const calls: string[][] = []
  const mainInput: string[] = []
  const sideInput: string[] = []
  const mainAttachments: DesktopComposerAttachment[][] = []
  const sideAttachments: DesktopComposerAttachment[][] = []
  const applied: DesktopSessionSnapshot[] = []
  const followUp = queuedFollowUp('follow-up-1')
  const actions = createSessionQueueGoalActions({
    activeSessionItem: sessionItem('session-1'),
    queuedFollowUps: [followUp],
    desktopApi: {
      removeQueuedFollowUp: async (sessionId, followUpId) => {
        calls.push(['remove', sessionId, followUpId])
        return snapshot('session-1')
      },
      sendQueuedFollowUpNow: async () => {},
      setSessionGoal: async () => goal('active'),
      clearSessionGoal: async () => true,
      getSession: async () => snapshot('session-1'),
    },
    applyReturnedSessionSnapshot: (_sessionId, value) => applied.push(value),
    setErrorMessage: () => {},
    setMainInput: value => mainInput.push(value),
    setMainAttachments: value => mainAttachments.push(value),
    focusMainComposer: () => {},
    setSideInput: value => sideInput.push(value),
    setSideAttachments: value => sideAttachments.push(value),
    focusSideComposer: () => {},
  })

  await actions.remove('follow-up-1')
  await actions.editMain('follow-up-1')
  await actions.editSide('follow-up-1')

  expect(calls).toEqual([
    ['remove', 'session-1', 'follow-up-1'],
    ['remove', 'session-1', 'follow-up-1'],
    ['remove', 'session-1', 'follow-up-1'],
  ])
  expect(mainInput).toEqual(['queued text'])
  expect(mainAttachments).toEqual([[followUp.input.attachments![0]]])
  expect(sideInput).toEqual(['queued text'])
  expect(sideAttachments).toEqual([[followUp.input.attachments![0]]])
  expect(applied).toHaveLength(3)
})

test('goal actions use activeSessionItem and apply the authoritative snapshot', async () => {
  const setGoalCalls: Array<[string, { status?: string }]> = []
  const clearCalls: string[] = []
  const applied: DesktopSessionSnapshot[] = []
  const actions = createSessionQueueGoalActions({
    activeSessionItem: sessionItem('session-1'),
    queuedFollowUps: [],
    desktopApi: {
      removeQueuedFollowUp: async () => snapshot('session-1'),
      sendQueuedFollowUpNow: async () => {},
      setSessionGoal: async (sessionId, input) => {
        setGoalCalls.push([sessionId, input])
        return goal(input.status ?? 'active')
      },
      clearSessionGoal: async sessionId => {
        clearCalls.push(sessionId)
        return true
      },
      getSession: async () => snapshot('session-1', goal('paused')),
    },
    applyReturnedSessionSnapshot: (_sessionId, value) => applied.push(value),
    setErrorMessage: () => {},
    setMainInput: () => {},
    setMainAttachments: () => {},
    focusMainComposer: () => {},
    setSideInput: () => {},
    setSideAttachments: () => {},
    focusSideComposer: () => {},
  })

  await actions.updateGoal({ status: 'paused' })
  await actions.updateGoal({ status: 'active' })
  await actions.updateGoal({ status: 'complete' })
  await actions.clearGoal()

  expect(setGoalCalls).toEqual([
    ['session-1', { status: 'paused' }],
    ['session-1', { status: 'active' }],
    ['session-1', { status: 'complete' }],
  ])
  expect(clearCalls).toEqual(['session-1'])
  expect(applied).toHaveLength(4)
  expect(applied[0]?.item.threadGoal).toEqual(goal('paused'))
})

function queuedFollowUp(id: string): DesktopQueuedFollowUp {
  return {
    id,
    input: {
      text: 'queued text',
      attachments: [attachment()],
    },
    previewText: 'queued text',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function attachment(): DesktopComposerAttachment {
  return {
    id: 'attachment-1',
    name: 'note.txt',
    path: 'C:/workspace/note.txt',
    mediaType: 'text/plain',
    sizeBytes: 1,
    kind: 'text',
    status: 'ready',
  }
}

function goal(status: DesktopThreadGoal['status']): DesktopThreadGoal {
  return {
    threadId: 'thread-1',
    objective: 'finish the task',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

function sessionItem(id: string): SessionListItem {
  return snapshot(id).item
}

function snapshot(
  id: string,
  threadGoal?: DesktopThreadGoal,
): DesktopSessionSnapshot {
  return {
    item: {
      id,
      sessionName: null,
      aiTitle: null,
      customTitle: null,
      tag: null,
      summary: null,
      gitBranch: null,
      firstPrompt: null,
      prNumber: null,
      prUrl: null,
      prRepository: null,
      transcriptPath: '',
      rolloutPath: null,
      legacyTranscriptPath: null,
      source: 'user',
      parentSessionId: null,
      guardianRolloutPath: null,
      fileSize: null,
      workspaceName: 'workspace',
      workspacePath: 'C:/workspace',
      standalone: false,
      pinnedAt: null,
      archivedAt: null,
      permissionMode: 'default',
      localRouterMode: 'off',
      planModeActive: false,
      model: null,
      reviewModel: null,
      thinkingMode: 'default',
      hasSystemPrompt: false,
      hasAppendSystemPrompt: false,
      additionalDirectoryCount: 0,
      status: 'idle',
      threadGoal,
      lastMessageAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    workspace: {
      path: 'C:/workspace',
      name: 'workspace',
      branchName: null,
      branches: [],
      isGitRepo: false,
    },
    settings: {
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
    view: { messages: [], toolLog: [], pendingPermissions: [], contextUsage: null },
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

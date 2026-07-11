import { expect, test } from 'bun:test'
import type { DesktopSessionSnapshot } from '../../../shared/types.js'
import {
  buildQueuedFollowUpsBySession,
  resolveQueuedFollowUpsForActiveSession,
} from './useSessionState.js'

test('buildQueuedFollowUpsBySession retains root queue items for each session', () => {
  const snapshots = [
    snapshot('session-1', ['follow-up-1']),
    snapshot('session-2', ['follow-up-2']),
  ]

  expect(buildQueuedFollowUpsBySession(snapshots)).toEqual({
    'session-1': [
      expect.objectContaining({ id: 'follow-up-1' }),
    ],
    'session-2': [
      expect.objectContaining({ id: 'follow-up-2' }),
    ],
  })
})

test('buildQueuedFollowUpsBySession clears a session queue when the store snapshot omits it', () => {
  expect(buildQueuedFollowUpsBySession([snapshot('session-1')])).toEqual({
    'session-1': [],
  })
})

test('Session Store Change updates the active Queue Dock and session switching selects its queue', () => {
  const queueBySession = buildQueuedFollowUpsBySession([
    snapshot('session-1', ['follow-up-1']),
    snapshot('session-2', ['follow-up-2']),
  ])

  expect(
    resolveQueuedFollowUpsForActiveSession(queueBySession, 'session-1'),
  ).toEqual([expect.objectContaining({ id: 'follow-up-1' })])
  expect(
    resolveQueuedFollowUpsForActiveSession(queueBySession, 'session-2'),
  ).toEqual([expect.objectContaining({ id: 'follow-up-2' })])
})

test('buildQueuedFollowUpsBySession drops archived session queues', () => {
  const archived = snapshot('session-1', ['follow-up-1'])
  archived.item.archivedAt = '2026-01-02T00:00:00.000Z'

  expect(buildQueuedFollowUpsBySession([archived])).toEqual({})
})

function snapshot(
  id: string,
  followUpIds: string[] = [],
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
    view: {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      contextUsage: null,
    },
    queuedFollowUps: followUpIds.map(followUpId => ({
      id: followUpId,
      input: { text: followUpId },
      previewText: followUpId,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

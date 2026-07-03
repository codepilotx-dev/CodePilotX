import { expect, test } from 'bun:test'
import type { SessionListItem } from '../../uiTypes.js'
import { sortSessionsByRecency } from './sessionSorting.js'

test('sortSessionsByRecency orders sessions by latest activity', () => {
  const sessions = [
    session('older', '2026-07-03T00:00:00.000Z'),
    session('newer', '2026-07-03T01:00:00.000Z'),
    session('newest', '2026-07-03T02:00:00.000Z'),
  ]

  expect(sortSessionsByRecency(sessions).map(item => item.id)).toEqual([
    'newest',
    'newer',
    'older',
  ])
})

function session(id: string, lastMessageAt: string): SessionListItem {
  return {
    id,
    sessionName: null,
    aiTitle: null,
    customTitle: null,
    tag: null,
    summary: null,
    gitBranch: null,
    firstPrompt: id,
    prNumber: null,
    prUrl: null,
    prRepository: null,
    transcriptPath: null,
    rolloutPath: null,
    legacyTranscriptPath: null,
    source: 'user',
    parentSessionId: null,
    guardianRolloutPath: null,
    fileSize: null,
    workspaceName: 'Project',
    workspacePath: 'D:/Project',
    standalone: false,
    pinnedAt: null,
    archivedAt: null,
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    localRouterMode: 'off',
    planModeActive: false,
    model: null,
    reviewModel: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: 'done',
    lastMessageAt,
    createdAt: '2026-07-03T00:00:00.000Z',
  }
}

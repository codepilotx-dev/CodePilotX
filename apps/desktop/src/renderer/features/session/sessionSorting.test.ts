import { expect, test } from 'bun:test'
import type { SessionListItem } from '../../uiTypes.js'
import {
  sortSessionsByRecency,
  sortSessionsForSidebar,
} from './sessionSorting.js'

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

test('sortSessionsForSidebar prioritizes needs input, then unread, then recency', () => {
  const sessions = [
    session('normal-newest', '2026-07-03T03:00:00.000Z'),
    session('needs-input', '2026-07-03T00:00:00.000Z'),
    session('unread', '2026-07-03T02:00:00.000Z'),
  ]

  expect(
    sortSessionsForSidebar(sessions, {
      sort: 'priority',
      needsInputSessionIds: new Set(['needs-input']),
      unreadSessionIds: new Set(['unread']),
      scopeKey: 'workspace:D:/Project',
      manualOrderByScope: {},
    }).map(item => item.id),
  ).toEqual(['needs-input', 'unread', 'normal-newest'])
})

test('sortSessionsForSidebar keeps priority ties stable by recency, createdAt, and id', () => {
  const sessions = [
    session('a', '2026-07-03T01:00:00.000Z', '2026-07-03T00:00:00.000Z'),
    session('b', '2026-07-03T01:00:00.000Z', '2026-07-03T02:00:00.000Z'),
    session('c', '2026-07-03T01:00:00.000Z', '2026-07-03T02:00:00.000Z'),
  ]

  expect(
    sortSessionsForSidebar(sessions, {
      sort: 'priority',
      needsInputSessionIds: new Set(),
      unreadSessionIds: new Set(),
      scopeKey: 'workspace:D:/Project',
      manualOrderByScope: {},
    }).map(item => item.id),
  ).toEqual(['c', 'b', 'a'])
})

test('sortSessionsForSidebar appends unrecorded sessions in recent order for manual sort', () => {
  const sessions = [
    session('newest', '2026-07-03T03:00:00.000Z'),
    session('manual-1', '2026-07-03T01:00:00.000Z'),
    session('manual-2', '2026-07-03T02:00:00.000Z'),
    session('older', '2026-07-03T00:00:00.000Z'),
  ]

  expect(
    sortSessionsForSidebar(sessions, {
      sort: 'manual',
      needsInputSessionIds: new Set(['newest']),
      unreadSessionIds: new Set(['older']),
      scopeKey: 'workspace:D:/Project',
      manualOrderByScope: {
        'workspace:D:/Project': ['manual-2', 'manual-1'],
        'workspace:D:/Other': ['older'],
      },
    }).map(item => item.id),
  ).toEqual(['manual-2', 'manual-1', 'newest', 'older'])
})

function session(
  id: string,
  lastMessageAt: string,
  createdAt = '2026-07-03T00:00:00.000Z',
): SessionListItem {
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
    createdAt,
  }
}

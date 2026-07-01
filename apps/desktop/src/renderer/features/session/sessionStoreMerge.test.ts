import { expect, test } from 'bun:test'
import { mergeSessionStoreSnapshotView } from './sessionStoreMerge.js'
import type { DesktopSessionSnapshot } from '../../../shared/types.js'
import type { SessionViewState } from '../../uiTypes.js'

test('mergeSessionStoreSnapshotView preserves hydrated view for lightweight snapshots', () => {
  const existing: SessionViewState = {
    events: [
      {
        id: 'event-1',
        type: 'status',
        sessionId: 'session-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    workflowEvents: [],
    messages: [
      {
        id: 'message-1',
        role: 'assistant',
        text: 'Existing text',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    toolLog: [
      {
        id: 'tool-1',
        toolName: 'Read',
        summary: 'file',
        kind: 'result',
        createdAt: '10:00:00',
        expanded: false,
      },
    ],
    pendingPermissions: [],
    contextUsage: null,
    selectedFile: null,
  }
  const snapshot = lightweightSnapshot({
    pendingPermissions: [
      {
        requestId: 'permission-1',
        toolName: 'Bash',
        description: 'Run command',
        input: {},
      },
    ],
  })

  const merged = mergeSessionStoreSnapshotView(existing, snapshot)

  expect(merged.messages).toEqual(existing.messages)
  expect(merged.toolLog).toEqual(existing.toolLog)
  expect(merged.events).toEqual(existing.events)
  expect(merged.pendingPermissions).toEqual(snapshot.view.pendingPermissions)
})

test('mergeSessionStoreSnapshotView accepts full hydrated snapshot content', () => {
  const existing: SessionViewState = {
    events: [],
    workflowEvents: [],
    messages: [],
    toolLog: [],
    pendingPermissions: [],
    contextUsage: null,
    selectedFile: null,
  }
  const snapshot = lightweightSnapshot({
    messages: [
      {
        id: 'message-2',
        role: 'user',
        text: 'New text',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })

  const merged = mergeSessionStoreSnapshotView(existing, snapshot)

  expect(merged.messages).toEqual(snapshot.view.messages)
})

function lightweightSnapshot(
  view: Partial<DesktopSessionSnapshot['view']>,
): DesktopSessionSnapshot {
  return {
    item: {
      id: 'session-1',
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
      workspacePath: 'D:\\workspace',
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
      status: 'running',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    workspace: {
      path: 'D:\\workspace',
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
      messages: view.messages ?? [],
      toolLog: view.toolLog ?? [],
      pendingPermissions: view.pendingPermissions ?? [],
      contextUsage: view.contextUsage ?? null,
    },
    events: view.messages ? [] : undefined,
    eventModelVersion: view.messages ? 1 : undefined,
    workflowEvents: undefined,
    workflowEventModelVersion: undefined,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

import { expect, test } from 'bun:test'
import * as desktopSessionSettings from './desktopSessionSettings.js'
import { createDesktopSessionSnapshot } from './sessionPersistence.js'

test('authoritative thread settings update the matching desktop snapshot', () => {
  const applySettings = (
    desktopSessionSettings as Record<string, unknown>
  ).applyAuthoritativeThreadSettingsToSnapshot

  expect(typeof applySettings).toBe('function')
  if (typeof applySettings !== 'function') return

  const snapshot = createDesktopSessionSnapshot({
    sessionId: 'session-1',
    appServerThreadId: 'thread-1',
    workspace: {
      path: 'D:/workspace',
      name: 'workspace',
      branchName: null,
      isGitRepo: false,
    },
    standalone: false,
    settings: {
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      collaborationMode: { mode: 'default', settings: {} },
      planModeActive: false,
      model: 'old-model',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })

  const updated = applySettings(snapshot, {
    threadId: 'thread-1',
    threadSettings: {
      cwd: 'D:/workspace',
      approvalPolicy: 'never',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: {},
      activePermissionProfile: {
        id: ':danger-full-access',
        extends: null,
      },
      model: 'new-model',
      modelProvider: 'openai',
      serviceTier: null,
      effort: 'high',
      summary: null,
      collaborationMode: { mode: 'plan', settings: {} },
      multiAgentMode: 'explicitRequestOnly',
      personality: 'concise',
    },
  }) as ReturnType<typeof createDesktopSessionSnapshot>

  expect(updated).not.toBe(snapshot)
  expect(updated.settings).toMatchObject({
    model: 'new-model',
    effort: 'high',
    personality: 'concise',
    permissionProfile: ':danger-full-access',
    approvalPolicy: 'never',
    approvalsReviewer: 'auto_review',
    planModeActive: true,
  })
  expect(updated.item).toMatchObject({
    model: 'new-model',
    effort: 'high',
    personality: 'concise',
    permissionProfile: ':danger-full-access',
    approvalPolicy: 'never',
    approvalsReviewer: 'auto_review',
    planModeActive: true,
  })
})

test('authoritative thread settings ignore a different app-server thread', () => {
  const applySettings = (
    desktopSessionSettings as Record<string, unknown>
  ).applyAuthoritativeThreadSettingsToSnapshot

  expect(typeof applySettings).toBe('function')
  if (typeof applySettings !== 'function') return

  const snapshot = createDesktopSessionSnapshot({
    sessionId: 'session-1',
    appServerThreadId: 'thread-1',
    workspace: {
      path: 'D:/workspace',
      name: 'workspace',
      branchName: null,
      isGitRepo: false,
    },
    standalone: false,
    settings: {
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      collaborationMode: { mode: 'default', settings: {} },
      planModeActive: false,
      model: 'old-model',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
  })

  const updated = applySettings(snapshot, {
    threadId: 'thread-2',
    threadSettings: {
      cwd: 'D:/workspace',
      approvalPolicy: 'never',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: {},
      activePermissionProfile: null,
      model: 'new-model',
      modelProvider: 'openai',
      serviceTier: null,
      effort: null,
      summary: null,
      collaborationMode: { mode: 'plan', settings: {} },
      multiAgentMode: null,
      personality: null,
    },
  })

  expect(updated).toBe(snapshot)
})

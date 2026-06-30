import { expect, test } from 'bun:test'
import {
  applySessionCollaborationModeToSnapshot,
  applySessionPermissionModeToSnapshot,
  createSessionSettingsSnapshot,
} from './desktopSessionSettings.js'
import type { DesktopSessionSnapshot } from '../shared/types.js'

test('createSessionSettingsSnapshot preserves requested permission mode', () => {
  const settings = createSessionSettingsSnapshot({
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'auto-review',
    collaborationMode: { mode: 'plan' },
    thinkingMode: 'default',
    additionalDirectories: [],
  })

  expect(settings.permissionMode).toBe('auto-review')
  expect(settings.collaborationMode).toEqual({ mode: 'plan' })
  expect(settings.planModeActive).toBe(true)
})

test('createSessionSettingsSnapshot preserves disabled bundled dependencies', () => {
  const settings = createSessionSettingsSnapshot({
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    thinkingMode: 'default',
    additionalDirectories: [],
    installCodexDependencies: false,
  })

  expect(settings.installCodexDependencies).toBe(false)
})

test('createSessionSettingsSnapshot defaults bundled dependencies to enabled', () => {
  const settings = createSessionSettingsSnapshot({
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    thinkingMode: 'default',
    additionalDirectories: [],
  })

  expect(settings.installCodexDependencies).toBe(true)
})

test('applySessionPermissionModeToSnapshot updates mode without treating it as profile', () => {
  const snapshot = {
    item: {
      id: 'session-1',
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
    },
    settings: {
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      thinkingMode: 'default',
      additionalDirectories: [],
    },
    updatedAt: '2026-06-26T00:00:00.000Z',
  } as DesktopSessionSnapshot

  const updated = applySessionPermissionModeToSnapshot(snapshot, 'auto-review')

  expect(updated.item.permissionMode).toBe('auto-review')
  expect(updated.settings.permissionMode).toBe('auto-review')
  expect(updated.item.permissionProfile).toBe(':workspace')
  expect(updated.settings.permissionProfile).toBe(':workspace')
  expect(updated.updatedAt).not.toBe(snapshot.updatedAt)
})

test('applySessionCollaborationModeToSnapshot stores canonical mode and legacy derived flag', () => {
  const snapshot = {
    item: {
      id: 'session-1',
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      planModeActive: false,
    },
    settings: {
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      permissionMode: 'default',
      planModeActive: false,
      thinkingMode: 'default',
      additionalDirectories: [],
    },
    updatedAt: '2026-06-26T00:00:00.000Z',
  } as DesktopSessionSnapshot

  const updated = applySessionCollaborationModeToSnapshot(snapshot, {
    mode: 'plan',
  })

  expect(updated.item.collaborationMode).toEqual({ mode: 'plan' })
  expect(updated.settings.collaborationMode).toEqual({ mode: 'plan' })
  expect(updated.item.planModeActive).toBe(true)
  expect(updated.settings.planModeActive).toBe(true)
})

import { expect, test } from 'bun:test'
import {
  applySessionPermissionModeToSnapshot,
  createSessionSettingsSnapshot,
} from './desktopSessionSettings.js'
import type { DesktopSessionSnapshot } from '../shared/types.js'

test('createSessionSettingsSnapshot preserves requested permission mode', () => {
  const settings = createSessionSettingsSnapshot({
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'plan',
    thinkingMode: 'default',
    additionalDirectories: [],
    askUserQuestionMaxQuestions: 3,
  })

  expect(settings.permissionMode).toBe('plan')
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

  const updated = applySessionPermissionModeToSnapshot(snapshot, 'plan')

  expect(updated.item.permissionMode).toBe('plan')
  expect(updated.settings.permissionMode).toBe('plan')
  expect(updated.item.permissionProfile).toBe(':workspace')
  expect(updated.settings.permissionProfile).toBe(':workspace')
  expect(updated.updatedAt).not.toBe(snapshot.updatedAt)
})

import { expect, test } from 'bun:test'
import { shouldRestoreLastWorkspace } from './lastWorkspaceRestore.js'

test('restores the first recent workspace after settings load on quick chat', () => {
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: true,
      isQuickChatPage: true,
      hasCurrentWorkspace: false,
      hasAttemptedRestore: false,
      recentWorkspaceCount: 1,
    }),
  ).toBe(true)
})

test('does not restore before settings load or after the first attempt', () => {
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: false,
      isQuickChatPage: true,
      hasCurrentWorkspace: false,
      hasAttemptedRestore: false,
      recentWorkspaceCount: 1,
    }),
  ).toBe(false)
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: true,
      isQuickChatPage: true,
      hasCurrentWorkspace: false,
      hasAttemptedRestore: true,
      recentWorkspaceCount: 1,
    }),
  ).toBe(false)
})

test('does not restore outside quick chat, with an active workspace, or without recents', () => {
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: true,
      isQuickChatPage: false,
      hasCurrentWorkspace: false,
      hasAttemptedRestore: false,
      recentWorkspaceCount: 1,
    }),
  ).toBe(false)
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: true,
      isQuickChatPage: true,
      hasCurrentWorkspace: true,
      hasAttemptedRestore: false,
      recentWorkspaceCount: 1,
    }),
  ).toBe(false)
  expect(
    shouldRestoreLastWorkspace({
      settingsLoaded: true,
      isQuickChatPage: true,
      hasCurrentWorkspace: false,
      hasAttemptedRestore: false,
      recentWorkspaceCount: 0,
    }),
  ).toBe(false)
})

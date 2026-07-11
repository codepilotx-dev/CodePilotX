import { expect, test } from 'bun:test'
import {
  getDesktopComposerCanSubmit,
  getDesktopComposerBranchName,
} from './DesktopComposer.js'
import type { DesktopWorkspace } from '../../../shared/types.js'

test('getDesktopComposerBranchName returns correct branch name from workspace', () => {
  const workspace: DesktopWorkspace = {
    path: '/test/path',
    name: 'test-project',
    branchName: 'feature/login',
    isGitRepo: true,
    branches: ['main', 'feature/login'],
  }
  expect(getDesktopComposerBranchName(workspace)).toBe('feature/login')
})

test('getDesktopComposerBranchName handles null workspace', () => {
  expect(getDesktopComposerBranchName(null)).toBe('无项目')
})

test('getDesktopComposerBranchName handles non-git workspace', () => {
  const workspace: DesktopWorkspace = {
    path: '/test/path',
    name: 'test-project',
    isGitRepo: false,
  }
  expect(getDesktopComposerBranchName(workspace)).toBe('未检测到 Git 分支')
})

test('getDesktopComposerCanSubmit allows a running session with content', () => {
  expect(
    getDesktopComposerCanSubmit({
      hasContent: true,
      hasAttachmentErrors: false,
      unsupportedAttachmentReason: null,
      modelConfigured: true,
      isQuickChatPage: false,
      routedSessionId: 'session-1',
      sessionStatus: 'running',
    }),
  ).toBe(true)
})

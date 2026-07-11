import { expect, test } from 'bun:test'
import {
  getDesktopComposerCanSubmit,
  getDesktopComposerBranchName,
  submitDesktopComposerGoal,
} from './DesktopComposer.js'
import type {
  DesktopComposerAttachment,
  DesktopWorkspace,
} from '../../../shared/types.js'

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

test('submitDesktopComposerGoal restores input, attachments, and skill when setting the goal fails', async () => {
  const attachment: DesktopComposerAttachment = {
    id: 'attachment-1',
    name: 'note.txt',
    path: 'C:/workspace/note.txt',
    mediaType: 'text/plain',
    sizeBytes: 1,
    kind: 'text',
    status: 'ready',
  }
  const restored: string[] = []
  const errors: string[] = []
  const skill = {
    name: 'review',
    title: 'Review',
    description: 'Review the change',
    category: 'skill' as const,
    skillPath: 'skills/review.md',
  }

  await submitDesktopComposerGoal({
    routedSessionId: 'session-1',
    input: 'finish the task',
    attachments: [attachment],
    selectedSkillToken: skill,
    setSessionGoal: async () => {
      throw new Error('goal unavailable')
    },
    onInputChange: value => restored.push(`text:${value}`),
    onAttachmentsChange: value => restored.push(`attachments:${value.length}`),
    onSelectedSkillTokenChange: value =>
      restored.push(`skill:${value?.name ?? 'none'}`),
    onGoalModeChange: value => restored.push(`goal-mode:${value}`),
    onError: message => errors.push(message),
    onGoalCreated: async () => {},
  })

  expect(restored).toEqual([
    'text:finish the task',
    'attachments:1',
    'skill:review',
  ])
  expect(errors).toEqual(['goal unavailable'])
})

test('submitDesktopComposerGoal requests an authoritative session refresh after creation', async () => {
  const refreshedSessionIds: string[] = []

  await submitDesktopComposerGoal({
    routedSessionId: 'session-1',
    input: 'finish the task',
    attachments: [],
    selectedSkillToken: null,
    setSessionGoal: async () => {},
    onInputChange: () => {},
    onAttachmentsChange: () => {},
    onSelectedSkillTokenChange: () => {},
    onGoalModeChange: () => {},
    onError: () => {},
    onGoalCreated: async sessionId => {
      refreshedSessionIds.push(sessionId)
    },
  })

  expect(refreshedSessionIds).toEqual(['session-1'])
})

import { expect, test } from 'bun:test'
import {
  GOAL_MODE_SYSTEM_PROMPT,
  buildGoalModePrompt,
  getDesktopComposerBranchName,
} from './DesktopComposer.js'
import type { DesktopWorkspace } from '../../../shared/types.js'

test('buildGoalModePrompt wraps user text with goal execution instructions', () => {
  const userText = '实现用户登录功能'
  const result = buildGoalModePrompt(userText)

  expect(result).toContain(GOAL_MODE_SYSTEM_PROMPT)
  expect(result).toContain('The user\'s goal/plan:')
  expect(result).toContain('---')
  expect(result).toContain(userText)
  // The first instruction should be about reading AGENTS.md
  expect(result).toContain('First read AGENTS.md and relevant code')
  // Should include review before editing
  expect(result).toContain('Review the pasted plan/goal')
  // Should include subagents instruction
  expect(result).toContain('Use subagents')
  // Should include verification
  expect(result).toContain('Verify your work before reporting completion')
})

test('buildGoalModePrompt wraps multi-line goal text correctly', () => {
  const userText = `实现用户登录功能
1. 创建登录页面
2. 实现后端 API
3. 添加 JWT 验证`
  const result = buildGoalModePrompt(userText)

  expect(result).toContain('实现用户登录功能')
  expect(result).toContain('创建登录页面')
  expect(result).toContain('添加 JWT 验证')
  // Should be wrapped in the markdown separator
  const needle = `The user's goal/plan:\n---\n${userText}\n---`
  expect(result).toContain(needle)
})

test('buildGoalModePrompt always includes strict execution instructions', () => {
  const result = buildGoalModePrompt('test')

  // Key instructions must be present
  expect(result).toContain('goal execution mode')
  expect(result).toContain('Follow these instructions strictly')
  expect(result).toContain('AGENTS.md')
  expect(result).toContain('Execute in small stages')
  expect(result).toContain('Verify your work before reporting')
})

test('normal empty string does not break buildGoalModePrompt', () => {
  const result = buildGoalModePrompt('')
  expect(result).toContain(GOAL_MODE_SYSTEM_PROMPT)
  expect(result).toContain('---')
  // Empty goal text produces double-dash markers with nothing between
  expect(result).toContain('---\n\n---')
})

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

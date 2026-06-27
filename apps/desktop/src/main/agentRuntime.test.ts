import { expect, test } from 'bun:test'
import {
  askUserQuestionMaxQuestionsEnv,
  codexPermissionConfigForMode,
  codexPermissionConfigArgs,
  permissionModeArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
  rustSearchAndDiffKernelEnv,
} from './agentRuntime.js'
import { getToolUseId } from './agentRuntimeSupport.js'

test('codexPermissionConfigArgs maps desktop permissions to official config overrides', () => {
  expect(
    codexPermissionConfigArgs({
      sandboxMode: 'workspace-write',
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto',
    }),
  ).toEqual([
    '--config',
    'sandbox_mode="workspace-write"',
    '--config',
    'default_permissions=":workspace"',
    '--config',
    'approval_policy="on-request"',
    '--config',
    'approvals_reviewer="auto_review"',
  ])
  expect(codexPermissionConfigArgs({ permissionProfile: 'project-edit' })).toEqual([
    '--config',
    'default_permissions="project-edit"',
  ])
  expect(codexPermissionConfigArgs({})).toEqual([])
})

test('desktop runtimes use stdio permission prompt protocol', () => {
  expect(permissionPromptToolName()).toBe('stdio')
  expect(permissionPromptToolArgs()).toEqual([
    '--permission-prompt-tool',
    'stdio',
  ])
})

test('desktop runtime exports AskUserQuestion max questions env when configured', () => {
  expect(askUserQuestionMaxQuestionsEnv({})).toEqual({})
  expect(
    askUserQuestionMaxQuestionsEnv({ askUserQuestionMaxQuestions: 3 }),
  ).toEqual({
    CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS: '3',
  })
})

test('codexPermissionConfigForMode maps desktop modes to official Codex config', () => {
  expect(codexPermissionConfigForMode({ permissionMode: 'default' })).toEqual({
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  })
  expect(codexPermissionConfigForMode({ permissionMode: 'auto-review' })).toEqual({
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  })
  expect(codexPermissionConfigForMode({ permissionMode: 'full-access' })).toEqual({
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  })
  expect(
    codexPermissionConfigForMode({
      permissionMode: 'custom',
      sandboxMode: 'read-only',
      permissionProfile: 'managed',
      approvalPolicy: 'on-failure',
      approvalsReviewer: 'auto',
    }),
  ).toEqual({
    sandboxMode: 'read-only',
    permissionProfile: 'managed',
    approvalPolicy: 'on-failure',
    approvalsReviewer: 'auto_review',
  })
})

test('permissionModeArgs passes desktop plan mode to the TUI runtime', () => {
  expect(permissionModeArgs('custom')).toEqual([])
  expect(permissionModeArgs('full-access')).toEqual([
    '--dangerously-skip-permissions',
  ])
  expect(permissionModeArgs('auto-review')).toEqual([
    '--permission-mode',
    'default',
  ])
  expect(permissionModeArgs('plan')).toEqual(['--permission-mode', 'plan'])
})

test('desktop runtime exports Rust Glob Grep and Diff env when enabled', () => {
  expect(rustSearchAndDiffKernelEnv({})).toEqual({})
  expect(
    rustSearchAndDiffKernelEnv({ rustSearchAndDiffKernels: false }),
  ).toEqual({})
  expect(
    rustSearchAndDiffKernelEnv({ rustSearchAndDiffKernels: true }),
  ).toEqual({
    CODEPILOTX_RUST_GLOB: '1',
    CODEPILOTX_RUST_GREP: '1',
    CODEPILOTX_RUST_DIFF: '1',
  })
})

test('desktop runtime extracts tool use id from tool blocks', () => {
  expect(getToolUseId({ type: 'tool_use', id: 'call-question-1' })).toBe(
    'call-question-1',
  )
  expect(
    getToolUseId({
      type: 'tool_result',
      tool_use_id: 'call-question-1',
    }),
  ).toBe('call-question-1')
  expect(getToolUseId({ type: 'tool_result' })).toBeUndefined()
})

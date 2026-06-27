import { expect, test } from 'bun:test'
import {
  askUserQuestionMaxQuestionsEnv,
  codexPermissionConfigArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
} from './agentRuntime.js'
import { getToolUseId } from './agentRuntimeSupport.js'

test('codexPermissionConfigArgs maps desktop permissions to official config overrides', () => {
  expect(
    codexPermissionConfigArgs({
      permissionProfile: ':workspace',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    }),
  ).toEqual([
    '--config',
    'default_permissions=":workspace"',
    '--config',
    'approval_policy="on-request"',
    '--config',
    'approvals_reviewer="user"',
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

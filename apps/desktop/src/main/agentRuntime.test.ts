import { expect, test } from 'bun:test'
import {
  askUserQuestionMaxQuestionsEnv,
  codexPermissionConfigArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
} from './agentRuntime.js'

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

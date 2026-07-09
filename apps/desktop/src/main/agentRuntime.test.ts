import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'

const spawnedChildren: FakeChildProcess[] = []

class RecordingStdin extends Writable {
  writeCount = 0
  endCount = 0
  writes: string[] = []

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writeCount += 1
    this.writes.push(String(chunk))
    callback()
  }

  override end(cb?: () => void): this
  override end(chunk: unknown, cb?: () => void): this
  override end(chunk: unknown, encoding: BufferEncoding, cb?: () => void): this
  override end(
    chunkOrCallback?: unknown,
    encodingOrCallback?: BufferEncoding | (() => void),
    callback?: () => void,
  ): this {
    this.endCount += 1
    return super.end(chunkOrCallback as never, encodingOrCallback as never, callback)
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new RecordingStdin()
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('exit', null)
    return true
  }
}

mock.module('node:fs', () => ({
  ...fs,
  existsSync: () => true,
}))

mock.module('node:child_process', () => ({
  ...childProcess,
  spawn: mock(() => {
    const child = new FakeChildProcess()
    spawnedChildren.push(child)
    return child
  }),
}))

const agentRuntime = await import('./agentRuntime.js')
const {
  buildAskUserQuestionControlResponse,
  buildDesktopPermissionRequestFromControlRequest,
  codexPermissionConfigForMode,
  codexPermissionConfigArgs,
  createDesktopAgentRuntime,
  permissionModeArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
} = agentRuntime
import {
  getToolUseId,
  getUpdatedPermissions,
} from './agentRuntimeSupport.js'

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

test('permissionModeArgs only passes permission modes to the TUI runtime', () => {
  expect(permissionModeArgs('custom')).toEqual([])
  expect(permissionModeArgs('full-access')).toEqual([
    '--dangerously-skip-permissions',
  ])
  expect(permissionModeArgs('auto-review')).toEqual([
    '--permission-mode',
    'default',
  ])
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

test('desktop runtime carries stdio tool use id into permission requests', () => {
  expect(
    buildDesktopPermissionRequestFromControlRequest('request-1', {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'call-question-1',
      input: { questions: [] },
      description: 'Answer questions',
    }),
  ).toEqual({
    requestId: 'request-1',
    toolName: 'AskUserQuestion',
    toolUseId: 'call-question-1',
    input: { questions: [] },
    description: 'Answer questions',
  })
})

test('desktop runtime derives persistent prefix remember option only for prefix suggestions', () => {
  const request = buildDesktopPermissionRequestFromControlRequest('request-1', {
    subtype: 'can_use_tool',
    tool_name: 'PowerShell',
    input: { command: 'Get-ChildItem apps\\desktop' },
    description: 'List files',
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [
          { toolName: 'PowerShell', ruleContent: 'Get-ChildItem:*' },
          { toolName: 'Read', ruleContent: 'apps/**' },
        ],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
  })

  expect(request.rememberOptions).toEqual([
    {
      id: 'session',
      label: '是，且本会话不再询问匹配请求',
    },
    {
      id: 'persistentPrefix',
      label: '是，且以后对以 Get-ChildItem 开头的命令不再询问',
      hint: 'Get-ChildItem',
    },
  ])
})

test('desktop runtime session remember keeps updates session-scoped', () => {
  expect(
    getUpdatedPermissions(
      {
        permission_suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem apps' }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      },
      { behavior: 'allow', rememberOptionId: 'session' },
    ),
  ).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem apps' }],
      behavior: 'allow',
      destination: 'session',
    },
  ])
})

test('desktop runtime persistent prefix remember keeps only prefix allow rules', () => {
  expect(
    getUpdatedPermissions(
      {
        permission_suggestions: [
          {
            type: 'addRules',
            rules: [
              { toolName: 'PowerShell', ruleContent: 'Get-ChildItem:*' },
              { toolName: 'Read', ruleContent: 'apps/**' },
            ],
            behavior: 'allow',
            destination: 'localSettings',
          },
          {
            type: 'addDirectories',
            directories: ['D:/work'],
            destination: 'session',
          },
        ],
      },
      { behavior: 'allow', rememberOptionId: 'persistentPrefix' },
    ),
  ).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem:*' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ])
})

test('desktop runtime keeps legacy alwaysAllow behavior persistent', () => {
  expect(
    getUpdatedPermissions(
      {
        permission_suggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem apps' }],
            behavior: 'allow',
            destination: 'session',
          },
        ],
      },
      { behavior: 'allow', alwaysAllow: true },
    ),
  ).toEqual([
    {
      type: 'addRules',
      rules: [{ toolName: 'PowerShell', ruleContent: 'Get-ChildItem apps' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ])
})

test('desktop runtime builds AskUserQuestion resume control response', () => {
  expect(
    buildAskUserQuestionControlResponse({
      requestId: 'request-1',
      toolUseId: 'call-question-1',
      updatedInput: { answers: { 'First choice?': 'A' } },
    }),
  ).toEqual(
    {
      type: 'control_response',
      response: {
        request_id: 'request-1',
        subtype: 'success',
        response: {
          behavior: 'allow',
          updatedInput: { answers: { 'First choice?': 'A' } },
          toolUseID: 'call-question-1',
          decisionClassification: 'user_temporary',
        },
      },
    },
  )
})

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
  appendCappedText,
  buildAskUserQuestionControlResponse,
  buildDesktopPermissionRequestFromControlRequest,
  codexPermissionConfigForMode,
  codexPermissionConfigArgs,
  createDesktopAgentRuntime,
  permissionModeArgs,
  permissionPromptToolArgs,
  permissionPromptToolName,
  rustSearchAndDiffKernelEnv,
} = agentRuntime
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

test('appendCappedText preserves the newest stderr tail inside the cap', () => {
  expect(appendCappedText('abcdef', 'ghijkl', 8)).toBe('efghijkl')
  expect(appendCappedText('', 'tool stderr', 32)).toBe('tool stderr')
})

test('subprocess runtime does not emit stderr chunks as tool results', async () => {
  spawnedChildren.length = 0
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'stderr-session',
    workspacePath: '/workspace',
    agentExecutablePath: '/fake/codex',
    runtimePreference: 'subprocess',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  const turn = runtime.runUserTurn('hello', new AbortController().signal)
  const child = spawnedChildren.at(-1)
  if (!child) throw new Error('expected subprocess child')

  child.stderr.write('stderr line 1\n')
  child.stdout.end()
  child.emit('exit', 1)

  await expect(turn).rejects.toThrow('stderr line 1')
  expect(events.filter(event => event.type === 'tool_result')).toHaveLength(0)
})

test('subprocess result after partial streaming emits the final assistant message only once', async () => {
  spawnedChildren.length = 0
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'partial-session',
    workspacePath: '/workspace',
    agentExecutablePath: '/fake/codex',
    runtimePreference: 'subprocess',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  const turn = runtime.runUserTurn('hello', new AbortController().signal)
  const child = spawnedChildren.at(-1)
  if (!child) throw new Error('expected subprocess child')

  child.stdout.write(
    `${JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        ],
      },
    })}\n`,
  )
  child.stdout.write(
    `${JSON.stringify({ type: 'result', result: 'Hello world' })}\n`,
  )
  child.stdout.write(
    `${JSON.stringify({ type: 'result', result: 'Hello world' })}\n`,
  )
  child.stdout.end()
  child.emit('exit', 0)

  await turn
  expect(
    events.filter(
      event => event.type === 'message' && event.role === 'assistant',
    ),
  ).toHaveLength(1)
})

test('subprocess duplicate result does not emit after partial already reached final text', async () => {
  spawnedChildren.length = 0
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'partial-equals-result-session',
    workspacePath: '/workspace',
    agentExecutablePath: '/fake/codex',
    runtimePreference: 'subprocess',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  const turn = runtime.runUserTurn('hello', new AbortController().signal)
  const child = spawnedChildren.at(-1)
  if (!child) throw new Error('expected subprocess child')

  child.stdout.write(
    `${JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        ],
      },
    })}\n`,
  )
  child.stdout.write(`${JSON.stringify({ type: 'result', result: 'Hello' })}\n`)
  child.stdout.write(`${JSON.stringify({ type: 'result', result: 'Hello' })}\n`)
  child.stdout.end()
  child.emit('exit', 0)

  await turn
  expect(
    events.filter(
      event => event.type === 'message' && event.role === 'assistant',
    ),
  ).toHaveLength(0)
})

test('subprocess result does not close stdin inside emitResultMessage', async () => {
  const runtime = createDesktopAgentRuntime({
    sessionId: 'stdin-session',
    workspacePath: '/workspace',
    agentExecutablePath: '/fake/codex',
    runtimePreference: 'subprocess',
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  }) as Record<string, unknown>
  const child = new FakeChildProcess()

  runtime.child = child
  runtime.emittedAssistantText = false
  runtime.partialText = ''

  await (runtime.emitResultMessage as (message: Record<string, unknown>) => Promise<void>)({
    type: 'result',
    result: 'done',
  })

  expect(child.stdin.endCount).toBe(0)
})

import { expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { PassThrough, Writable } from 'node:stream'

const spawnedChildren: FakeChildProcess[] = []
const appServerClients: FakeCodexAppServerClient[] = []
const headlessRuntimes: FakeDesktopHeadlessRuntime[] = []

class FakeCodexAppServerClient {
  static failStart = false
  static deferStartTurn = false
  readonly options: Record<string, unknown>
  readonly notifications = new Set<(notification: Record<string, unknown>) => void>()
  readonly requests = new Set<(request: Record<string, unknown>) => void>()
  started = false
  shutdownCalled = false
  startThreadCalls: Record<string, unknown>[] = []
  resumeThreadCalls: string[] = []
  startTurnCalls: Record<string, unknown>[] = []
  interruptTurnCalls: Record<string, unknown>[] = []
  responses: Array<{ id: unknown; result: unknown }> = []
  responseErrors: Array<{ id: unknown; code: number; message: string; data?: unknown }> = []
  nextThreadId = 'thread-app-1'
  nextTurnId = 'turn-app-1'
  resolveDeferredStartTurn:
    | ((result: { turn: { id: string; status: string; items: unknown[] } }) => void)
    | null = null

  constructor(options: Record<string, unknown>) {
    this.options = options
    appServerClients.push(this)
  }

  async start() {
    if (FakeCodexAppServerClient.failStart) {
      throw new Error('app-server unavailable')
    }
    this.started = true
    return { userAgent: 'test', codexHome: '/tmp/codex' }
  }

  async shutdown() {
    this.shutdownCalled = true
  }

  startThread(params: Record<string, unknown>) {
    this.startThreadCalls.push(params)
    return Promise.resolve({
      thread: {
        id: this.nextThreadId,
        preview: '',
        modelProvider: 'openai',
        createdAt: 1,
      },
    })
  }

  resumeThread(threadId: string) {
    this.resumeThreadCalls.push(threadId)
    return Promise.resolve({
      thread: {
        id: threadId,
        preview: '',
        modelProvider: 'openai',
        createdAt: 1,
      },
    })
  }

  startTurn(params: Record<string, unknown>) {
    this.startTurnCalls.push(params)
    if (FakeCodexAppServerClient.deferStartTurn) {
      return new Promise(resolve => {
        this.resolveDeferredStartTurn = resolve
      })
    }
    return Promise.resolve({
      turn: {
        id: this.nextTurnId,
        status: 'completed',
        items: [],
      },
    })
  }

  interruptTurn(params: Record<string, unknown>) {
    this.interruptTurnCalls.push(params)
    return Promise.resolve()
  }

  onNotification(handler: (notification: Record<string, unknown>) => void) {
    this.notifications.add(handler)
    return () => this.notifications.delete(handler)
  }

  onRequest(handler: (request: Record<string, unknown>) => void) {
    this.requests.add(handler)
    return () => this.requests.delete(handler)
  }

  respondToRequest(id: unknown, result: unknown) {
    this.responses.push({ id, result })
  }

  respondToRequestError(id: unknown, code: number, message: string, data?: unknown) {
    this.responseErrors.push({ id, code, message, data })
  }

  emitNotification(notification: Record<string, unknown>) {
    for (const handler of this.notifications) {
      handler(notification)
    }
  }

  emitRequest(request: Record<string, unknown>) {
    for (const handler of this.requests) {
      handler(request)
    }
  }
}

class FakeDesktopHeadlessRuntime {
  model: string | undefined
  providerID: string | undefined
  providerBaseURL: string | undefined
  debugConversationDump = false

  constructor(readonly options: Record<string, unknown>) {
    headlessRuntimes.push(this)
  }

  setModel(model: string | undefined) {
    this.model = model
  }

  setProvider(providerID: string | undefined, providerBaseURL: string | undefined) {
    this.providerID = providerID
    this.providerBaseURL = providerBaseURL
  }

  setPermissionMode() {}

  setCodexPermissionConfig() {}

  setDebugConversationDump(enabled: boolean) {
    this.debugConversationDump = enabled
  }
}

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

mock.module('@codepilotx/codex-app-server-client', () => ({
  CodexAppServerClient: FakeCodexAppServerClient,
}))

mock.module('@codepilotx/tui/headless/desktopRuntime.js', () => ({
  createDesktopHeadlessRuntime: (options: Record<string, unknown>) =>
    new FakeDesktopHeadlessRuntime(options),
  runDesktopHeadlessTurn: async (
    runtime: FakeDesktopHeadlessRuntime,
    _content: unknown,
    signal: AbortSignal,
  ) => {
    if (signal.aborted) return
    const onOutput = runtime.options.onOutput as
      | ((message: Record<string, unknown>, controls: Record<string, unknown>) => Promise<void>)
      | undefined
    await onOutput?.({ type: 'result', result: 'embedded fallback' }, {})
  },
  runDesktopHeadlessControlResponse: async () => undefined,
}))

mock.module('axios', () => ({
  default: {
    create: () => ({
      get: mock(() => Promise.resolve({ data: {} })),
      post: mock(() => Promise.resolve({ data: {} })),
      interceptors: {
        request: { use: mock() },
        response: { use: mock() },
      },
    }),
  },
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

function resetAppServerClientFakes(): void {
  appServerClients.length = 0
  headlessRuntimes.length = 0
  FakeCodexAppServerClient.failStart = false
  FakeCodexAppServerClient.deferStartTurn = false
}

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

test('auto runtime starts app-server thread and turn before falling back to embedded runtime', async () => {
  resetAppServerClientFakes()
  const events: Array<Record<string, unknown>> = []
  const threadIds: string[] = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-session',
    workspacePath: '/workspace',
    configDirectoryPath: '/codex-home',
    runtimePreference: 'auto',
    model: 'gpt-test',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
    onCodexAppServerThreadId: threadId => threadIds.push(threadId),
  })

  await runtime.runUserTurn('hello', new AbortController().signal)

  const client = appServerClients.at(-1)
  expect(client?.started).toBe(true)
  expect(client?.startThreadCalls).toEqual([
    {
      cwd: '/workspace',
      model: 'gpt-test',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      threadSource: 'codepilotx_desktop',
    },
  ])
  expect(client?.startTurnCalls).toEqual([
    {
      threadId: 'thread-app-1',
      input: [{ type: 'text', text: 'hello' }],
      cwd: '/workspace',
      model: 'gpt-test',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    },
  ])
  expect(threadIds).toEqual(['thread-app-1'])
  expect(events).toContainEqual({
    type: 'status',
    sessionId: 'app-server-session',
    status: 'done',
  })
})

test('app-server runtime resumes an existing thread id', async () => {
  resetAppServerClientFakes()
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-resume-session',
    workspacePath: '/workspace',
    runtimePreference: 'app-server',
    codexAppServerThreadId: 'thread-existing',
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  await runtime.runUserTurn('hello', new AbortController().signal)

  const client = appServerClients.at(-1)
  expect(client?.startThreadCalls).toEqual([])
  expect(client?.resumeThreadCalls).toEqual(['thread-existing'])
  expect(client?.startTurnCalls[0]?.threadId).toBe('thread-existing')
})

test('app-server runtime maps notifications to desktop events', async () => {
  resetAppServerClientFakes()
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-events-session',
    workspacePath: '/workspace',
    runtimePreference: 'app-server',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  await runtime.runUserTurn('hello', new AbortController().signal)
  const client = appServerClients.at(-1)
  client?.emitNotification({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'thread-app-1',
      turnId: 'turn-app-1',
      itemId: 'item-message-1',
      delta: 'Hello',
    },
  })
  client?.emitNotification({
    method: 'item/commandExecution/outputDelta',
    params: {
      threadId: 'thread-app-1',
      turnId: 'turn-app-1',
      itemId: 'item-command-1',
      delta: 'npm test',
    },
  })
  client?.emitNotification({
    method: 'error',
    params: { message: 'server warning' },
  })

  expect(events).toContainEqual({
    type: 'partial_message',
    sessionId: 'app-server-events-session',
    text: 'Hello',
    sourceThreadId: 'thread-app-1',
  })
  expect(events).toContainEqual({
    type: 'tool_result',
    sessionId: 'app-server-events-session',
    toolName: 'Command',
    summary: 'npm test',
    toolUseId: 'item-command-1',
    sourceThreadId: 'thread-app-1',
  })
  expect(events).toContainEqual({
    type: 'message',
    sessionId: 'app-server-events-session',
    role: 'system',
    text: 'server warning',
  })
})

test('app-server runtime handles turn completion before turn start response', async () => {
  resetAppServerClientFakes()
  FakeCodexAppServerClient.deferStartTurn = true
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-out-of-order-session',
    workspacePath: '/workspace',
    runtimePreference: 'app-server',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  const turn = runtime.runUserTurn('hello', new AbortController().signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  const client = appServerClients.at(-1)
  client?.emitNotification({
    method: 'turn/completed',
    params: {
      threadId: 'thread-app-1',
      turn: {
        id: 'turn-app-1',
        status: 'completed',
        items: [],
      },
    },
  })
  client?.resolveDeferredStartTurn?.({
    turn: {
      id: 'turn-app-1',
      status: 'inProgress',
      items: [],
    },
  })

  await turn
  expect(events).toContainEqual({
    type: 'status',
    sessionId: 'app-server-out-of-order-session',
    status: 'done',
  })
})

test('app-server runtime bridges command approval requests to desktop permissions', async () => {
  resetAppServerClientFakes()
  const permissionRequests: Array<Record<string, unknown>> = []
  let resolvePermission:
    | ((decision: { behavior: 'allow'; alwaysAllow?: boolean }) => void)
    | null = null
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-permission-session',
    workspacePath: '/workspace',
    runtimePreference: 'app-server',
    emit: () => undefined,
    requestPermission: request =>
      new Promise(resolve => {
        permissionRequests.push(request as Record<string, unknown>)
        resolvePermission = resolve
      }),
  })

  await runtime.runUserTurn('hello', new AbortController().signal)
  const client = appServerClients.at(-1)
  const bridge = new Promise<void>(resolve => {
    setTimeout(resolve, 0)
  })
  client?.emitRequest({
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-app-1',
      turnId: 'turn-app-1',
      itemId: 'item-command-1',
      command: 'npm test',
      cwd: '/workspace',
      reason: 'Need to test',
    },
  })
  await bridge
  expect(permissionRequests).toEqual([
    {
      requestId: '7',
      toolName: 'Command',
      toolUseId: 'item-command-1',
      input: {
        command: 'npm test',
        cwd: '/workspace',
        reason: 'Need to test',
      },
      description: 'Need to test',
      requestKind: 'shell-command',
    },
  ])

  resolvePermission?.({ behavior: 'allow', alwaysAllow: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(client?.responses).toEqual([
    { id: 7, result: { decision: 'acceptForSession' } },
  ])
})

test('auto runtime falls back when app-server fails to start', async () => {
  resetAppServerClientFakes()
  FakeCodexAppServerClient.failStart = true
  const events: Array<Record<string, unknown>> = []
  const runtime = createDesktopAgentRuntime({
    sessionId: 'app-server-fallback-session',
    workspacePath: '/workspace',
    runtimePreference: 'auto',
    emit: event => events.push(event as Record<string, unknown>),
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  await runtime.runUserTurn('hello', new AbortController().signal)

  expect(appServerClients).toHaveLength(1)
  expect(headlessRuntimes).toHaveLength(1)
  expect(events).toContainEqual({
    type: 'message',
    sessionId: 'app-server-fallback-session',
    role: 'assistant',
    text: 'embedded fallback',
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

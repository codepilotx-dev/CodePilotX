import { expect, mock, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  createDesktopAgentSession,
  permissionActionForDesktopTool,
  resolveDesktopPermissionPolicyDecision,
} from './agentSession.js'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import type { DesktopAgentEvent } from '../shared/types.js'
import type { DesktopAutoReviewService } from './autoReviewService.js'

test('permissionActionForDesktopTool maps common desktop tools to policy actions', () => {
  expect(permissionActionForDesktopTool('Read')).toBe('read')
  expect(permissionActionForDesktopTool('Edit')).toBe('write')
  expect(permissionActionForDesktopTool('Bash')).toBe('shell')
  expect(permissionActionForDesktopTool('WebFetch')).toBe('network')
  expect(permissionActionForDesktopTool('mcp__docs__search')).toBe('mcp')
  expect(permissionActionForDesktopTool('UnknownTool')).toBe('shell')
})

test('resolveDesktopPermissionPolicyDecision short-circuits allow and deny effects only', () => {
  const request = {
    requestId: 'permission-1',
    toolName: 'Bash',
    input: {},
    description: 'Run command',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':danger-full-access',
        approvalMode: 'never',
        sandboxMode: 'danger-full-access',
        actionScopes: {
          shell: 'allow',
        },
      },
      request,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
        toolOverrides: {
          Bash: {
            shell: 'deny',
          },
        },
      },
      request,
    ),
  ).toEqual({
    behavior: 'deny',
    message: 'Permission denied by :workspace permission profile',
  })

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
    ),
  ).toBe(null)
})

test('workspace-write policy allows ordinary workspace edits', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-edit',
    toolName: 'Edit',
    input: {
      file_path: join(workspacePath, 'src', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('auto-review workspace-write policy allows ordinary workspace writes', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-write',
    toolName: 'Write',
    input: {
      file_path: join(workspacePath, 'src', 'created.ts'),
    },
    description: 'Write file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('workspace-write policy still prompts for edits outside the workspace', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-outside',
    toolName: 'Edit',
    input: {
      file_path: resolve('tmp', 'other-workspace', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('workspace-write policy still prompts for sensitive workspace paths', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const sensitivePaths = [
    join(workspacePath, '.git', 'config'),
    join(workspacePath, '.claude', 'settings.json'),
    join(workspacePath, '.vscode', 'settings.json'),
    join(workspacePath, 'src', '.gitconfig'),
    join(workspacePath, 'src', '.bashrc'),
  ]

  for (const filePath of sensitivePaths) {
    expect(
      resolveDesktopPermissionPolicyDecision(
        {
          profile: ':workspace',
          approvalMode: 'on-request',
          sandboxMode: 'workspace-write',
        },
        {
          requestId: `permission-sensitive-${filePath}`,
          toolName: 'Edit',
          input: {
            file_path: filePath,
          },
          description: 'Edit file',
        },
        workspacePath,
      ),
    ).toBe(null)
  }
})

test('workspace-write policy still prompts for network paths', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-network',
    toolName: 'Edit',
    input: {
      file_path: '\\\\server\\share\\index.ts',
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':workspace',
        approvalMode: 'on-request',
        sandboxMode: 'workspace-write',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('custom read-only policy still prompts for workspace writes', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-custom',
    toolName: 'Edit',
    input: {
      file_path: join(workspacePath, 'src', 'index.ts'),
    },
    description: 'Edit file',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':read-only',
        approvalMode: 'on-request',
        sandboxMode: 'read-only',
      },
      request,
      workspacePath,
    ),
  ).toBe(null)
})

test('full access policy still allows every desktop tool action', () => {
  const workspacePath = resolve('tmp', 'desktop-workspace')
  const request = {
    requestId: 'permission-bypass',
    toolName: 'Bash',
    input: {
      command: 'git status',
    },
    description: 'Run command',
  }

  expect(
    resolveDesktopPermissionPolicyDecision(
      {
        profile: ':danger-full-access',
        approvalMode: 'never',
        sandboxMode: 'danger-full-access',
        actionScopes: {
          shell: 'allow',
        },
      },
      request,
      workspacePath,
    ),
  ).toEqual({
    behavior: 'allow',
    alwaysAllow: true,
  })
})

test('auto-review session routes shell approval through reviewer without emitting user permission request', async () => {
  const events: DesktopAgentEvent[] = []
  const decisions: unknown[] = []
  const autoReviewService: DesktopAutoReviewService = {
    review: async () => ({
      type: 'decision',
      decision: {
        behavior: 'allow',
        alwaysAllow: false,
      },
      assessment: {
        outcome: 'allow',
        riskLevel: 'low',
        userAuthorization: 'unknown',
        rationale: 'reviewed as low risk',
      },
      reason: 'reviewed as low risk',
    }),
  }
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-auto-review',
      suppressStartupMessage: true,
      permissionMode: 'auto-review',
      approvalsReviewer: 'auto_review',
    },
    {
      autoReviewService,
      createRuntime: context => createPermissionRuntime(context, decisions),
    },
  )
  session.on('event', event => events.push(event))

  await session.sendUserMessage('run command', 'run command')

  expect(decisions).toEqual([
    {
      behavior: 'allow',
      alwaysAllow: false,
    },
  ])
  expect(events.some(event => event.type === 'permission_request')).toBe(false)
})

test('auto-review reviewer failures fail closed without user permission fallback', async () => {
  const events: DesktopAgentEvent[] = []
  const decisions: unknown[] = []
  const autoReviewService: DesktopAutoReviewService = {
    review: async () => ({
      type: 'decision',
      decision: {
        behavior: 'deny',
        message: 'Automatic approval review failed: Reviewer returned invalid JSON',
      },
      assessment: {
        outcome: 'deny',
        riskLevel: 'high',
        userAuthorization: 'unknown',
        rationale:
          'Automatic approval review failed: Reviewer returned invalid JSON',
      },
      reason: 'Reviewer returned invalid JSON',
    }),
  }
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-auto-review-fallback',
      suppressStartupMessage: true,
      permissionMode: 'auto-review',
      approvalsReviewer: 'auto_review',
    },
    {
      autoReviewService,
      createRuntime: context => createPermissionRuntime(context, decisions),
    },
  )
  session.on('event', event => events.push(event))

  await session.sendUserMessage('run command', 'run command')

  expect(events.some(event => event.type === 'permission_request')).toBe(false)
  expect(decisions).toEqual([
    {
      behavior: 'deny',
      message: 'Automatic approval review failed: Reviewer returned invalid JSON',
    },
  ])
  expect(events.filter(event => event.type === 'guardian_review')).toHaveLength(2)
})

test('recovered AskUserQuestion permission injects control response into runtime', async () => {
  const controlResponses: Record<string, unknown>[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-recovered-question',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    {
      createRuntime: () => createRecoveredQuestionRuntime(controlResponses),
    },
  )

  await session.respondToRecoveredAskUserQuestion(
    {
      requestId: 'permission-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'call-question-1',
      input: { questions: [] },
      description: 'Answer question',
    },
    {
      behavior: 'allow',
      updatedInput: { answers: { 'First choice?': 'A' } },
    },
  )

  expect(controlResponses).toEqual([
    {
      type: 'control_response',
      response: {
        request_id: 'permission-1',
        subtype: 'success',
        response: {
          behavior: 'allow',
          updatedInput: { answers: { 'First choice?': 'A' } },
          toolUseID: 'call-question-1',
          decisionClassification: 'user_temporary',
        },
      },
    },
  ])
})

test('recovered ExitPlanMode approval starts implementation turn', async () => {
  const userTurns: unknown[] = []
  const models: unknown[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-recovered-plan',
      suppressStartupMessage: true,
      permissionMode: 'default',
      planModeActive: true,
    },
    {
      createRuntime: () => createRecoveredPlanRuntime(userTurns, models),
    },
  )

  await session.respondToRecoveredExitPlanMode(
    {
      requestId: 'plan-permission-1',
      toolName: 'ExitPlanMode',
      input: { plan: '# 计划\n\n- 实施功能' },
      description: '确认计划',
    },
    { behavior: 'allow', planExecutionModel: 'default' },
  )

  expect(userTurns).toHaveLength(1)
  expect(models).toEqual(['default'])
  expect(String(userTurns[0])).toContain('用户已批准以下计划')
  expect(String(userTurns[0])).toContain('# 计划\n\n- 实施功能')
})

test('recovered ExitPlanMode with provider info calls setModelProvider', async () => {
  const userTurns: unknown[] = []
  const modelProviderCalls: Array<{ providerID: string | undefined; model: string | undefined; baseURL: string | undefined }> = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-recovered-plan-provider',
      suppressStartupMessage: true,
      permissionMode: 'default',
      planModeActive: true,
    },
    {
      createRuntime: () => createRecoveredPlanRuntime(userTurns, [], modelProviderCalls),
    },
  )

  await session.respondToRecoveredExitPlanMode(
    {
      requestId: 'plan-permission-2',
      toolName: 'ExitPlanMode',
      input: { plan: '# 计划\n\n- 实施功能' },
      description: '确认计划',
    },
    {
      behavior: 'allow',
      planExecutionProviderID: 'anthropic',
      planExecutionModel: 'claude-sonnet-4-20250514',
      planExecutionProviderBaseURL: 'https://api.anthropic.com',
    },
  )

  expect(userTurns).toHaveLength(1)
  expect(modelProviderCalls).toHaveLength(1)
  expect(modelProviderCalls[0]).toEqual({
    providerID: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    baseURL: 'https://api.anthropic.com',
  })
  expect(String(userTurns[0])).toContain('用户已批准以下计划')
  expect(String(userTurns[0])).toContain('# 计划\n\n- 实施功能')
})

test('model switch during an existing conversation emits a system notice', async () => {
  const events: DesktopAgentEvent[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-model-switch-notice',
      suppressStartupMessage: true,
      permissionMode: 'default',
      providerID: 'deepseek',
      model: 'deepseek-v4-flash',
    },
    {
      createRuntime: () => createRecoveredPlanRuntime([], []),
    },
  )
  session.on('event', event => events.push(event))

  await session.sendUserMessage('hello', 'hello')
  events.length = 0

  session.setModelProvider('deepseek', 'deepseek-v4-pro', undefined)

  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'message',
      role: 'system',
      text: '模型已从 deepseek-v4-flash 更改为 deepseek-v4-pro',
    }),
  )
})

test('auto-review sub-runtime execution does not deadlock parent turn on serial queue', async () => {
  const decisions: unknown[] = []
  const events: DesktopAgentEvent[] = []
  let subRuntimeCompleted = false

  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-deadlock-test',
      suppressStartupMessage: true,
      permissionMode: 'auto-review',
      approvalsReviewer: 'auto_review',
    },
    {
	    createRuntime: context => ({
        setModel: () => {},
        setModelProvider: () => {},
        setDebugConversationDump: () => {},
        setPermissionMode: () => {},
        setPlanModeActive: () => {},
        getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
        dispose: async () => {},
        runControlResponse: async () => {},
        async runUserTurn(_content, signal) {
          const decision = await context.requestPermission({
            requestId: 'permission-during-turn',
            toolName: 'PowerShell',
            input: { command: 'echo ok' },
            description: 'Test command',
          })
          decisions.push(decision)
        },
      }),
      autoReviewService: {
        review: async () => {
          subRuntimeCompleted = true
          return {
            type: 'decision',
            decision: { behavior: 'allow', alwaysAllow: false },
            assessment: {
              outcome: 'allow',
              riskLevel: 'low',
              userAuthorization: 'unknown',
              rationale: 'reviewer completed without deadlock',
            },
            reason: 'reviewer completed without deadlock',
          }
        },
      },
    },
  )
  session.on('event', event => events.push(event))

  await session.sendUserMessage('test', 'test')

  expect(subRuntimeCompleted).toBe(true)
  expect(decisions).toEqual([{ behavior: 'allow', alwaysAllow: false }])
})

test('session rejects a second AskUserQuestion while one is pending', async () => {
  const permissionRequests: DesktopAgentEvent[] = []
  const decisions: unknown[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-question-pending',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    {
      createRuntime: context => createDoubleQuestionRuntime(context, decisions),
    },
  )
  session.on('event', event => {
    if (event.type !== 'permission_request') return
    permissionRequests.push(event)
    if (event.request.requestId === 'question-1') {
      setTimeout(() => {
        void session.respondToPermission('question-1', {
          behavior: 'allow',
          updatedInput: { answers: { 'First?': 'Yes' } },
        })
      }, 0)
    }
    if (event.request.requestId === 'question-2') {
      void session.respondToPermission(event.request.requestId, {
        behavior: 'deny',
        message: 'user denied',
      })
    }
  })

  await session.sendUserMessage('ask questions', 'ask questions')

  expect(
    permissionRequests.filter(
      event =>
        event.type === 'permission_request' &&
        event.request.toolName === 'AskUserQuestion',
    ),
  ).toHaveLength(1)
  expect(decisions).toEqual([
    {
      behavior: 'deny',
      message:
        'AskUserQuestion is already waiting for a user answer. Wait for that answer before asking another dependent question, or combine independent questions into one questions array.',
    },
    {
      behavior: 'allow',
      updatedInput: { answers: { 'First?': 'Yes' } },
    },
  ])
})

test('interrupted session emits a done event after runtime observes abort', async () => {
  const events: DesktopAgentEvent[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-interrupt-done',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    {
      createRuntime: () => createAbortAwareRuntime(),
    },
  )
  session.on('event', event => events.push(event))

  const turn = session.sendUserMessage('run command', 'run command')
  await Promise.resolve()
  await session.interrupt()
  await turn

  expect(events.some(event => event.type === 'done')).toBe(true)
})

test('disposing a session rejects pending permission with dispose reason', async () => {
  const decisions: unknown[] = []
  let sawPermissionRequest: (() => void) | undefined
  const permissionRequested = new Promise<void>(resolve => {
    sawPermissionRequest = resolve
  })
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-dispose-pending-permission',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    {
      createRuntime: context => createPermissionRuntime(context, decisions),
    },
  )
  session.on('event', event => {
    if (event.type === 'permission_request') {
      sawPermissionRequest?.()
    }
  })

  const turn = session.sendUserMessage('run command', 'run command')
  await permissionRequested
  await session.dispose()
  await turn

  expect(decisions).toEqual([
    {
      behavior: 'deny',
      message: 'Session disposed before approval',
    },
  ])
})

test('disposing a session awaits runtime disposal and is idempotent', async () => {
  let releaseDispose: (() => void) | undefined
  const runtimeDisposed = new Promise<void>(resolve => {
    releaseDispose = resolve
  })
  const dispose = mock(async () => {
    await runtimeDisposed
  })
  const runtime: DesktopAgentRuntime = {
    setModel: () => {},
    setModelProvider: () => {},
    setDebugConversationDump: () => {},
    setPermissionMode: () => {},
    setPlanModeActive: () => {},
    getMcpRuntimeStatus: () => ({
      servers: [],
      totalTools: 0,
      totalResources: 0,
      totalPrompts: 0,
    }),
    refreshMcpConfig: async () => 'not_loaded',
    runUserTurn: async () => {},
    runControlResponse: async () => {},
    dispose,
  }
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-runtime-dispose',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    { createRuntime: () => runtime },
  )

  let settled = false
  const firstDispose = session.dispose().then(() => {
    settled = true
  })
  const secondDispose = session.dispose()
  await Promise.resolve()
  expect(settled).toBe(false)
  releaseDispose?.()
  await Promise.all([firstDispose, secondDispose])

  expect(dispose).toHaveBeenCalledTimes(1)
})

test('permission requested after dispose abort resolves instead of hanging', async () => {
  const decisions: unknown[] = []
  const session = createDesktopAgentSession(
    {
      workspacePath: resolve('tmp', 'desktop-workspace'),
      sessionId: 'session-late-permission-after-dispose',
      suppressStartupMessage: true,
      permissionMode: 'default',
    },
    {
      createRuntime: context => createLatePermissionAfterAbortRuntime(context, decisions),
    },
  )

  const turn = session.sendUserMessage('run command', 'run command')
  await Promise.resolve()
  await session.dispose()
  await expect(settlesWithin(turn, 100)).resolves.toBe('settled')

  expect(decisions).toEqual([
    {
      behavior: 'deny',
      message: 'Session disposed before approval',
    },
  ])
})

function createRecoveredQuestionRuntime(
  controlResponses: Record<string, unknown>[],
): DesktopAgentRuntime {
  return {
    setModel: () => {},
    setModelProvider: () => {},
    setDebugConversationDump: () => {},
    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runUserTurn: async () => {},
	    runControlResponse: async response => {
      controlResponses.push(response)
    },
  }
}

function createRecoveredPlanRuntime(
  userTurns: unknown[],
  models: unknown[] = [],
  modelProviderCalls?: Array<{ providerID: string | undefined; model: string | undefined; baseURL: string | undefined }>,
): DesktopAgentRuntime {
  return {
    setModel: model => {
      models.push(model)
    },
    setModelProvider: (providerID, model, baseURL) => {
      if (modelProviderCalls) {
        modelProviderCalls.push({ providerID, model, baseURL })
      }
    },
    setDebugConversationDump: () => {},
    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runControlResponse: async () => {},
	    runUserTurn: async content => {
	      userTurns.push(content)
	    },
	  }
	}

	function createAbortAwareRuntime(): DesktopAgentRuntime {
	  return {
	    setModel: () => {},
	    setModelProvider: () => {},
	    setDebugConversationDump: () => {},
	    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runControlResponse: async () => {},
	    async runUserTurn(_content, signal) {
      if (signal.aborted) return
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
  }
}

function createDoubleQuestionRuntime(
  context: DesktopAgentRuntimeContext,
  decisions: unknown[],
): DesktopAgentRuntime {
  return {
    setModel: () => {},
    setModelProvider: () => {},
    setDebugConversationDump: () => {},
    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runControlResponse: async () => {},
	    async runUserTurn() {
	      const firstDecision = context.requestPermission({
	        requestId: 'question-1',
	        toolName: 'AskUserQuestion',
	        input: questionInput('First?'),
	        description: 'Answer first question',
	      })
	      await Promise.resolve()
	      decisions.push(
	        await context.requestPermission({
	          requestId: 'question-2',
	          toolName: 'AskUserQuestion',
	          input: questionInput('Second?'),
	          description: 'Answer second question',
	        }),
	      )
	      decisions.push(await firstDecision)
	    },
	  }
	}

	function createPermissionRuntime(
	  context: DesktopAgentRuntimeContext,
	  decisions: unknown[],
	): DesktopAgentRuntime {
	  return {
	    setModel: () => {},
	    setModelProvider: () => {},
	    setDebugConversationDump: () => {},
	    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runControlResponse: async () => {},
	    async runUserTurn() {
	      const decision = await context.requestPermission({
	        requestId: 'permission-1',
	        toolName: 'PowerShell',
	        input: { command: 'echo ok' },
	        description: 'Run shell',
	      })
	      decisions.push(decision)
	    },
	  }
	}

	function createLatePermissionAfterAbortRuntime(
	  context: DesktopAgentRuntimeContext,
	  decisions: unknown[],
	): DesktopAgentRuntime {
	  return {
	    setModel: () => {},
	    setModelProvider: () => {},
	    setDebugConversationDump: () => {},
	    setPermissionMode: () => {},
	    setPlanModeActive: () => {},
      getMcpRuntimeStatus: () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
        refreshMcpConfig: async () => 'not_loaded' as const,
	    dispose: async () => {},
	    runControlResponse: async () => {},
	    async runUserTurn(_content, signal) {
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
      decisions.push(
        await context.requestPermission({
          requestId: 'permission-after-abort',
          toolName: 'PowerShell',
          input: { command: 'echo late' },
          description: 'Run shell after abort',
        }),
      )
    },
  }
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<'settled' | 'timeout'> {
  return Promise.race([
    promise.then(() => 'settled' as const),
    new Promise<'timeout'>(resolve =>
      setTimeout(() => resolve('timeout'), timeoutMs),
    ),
  ])
}

function questionInput(question: string): Record<string, unknown> {
  return {
    questions: [
      {
        question,
        header: 'Q',
        options: [
          { label: 'Yes', description: 'Choose yes' },
          { label: 'No', description: 'Choose no' },
        ],
      },
    ],
  }
}

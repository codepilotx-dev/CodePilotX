import { expect, mock, test } from 'bun:test'

const createdHeadlessOptions: Array<Record<string, unknown>> = []
const headlessRuntime = {
  setModel: mock((_model: string | undefined) => undefined),
  setProvider: mock(
    (
      _providerID: string | undefined,
      _providerBaseURL: string | undefined,
    ) => undefined,
  ),
  setPermissionMode: mock((_permissionMode: string | undefined) => undefined),
  setCodexPermissionConfig: mock((_config: Record<string, unknown>) => undefined),
  runUserTurn: mock(async (_content: unknown, _signal: AbortSignal) => undefined),
  runControlResponse: mock(
    async (_response: Record<string, unknown>, _signal: AbortSignal) => undefined,
  ),
}

mock.module('@codepilotx/tui/headless/desktopRuntime.js', () => ({
  createDesktopHeadlessRuntime: (options: Record<string, unknown>) => {
    createdHeadlessOptions.push(options)
    return headlessRuntime
  },
  runDesktopHeadlessTurn: (
    runtime: typeof headlessRuntime,
    content: unknown,
    signal: AbortSignal,
  ) => runtime.runUserTurn(content, signal),
  runDesktopHeadlessControlResponse: (
    runtime: typeof headlessRuntime,
    response: Record<string, unknown>,
    signal: AbortSignal,
  ) => runtime.runControlResponse(response, signal),
}))

const { createDesktopAgentRuntime } = await import('./agentRuntime.js')

test('embedded desktop runtime receives and updates permission mode', () => {
  createdHeadlessOptions.length = 0
  headlessRuntime.setPermissionMode.mockClear()
  headlessRuntime.setCodexPermissionConfig.mockClear()

  const runtime = createDesktopAgentRuntime({
    sessionId: 'session-1',
    workspacePath: '/workspace',
    runtimePreference: 'embedded-headless',
    permissionMode: 'auto-review',
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  expect(createdHeadlessOptions[0]).toMatchObject({
    permissionMode: 'default',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  })

  runtime.setPermissionMode('full-access')

  expect(headlessRuntime.setPermissionMode).toHaveBeenCalledWith(
    'bypassPermissions',
  )
  expect(headlessRuntime.setCodexPermissionConfig).toHaveBeenCalledWith({
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  })
})

test('embedded desktop runtime applies plan mode independently from permission mode', () => {
  createdHeadlessOptions.length = 0
  headlessRuntime.setPermissionMode.mockClear()

  const runtime = createDesktopAgentRuntime({
    sessionId: 'session-plan-mode',
    workspacePath: '/workspace',
    runtimePreference: 'embedded-headless',
    permissionMode: 'auto-review',
    planModeActive: true,
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  expect(createdHeadlessOptions[0]).toMatchObject({
    permissionMode: 'plan',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  })

  runtime.setPlanModeActive(false)
  expect(headlessRuntime.setPermissionMode).toHaveBeenCalledWith('default')

  runtime.setPlanModeActive(true)
  expect(headlessRuntime.setPermissionMode).toHaveBeenCalledWith('plan')
})

test('embedded desktop runtime derives plan mode from collaboration mode', () => {
  createdHeadlessOptions.length = 0

  createDesktopAgentRuntime({
    sessionId: 'session-collaboration-plan',
    workspacePath: '/workspace',
    runtimePreference: 'embedded-headless',
    permissionMode: 'auto-review',
    collaborationMode: { mode: 'plan' },
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  expect(createdHeadlessOptions[0]).toMatchObject({
    permissionMode: 'plan',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
  })
})


test('embedded desktop runtime receives and updates selected provider', () => {
  createdHeadlessOptions.length = 0
  headlessRuntime.setModel.mockClear()
  headlessRuntime.setProvider.mockClear()

  const runtime = createDesktopAgentRuntime({
    sessionId: 'session-provider',
    workspacePath: '/workspace',
    runtimePreference: 'embedded-headless',
    providerID: 'deepseek',
    providerBaseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  expect(createdHeadlessOptions[0]).toMatchObject({
    providerID: 'deepseek',
    providerBaseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
  })

  runtime.setModelProvider(
    'minimax-cn-coding-plan',
    'MiniMax-M3',
    'https://api.minimaxi.com/anthropic/v1',
  )

  expect(headlessRuntime.setProvider).toHaveBeenCalledWith(
    'minimax-cn-coding-plan',
    'https://api.minimaxi.com/anthropic/v1',
  )
  expect(headlessRuntime.setModel).toHaveBeenCalledWith('MiniMax-M3')
})

test('embedded desktop runtime receives conversation dump debug mode', () => {
  createdHeadlessOptions.length = 0

  createDesktopAgentRuntime({
    sessionId: 'session-debug-dump',
    workspacePath: '/workspace',
    runtimePreference: 'embedded-headless',
    debugConversationDump: true,
    emit: () => undefined,
    requestPermission: async () => ({ behavior: 'deny' }),
  })

  expect(createdHeadlessOptions[0]).toMatchObject({
    debugConversationDump: true,
  })
})

import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../shared/ipcChannels.js'
import { encodeDesktopBridgeArgs } from '../../shared/desktopBridgeArgs.js'
import { defaultDesktopStoredSettings } from '../../shared/settingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
} from '@codepilotx/core/agent/codepilotxSessionContract.js'
import type {
  CreateDesktopSessionOptions,
  DesktopApi,
  DesktopBrowserState,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopReviewDiffResult,
  DesktopRuntimeStatus,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
  DesktopUpdateStatus,
  DesktopWorkspace,
  ModelProviderID,
} from '../../shared/types.js'

export const DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY =
  'codepilotx.desktop.browserDebugMode'
export const DESKTOP_BROWSER_DEBUG_MODE_EVENT =
  'desktop-browser-debug-mode-change'

const DEFAULT_BROWSER_DEBUG_PORT = 53271

type DesktopClientWindow = {
  desktopApi?: DesktopApi
  addEventListener?: Window['addEventListener']
  removeEventListener?: Window['removeEventListener']
}

export type DesktopClientEnvironment = {
  window?: DesktopClientWindow
  localStorage?: Storage
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  debugBridgePort?: number
  debugBridgeToken?: string
}

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
): DesktopApi {
  if (environment.window?.desktopApi) {
    return environment.window.desktopApi
  }
  return createSwitchingBrowserDesktopClient(environment)
}

export function readDesktopBrowserDebugMode(
  storage: Storage | undefined = getDefaultLocalStorage(),
): boolean {
  try {
    return storage?.getItem(DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeDesktopBrowserDebugMode(
  storage: Storage | undefined = getDefaultLocalStorage(),
  enabled: boolean,
): void {
  try {
    storage?.setItem(DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY, enabled ? '1' : '0')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(DESKTOP_BROWSER_DEBUG_MODE_EVENT))
    }
  } catch {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

export const desktopClient: DesktopApi = createDesktopClient()

function createSwitchingBrowserDesktopClient(
  environment: DesktopClientEnvironment,
): DesktopApi {
  let mockClient: DesktopApi | null = null
  let debugClient: DesktopApi | null = null

  function currentClient(): DesktopApi {
    if (readDesktopBrowserDebugMode(environment.localStorage)) {
      debugClient ??= createBrowserDebugDesktopClient(environment)
      return debugClient
    }
    mockClient ??= createBrowserMockDesktopClient()
    return mockClient
  }

  const client = {} as DesktopApi
  for (const method of DESKTOP_API_METHODS) {
    client[method] = ((...args: unknown[]) => {
      const target = currentClient()[method] as (...methodArgs: unknown[]) => unknown
      return target(...args)
    }) as never
  }
  client.onAgentEvent = callback =>
    subscribeWithModeSwitch(environment, () => currentClient().onAgentEvent(callback))
  client.onWorkflowEvent = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onWorkflowEvent(callback),
    )
  client.onUiCommand = callback =>
    subscribeWithModeSwitch(environment, () => currentClient().onUiCommand(callback))
  client.onSessionStoreChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onSessionStoreChange(callback),
    )
  client.onDesktopSettingsChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onDesktopSettingsChange(callback),
    )
  client.onUpdateStatusChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onUpdateStatusChange(callback),
    )
  return client
}

function subscribeWithModeSwitch(
  environment: DesktopClientEnvironment,
  subscribe: () => () => void,
): () => void {
  let unsubscribe = subscribe()
  const targetWindow = environment.window ?? (typeof window === 'undefined' ? undefined : window)
  const reconnect = () => {
    unsubscribe()
    unsubscribe = subscribe()
  }
  targetWindow?.addEventListener?.(DESKTOP_BROWSER_DEBUG_MODE_EVENT, reconnect)
  return () => {
    targetWindow?.removeEventListener?.(DESKTOP_BROWSER_DEBUG_MODE_EVENT, reconnect)
    unsubscribe()
  }
}

function createBrowserDebugDesktopClient(
  environment: DesktopClientEnvironment,
): DesktopApi {
  const port = environment.debugBridgePort ?? getBrowserDebugPort()
  const baseURL = `http://127.0.0.1:${port}`
  const requestFetch = environment.fetch ?? fetch
  const eventSourceFactory =
    environment.eventSourceFactory ??
    ((url: string) => new EventSource(url))

  /** Resolve the debug bridge token from the environment or Vite-injected env. */
  function getDebugToken(): string | undefined {
    if (environment.debugBridgeToken) return environment.debugBridgeToken
    try {
      const viteToken =
        import.meta.env?.CODEPILOTX_DESKTOP_BROWSER_DEBUG_BRIDGE_TOKEN
      if (viteToken) return viteToken
    } catch {
      // import.meta.env may not be available in some environments (e.g. older runtimes)
    }
    return undefined
  }

  async function invoke(method: DesktopApiMethod, args: unknown[]): Promise<unknown> {
    let response: Response
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const debugToken = getDebugToken()
    if (debugToken) {
      headers['authorization'] = `Bearer ${debugToken}`
    }
    try {
      response = await requestFetch(`${baseURL}/desktop-api/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ args: encodeDesktopBridgeArgs(method, args) }),
      })
    } catch (error) {
      throw new Error(
        `桌面端浏览器调试桥不可用。请确认 Electron 正在通过 bun run desktop:dev 运行，并且调试模式已开启。${
          error instanceof Error ? ` 原始错误：${error.message}` : ''
        }`,
      )
    }
    if (!response.ok) {
      throw new Error(
        `桌面端浏览器调试桥请求失败：${response.status} ${await response.text()}`,
      )
    }
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }

  function subscribe<T>(
    channel: string,
    callback: (event: T) => void,
  ): () => void {
    let source: EventSource
    try {
      const token = getDebugToken()
      const eventsUrl = token
        ? `${baseURL}/desktop-events?token=${encodeURIComponent(token)}`
        : `${baseURL}/desktop-events`
      source = eventSourceFactory(eventsUrl)
    } catch {
      return () => {}
    }
    const listener = (event: MessageEvent<string>) => {
      callback(JSON.parse(event.data) as T)
    }
    source.addEventListener(channel, listener as EventListener)
    return () => {
      source.removeEventListener(channel, listener as EventListener)
      source.close()
    }
  }

  return createInvokingDesktopClient(invoke, subscribe)
}

function createBrowserMockDesktopClient(): DesktopApi {
  let settings: DesktopStoredSettings = defaultDesktopStoredSettings()
  let browserState: DesktopBrowserState = emptyBrowserState()
  const sessions = new Map<string, DesktopSessionSnapshot>()
  let activeSessionId: string | null = null
  const sessionStoreListeners = new Set<(change: DesktopSessionStoreChange) => void>()
  const settingsListeners = new Set<(change: DesktopSettingsChange) => void>()

  const runtimeStatus: DesktopRuntimeStatus = {
    runtimeKind: 'rust-sidecar',
    runtimePreference: 'auto',
    runtimeSelectionSource: 'default',
    agentExecutablePath: '',
    agentExecutableExists: false,
    configDirectoryPath: '',
    toolchainEnabled: true,
    toolchainRoot: null,
    managedToolchainRoot: '',
    packagedToolchainRoot: '',
    toolchainPathEntries: [],
    toolchainBinaries: [],
  }
  const provider = mockModelProvider(settings.providerID)
  const providerState = (): DesktopModelProviderState => ({
    selectedProviderID: settings.providerID,
    provider,
    model: settings.model,
    baseURL: settings.providerBaseURL || provider.baseURL,
    apiKeyConfigured: false,
    apiKeySource: null,
    modelConfigured: Boolean(settings.model),
    configurationMessage: '浏览器 mock 模式不会读取真实模型配置。',
    models: provider.defaultModels,
    modelMetadata: provider.modelMetadata,
  })

  return {
    getAuthStatus: async () => ({
      authenticated: false,
      method: 'none',
      email: null,
      organizationName: null,
    }),
    getRuntimeStatus: async () => runtimeStatus,
    diagnoseDesktopToolchain: async () => ({
      enabled: settings.installCodePilotXDependencies,
      root: runtimeStatus.toolchainRoot,
      managedRoot: runtimeStatus.managedToolchainRoot,
      packagedRoot: runtimeStatus.packagedToolchainRoot,
      pathEntries: runtimeStatus.toolchainPathEntries,
      binaries: runtimeStatus.toolchainBinaries,
    }),
    reinstallDesktopToolchain: async () => ({
      ok: true,
      root: runtimeStatus.managedToolchainRoot,
      copiedFrom: null,
      diagnostics: {
        enabled: settings.installCodePilotXDependencies,
        root: runtimeStatus.toolchainRoot,
        managedRoot: runtimeStatus.managedToolchainRoot,
        packagedRoot: runtimeStatus.packagedToolchainRoot,
        pathEntries: runtimeStatus.toolchainPathEntries,
        binaries: runtimeStatus.toolchainBinaries,
      },
    }),
    deleteDesktopToolchain: async () => ({
      ok: true,
      root: runtimeStatus.managedToolchainRoot,
      copiedFrom: null,
      diagnostics: {
        enabled: settings.installCodePilotXDependencies,
        root: null,
        managedRoot: runtimeStatus.managedToolchainRoot,
        packagedRoot: runtimeStatus.packagedToolchainRoot,
        pathEntries: [],
        binaries: runtimeStatus.toolchainBinaries,
      },
    }),
    getDesktopSettings: async () => settings,
    saveDesktopSettings: async next => {
      settings = { ...settings, ...next }
      emitSettingsChange()
      return settings
    },
    listProjectMemories: async workspacePath => ({
      memoryDir: `${workspacePath || 'mock'}/.codepilotx-memory/`,
      entrypointPath: `${workspacePath || 'mock'}/.codepilotx-memory/MEMORY.md`,
      memories: [],
    }),
    readProjectMemory: async (_workspacePath, relativePath) => ({
      relativePath,
      absolutePath: relativePath,
      description: null,
      size: 0,
      mtimeMs: 0,
      content: '',
    }),
    saveProjectMemory: async input => ({
      relativePath: input.relativePath,
      absolutePath: input.relativePath,
      description: null,
      size: input.content.length,
      mtimeMs: Date.now(),
    }),
    deleteProjectMemory: async () => {},
    resetProjectMemory: async () => {},
    listProjectMemoryRecalls: async workspacePath => ({
      recallLogPath: `${workspacePath || 'mock'}/.codepilotx-memory/.recall-events.jsonl`,
      recalls: [],
    }),
    listUserMemories: async () => ({
      memoryDir: 'mock/user-memory/',
      profilePath: 'mock/user-memory/profile.memory.md',
      preferencesPath: 'mock/user-memory/preferences.json',
      eventsPath: 'mock/user-memory/memory_events.jsonl',
      conversationIndexPath: 'mock/user-memory/conversation_index.sqlite',
      memories: [],
    }),
    readUserMemory: async relativePath => ({
      relativePath,
      absolutePath: relativePath,
      description: null,
      size: 0,
      mtimeMs: 0,
      content: '',
    }),
    saveUserMemory: async input => ({
      relativePath: input.relativePath,
      absolutePath: input.relativePath,
      description: null,
      size: input.content.length,
      mtimeMs: Date.now(),
    }),
    deleteUserMemory: async () => {},
    resetUserMemory: async () => {},
    exportUserMemory: async () => ({
      memoryDir: 'mock/user-memory/',
      files: [],
    }),
    importUserMemory: async input => ({
      memoryDir: 'mock/user-memory/',
      files: input.files,
    }),
    getBrowserState: async () => browserState,
    openBrowser: async url => {
      browserState = {
        ...browserState,
        open: true,
        url: url ?? browserState.url,
        allowedSites: settings.browserAllowedSites,
        sitePermissions: settings.browserSitePermissions,
      }
      return browserState
    },
    navigateBrowser: async url => {
      browserState = { ...browserState, open: true, url }
      return browserState
    },
    reloadBrowser: async () => browserState,
    goBackBrowser: async () => browserState,
    goForwardBrowser: async () => browserState,
    closeBrowser: async () => {
      browserState = emptyBrowserState()
      return browserState
    },
    setBrowserBounds: async () => browserState,
    clearBrowserAllowedSites: async () => {
      settings = { ...settings, browserAllowedSites: [], browserSitePermissions: [] }
      browserState = { ...browserState, allowedSites: [], sitePermissions: [] }
      return browserState
    },
    listBuiltinPlugins: async () => [],
    setBuiltinPluginEnabled: async (pluginId, enabled) => ({ id: pluginId, enabled }),
    listSkillsCatalog: async options => ({
      skills: [],
      page: options?.page ?? 0,
      perPage: options?.perPage ?? 20,
      total: 0,
      hasMore: false,
    }),
    installSkill: async skill => ({
      id: typeof skill === 'string' ? skill : skill.id,
      slug: typeof skill === 'string' ? skill : skill.id,
      installed: false,
      installPath: '',
    }),
    listSlashCommands: async () => [],
    listMcpServers: async () => [],
    getMcpRuntimeStatus: async () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }),
    saveMcpServer: async () => [],
    removeMcpServer: async () => [],
    setMcpServerEnabled: async () => [],
    reloadMcpConfiguration: async () => ({ refreshed: 0, skipped: 0, failed: 0 }),
    listOpenTargets: async () => [],
    openPathWithDefaultTarget: async () => {},
    listModelProviders: async () => [provider],
    getModelProviderState: async () => providerState(),
    fetchProviderModels: async () => ({ models: provider.defaultModels }),
    fetchProviderBalance: async () => ({ isAvailable: false, balances: [] }),
    saveModelProvider: async options => {
      settings = {
        ...settings,
        providerID: options.providerID,
        model: options.modelID ?? settings.model,
        providerBaseURL: options.baseURL ?? settings.providerBaseURL,
      }
      return providerState()
    },
    saveProviderApiKey: async () => providerState(),
    deleteProviderApiKey: async () => providerState(),
    getCopilotAuthStatus: async () => ({ authenticated: false }),
    startCopilotLogin: async () => mockCopilotLogin(),
    pollCopilotLogin: async () => mockCopilotLogin(),
    cancelCopilotLogin: async () => ({ cancelled: true }),
    getGithubAuthStatus: async () => ({
      configured: false,
      authenticated: false,
      user: null,
    }),
    startGithubLogin: async () => mockGithubLogin(),
    pollGithubLogin: async () => mockGithubLogin(),
    logoutGithub: async () => ({
      configured: false,
      authenticated: false,
      user: null,
    }),
    listGithubRepositories: async () => ({ ok: true, repositories: [] }),
    getGithubProfileOverview: async () => ({
      ok: false,
      error: '浏览器 mock 模式未连接 GitHub。',
    }),
    setGithubUserStatus: async () => ({
      ok: false,
      error: '浏览器 mock 模式未连接 GitHub。',
    }),
    clearGithubUserStatus: async () => ({
      ok: true,
      status: null,
    }),
    cloneGithubRepository: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会克隆仓库。',
    }),
    chooseWorkspace: async () => null,
    openWorkspace: async workspacePath => mockWorkspace(workspacePath),
    getWorkspaceContext: async workspacePath => mockWorkspace(workspacePath),
    checkoutWorkspaceBranch: async (workspacePath, branchName) => ({
      ...mockWorkspace(workspacePath),
      branchName,
    }),
    getWorkspaceGitStatus: async () => ({ ok: true, status: cleanGitStatus() }),
    createWorkspaceBranch: async input => ({
      ok: true,
      workspace: {
        ...mockWorkspace(input.workspacePath),
        branchName: input.branchName,
      },
      status: { ...cleanGitStatus(), branchName: input.branchName },
    }),
    commitWorkspaceChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会提交文件。',
    }),
    pushWorkspaceBranch: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会推送分支。',
    }),
    discardWorkspaceChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会放弃文件改动。',
    }),
    restoreSessionTurnChanges: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会恢复对话轮次改动。',
    }),
    createPullRequest: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会创建 Pull Request。',
    }),
    getWorkspaceReviewDiff: async () => emptyReviewDiff(),
    applyWorkspaceReviewOperation: async () => ({
      ok: false,
      error: '浏览器 mock 模式不会修改 git 暂存区。',
    }),
    listWorkspaceFiles: async () => [],
    readWorkspaceFile: async (_workspacePath, filePath) => ({
      path: filePath,
      content: '',
      truncated: false,
    }),
    readOptionalWorkspaceFile: async () => null,
    chooseComposerFiles: async () => [],
    authorizeComposerFilePaths: async () => {},
    readComposerFiles: async () => [],
    getWorkspaceDiff: async () => ({
      patch: '',
    }),
    getThemeSettings: async () => defaultMockThemeSettings(),
    saveThemeSettings: async () => {},
    createSession: async options => {
      const workspace = options.workspacePath
        ? mockWorkspace(options.workspacePath)
        : mockWorkspace('')
      const sessionId = `browser-mock-${sessions.size + 1}`
      const snapshot = mockSessionSnapshot(sessionId, workspace, options)
      sessions.set(sessionId, snapshot)
      activeSessionId = sessionId
      emitSessionStoreChange()
      return {
        sessionId,
        workspace,
        standalone: !options.workspacePath,
      }
    },
    listSessions: async () => [...sessions.values()],
    getSessionCatalogStatus: async () => ({ state: 'ready', error: null }),
    getSession: async sessionId => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      return snapshot
    },
    getActiveSessionId: async () => activeSessionId,
    setActiveSession: async sessionId => {
      activeSessionId = sessionId
      emitSessionStoreChange()
    },
    updateSessionMetadata: async (sessionId, patch) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, ...patch },
        updatedAt: new Date().toISOString(),
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    renameSession: async (sessionId, name) => {
      const snapshot = sessions.get(sessionId)
      if (!snapshot) throw new Error(`Unknown desktop session: ${sessionId}`)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, sessionName: name },
      }
      sessions.set(sessionId, next)
      return next
    },
    saveSessionReviewComment: async input => requireMockSession(sessions, input.sessionId),
    resolveSessionReviewComment: async input => requireMockSession(sessions, input.sessionId),
    deleteSessionReviewComment: async input => requireMockSession(sessions, input.sessionId),
    setSessionPermissionMode: async (sessionId, mode) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const next = {
        ...snapshot,
        settings: { ...snapshot.settings, permissionMode: mode },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    setSessionPlanModeActive: async (sessionId, active) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const collaborationMode = collaborationModeFromPlanModeActive(active)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, collaborationMode, planModeActive: active },
        settings: {
          ...snapshot.settings,
          collaborationMode,
          planModeActive: active,
        },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    setSessionLocalRouterMode: async (sessionId, mode) => {
      const snapshot = requireMockSession(sessions, sessionId)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, localRouterMode: mode },
        settings: { ...snapshot.settings, localRouterMode: mode },
      }
      sessions.set(sessionId, next)
      emitSessionStoreChange()
      return next
    },
    readWorkflowEventLog: async () => [],
    openConfigFile: async () => ({ path: '' }),
    openExternalURL: async url => {
      globalThis.open?.(url, '_blank', 'noopener,noreferrer')
    },
    sendUserMessage: async () => {},
    respondToPermission: async () => {},
    interruptSession: async () => {},
    disposeSession: async sessionId => {
      sessions.delete(sessionId)
      if (activeSessionId === sessionId) {
        activeSessionId = [...sessions.keys()][0] ?? null
      }
      emitSessionStoreChange()
    },
    minimizeWindow: async () => {},
    toggleWindowMaximized: async () => false,
    closeWindow: async () => {},
    isWindowMaximized: async () => false,
    newWindow: async () => {},
    openDevTools: async () => {},
    closeDevTools: async () => {},
    openSettings: async () => {},
    logOut: async () => {},
    exitApp: async () => {},
    getDataLocation: async (): Promise<DesktopDataLocationState> => ({
      currentConfigDir: '',
      pendingConfigDir: null,
      controlSource: 'default',
      isEnvControlled: false,
    }),
    chooseDataLocation: async (): Promise<DesktopDataLocationMigrationResult | null> =>
      null,
    onAgentEvent: () => noop,
    onWorkflowEvent: () => noop,
    onUiCommand: () => noop,
    onSessionStoreChange: callback => {
      sessionStoreListeners.add(callback)
      return () => {
        sessionStoreListeners.delete(callback)
      }
    },
    onDesktopSettingsChange: callback => {
      settingsListeners.add(callback)
      return () => {
        settingsListeners.delete(callback)
      }
    },
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    quitAndInstall: async () => {},
    onUpdateStatusChange: () => noop,
    listDebugBuiltinTools: async () => ({
      toolNames: [],
      enabled: [],
      hasProbeInput: [],
    }),
    runDebugToolProbe: async mode => ({
      runId: 'browser-mock-probe',
      mode,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalTools: 0,
      passed: 0,
      failed: 0,
      permissionDenied: 0,
      skippedByEnvironment: 0,
      items: [],
    }),
    cancelDebugToolProbe: async () => {},
    submitSessionFollowUp: async () => 'queued' as const,
    updateQueuedFollowUp: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    removeQueuedFollowUp: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    sendQueuedFollowUpNow: async () => {},
    compactSession: async () => {},
    rollbackSession: async () => ({
      snapshot: mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
      restoredFiles: [],
    }),
    getSessionGoal: async () => null,
    setSessionGoal: async () => ({
      threadId: 'mock',
      objective: '',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    clearSessionGoal: async () => true,
    startSessionReview: async () => {},
    listRuntimePermissionProfiles: async () => ({
      state: 'unavailable',
      data: null,
      error: 'Browser mock does not support catalog queries.',
    }),
    setSessionPermissionProfile: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    listRuntimeSkills: async () => ({
      state: 'unavailable',
      data: null,
      error: 'Browser mock does not support catalog queries.',
    }),
  }

  function emitSessionStoreChange(): void {
    const change: DesktopSessionStoreChange = {
      activeSessionId,
      sessions: [...sessions.values()],
    }
    for (const listener of sessionStoreListeners) {
      listener(change)
    }
  }

  function emitSettingsChange(): void {
    const change: DesktopSettingsChange = { settings }
    for (const listener of settingsListeners) {
      listener(change)
    }
  }
}

function createInvokingDesktopClient(
  invoke: (method: DesktopApiMethod, args: unknown[]) => Promise<unknown>,
  subscribe: <T>(channel: string, callback: (event: T) => void) => () => void,
): DesktopApi {
  const client = {} as DesktopApi
  for (const method of DESKTOP_API_METHODS) {
    client[method] = ((...args: unknown[]) => invoke(method, args)) as never
  }
  client.onAgentEvent = callback => subscribe(DESKTOP_AGENT_EVENT_CHANNEL, callback)
  client.onWorkflowEvent = callback =>
    subscribe(DESKTOP_WORKFLOW_EVENT_CHANNEL, callback)
  client.onUiCommand = callback => subscribe(DESKTOP_UI_COMMAND_CHANNEL, callback)
  client.onSessionStoreChange = callback =>
    subscribe(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, callback)
  client.onDesktopSettingsChange = callback =>
    subscribe(DESKTOP_SETTINGS_CHANGE_CHANNEL, callback)
  client.onUpdateStatusChange = callback =>
    subscribe<DesktopUpdateStatus>(DESKTOP_UPDATE_STATUS_CHANNEL, callback)
  return client
}

function defaultDesktopClientEnvironment(): DesktopClientEnvironment {
  return {
    window: typeof window === 'undefined' ? undefined : window,
    localStorage: getDefaultLocalStorage(),
    fetch:
      typeof fetch === 'undefined'
        ? undefined
        : (input, init) => fetch(input, init),
  }
}

function getDefaultLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function getBrowserDebugPort(): number {
  const value = Number.parseInt(
    import.meta.env?.VITE_DESKTOP_BROWSER_DEBUG_PORT ??
      import.meta.env?.CODEPILOTX_DESKTOP_BROWSER_DEBUG_PORT ??
      import.meta.env?.CLAUDE_CODE_DESKTOP_BROWSER_DEBUG_PORT ??
      `${DEFAULT_BROWSER_DEBUG_PORT}`,
    10,
  )
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BROWSER_DEBUG_PORT
}

function emptyBrowserState(): DesktopBrowserState {
  return {
    open: false,
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    allowedSites: [],
    sitePermissions: [],
  }
}

function defaultMockThemeSettings(): DesktopThemeSettings {
  return {
    mode: 'light',
    activeThemeIds: {
      light: 'browser-mock-light',
      dark: 'browser-mock-dark',
    },
    glassmorphismEnabled: true,
    pointerCursorEnabled: true,
    reduceMotion: 'system',
    fontSizes: {
      code: 12,
      ui: 14,
    },
    customThemes: [],
    presetOverrides: {},
  }
}

function mockModelProvider(providerID: ModelProviderID): DesktopModelProviderSummary {
  return {
    providerID,
    kind: 'openai-compatible',
    displayName: 'Browser Mock',
    defaultModels: [],
    apiKeyConfigured: false,
  }
}

function cleanGitStatus() {
  return {
    branchName: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
  }
}

function emptyReviewDiff(): DesktopReviewDiffResult {
  return {
    scopes: [
      { scope: 'unstaged', changedFiles: 0, additions: 0, deletions: 0 },
      { scope: 'staged', changedFiles: 0, additions: 0, deletions: 0 },
    ],
    activeScope: 'unstaged',
    files: [],
    status: cleanGitStatus(),
  }
}

function mockWorkspace(path: string): DesktopWorkspace {
  return {
    path,
    name: path ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path : '浏览器 Mock',
    branchName: null,
  }
}

function mockSessionSnapshot(
  sessionId: string,
  workspace: DesktopWorkspace,
  options: CreateDesktopSessionOptions,
): DesktopSessionSnapshot {
  const now = new Date().toISOString()
  const collaborationMode = resolveCodePilotXCollaborationMode({
    collaborationMode: options.collaborationMode,
    planModeActive: options.planModeActive,
  })
  const planModeActive = planModeActiveFromCollaborationMode(collaborationMode)
  return {
    item: {
      id: sessionId,
      sessionName: options.sessionName ?? null,
      aiTitle: null,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone: !options.workspacePath,
      permissionMode: options.permissionMode ?? 'default',
      collaborationMode,
      planModeActive,
      model: options.model ?? null,
      reviewModel: options.reviewModel ?? null,
      thinkingMode: options.thinkingMode ?? 'default',
      hasSystemPrompt: Boolean(options.systemPrompt),
      hasAppendSystemPrompt: Boolean(options.appendSystemPrompt),
      additionalDirectoryCount: options.additionalDirectories?.length ?? 0,
      status: 'idle',
      createdAt: now,
      lastMessageAt: null,
    },
    workspace,
    settings: {
      permissionMode: options.permissionMode ?? 'default',
      collaborationMode,
      planModeActive,
      model: options.model,
      reviewModel: options.reviewModel,
      smallFastModel: options.smallFastModel,
      fastModel: options.fastModel,
      defaultModel: options.defaultModel,
      deepModel: options.deepModel,
      sessionName: options.sessionName,
      thinkingMode: options.thinkingMode ?? 'default',
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      additionalDirectories: options.additionalDirectories ?? [],
    },
    view: {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      contextUsage: null,
    },
    events: [],
    workflowEvents: [],
    reviewComments: [],
    updatedAt: now,
  }
}

function requireMockSession(
  sessions: Map<string, DesktopSessionSnapshot>,
  sessionId: string,
): DesktopSessionSnapshot {
  const snapshot = sessions.get(sessionId)
  if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
  return snapshot
}

function mockCopilotLogin() {
  return {
    state: 'idle' as const,
    deviceCode: null,
    verificationUrl: null,
    error: null,
    auth: null,
    elapsedMs: 0,
  }
}

function mockGithubLogin() {
  return {
    state: 'idle' as const,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error: null,
    auth: null,
    elapsedMs: 0,
  }
}

function noop(): void {}

import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../../shared/ipcChannels.js'
import { encodeDesktopBridgeArgs } from '../../../shared/desktopBridgeArgs.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../../../shared/settingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
} from '../../shims/core/agent/codepilotxSessionContract.js'
import type {
  CatalogProvider,
  IntegrationAuthorizeRequest,
  IntegrationAuthorizeResponse,
  IntegrationAuthorizeStatusResponse,
  IntegrationConnectRequest,
  IntegrationDisconnectRequest,
  IntegrationListResponse,
  ModelRef,
  OkResponse,
  Project,
} from '@codepilotx/shared'
import type {
  PermissionConfig,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import type {
  EventEnvelope,
  JsonValue,
  ProtocolCapability,
  RpcParams,
  RpcResult,
} from '@codepilotx/agent-protocol'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'
import { desktopUserMessageInputToPreviewText } from '../../../shared/desktopUserMessage.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopApi,
  DesktopBrowserState,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopFileRevision,
  DesktopFileSaveResult,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopReviewSource,
  DesktopSessionEvent,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
  DesktopGithubProfileOverviewResult,
  DesktopGithubRepositoryListResult,
  DesktopGitStatus,
  DesktopGitOperationResult,
  DesktopPullRequestResult,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
  DesktopSubagentRead,
  DesktopUpdateStatus,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/types.js'
import {
  agentEventsFromNotification,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktopSnapshot,
  agentThreadSnapshotToDesktop,
  desktopPermissionModeToPermissionConfig,
  projectToDesktopWorkspace,
} from '../agentThreadAdapter.js'
import {
  createAgentRpcClient,
  type AgentRpcSubscription,
} from '../agentRpcClient.js'

import type { DesktopClientEnvironment } from './types.js'
import {
  cleanGitStatus,
  createBrowserVisualFixture,
  emptyBrowserState,
  emptyReviewDiff,
  githubLoginFailure,
  mockCopilotLogin,
  mockGithubLogin,
  mockModelProvider,
  mockSessionSnapshot,
  mockThreadHistoryPage,
  mockWorkspace,
  permissionModeFromDesktopConfig,
  readBrowserThemeSettings,
  requireMockSession,
} from './fixtures.js'

const BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY =
  'codepilotx.desktop.appearance.v6'

function noop(): void {}

function mcpUnavailable(): never {
  const error = new Error(
    'MCP_UNAVAILABLE: 浏览器 mock 模式无法连接 Agent MCP 运行时。',
  ) as Error & { code: string }
  error.code = 'MCP_UNAVAILABLE'
  throw error
}

export function createBrowserMockDesktopClient(storage?: Storage): DesktopApi {
  let settings: DesktopStoredSettings = defaultDesktopStoredSettings()
  let configDocument: Record<string, JsonValue> = {
    desktop: { ...settings } as unknown as JsonValue,
  }
  let configVersion = '0'.repeat(64)
  let themeSettings: DesktopThemeSettings = readBrowserThemeSettings(storage)
  let browserState: DesktopBrowserState = emptyBrowserState()
  let githubLoginMode: DesktopGithubAuthMode = 'browser'
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
  const visualFixture = createBrowserVisualFixture()
  if (visualFixture) {
    sessions.set(visualFixture.item.id, visualFixture)
    activeSessionId = visualFixture.item.id
  }

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
    readConfig: async params => ({
      config: configDocument,
      origins: {},
      ...(params?.includeLayers
        ? {
            layers: [{
              kind: 'user' as const,
              displayName: '用户配置',
              filePath: 'C:/Users/mock/.codepilotx/config.toml',
              version: configVersion,
              writable: true,
              trusted: true,
              config: configDocument,
            }],
          }
        : {}),
      diagnostics: [],
    }),
    writeConfigBatch: async params => {
      for (const edit of params.edits) {
        let target = configDocument
        for (const part of edit.keyPath.slice(0, -1)) {
          const next = target[part]
          if (!next || typeof next !== 'object' || Array.isArray(next)) target[part] = {}
          target = target[part] as Record<string, JsonValue>
        }
        const leaf = edit.keyPath.at(-1)!
        if (edit.value === null) delete target[leaf]
        else target[leaf] = edit.value
      }
      configVersion = (configVersion[0] === '0' ? '1' : '0').repeat(64)
      return {
        status: 'ok',
        version: configVersion,
        filePath: params.filePath ?? 'C:/Users/mock/.codepilotx/config.toml',
      }
    },
    readProjectTrust: async cwd => ({
      projectRoot: cwd,
      trustLevel: 'untrusted',
      hasProjectConfig: false,
    }),
    updateProjectTrust: async params => ({
      status: 'ok',
      version: configVersion,
      filePath: 'C:/Users/mock/.codepilotx/config.toml',
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
    generateTaskSuggestions: async () => {
      throw new Error('TASK_SUGGESTIONS_UNAVAILABLE')
    },
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
    listMcpServers: async () => mcpUnavailable(),
    getMcpRuntimeStatus: async () => mcpUnavailable(),
    saveMcpServer: async () => mcpUnavailable(),
    removeMcpServer: async () => mcpUnavailable(),
    setMcpServerEnabled: async () => mcpUnavailable(),
    reloadMcpConfiguration: async () => mcpUnavailable(),
    startMcpOAuth: async () => mcpUnavailable(),
    getMcpOAuthStatus: async () => mcpUnavailable(),
    logoutMcpOAuth: async () => mcpUnavailable(),
    listOpenTargets: async () => [
      { id: 'default-app', label: '系统默认应用', kind: 'default-app' },
    ],
    listExternalOpenTargets: async () => [
      {
        id: 'default-app',
        label: '系统默认应用',
        kind: 'default-app',
        preferred: true,
      },
    ],
    openPathWithTarget: async () => {},
    openPathWithDefaultTarget: async () => {},
    revealPathInFolder: async () => {},
    listModelProviders: async () => [provider],
    getModelProviderState: async () => providerState(),
    fetchProviderModels: async () => ({ models: provider.defaultModels }),
    saveModelProvider: async options => {
      settings = {
        ...settings,
        providerID: options.providerID,
        model: options.id ?? settings.model,
        providerBaseURL: options.baseURL ?? settings.providerBaseURL,
      }
      return providerState()
    },
    saveProviderApiKey: async () => providerState(),
    deleteProviderApiKey: async () => providerState(),
    listApiKeys: async () => [],
    createApiKey: async () => undefined,
    updateApiKey: async () => undefined,
    setActiveApiKey: async () => undefined,
    setApiKeyEnabled: async () => undefined,
    reorderApiKeys: async () => undefined,
    testApiKey: async () => ({ ok: true, message: 'API Key 可用。' }),
    deleteApiKey: async () => undefined,
    copyProviderApiKey: async () => {
      throw new Error('安全复制仅在桌面应用中可用。')
    },
    testModelProvider: async () => ({ ok: true }),
    listIntegrations: async () => [],
    connectIntegration: async () => ({ ok: true }),
    authorizeIntegration: async input => ({
      attempt: {
        attemptID: `browser-mock-${input.integrationID}`,
        url: '',
        instructions: '浏览器 mock 模式不会启动真实授权。',
        mode: 'auto',
        time: { created: Date.now(), expires: Date.now() + 300_000 },
      },
    }) as IntegrationAuthorizeResponse,
    completeIntegrationAuthorization: async () => ({ ok: true }),
    getIntegrationAuthorizationStatus: async () => ({
      status: {
        status: 'complete',
        time: { created: Date.now(), expires: Date.now() + 300_000 },
      },
    }),
    disconnectIntegration: async () => ({ ok: true }),
    getCopilotAuthStatus: async () => ({ authenticated: false }),
    startCopilotLogin: async () => mockCopilotLogin(),
    pollCopilotLogin: async () => mockCopilotLogin(),
    cancelCopilotLogin: async () => ({ cancelled: true }),
    getGithubAuthStatus: async () => ({
      configured: false,
      authenticated: false,
      user: null,
    }),
    startGithubLogin: async input => {
      githubLoginMode = input.mode
      return mockGithubLogin(githubLoginMode)
    },
    pollGithubLogin: async () => mockGithubLogin(githubLoginMode),
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
    listProjects: async folderPath =>
      folderPath ? [{ ...mockWorkspace(folderPath), projectId: `mock:${folderPath}` }] : [],
    updateProject: async input => ({
      ...mockWorkspace(''),
      projectId: input.projectId,
      name: input.name,
    }),
    removeProject: async () => ({ archivedThreadCount: 0 }),
    addProjectFolder: async (projectId, path) => ({
      ...mockWorkspace(path),
      projectId,
    }),
    removeProjectFolder: async projectId => ({
      ...mockWorkspace(''),
      projectId,
    }),
    setPrimaryProjectFolder: async projectId => ({
      ...mockWorkspace(''),
      projectId,
    }),
    updateProjectSettings: async input => ({
      ...mockWorkspace(''),
      projectId: input.projectId,
      projectSettings: {
        defaultModel: input.defaultModel ?? null,
        instructions: input.instructions ?? '',
        version: input.expectedVersion + 1,
      },
    }),
    listProjectSources: async () => [],
    importProjectSources: async () => [],
    addProjectSourceReference: async () => [],
    readProjectSource: async () => {
      throw new Error('浏览器模拟模式没有可预览的项目来源。')
    },
    removeProjectSource: async () => false,
    chooseProjectFolder: async () => null,
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
    listWorkspaceFiles: async (_workspacePath, directoryPath = '.') => {
      const tree: DesktopFileEntry[] = [
        { name: 'apps', path: 'apps', type: 'directory', depth: 0 },
        { name: 'packages', path: 'packages', type: 'directory', depth: 0 },
        { name: 'README.md', path: 'README.md', type: 'file', depth: 0 },
        { name: 'desktop', path: 'apps/desktop', type: 'directory', depth: 1 },
        { name: 'renderer', path: 'apps/desktop/renderer', type: 'directory', depth: 2 },
        {
          name: 'package.json',
          path: 'apps/desktop/renderer/package.json',
          type: 'file',
          depth: 3,
        },
      ]
      const parent = directoryPath === '' ? '.' : directoryPath.replaceAll('\\', '/')
      return tree.filter(entry => {
        const separator = entry.path.lastIndexOf('/')
        const entryParent = separator < 0 ? '.' : entry.path.slice(0, separator)
        return entryParent === parent
      })
    },
    readWorkspaceFile: async (_workspacePath, filePath) => ({
      path: filePath,
      content:
        filePath === 'README.md'
          ? '# CodePilotX\n\n**可编辑的 Markdown** 与 `inline code`。\n\n- 无序列表项目\n\n| 优化点 | 说明 |\n| --- | --- |\n| 缓存命中优化 | 稳定复用前缀 |\n\n```text\nbun run build\n```\n'
          : '',
      truncated: false,
      sizeBytes:
        filePath === 'README.md'
          ? new TextEncoder().encode(
              '# CodePilotX\n\n**可编辑的 Markdown** 与 `inline code`。\n\n- 无序列表项目\n\n| 优化点 | 说明 |\n| --- | --- |\n| 缓存命中优化 | 稳定复用前缀 |\n\n```text\nbun run build\n```\n',
            ).byteLength
          : 0,
      readonly: false,
      revision: { mtimeMs: 0, sha256: '' },
    }),
    readOptionalWorkspaceFile: async () => null,
    saveWorkspaceFile: async input => ({
      outcome: 'saved',
      revision: input.expectedRevision,
    }),
    watchWorkspaceFile: async () => {},
    unwatchWorkspaceFile: async () => {},
    chooseComposerFiles: async () => [],
    authorizeComposerFilePaths: async () => {},
    readComposerFiles: async () => [],
    getWorkspaceDiff: async () => ({
      patch: '',
    }),
    getThemeSettings: async () => themeSettings,
    saveThemeSettings: async next => {
      themeSettings = normalizeDesktopThemeSettings(next)
      try {
        storage?.setItem(
          BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY,
          JSON.stringify(themeSettings),
        )
      } catch {
        // Browser preview persistence is best-effort.
      }
    },
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
      const permissionConfig = desktopPermissionModeToPermissionConfig(mode)
      const next = {
        ...snapshot,
        item: { ...snapshot.item, permissionMode: mode },
        settings: { ...snapshot.settings, permissionConfig },
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
    minimizeWindow: async () => {
      await window.codePilotXDesktop?.minimize()
    },
    toggleWindowMaximized: async () =>
      (await window.codePilotXDesktop?.toggleMaximize()) ?? false,
    closeWindow: async () => {
      await window.codePilotXDesktop?.close()
    },
    isWindowMaximized: async () =>
      (await window.codePilotXDesktop?.isMaximized()) ?? false,
    newWindow: async () => {},
    openDevTools: async () => {},
    closeDevTools: async () => {},
    openSettings: async () => {},
    logOut: async () => {},
    exitApp: async () => {},
    getDataLocation: async (): Promise<DesktopDataLocationState> => ({
      defaultDataDir: '',
      currentDataDir: '',
      pendingDataDir: null,
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
    submitSessionFollowUp: async (_sessionId, _input, delivery) =>
      delivery === 'steer' ? 'steered' as const : 'queued' as const,
    updateQueuedFollowUp: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    removeQueuedFollowUp: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    resumeQueuedFollowUps: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    compactSession: async () => {},
    getSessionPromptPreview: async () => null,
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
    startSessionReview: async (sessionId, target) => ({
      threadId: sessionId,
      turnId: `mock-review-${Date.now()}`,
      delivery: 'inline',
      source:
        target.type === 'baseBranch'
          ? { kind: 'branch', baseBranch: target.branch }
          : target.type === 'commit'
            ? { kind: 'commit', commitSha: target.sha }
            : { kind: 'unstaged' },
    }),
    listRuntimePermissionProfiles: async () => ({
      state: 'unavailable',
      data: null,
      error: 'Browser mock does not support catalog queries.',
    }),
    setSessionPermissionProfile: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
    listRuntimeSkills: async () => ({
      state: 'unavailable',
      data: null,
      error: '浏览器预览环境不支持读取本机技能目录。',
    }),
    readRuntimeSkill: async () => {
      throw new Error('浏览器预览环境不支持读取本机技能详情。')
    },
    setRuntimeSkillEnabled: async () => {
      throw new Error('浏览器预览环境不支持修改本机技能状态。')
    },
    onRuntimeSkillsUpdated: () => () => {},
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

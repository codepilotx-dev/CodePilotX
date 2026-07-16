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
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../../shared/settingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
} from '../shims/core/agent/codepilotxSessionContract.js'
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
  ProviderTestResponse,
  ProvidersResponse,
} from '@codepilotx/shared'
import type {
  PermissionConfig,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import { normalizeDesktopThemeSettings } from '../../shared/theme.js'
import { desktopUserMessageInputToPreviewText } from '../../shared/desktopUserMessage.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopApi,
  DesktopBrowserState,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopFollowUpBehavior,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
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
} from '../../shared/types.js'
import {
  agentEventsFromNotification,
  agentPlanRunIdFromRequestId,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktopSnapshot,
  agentThreadSnapshotToDesktop,
  desktopPermissionModeToPermissionConfig,
  projectToDesktopWorkspace,
} from './agentThreadAdapter.js'
import { createAgentRpcClient } from './agentRpcClient.js'

export const DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY =
  'codepilotx.desktop.browserDebugMode'
export const DESKTOP_BROWSER_DEBUG_MODE_EVENT =
  'desktop-browser-debug-mode-change'

const DEFAULT_BROWSER_DEBUG_PORT = 53271

type DesktopClientWindow = {
  desktopApi?: DesktopApi
  codePilotXDesktop?: {
    pickWorkspaceDirectory(): Promise<string | null>
  }
  addEventListener?: Window['addEventListener']
  removeEventListener?: Window['removeEventListener']
}

export type DesktopClientEnvironment = {
  window?: DesktopClientWindow
  localStorage?: Storage
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  openExternal?: (url: string) => void | Promise<void>
  debugBridgePort?: number
  debugBridgeToken?: string
}

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
): DesktopApi {
  const productionClient = environment.window?.desktopApi
  const fallbackClient = productionClient ?? createSwitchingBrowserDesktopClient(environment)
  return createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    productionClient === undefined && environment.window?.codePilotXDesktop === undefined,
  )
}

export function readDesktopBrowserDebugMode(
  _storage: Storage | undefined = getDefaultLocalStorage(),
): boolean {
  return false
}

export function writeDesktopBrowserDebugMode(
  _storage: Storage | undefined = getDefaultLocalStorage(),
  _enabled: boolean,
): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DESKTOP_BROWSER_DEBUG_MODE_EVENT))
  }
}

export const desktopClient: DesktopApi = createDesktopClient()

function createAgentSessionDesktopClient(
  environment: DesktopClientEnvironment,
  mockClient: DesktopApi,
  allowBrowserMockFallback: boolean,
): DesktopApi {
  const fetcher = environment.fetch
  const rpc = createAgentRpcClient(environment)
  let activeSessionId: string | null = null
  let agentReady = false
  let agentCapabilities: Record<string, number> = {}
  let readyProbe: Promise<boolean> | null = null
  let readinessError: unknown = null
  let projectsByIdCache: Map<string, Project> | null = null
  let modelCatalogCache: ProvidersResponse | null = null
  let integrationsCache: IntegrationListResponse['integrations'] | null = null
  const sessionSnapshots = new Map<string, DesktopSessionSnapshot>()
  const sessionPermissionConfigs = new Map<string, PermissionConfig>()
  const sessionStoreListeners = new Set<(change: DesktopSessionStoreChange) => void>()
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingSettingsUpdates = new Map<string, Promise<void>>()

  async function isAgentAvailable(): Promise<boolean> {
    if (agentReady) return true
    readyProbe ??= probeAgentReady().finally(() => {
      readyProbe = null
    })
    agentReady = await readyProbe
    return agentReady
  }

  async function probeAgentReady(): Promise<boolean> {
    if (!fetcher) {
      readinessError = new Error('当前环境无法访问 agent RPC。')
      return false
    }
    try {
      const initialized = await rpc.call<{ capabilities?: Record<string, number> }>('initialize')
      agentCapabilities = initialized.capabilities ?? {}
      readinessError = null
      return true
    } catch (error) {
      readinessError = error
      return false
    }
  }

  async function withAgentOrMock<T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ): Promise<T> {
    if (!(await isAgentAvailable())) {
      if (allowBrowserMockFallback) return mockOperation()
      throw readinessError instanceof Error
        ? readinessError
        : new Error('Agent RPC 当前不可用。')
    }
    return agentOperation()
  }

  function unsupportedAgentOperation(operation: string): never {
    const error = new Error(
      `AGENT_OPERATION_UNSUPPORTED: 真实 Agent 会话暂不支持 ${operation}。`,
    ) as Error & { code: string }
    error.code = 'AGENT_OPERATION_UNSUPPORTED'
    throw error
  }

  function requireAgentCapability(name: 'prompt' | 'memory' | 'compact' | 'hookTrust', version = 1): void {
    if ((agentCapabilities[name] ?? 0) >= version) return
    unsupportedAgentOperation(`${name} v${version}`)
  }

  function withUnsupportedAgentFallback<T>(
    operation: string,
    mockOperation: () => Promise<T>,
  ): Promise<T> {
    return withAgentOrMock(
      async () => unsupportedAgentOperation(operation),
      mockOperation,
    )
  }

  function queueSettingsUpdate<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = pendingSettingsUpdates.get(sessionId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const pending = result.then(() => undefined)
    pendingSettingsUpdates.set(sessionId, pending)
    void pending.then(
      () => {
        if (pendingSettingsUpdates.get(sessionId) === pending) {
          pendingSettingsUpdates.delete(sessionId)
        }
      },
      () => {
        if (pendingSettingsUpdates.get(sessionId) === pending) {
          pendingSettingsUpdates.delete(sessionId)
        }
      },
    )
    return result
  }

  async function awaitPendingSettingsUpdate(sessionId: string): Promise<void> {
    await pendingSettingsUpdates.get(sessionId)
  }

  async function loadModelCatalog(refresh = false): Promise<ProvidersResponse> {
    if (modelCatalogCache && !refresh) return modelCatalogCache
    modelCatalogCache = await rpc.call<ProvidersResponse>(
      refresh ? 'model/refresh' : 'model/list',
    )
    return modelCatalogCache
  }

  async function loadIntegrations(
    refresh = false,
  ): Promise<IntegrationListResponse['integrations']> {
    if (integrationsCache && !refresh) return integrationsCache
    const response = await rpc.call<IntegrationListResponse>('integration/list')
    integrationsCache = response.integrations
    return integrationsCache
  }

  async function providerState(
    preferredProviderID?: ModelProviderID,
  ): Promise<DesktopModelProviderState> {
    const [catalog, integrations, desktopSettings] = await Promise.all([
      loadModelCatalog(),
      loadIntegrations(),
      mockClient.getDesktopSettings(),
    ])
    const selectedProviderID =
      preferredProviderID ??
      catalog.defaultModel?.providerID ??
      desktopSettings.providerID ??
      catalog.providers[0]?.provider.id
    const catalogProvider =
      catalog.providers.find(item => item.provider.id === selectedProviderID) ??
      catalog.providers[0]
    if (!catalogProvider) throw new Error('Agent 未返回可用模型提供商。')
    const integration = integrations.find(
      item => item.id === catalogProvider.provider.integrationID,
    )
    const summary = catalogProviderToDesktop(catalogProvider, integration)
    const selectedModel =
      catalog.defaultModel?.providerID === catalogProvider.provider.id
        ? catalog.defaultModel
        : null
    const model =
      selectedModel?.id ??
      catalogProvider.models.find(item => item.enabled)?.id ??
      catalogProvider.models[0]?.id ??
      ''
    const credentialConnection = integration?.connections.find(
      connection => connection.type === 'credential',
    )
    const envConnection = integration?.connections.find(
      connection => connection.type === 'env',
    )
    return {
      selectedProviderID: catalogProvider.provider.id,
      provider: summary,
      model,
      variant: selectedModel?.variant,
      baseURL: summary.baseURL,
      apiKeyConfigured: summary.apiKeyConfigured,
      apiKeySource: credentialConnection
        ? 'secureStorage'
        : envConnection?.name ?? null,
      modelConfigured: Boolean(model && summary.apiKeyConfigured),
      configurationMessage: summary.apiKeyConfigured
        ? undefined
        : '未连接凭据，请先配置 API 密钥或完成授权。',
      models: summary.defaultModels,
      modelMetadata: summary.modelMetadata,
    }
  }

  async function integrationForProvider(
    providerID: ModelProviderID,
    refreshIntegrations = false,
  ) {
    const [catalog, integrations] = await Promise.all([
      loadModelCatalog(),
      loadIntegrations(refreshIntegrations),
    ])
    const provider = catalog.providers.find(item => item.provider.id === providerID)
    if (!provider) throw new Error(`未找到模型提供商：${providerID}`)
    const integrationID = provider.provider.integrationID
    if (!integrationID) throw new Error(`模型提供商 ${providerID} 未声明凭据 Integration。`)
    const integration = integrations.find(item => item.id === integrationID)
    if (!integration) throw new Error(`未找到模型提供商 ${providerID} 的 Integration。`)
    return { provider, integration }
  }

  async function openAuthorizationURL(url: string): Promise<void> {
    if (!url) return
    if (environment.openExternal) {
      await environment.openExternal(url)
      return
    }
    if (typeof window !== 'undefined') {
      if (window.codePilotXDesktop) {
        await window.codePilotXDesktop.openExternal(url)
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  async function loadProjectsById(refresh = false): Promise<Map<string, Project>> {
    if (projectsByIdCache && !refresh) return projectsByIdCache
    const response = await rpc.call<{ projects: Project[] }>('project/list')
    projectsByIdCache = new Map(response.projects.map(project => [project.id, project]))
    return projectsByIdCache
  }

  async function loadProjectForPath(rootPath: string): Promise<Project> {
    const response = await rpc.call<{ project: Project }>('project/open', { rootPath })
    projectsByIdCache = null
    return response.project
  }

  async function listAgentSessions(
    options?: { archived?: boolean },
  ): Promise<DesktopSessionSnapshot[]> {
    const archived = options?.archived === true
    const [projectsById, response] = await Promise.all([
      loadProjectsById(),
      rpc.call<{ threads: ThreadListItem[]; nextCursor: string | null }>('thread/list', {
        archived,
        limit: 100,
      }),
    ])
    const snapshots = response.threads.map(item => {
      const listSnapshot = agentThreadListItemToDesktopSnapshot(
        item,
        item.projectID ? projectsById.get(item.projectID) : null,
      )
      const cached = sessionSnapshots.get(item.id)
      const snapshot = cached
        ? {
            ...cached,
            item: {
              ...cached.item,
              ...listSnapshot.item,
              pinnedAt: cached.item.pinnedAt ?? listSnapshot.item.pinnedAt,
            },
            workspace: listSnapshot.workspace,
            updatedAt: listSnapshot.updatedAt,
          }
        : listSnapshot
      sessionSnapshots.set(item.id, snapshot)
      return snapshot
    })
    return snapshots
  }

  async function loadAgentSessionSnapshot(
    sessionId: string,
  ): Promise<DesktopSessionSnapshot> {
    const sharedSnapshot = await rpc.call<ThreadSnapshot>('thread/read', { threadId: sessionId })
    sessionPermissionConfigs.set(sessionId, sharedSnapshot.thread.settings.permissionConfig)
    const projectsById = await loadProjectsById()
    const snapshot = agentThreadSnapshotToDesktop(
      sharedSnapshot,
      sharedSnapshot.thread.projectID
        ? projectsById.get(sharedSnapshot.thread.projectID)
        : null,
    )
    const cached = sessionSnapshots.get(sessionId)
    sessionSnapshots.set(sessionId, {
      ...snapshot,
      item: {
        ...snapshot.item,
        pinnedAt: cached?.item.pinnedAt ?? snapshot.item.pinnedAt,
      },
    })
    return sessionSnapshots.get(sessionId)!
  }

  async function refreshAgentSessionStoreChange(): Promise<void> {
    const sessions = await listAgentSessions({ archived: false })
    const visibleIds = new Set(sessions.map(snapshot => snapshot.item.id))
    for (const sessionId of [...sessionSnapshots.keys()]) {
      if (!visibleIds.has(sessionId)) {
        const snapshot = sessionSnapshots.get(sessionId)
        if (!snapshot?.item.archivedAt) sessionSnapshots.delete(sessionId)
      }
    }
    if (activeSessionId && !visibleIds.has(activeSessionId)) {
      activeSessionId = sessions[0]?.item.id ?? null
    }
    emitSessionStoreChange(sessions)
  }

  function emitSessionStoreChange(
    sessions = [...sessionSnapshots.values()].filter(
      snapshot => !snapshot.item.archivedAt,
    ),
  ): void {
    const change: DesktopSessionStoreChange = {
      activeSessionId,
      sessions,
    }
    for (const listener of sessionStoreListeners) {
      listener(change)
    }
  }

  function scheduleSessionRefresh(sessionId: string): void {
    if (refreshTimers.has(sessionId)) return
    const timer = setTimeout(() => {
      refreshTimers.delete(sessionId)
      void loadAgentSessionSnapshot(sessionId)
        .then(() => refreshAgentSessionStoreChange())
        .catch(() => {})
    }, 250)
    refreshTimers.set(sessionId, timer)
  }

  function taskModeForSession(sessionId: string): 'chat' | 'plan' {
    return sessionSnapshots.get(sessionId)?.item.planModeActive ? 'plan' : 'chat'
  }

  function permissionConfigForSession(sessionId: string) {
    return sessionPermissionConfigs.get(sessionId) ?? desktopPermissionModeToPermissionConfig(
      sessionSnapshots.get(sessionId)?.item.permissionMode,
    )
  }

  function permissionModeFromConfig(
    config: PermissionConfig,
  ): DesktopPermissionMode {
    return permissionModeFromDesktopConfig(config)
  }

  async function applyThreadSettings(
    sessionId: string,
    settings: ThreadSettings,
  ): Promise<DesktopSessionSnapshot> {
    const current =
      sessionSnapshots.get(sessionId) ??
      (await loadAgentSessionSnapshot(sessionId))
    const planModeActive = settings.taskMode === 'plan'
    const collaborationMode = collaborationModeFromPlanModeActive(planModeActive)
    const permissionMode = permissionModeFromConfig(settings.permissionConfig)
    const snapshot: DesktopSessionSnapshot = {
      ...current,
      item: {
        ...current.item,
        collaborationMode,
        permissionMode,
        planModeActive,
      },
      settings: {
        ...current.settings,
        collaborationMode,
        permissionConfig: settings.permissionConfig,
        planModeActive,
      },
    }
    sessionSnapshots.set(sessionId, snapshot)
    sessionPermissionConfigs.set(sessionId, settings.permissionConfig)
    emitSessionStoreChange()
    return snapshot
  }

  function updateThreadSettings(
    sessionId: string,
    settings: ThreadSettingsPatch,
  ): Promise<DesktopSessionSnapshot> {
    return queueSettingsUpdate(sessionId, async () => {
      const response = await rpc.call<{
        threadId: string
        settings: ThreadSettings
      }>('thread/settings/update', {
        threadId: sessionId,
        settings,
      })
      if (response.threadId !== sessionId) {
        throw new Error(
          `thread/settings/update 返回了不匹配的 threadId：${response.threadId}`,
        )
      }
      return applyThreadSettings(sessionId, response.settings)
    })
  }

  async function submitAgentMessage(
    sessionId: string,
    input: DesktopUserMessageInput,
    strategy: 'queue' | 'guide',
    model?: string | DesktopModelSelection,
  ): Promise<unknown> {
    await awaitPendingSettingsUpdate(sessionId)
    const attachmentIds = await importAgentAttachments(input)
    const response = await rpc.call('turn/start', {
      threadId: sessionId,
      content: desktopUserMessageInputToPreviewText(input),
      model: await resolveAgentModelRef(model, sessionId),
      permissionConfig: permissionConfigForSession(sessionId),
      strategy,
      taskMode: taskModeForSession(sessionId),
      ...(attachmentIds.length ? { attachmentIds } : {}),
    })
    await loadAgentSessionSnapshot(sessionId).catch(() => null)
    emitSessionStoreChange()
    return response
  }

  async function importAgentAttachments(input: DesktopUserMessageInput) {
    const source = input.attachments ?? []
    if (!source.length) return []
    const payload = source.map(attachment => {
      if (attachment.status !== 'ready') throw new Error(`附件 ${attachment.name} 尚未准备完成。`)
      if (attachment.kind === 'image') {
        const data = attachment.contentBase64 ?? attachment.previewDataUrl?.replace(/^data:[^;]+;base64,/, '')
        if (!data) throw new Error(`图片附件 ${attachment.name} 缺少内容。`)
        return { kind: 'image' as const, name: attachment.name, mediaType: attachment.mediaType, data, encoding: 'base64' }
      }
      if (typeof attachment.textContent !== 'string' || attachment.truncated) throw new Error(`附件 ${attachment.name} 不是完整的 UTF-8 文本或受支持图片。`)
      return { kind: 'text' as const, name: attachment.name, mediaType: attachment.mediaType || 'text/plain', data: attachment.textContent, encoding: 'utf8' }
    })
    const response = await rpc.call<{ attachments: Array<{ id: string }> }>('attachment/import', { attachments: payload })
    return response.attachments.map(attachment => attachment.id)
  }

  async function resolveAgentModelRef(
    selection: string | DesktopModelSelection | undefined,
    sessionId: string,
  ): Promise<ModelRef> {
    const providers = await loadModelCatalog()
    if (typeof selection === 'object' && selection?.providerID && selection.model) {
      const provider = providers.providers.find(
        item => item.provider.id === selection.providerID,
      )
      const model = provider?.models.find(item => item.id === selection.model)
      if (!provider || !model) {
        throw new Error(`未找到模型：${selection.providerID}/${selection.model}`)
      }
      const variant = selection.variant
        ? model.variants.find(item => item.id === selection.variant)?.id
        : undefined
      return {
        providerID: provider.provider.id,
        id: model.id,
        ...(variant ? { variant } : {}),
      }
    }
    if (typeof selection === 'string' && selection.trim()) {
      const providerID = sessionSnapshots.get(sessionId)?.settings.providerID
      const provider = providers.providers.find(
        item => item.provider.id === providerID,
      )
      const model = provider?.models.find(item => item.id === selection.trim())
      if (provider && model) {
        return { providerID: provider.provider.id, id: model.id }
      }
    }
    const cached = sessionSnapshots.get(sessionId)
    if (cached?.settings.providerID && cached.settings.model) {
      if (
        providers.defaultModel?.providerID === cached.settings.providerID &&
        providers.defaultModel.id === cached.settings.model
      ) {
        return providers.defaultModel
      }
      const provider = providers.providers.find(
        item => item.provider.id === cached.settings.providerID,
      )
      const model = provider?.models.find(item => item.id === cached.settings.model)
      if (provider && model) return { providerID: provider.provider.id, id: model.id }
    }
    if (providers.defaultModel) return providers.defaultModel
    const integrations = await loadIntegrations()
    const provider =
      providers.providers.find(item => {
        if (!item.provider.integrationID) return true
        return integrations.some(
          integration =>
            integration.id === item.provider.integrationID &&
            integration.connections.length > 0,
        )
      }) ?? providers.providers[0]
    const model = provider?.models[0]
    if (provider && model) {
      return { providerID: provider.provider.id, id: model.id }
    }
    throw new Error('没有可用模型，请先配置模型提供商。')
  }

  function eventSourceFactory(): ((url: string) => EventSource) | null {
    if (environment.eventSourceFactory) return environment.eventSourceFactory
    if (typeof EventSource === 'undefined') return null
    return url => new EventSource(url, { withCredentials: true })
  }

  const client: DesktopApi = {
    ...mockClient,
    getMcpRuntimeStatus: sessionId =>
      withUnsupportedAgentFallback(
        'getMcpRuntimeStatus',
        () => mockClient.getMcpRuntimeStatus(sessionId),
      ),
    restoreSessionTurnChanges: input =>
      withUnsupportedAgentFallback(
        'restoreSessionTurnChanges',
        () => mockClient.restoreSessionTurnChanges(input),
      ),
    chooseWorkspace: async () => {
      const picker = environment.window?.codePilotXDesktop?.pickWorkspaceDirectory
      if (!picker) return mockClient.chooseWorkspace()
      const workspacePath = await picker()
      if (!workspacePath) return null
      return withAgentOrMock(
        async () => projectToDesktopWorkspace(await loadProjectForPath(workspacePath), null),
        () => mockClient.openWorkspace(workspacePath),
      )
    },
    openWorkspace: workspacePath =>
      withAgentOrMock(
        async () => projectToDesktopWorkspace(await loadProjectForPath(workspacePath), null),
        () => mockClient.openWorkspace(workspacePath),
      ),
    getWorkspaceContext: workspacePath =>
      withAgentOrMock(
        async () => projectToDesktopWorkspace(await loadProjectForPath(workspacePath), null),
        () => mockClient.getWorkspaceContext(workspacePath),
      ),
    getDesktopSettings: () =>
      withAgentOrMock(
        async () => {
          const response = await rpc.call<{ settings: unknown }>('desktop/settings/get')
          return normalizeDesktopStoredSettings(response.settings)
        },
        () => mockClient.getDesktopSettings(),
      ),
    saveDesktopSettings: settings =>
      withAgentOrMock(
        async () => {
          const normalized = normalizeDesktopStoredSettings(settings)
          const response = await rpc.call<{ settings: unknown }>(
            'desktop/settings/save',
            { settings: normalized },
          )
          const saved = normalizeDesktopStoredSettings(response.settings)
          await mockClient.saveDesktopSettings(saved)
          return saved
        },
        () => mockClient.saveDesktopSettings(settings),
      ),
    listProjectMemories: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(workspacePath)
          const response = await rpc.call<{ entries: Array<{ id: string; scope: 'user' | 'project'; content: string; updatedAt: number }> }>('memory/list', { scope: 'project', projectId: project.id })
          return {
            memoryDir: 'Agent data directory / project memory',
            entrypointPath: 'SQLite:memory_entries',
            memories: response.entries.map(entry => ({ relativePath: entry.id, absolutePath: entry.id, type: 'project' as const, description: entry.content.slice(0, 120), size: entry.content.length, mtimeMs: entry.updatedAt })),
          }
        },
        () => mockClient.listProjectMemories(workspacePath),
      ),
    readProjectMemory: (workspacePath, relativePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(workspacePath)
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/read', { id: relativePath, scope: 'project', projectId: project.id })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'project' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt, content: response.entry.content }
        },
        () => mockClient.readProjectMemory(workspacePath, relativePath),
      ),
    saveProjectMemory: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(input.workspacePath)
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/save', { scope: 'project', projectId: project.id, ...(input.relativePath ? { id: input.relativePath } : {}), content: input.content })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'project' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt }
        },
        () => mockClient.saveProjectMemory(input),
      ),
    deleteProjectMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); const project = await loadProjectForPath(input.workspacePath); await rpc.call('memory/delete', { id: input.relativePath, scope: 'project', projectId: project.id }) }, () => mockClient.deleteProjectMemory(input)),
    resetProjectMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); const project = await loadProjectForPath(input.workspacePath); await rpc.call('memory/reset', { scope: 'project', projectId: project.id, includeEventLog: input.includeRecallLog === true }) }, () => mockClient.resetProjectMemory(input)),
    listProjectMemoryRecalls: workspacePath =>
      withAgentOrMock(async () => ({ recallLogPath: 'SQLite prompt context fragments', recalls: [] }), () => mockClient.listProjectMemoryRecalls(workspacePath)),
    listUserMemories: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{ entries: Array<{ id: string; content: string; updatedAt: number }> }>('memory/list', { scope: 'user' })
          return { memoryDir: 'Agent data directory / user memory', profilePath: 'SQLite:memory_entries', preferencesPath: 'SQLite:memory_entries', eventsPath: 'SQLite:memory_jobs', conversationIndexPath: 'SQLite:agent.sqlite', memories: response.entries.map(entry => ({ relativePath: entry.id, absolutePath: entry.id, type: 'user' as const, description: entry.content.slice(0, 120), size: entry.content.length, mtimeMs: entry.updatedAt })) }
        },
        () => mockClient.listUserMemories(),
      ),
    readUserMemory: relativePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/read', { id: relativePath, scope: 'user' })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'user' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt, content: response.entry.content }
        },
        () => mockClient.readUserMemory(relativePath),
      ),
    saveUserMemory: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/save', { scope: 'user', ...(input.relativePath ? { id: input.relativePath } : {}), content: input.content })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'user' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt }
        },
        () => mockClient.saveUserMemory(input),
      ),
    deleteUserMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); await rpc.call('memory/delete', { id: input.relativePath, scope: 'user' }) }, () => mockClient.deleteUserMemory(input)),
    resetUserMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); await rpc.call('memory/reset', { scope: 'user', includeEventLog: input.includeEventLog }) }, () => mockClient.resetUserMemory(input)),
    listModelProviders: async () => {
      const [catalog, integrations] = await Promise.all([
        loadModelCatalog(),
        loadIntegrations(),
      ])
      return catalog.providers.map(provider =>
        catalogProviderToDesktop(
          provider,
          integrations.find(
            integration => integration.id === provider.provider.integrationID,
          ),
        ),
      )
    },
    getModelProviderState: () => providerState(),
    fetchProviderModels: async options => {
      const catalog = await loadModelCatalog(true)
      const provider = catalog.providers.find(
        item => item.provider.id === options.providerID,
      )
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      return {
        models: provider.models.filter(item => item.enabled).map(item => item.id),
      }
    },
    saveModelProvider: async options => {
      const catalog = await loadModelCatalog()
      const catalogProvider = catalog.providers.find(
        item => item.provider.id === options.providerID,
      )
      if (!catalogProvider) throw new Error(`未找到模型提供商：${options.providerID}`)
      if (
        options.baseURL !== undefined &&
        options.baseURL !== catalogProvider.provider.api.url
      ) {
        const updatedProvider: CatalogProvider = {
          ...catalogProvider,
          provider: {
            ...catalogProvider.provider,
            api: {
              ...catalogProvider.provider.api,
              url: options.baseURL || undefined,
            },
          },
        }
        await rpc.call<OkResponse>('provider/updateSettings', updatedProvider)
      }
      if (options.id) {
        const selectedModel = catalogProvider.models.find(
          model => model.id === options.id,
        )
        if (!selectedModel) {
          throw new Error(`未找到模型：${options.providerID}/${options.id}`)
        }
        const selectedVariant = options.variant
          ? selectedModel.variants.find(variant => variant.id === options.variant)?.id
          : undefined
        const model: ModelRef = {
          providerID: catalogProvider.provider.id,
          id: selectedModel.id,
          ...(selectedVariant ? { variant: selectedVariant } : {}),
        }
        await rpc.call<OkResponse>('model/setDefault', model)
      }
      modelCatalogCache = null
      return providerState(options.providerID)
    },
    saveProviderApiKey: async (providerID, apiKey) => {
      const { integration } = await integrationForProvider(providerID)
      await rpc.call<OkResponse>('integration/connect', {
        integrationID: integration.id,
        key: apiKey,
      } satisfies IntegrationConnectRequest)
      integrationsCache = null
      modelCatalogCache = null
      return providerState(providerID)
    },
    deleteProviderApiKey: async providerID => {
      const { integration } = await integrationForProvider(providerID, true)
      const credentials = integration.connections.filter(
        connection => connection.type === 'credential',
      )
      if (credentials.length === 0) {
        const environment = integration.connections.find(
          connection => connection.type === 'env',
        )
        throw new Error(
          environment
            ? `当前凭据来自环境变量 ${environment.name}，不能在应用内删除。`
            : '当前 Provider 没有可删除的应用内 API 密钥。',
        )
      }
      for (const connection of credentials) {
        await rpc.call<OkResponse>('integration/disconnect', {
          integrationID: integration.id,
          credentialID: connection.id,
        } satisfies IntegrationDisconnectRequest)
      }
      integrationsCache = null
      modelCatalogCache = null
      const nextState = await providerState(providerID)
      const refreshedIntegration = (await loadIntegrations()).find(
        item => item.id === integration.id,
      )
      if (
        refreshedIntegration?.connections.some(
          connection => connection.type === 'credential',
        )
      ) {
        throw new Error('API 密钥删除后仍存在于安全存储中，请重试。')
      }
      return nextState
    },
    testModelProvider: async providerID => {
      const catalog = await loadModelCatalog()
      const provider = catalog.providers.find(item => item.provider.id === providerID)
      if (!provider) throw new Error(`未找到模型提供商：${providerID}`)
      return rpc.call<ProviderTestResponse>('provider/test', {
        providerID: provider.provider.id,
      })
    },
    listIntegrations: async () => [...await loadIntegrations(true)],
    connectIntegration: async input => {
      const result = await rpc.call<OkResponse>('integration/connect', input)
      integrationsCache = null
      modelCatalogCache = null
      return result
    },
    authorizeIntegration: async input => {
      const result = await rpc.call<IntegrationAuthorizeResponse>(
        'integration/authorize',
        input satisfies IntegrationAuthorizeRequest,
      )
      await openAuthorizationURL(result.attempt.url)
      return result
    },
    completeIntegrationAuthorization: async input => {
      const result = await rpc.call<OkResponse>(
        'integration/authorizeComplete',
        input,
      )
      integrationsCache = null
      modelCatalogCache = null
      return result
    },
    getIntegrationAuthorizationStatus: input =>
      rpc.call<IntegrationAuthorizeStatusResponse>(
        'integration/authorizeStatus',
        input,
      ),
    disconnectIntegration: async input => {
      const result = await rpc.call<OkResponse>('integration/disconnect', input)
      integrationsCache = null
      modelCatalogCache = null
      return result
    },
    createSession: async (options: CreateDesktopSessionOptions) =>
      withAgentOrMock<CreateDesktopSessionResult>(
        async () => {
          if (!options.workspacePath?.trim()) {
            throw new Error('历史会话需要先选择项目工作区。')
          }
          const project = await loadProjectForPath(options.workspacePath)
          const collaborationMode = resolveCodePilotXCollaborationMode({
            collaborationMode: options.collaborationMode,
            planModeActive: options.planModeActive,
          })
          const stored = await desktopClient.getDesktopSettings()
          const advancedPermission: PermissionConfig = options.permissionConfig ?? stored.permissionConfig
          const settings: ThreadSettings = {
            taskMode: planModeActiveFromCollaborationMode(collaborationMode)
              ? 'plan'
              : 'chat',
            permissionConfig: advancedPermission,
          }
          const sharedSnapshot = await rpc.call<ThreadSnapshot>('thread/create', {
            projectID: project.id,
            settings,
            title: options.sessionName,
          })
          const snapshot = agentThreadSnapshotToDesktop(sharedSnapshot, project)
          sessionSnapshots.set(snapshot.item.id, snapshot)
          activeSessionId = snapshot.item.id
          await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
          return {
            sessionId: snapshot.item.id,
            workspace: snapshot.workspace,
            standalone: false,
          }
        },
        () => mockClient.createSession(options),
      ),
    listSessions: async options =>
      withAgentOrMock(
        () => listAgentSessions(options),
        () => mockClient.listSessions(options),
      ),
    getSessionCatalogStatus: async (): Promise<DesktopSessionCatalogStatus> => {
      if (await isAgentAvailable()) return { state: 'ready', error: null }
      if (allowBrowserMockFallback) return mockClient.getSessionCatalogStatus()
      return {
        state: 'unavailable',
        error:
          readinessError instanceof Error
            ? readinessError.message
            : 'Agent RPC 当前不可用。',
      }
    },
    getSession: async sessionId =>
      withAgentOrMock(
        () => loadAgentSessionSnapshot(sessionId),
        () => mockClient.getSession(sessionId),
      ),
    listSubagents: async threadId => {
      const response = await rpc.call<{ subagents: SubagentProjection[] }>('subagent/list', { threadId })
      return response.subagents
    },
    readSubagent: taskId => rpc.call<DesktopSubagentRead>('subagent/read', { taskId }),
    sendSubagent: async (taskId, input, selectedModel, selectedPermissionMode) => rpc.call('subagent/send', {
      taskId,
      message: desktopUserMessageInputToPreviewText(input),
      requestId: crypto.randomUUID(),
      model: await resolveAgentModelRef(selectedModel, activeSessionId ?? ''),
      attachmentIds: await importAgentAttachments(input),
      ...(selectedPermissionMode ? { permissionConfig: desktopPermissionModeToPermissionConfig(selectedPermissionMode) } : {}),
    }),
    stopSubagent: taskId => rpc.call('subagent/stop', { taskId, requestId: crypto.randomUUID() }),
    retrySubagent: taskId => rpc.call('subagent/retry', { taskId, requestId: crypto.randomUUID() }),
    applySubagentWorktree: taskId => rpc.call('subagent/worktree/apply', { taskId, requestId: crypto.randomUUID() }),
    discardSubagentWorktree: taskId => rpc.call('subagent/worktree/discard', { taskId, requestId: crypto.randomUUID() }),
    restoreSubagentWorkspace: taskId => rpc.call('subagent/workspace/restore', { taskId, requestId: crypto.randomUUID() }),
    respondSubagentApproval: async (approval, decision) => {
      await rpc.call('approval/respond', { approvalId: approval.id, decision })
    },
    respondSubagentQuestion: async (questionId, answer, ignored) => {
      await rpc.call('question/respond', { questionId, answer, ignored })
    },
    getActiveSessionId: () =>
      withAgentOrMock(
        async () => activeSessionId,
        () => mockClient.getActiveSessionId(),
      ),
    setActiveSession: sessionId =>
      withAgentOrMock(
        async () => {
          activeSessionId = sessionId
          emitSessionStoreChange()
        },
        () => mockClient.setActiveSession(sessionId),
      ),
    updateSessionMetadata: async (
      sessionId: string,
      patch: DesktopSessionMetadataPatch,
    ) =>
      withAgentOrMock(
        async () => {
          let snapshot =
            sessionSnapshots.get(sessionId) ??
            (await loadAgentSessionSnapshot(sessionId))
          if (patch.archivedAt !== undefined) {
            const response = await rpc.call<{ thread: ThreadListItem }>('thread/update', {
              threadId: sessionId,
              archived: patch.archivedAt !== null,
            })
            const projectsById = await loadProjectsById()
            const listSnapshot = agentThreadListItemToDesktopSnapshot(
              response.thread,
              response.thread.projectID
                ? projectsById.get(response.thread.projectID)
                : null,
            )
            snapshot = {
              ...snapshot,
              item: {
                ...snapshot.item,
                ...listSnapshot.item,
                pinnedAt: patch.pinnedAt ?? snapshot.item.pinnedAt,
              },
              updatedAt: listSnapshot.updatedAt,
            }
          }
          if (patch.pinnedAt !== undefined) {
            snapshot = {
              ...snapshot,
              item: { ...snapshot.item, pinnedAt: patch.pinnedAt },
              updatedAt: new Date().toISOString(),
            }
          }
          sessionSnapshots.set(sessionId, snapshot)
          await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
          return snapshot
        },
        () => mockClient.updateSessionMetadata(sessionId, patch),
      ),
    renameSession: async (sessionId: string, name: string) =>
      withAgentOrMock(
        async () => {
          const response = await rpc.call<{ thread: ThreadListItem }>('thread/update', {
            threadId: sessionId,
            title: name,
          })
          const projectsById = await loadProjectsById()
          const listSnapshot = agentThreadListItemToDesktopSnapshot(
            response.thread,
            response.thread.projectID
              ? projectsById.get(response.thread.projectID)
              : null,
          )
          const current =
            sessionSnapshots.get(sessionId) ??
            (await loadAgentSessionSnapshot(sessionId).catch(() => listSnapshot))
          const snapshot = {
            ...current,
            item: { ...current.item, ...listSnapshot.item },
            updatedAt: listSnapshot.updatedAt,
          }
          sessionSnapshots.set(sessionId, snapshot)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.renameSession(sessionId, name),
      ),
    saveSessionReviewComment: input =>
      withUnsupportedAgentFallback(
        'saveSessionReviewComment',
        () => mockClient.saveSessionReviewComment(input),
      ),
    resolveSessionReviewComment: input =>
      withUnsupportedAgentFallback(
        'resolveSessionReviewComment',
        () => mockClient.resolveSessionReviewComment(input),
      ),
    deleteSessionReviewComment: input =>
      withUnsupportedAgentFallback(
        'deleteSessionReviewComment',
        () => mockClient.deleteSessionReviewComment(input),
      ),
    setSessionPermissionMode: (sessionId, mode) =>
      withAgentOrMock(
        () => updateThreadSettings(sessionId, {
          permissionConfig: desktopPermissionModeToPermissionConfig(mode),
        }),
        () => mockClient.setSessionPermissionMode(sessionId, mode),
      ),
    setSessionPlanModeActive: (sessionId, active) =>
      withAgentOrMock(
        () => updateThreadSettings(sessionId, {
          taskMode: active ? 'plan' : 'chat',
        }),
        () => mockClient.setSessionPlanModeActive(sessionId, active),
      ),
    setSessionLocalRouterMode: (sessionId, mode) =>
      withUnsupportedAgentFallback(
        'setSessionLocalRouterMode',
        () => mockClient.setSessionLocalRouterMode(sessionId, mode),
      ),
    disposeSession: async sessionId =>
      withAgentOrMock(
        async () => {
          await rpc.call('thread/delete', { threadId: sessionId })
          sessionSnapshots.delete(sessionId)
          if (activeSessionId === sessionId) {
            activeSessionId =
              [...sessionSnapshots.values()].find(snapshot => !snapshot.item.archivedAt)
                ?.item.id ?? null
          }
          emitSessionStoreChange()
        },
        () => mockClient.disposeSession(sessionId),
      ),
    sendUserMessage: async (sessionId, input, model) =>
      withAgentOrMock(
        async () => {
          await submitAgentMessage(sessionId, input, 'queue', model)
        },
        () => mockClient.sendUserMessage(sessionId, input, model),
      ),
    submitSessionFollowUp: async (
      sessionId: string,
      input: DesktopUserMessageInput,
      behavior: DesktopFollowUpBehavior,
    ) =>
      withAgentOrMock(
        async () => {
          const strategy = behavior === 'steer' ? 'guide' : 'queue'
          await submitAgentMessage(sessionId, input, strategy)
          return behavior === 'steer' ? 'steered' as const : 'queued' as const
        },
        () => mockClient.submitSessionFollowUp(sessionId, input, behavior),
      ),
    updateQueuedFollowUp: (sessionId, followUpId, input) =>
      withUnsupportedAgentFallback(
        'updateQueuedFollowUp',
        () => mockClient.updateQueuedFollowUp(sessionId, followUpId, input),
      ),
    removeQueuedFollowUp: (sessionId, followUpId) =>
      withUnsupportedAgentFallback(
        'removeQueuedFollowUp',
        () => mockClient.removeQueuedFollowUp(sessionId, followUpId),
      ),
    sendQueuedFollowUpNow: (sessionId, followUpId) =>
      withUnsupportedAgentFallback(
        'sendQueuedFollowUpNow',
        () => mockClient.sendQueuedFollowUpNow(sessionId, followUpId),
      ),
    compactSession: sessionId =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('compact')
          await rpc.call('thread/compact', { threadId: sessionId })
        },
        () => mockClient.compactSession(sessionId),
      ),
    getSessionPromptPreview: sessionId =>
      withAgentOrMock(
        async () => { requireAgentCapability('prompt', 2); return (await rpc.call<{ preview: unknown }>('prompt/preview', { threadId: sessionId })).preview },
        () => mockClient.getSessionPromptPreview(sessionId),
      ),
    rollbackSession: input =>
      withUnsupportedAgentFallback(
        'rollbackSession',
        () => mockClient.rollbackSession(input),
      ),
    getSessionGoal: sessionId =>
      withUnsupportedAgentFallback(
        'getSessionGoal',
        () => mockClient.getSessionGoal(sessionId),
      ),
    setSessionGoal: (sessionId, input) =>
      withUnsupportedAgentFallback(
        'setSessionGoal',
        () => mockClient.setSessionGoal(sessionId, input),
      ),
    clearSessionGoal: sessionId =>
      withUnsupportedAgentFallback(
        'clearSessionGoal',
        () => mockClient.clearSessionGoal(sessionId),
      ),
    startSessionReview: (sessionId, target) =>
      withUnsupportedAgentFallback(
        'startSessionReview',
        () => mockClient.startSessionReview(sessionId, target),
      ),
    setSessionPermissionProfile: (sessionId, profile, approvalPolicy) =>
      withAgentOrMock(
        async () => {
          const current = sessionSnapshots.get(sessionId) ?? await loadAgentSessionSnapshot(sessionId)
          const sandboxMode: PermissionConfig['sandboxMode'] = profile.includes('danger')
            ? 'danger-full-access'
            : profile.includes('read-only')
              ? 'read-only'
              : 'workspace-write'
          const permissionConfig: PermissionConfig = {
            sandboxMode,
            approvalPolicy: approvalPolicy ?? 'on-request',
            approvalsReviewer: current.settings.permissionConfig.approvalsReviewer,
          }
          const response = await rpc.call<{ threadId: string; settings: ThreadSettings }>('thread/settings/update', { threadId: sessionId, settings: { permissionConfig } })
          return applyThreadSettings(response.threadId, response.settings)
        },
        () => mockClient.setSessionPermissionProfile(sessionId, profile, approvalPolicy),
      ),
    respondToPermission: async (
      sessionId: string,
      requestId: string,
      decision: DesktopPermissionDecision,
    ) =>
      withAgentOrMock(
        async () => {
          const questionId = agentQuestionIdFromRequestId(requestId)
          const planRunId = agentPlanRunIdFromRequestId(requestId)
          if (planRunId) {
            await rpc.call('turn/submitPlanDecision', {
              turnId: planRunId,
              decision: decision.behavior === 'allow' ? 'continue' : 'reject',
            })
          } else if (questionId) {
            await rpc.call('question/respond', {
              questionId,
              answer: questionAnswerFromDecision(decision),
              ignored: decision.behavior === 'deny',
            })
          } else {
            await rpc.call('approval/respond', {
              approvalId: requestId,
              decision: decision.behavior === 'allow' ? 'allow-once' : 'deny',
            })
          }
          await loadAgentSessionSnapshot(sessionId).catch(() => null)
          emitSessionStoreChange()
        },
        () => mockClient.respondToPermission(sessionId, requestId, decision),
      ),
    interruptSession: async sessionId =>
      withAgentOrMock(
        async () => {
          await rpc.call('turn/interrupt', { threadId: sessionId })
          scheduleSessionRefresh(sessionId)
        },
        () => mockClient.interruptSession(sessionId),
      ),
    onAgentEvent: callback => {
      const makeEventSource = eventSourceFactory()
      if (!makeEventSource) {
        return allowBrowserMockFallback
          ? mockClient.onAgentEvent(callback)
          : noop
      }
      const source = makeEventSource('/rpc/events')
      source.onmessage = message => {
        try {
          const notification = JSON.parse(message.data)
          for (const event of agentEventsFromNotification(notification)) {
            callback(event)
          }
          const params =
            notification?.params && typeof notification.params === 'object'
              ? notification.params
              : null
          if (
            typeof params?.threadId === 'string' &&
            typeof notification?.method === 'string' &&
            [
              'thread/snapshot',
              'thread/updated',
              'thread/settings/updated',
              'turn/queued',
              'turn/started',
              'turn/statusChanged',
              'turn/completed',
              'turn/failed',
              'turn/interrupted',
              'item/completed',
              'approval/requested',
              'question/requested',
            ].includes(notification.method)
          ) {
            scheduleSessionRefresh(params.threadId)
          }
        } catch {
          // Ignore malformed SSE payloads; connection state is handled elsewhere.
        }
      }
      source.onerror = () => {}
      return () => {
        source.close()
      }
    },
    onSessionStoreChange: callback => {
      sessionStoreListeners.add(callback)
      const unsubscribeMock = allowBrowserMockFallback
        ? mockClient.onSessionStoreChange(callback)
        : noop
      return () => {
        sessionStoreListeners.delete(callback)
        unsubscribeMock()
      }
    },
  }

  return client
}

function catalogProviderToDesktop(
  catalogProvider: CatalogProvider,
  integration?: IntegrationListResponse['integrations'][number],
): DesktopModelProviderSummary {
  const { provider } = catalogProvider
  const models = catalogProvider.models.filter(model => model.enabled)
  const modelMetadata = Object.fromEntries(
    models.map(model => {
      const cost = model.cost[0]
      const metadata: DesktopModelMetadata = {
        id: model.id,
        name: model.name,
        contextWindow: model.limit.context,
        outputTokens: model.limit.output,
        inputCost: cost?.input,
        outputCost: cost?.output,
        cacheReadCost: cost?.cache.read,
        toolCall: model.capabilities.tools,
        structuredOutput: model.capabilities.output.some(
          output => output === 'json' || output === 'structured',
        ),
        vision: model.capabilities.input.includes('image'),
        modalities: {
          input: [...model.capabilities.input],
          output: [...model.capabilities.output],
        },
        modelType: model.family,
        tags: [model.status],
        variants: model.variants.map(variant => variant.id),
      }
      return [model.id, metadata]
    }),
  )
  const configured = provider.integrationID
    ? Boolean(integration?.connections.length)
    : provider.disabled !== true
  return {
    providerID: provider.id,
    integrationID: provider.integrationID,
    kind: provider.id === 'github-copilot' ? 'github-copilot' : provider.api.type,
    displayName: provider.name,
    baseURL: provider.api.url,
    defaultModels: models.map(model => model.id),
    modelMetadata,
    apiKeyConfigured: configured,
    envVars: integration?.methods
      .filter(method => method.type === 'env')
      .flatMap(method => method.names),
    npmPackage: provider.api.type === 'aisdk' ? provider.api.package : undefined,
    logoURL: `https://models.dev/logos/${encodeURIComponent(provider.id)}.svg`,
    modelsDevSource: true,
    requiresBaseURL: provider.api.type === 'aisdk' && !provider.api.url,
  }
}

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
  _environment: DesktopClientEnvironment,
): DesktopApi {
  return createBrowserMockDesktopClient()
}

function createBrowserMockDesktopClient(): DesktopApi {
  let settings: DesktopStoredSettings = defaultDesktopStoredSettings()
  let themeSettings: DesktopThemeSettings = defaultMockThemeSettings()
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
        model: options.id ?? settings.model,
        providerBaseURL: options.baseURL ?? settings.providerBaseURL,
      }
      return providerState()
    },
    saveProviderApiKey: async () => providerState(),
    deleteProviderApiKey: async () => providerState(),
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
    getThemeSettings: async () => themeSettings,
    saveThemeSettings: async next => {
      themeSettings = normalizeDesktopThemeSettings(next)
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
    eventSourceFactory:
      typeof EventSource === 'undefined'
        ? undefined
        : url => new EventSource(url, { withCredentials: true }),
  }
}

function getDefaultLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

async function agentJson<T>(
  path: string,
  init?: RequestInit,
  fetcher: DesktopClientEnvironment['fetch'] =
    typeof fetch === 'undefined' ? undefined : (input, requestInit) => fetch(input, requestInit),
): Promise<T> {
  if (!fetcher) throw new Error('当前环境无法访问 agent API。')
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetcher(path, {
    ...init,
    credentials: 'include',
    headers,
  })
  if (!response.ok) throw new Error(await agentErrorMessage(response))
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function agentErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return `Agent API 请求失败：${response.status}`
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof payload.error?.message === 'string') return payload.error.message
  } catch {
    // Fall through to the raw response body.
  }
  return text
}

function questionAnswerFromDecision(decision: DesktopPermissionDecision): string {
  const input = decision.updatedInput
  if (typeof input?.answer === 'string') return input.answer
  const answers = input?.answers
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    const values = Object.values(answers).filter(
      (value): value is string => typeof value === 'string',
    )
    if (values.length === 1) return values[0]!
    if (values.length > 1) return JSON.stringify(answers)
  }
  return decision.message ?? ''
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
  const permissionConfig = options.permissionConfig ?? desktopPermissionModeToPermissionConfig('default')
  const permissionMode = permissionModeFromDesktopConfig(permissionConfig)
  return {
    item: {
      id: sessionId,
      sessionName: options.sessionName ?? null,
      aiTitle: null,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone: !options.workspacePath,
      permissionMode,
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
      permissionConfig,
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

function permissionModeFromDesktopConfig(config: PermissionConfig): DesktopPermissionMode {
  if (config.sandboxMode === 'danger-full-access' && config.approvalPolicy === 'never') return 'full-access'
  if (config.sandboxMode === 'workspace-write' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'auto_review') return 'auto-review'
  if (config.sandboxMode === 'workspace-write' && config.approvalPolicy === 'on-request' && config.approvalsReviewer === 'user') return 'default'
  return 'custom'
}

function noop(): void {}

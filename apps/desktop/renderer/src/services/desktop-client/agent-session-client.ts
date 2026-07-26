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
  QueueStateResult,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import type {
  EventEnvelope,
  ProtocolCapability,
  RpcParams,
  RpcResult,
  ToolingStatus,
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
  DesktopFollowUpBehavior,
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
  GenerateDesktopTaskSuggestionsInput,
  DesktopInstalledSkill,
  DesktopInstalledSkillDetails,
  DesktopMcpServerListItem,
  DesktopPullRequestResult,
  DesktopProjectSource,
  DesktopProjectSourceReadResult,
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

export const WORKSPACE_FILE_CHANGED_EVENT =
  'codepilotx-workspace-file-changed'
export const WORKSPACE_GIT_CHANGED_EVENT =
  'codepilotx-workspace-git-changed'
export const CONFIG_UPDATED_EVENT = 'codepilotx-config-updated'

const RENDERER_PROTOCOL = 'thread-rpc-v4' as const
const RENDERER_CAPABILITIES = [
  'rpc.typed.v1',
  'events.replay.v1',
  'events.live.v1',
  'interactions.serverRequests.v1',
  'interaction.recovery.v1',
  'turn.admission.v1',
  'turn.steer.v1',
  'turn.queue.management.v1',
  'attachments.v1',
  'memory.v2',
  'pets.management.v1',
  'workspace.editor.v1',
  'git.review.v1',
  'ai.review.v1',
  'github.oauth.v1',
  'github.pullRequests.v1',
  'context.compact.v1',
  'hooks.trust.v1',
  'subagents.v1',
  'sandbox.management.v1',
  'prompt.preview.sensitive.v1',
  'model.catalog.paged.v1',
  'tooling.management.v1',
  'skills.manage.v1',
  'mcp.manage.v1',
  'mcp.oauth.v1',
  'config.manage.v1',
  'task-suggestions.v1',
] as const satisfies ReadonlyArray<ProtocolCapability>
type PendingInteraction =
  RpcResult<'interaction/listPending'>['interactions'][number]

type AgentManagedSkill = RpcResult<'skill/list'>['skills'][number]

function desktopInstalledSkill(skill: AgentManagedSkill): DesktopInstalledSkill {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope === 'workspace' ? 'repo' : 'user',
    source: skill.scope,
    format: skill.format,
    enabled: skill.enabled,
  }
}

function desktopMcpServer(
  item: RpcResult<'mcp/list'>['servers'][number],
): DesktopMcpServerListItem {
  const server = item.server
  const summary = server.transport.type === 'stdio'
    ? [server.transport.command, ...(server.transport.args ?? [])].join(' ')
    : server.transport.url
  return {
    name: server.name,
    scope: server.scope,
    type: server.transport.type,
    summary,
    enabled: server.enabled,
    diagnosticContext: server.diagnosticContext ?? false,
    effective: item.effective,
    ...(item.shadowedByScope
      ? { shadowedByScope: item.shadowedByScope }
      : {}),
    editable: true,
    removable: true,
    transport: server.transport,
    ...(server.startupTimeoutMs
      ? { startupTimeoutMs: server.startupTimeoutMs }
      : {}),
    ...(server.toolTimeoutMs
      ? { toolTimeoutMs: server.toolTimeoutMs }
      : {}),
    ...(server.required !== undefined ? { required: server.required } : {}),
    ...(server.enabledTools ? { enabledTools: [...server.enabledTools] } : {}),
    ...(server.disabledTools ? { disabledTools: [...server.disabledTools] } : {}),
    ...(server.defaultToolsApprovalMode
      ? { defaultToolsApprovalMode: server.defaultToolsApprovalMode }
      : {}),
    ...(server.tools ? { tools: { ...server.tools } } : {}),
  }
}
import {
  githubLoginFailure,
  mockThreadHistoryPage,
  permissionModeFromDesktopConfig,
} from './fixtures.js'
import { createBrowserMockDesktopClient } from './browser-mock-client.js'
import { catalogProviderToDesktop } from './provider-adapters.js'
import {
  desktopGitStatus,
  type ReviewAgentGitStatus,
} from './review-client.js'
import type {
  CodePilotXDesktopClient,
  DesktopAgentEventEnvelopeApi,
  DesktopAgentReviewApi,
  DesktopClientEnvironment,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentSummaryResult,
} from './types.js'


export function createAgentSessionDesktopClient(
  environment: DesktopClientEnvironment,
  mockClient: DesktopApi,
  allowBrowserMockFallback: boolean,
): CodePilotXDesktopClient {
  const fetcher = environment.fetch
  const clientInstanceId = crypto.randomUUID()
  const rpc = createAgentRpcClient({
    ...environment,
    handshake: {
      initialize: {
        clientInfo: {
          name: 'codepilotx-desktop-renderer',
          version: '0.2.0',
          platform:
            typeof navigator === 'undefined' ? 'desktop' : navigator.platform,
          instanceId: clientInstanceId,
        },
        protocols: [RENDERER_PROTOCOL],
        capabilities: [...RENDERER_CAPABILITIES],
        interactionDelivery: 'active',
      },
      initialized: {
        protocol: RENDERER_PROTOCOL,
        clientInstanceId,
      },
    },
  })
  let activeSessionId: string | null = null
  let agentReady = false
  let agentCapabilities = new Set<string>()
  let activeGithubLoginId: string | null = null
  let activeGithubLoginMode: DesktopGithubAuthMode = 'browser'
  let readyProbe: Promise<boolean> | null = null
  let readinessError: unknown = null
  let projectsByIdCache: Map<string, Project> | null = null
  let modelCatalogCache: RpcResult<'model/list'> | null = null
  let providerCatalogCache: RpcResult<'provider/list'> | null = null
  let providerCatalogRequest: Promise<RpcResult<'provider/list'>> | null = null
  const providerModelCache = new Map<string, CatalogProvider['models']>()
  const providerModelRequests = new Map<string, Promise<RpcResult<'model/list'>>>()
  let integrationsCache: IntegrationListResponse['integrations'] | null = null
  const sessionSnapshots = new Map<string, DesktopSessionSnapshot>()
  const sessionPermissionConfigs = new Map<string, PermissionConfig>()
  const sessionStoreListeners = new Set<(change: DesktopSessionStoreChange) => void>()
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingSettingsUpdates = new Map<string, Promise<void>>()
  let sessionStoreReconcile: Promise<void> | null = null

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
      const initialized = await rpc.ensureInitialized()
      agentCapabilities = new Set(initialized.capabilities)
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

  async function withRequiredAgent<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!(await isAgentAvailable())) {
      throw readinessError instanceof Error
        ? readinessError
        : new Error('Agent RPC 当前不可用。')
    }
    return operation()
  }

  function unsupportedAgentOperation(operation: string): never {
    const error = new Error(
      `AGENT_OPERATION_UNSUPPORTED: 真实 Agent 会话暂不支持 ${operation}。`,
    ) as Error & { code: string }
    error.code = 'AGENT_OPERATION_UNSUPPORTED'
    throw error
  }

  function requireAgentCapability(
    name:
      | 'prompt'
      | 'memory'
      | 'compact'
      | 'hookTrust'
      | 'git.review.v1'
      | 'ai.review.v1'
      | 'github.oauth.v1'
      | 'github.pullRequests.v1'
      | 'tooling.management.v1'
      | 'pets.management.v1'
      | 'skills.manage.v1'
      | 'mcp.manage.v1'
      | 'mcp.oauth.v1'
      | 'config.manage.v1'
      | 'task-suggestions.v1',
    version = 1,
  ): void {
    const capabilities: Record<typeof name, string> = {
      prompt: 'prompt.preview.sensitive.v1',
      memory: 'memory.v2',
      compact: 'context.compact.v1',
      hookTrust: 'hooks.trust.v1',
      'git.review.v1': 'git.review.v1',
      'ai.review.v1': 'ai.review.v1',
      'github.oauth.v1': 'github.oauth.v1',
      'github.pullRequests.v1': 'github.pullRequests.v1',
      'tooling.management.v1': 'tooling.management.v1',
      'pets.management.v1': 'pets.management.v1',
      'skills.manage.v1': 'skills.manage.v1',
      'mcp.manage.v1': 'mcp.manage.v1',
      'mcp.oauth.v1': 'mcp.oauth.v1',
      'config.manage.v1': 'config.manage.v1',
      'task-suggestions.v1': 'task-suggestions.v1',
    }
    if (version <= 1 && agentCapabilities.has(capabilities[name])) return
    if (version === 2 && (name === 'prompt' || name === 'memory')) {
      if (agentCapabilities.has(capabilities[name])) return
    }
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

  function invalidateModelCatalog(): void {
    modelCatalogCache = null
    providerCatalogCache = null
    providerCatalogRequest = null
    providerModelCache.clear()
    providerModelRequests.clear()
  }

  async function loadModelCatalog(refresh = false): Promise<RpcResult<'model/list'>> {
    if (modelCatalogCache && !refresh) return modelCatalogCache
    const result = refresh
      ? await rpc.call('model/refresh', {
          operationId: crypto.randomUUID(),
        })
      : await rpc.call('model/list', {})
    modelCatalogCache = {
      providers: [...result.providers],
      defaultModel: result.defaultModel,
      reviewerModel: result.reviewerModel,
      catalogVersion: result.catalogVersion,
    }
    return modelCatalogCache
  }

  async function loadProviderCatalog(
    refresh = false,
  ): Promise<RpcResult<'provider/list'>> {
    await isAgentAvailable()
    if (providerCatalogCache && !refresh) return providerCatalogCache
    if (providerCatalogRequest && !refresh) return providerCatalogRequest
    if (agentCapabilities.has('model.catalog.paged.v1')) {
      const pending = rpc.call('provider/list', {}).then(result => {
        providerCatalogCache = result
        return result
      }).finally(() => {
        if (providerCatalogRequest === pending) providerCatalogRequest = null
      })
      providerCatalogRequest = pending
      return pending
    }
    const legacy = await loadModelCatalog(refresh)
    providerCatalogCache = {
      providers: legacy.providers.map(item => item.provider),
      defaultModel: legacy.defaultModel,
      reviewerModel: legacy.reviewerModel,
      catalogVersion: legacy.catalogVersion,
    }
    for (const item of legacy.providers) {
      providerModelCache.set(item.provider.id, [...item.models])
    }
    return providerCatalogCache
  }

  async function loadProviderModelPage(options: {
    providerID: ModelProviderID
    query?: string
    cursor?: string
    limit?: number
  }): Promise<RpcResult<'model/list'>> {
    if (!agentCapabilities.has('model.catalog.paged.v1')) {
      const legacy = await loadModelCatalog()
      const provider = legacy.providers.find(
        item => item.provider.id === options.providerID,
      )
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      providerModelCache.set(provider.provider.id, [...provider.models])
      return {
        ...legacy,
        providers: [provider],
        total: provider.models.length,
      }
    }

    const directory = await loadProviderCatalog()
    const providerID = directory.providers.find(
      provider => provider.id === options.providerID,
    )?.id
    if (!providerID) throw new Error(`未找到模型提供商：${options.providerID}`)
    const requestKey = JSON.stringify({
      version: directory.catalogVersion,
      providerID,
      query: options.query?.trim().toLowerCase() ?? '',
      cursor: options.cursor ?? '',
      limit: options.limit ?? 100,
    })
    let pending = providerModelRequests.get(requestKey)
    if (!pending) {
      pending = rpc.call('model/list', {
        providerId: providerID,
        enabled: true,
        limit: Math.max(1, Math.min(100, options.limit ?? 100)),
        ...(options.query?.trim() ? { query: options.query.trim() } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
      }).catch(error => {
        providerModelRequests.delete(requestKey)
        throw error
      })
      providerModelRequests.set(requestKey, pending)
    }
    const result = await pending
    if (result.catalogVersion !== directory.catalogVersion) {
      invalidateModelCatalog()
      if (options.cursor) throw new Error('模型目录已更新，请重新查询。')
      return loadProviderModelPage(options)
    }
    const page = result.providers.find(
      item => item.provider.id === options.providerID,
    )?.models ?? []
    const previous = providerModelCache.get(options.providerID) ?? []
    const merged = new Map(previous.map(model => [model.id, model]))
    for (const model of page) merged.set(model.id, model)
    providerModelCache.set(options.providerID, [...merged.values()])
    return result
  }

  async function loadIntegrations(
    refresh = false,
  ): Promise<IntegrationListResponse['integrations']> {
    if (integrationsCache && !refresh) return integrationsCache
    const response = await rpc.call('integration/list', {})
    integrationsCache = response.integrations
    return integrationsCache
  }

  async function providerState(
    preferredProviderID?: ModelProviderID,
  ): Promise<DesktopModelProviderState> {
    const [directory, integrations, desktopSettings] = await Promise.all([
      loadProviderCatalog(),
      loadIntegrations(),
      mockClient.getDesktopSettings(),
    ])
    const selectedProviderID =
      preferredProviderID ??
      directory.defaultModel?.providerID ??
      desktopSettings.providerID ??
      directory.providers[0]?.id
    const provider =
      directory.providers.find(item => item.id === selectedProviderID) ??
      directory.providers[0]
    if (!provider) throw new Error('Agent 未返回可用模型提供商。')
    const firstPage = await loadProviderModelPage({
      providerID: provider.id,
      limit: 100,
    })
    let models = firstPage.providers.find(
      item => item.provider.id === provider.id,
    )?.models ?? []
    const selectedModel =
      directory.defaultModel?.providerID === provider.id
        ? directory.defaultModel
        : null
    if (selectedModel && !models.some(item => item.id === selectedModel.id)) {
      const selectedPage = await loadProviderModelPage({
        providerID: provider.id,
        query: selectedModel.id,
        limit: 100,
      })
      const exact = selectedPage.providers
        .find(item => item.provider.id === provider.id)
        ?.models.find(item => item.id === selectedModel.id)
      if (exact) models = [...models, exact]
    }
    const catalogProvider: CatalogProvider = { provider, models }
    const integration = integrations.find(
      item => item.id === provider.integrationID,
    )
    const summary = catalogProviderToDesktop(catalogProvider, integration)
    const model =
      selectedModel?.id ??
      models.find(item => item.enabled)?.id ??
      models[0]?.id ??
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
    const [directory, integrations] = await Promise.all([
      loadProviderCatalog(),
      loadIntegrations(refreshIntegrations),
    ])
    const provider = directory.providers.find(item => item.id === providerID)
    if (!provider) throw new Error(`未找到模型提供商：${providerID}`)
    const integrationID = provider.integrationID
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
    const response = await rpc.call<{ projects: Project[] }>('project/list', {})
    projectsByIdCache = new Map(response.projects.map(project => [project.id, project]))
    return projectsByIdCache
  }

  async function loadProjectForPath(rootPath: string): Promise<Project> {
    const listed = await rpc.call<{ projects: Project[] }>(
      'project/list',
      { folderPath: rootPath },
    )
    if (listed.projects.length > 1) {
      throw new Error('该目录属于多个项目，请先选择具体项目。')
    }
    const existing = listed.projects[0]
    const response = existing
      ? await rpc.call<{ project: Project }>('project/open', {
          projectId: existing.id,
          operationId: crypto.randomUUID(),
        })
      : await rpc.call<{ project: Project }>('project/create', {
          primaryPath: rootPath,
          operationId: crypto.randomUUID(),
        })
    projectsByIdCache = null
    return response.project
  }

  async function chooseProjectForPath(rootPath: string): Promise<Project | null> {
    const listed = await rpc.call<{ projects: Project[] }>(
      'project/list',
      { folderPath: rootPath },
    )
    if (listed.projects.length === 0) {
      return (await rpc.call<{ project: Project }>('project/create', {
        primaryPath: rootPath,
        operationId: crypto.randomUUID(),
      })).project
    }

    const choices = listed.projects
      .map((project, index) => `${index + 1}. ${project.name}`)
      .join('\n')
    const selection = typeof window === 'undefined'
      ? '1'
      : window.prompt(
          `该目录已属于以下项目：\n${choices}\n\n输入序号打开项目，输入 0 仍然创建新项目；取消则不打开。`,
          '1',
        )
    if (selection === null) return null
    if (selection.trim() === '0') {
      return (await rpc.call<{ project: Project }>('project/create', {
        primaryPath: rootPath,
        operationId: crypto.randomUUID(),
      })).project
    }
    const selectedIndex = Number(selection) - 1
    const selected = listed.projects[selectedIndex]
    if (!selected) throw new Error('项目选择无效。')
    return (await rpc.call<{ project: Project }>('project/open', {
      projectId: selected.id,
      operationId: crypto.randomUUID(),
    })).project
  }

  async function loadProjectById(projectId: string): Promise<Project> {
    const cached = (await loadProjectsById()).get(projectId)
    if (cached) return cached
    const response = await rpc.call<{ project: Project }>('project/open', {
      projectId,
      operationId: crypto.randomUUID(),
    })
    projectsByIdCache = new Map([[response.project.id, response.project]])
    return response.project
  }

  function projectFolderId(
    project: Project,
    requested?: string,
    workspacePath?: string,
  ): string {
    if (requested) return requested
    if (workspacePath) {
      const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase()
      const matching = project.folders.find(folder =>
        folder.path.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase() === normalized
      )
      if (matching) return matching.id
    }
    return project.primaryFolderId
  }

  async function listAgentSessions(
    options?: { archived?: boolean },
  ): Promise<DesktopSessionSnapshot[]> {
    const archived = options?.archived === true
    const [projectsById, response] = await Promise.all([
      loadProjectsById(),
      rpc.call('thread/list', {
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
    const { snapshot: sharedSnapshot } = await rpc.call('thread/read', {
      threadId: sessionId,
    })
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

  async function refreshAgentSessionStoreChange(
    options: { reloadActive?: boolean } = {},
  ): Promise<void> {
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
    if (options.reloadActive && activeSessionId) {
      await loadAgentSessionSnapshot(activeSessionId)
    }
    emitSessionStoreChange()
  }

  function reconcileAgentSessionStore(): Promise<void> {
    if (sessionStoreReconcile) return sessionStoreReconcile
    integrationsCache = null
    invalidateModelCatalog()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    }
    sessionStoreReconcile = refreshAgentSessionStoreChange({ reloadActive: true })
      .finally(() => {
        sessionStoreReconcile = null
      })
    return sessionStoreReconcile
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
      const response = await rpc.call('thread/settings/update', {
        threadId: sessionId,
        settings,
        operationId: crypto.randomUUID(),
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
    const content = desktopUserMessageInputToPreviewText(input)
    const inputId = crypto.randomUUID()
    let response: unknown
    if (strategy === 'guide') {
      const { snapshot: current } = await rpc.call('thread/read', {
        threadId: sessionId,
      })
      const activeTurn = [...current.turns].reverse().find(turn =>
        turn.status === 'running' || turn.status.startsWith('waiting-'),
      )
      response = activeTurn
        ? await rpc.call('turn/steer', {
            threadId: sessionId,
            turnId: activeTurn.id,
            inputId,
            content,
            ...(attachmentIds.length ? { attachmentIds } : {}),
          })
        : await rpc.call('turn/start', {
            threadId: sessionId,
            inputId,
            content,
            model: await resolveAgentModelRef(model, sessionId),
            permissionConfig: permissionConfigForSession(sessionId),
            taskMode: taskModeForSession(sessionId),
            ...(attachmentIds.length ? { attachmentIds } : {}),
          })
    } else {
      response = await rpc.call('turn/start', {
        threadId: sessionId,
        inputId,
        content,
        model: await resolveAgentModelRef(model, sessionId),
        permissionConfig: permissionConfigForSession(sessionId),
        taskMode: taskModeForSession(sessionId),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      })
    }
    await loadAgentSessionSnapshot(sessionId).catch(() => null)
    emitSessionStoreChange()
    return response
  }

  async function callQueueMutation(
    sessionId: string,
    method: 'queue/update' | 'queue/remove' | 'queue/reorder' | 'queue/steer' | 'queue/resume',
    params: Record<string, unknown>,
  ): Promise<QueueStateResult> {
    const expectedVersion = sessionSnapshots.get(sessionId)?.queueVersion
    try {
      return await rpc.call<QueueStateResult>(method, {
        threadId: sessionId,
        ...params,
        operationId: crypto.randomUUID(),
        ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}),
      })
    } catch (error) {
      await loadAgentSessionSnapshot(sessionId).catch(() => null)
      emitSessionStoreChange()
      throw error
    }
  }

  async function importAgentAttachments(input: DesktopUserMessageInput) {
    const source = input.attachments ?? []
    if (!source.length) return []
    const payload = source.map(attachment => {
      if (attachment.status !== 'ready') throw new Error(`附件 ${attachment.name} 尚未准备完成。`)
      if (attachment.kind === 'image') {
        const data = attachment.contentBase64 ?? attachment.previewDataUrl?.replace(/^data:[^;]+;base64,/, '')
        if (!data) throw new Error(`图片附件 ${attachment.name} 缺少内容。`)
        return { kind: 'image' as const, name: attachment.name, mediaType: attachment.mediaType, data, encoding: 'base64' as const }
      }
      if (typeof attachment.textContent !== 'string' || attachment.truncated) throw new Error(`附件 ${attachment.name} 不是完整的 UTF-8 文本或受支持图片。`)
      return { kind: 'text' as const, name: attachment.name, mediaType: attachment.mediaType || 'text/plain', data: attachment.textContent, encoding: 'utf8' as const }
    })
    const response = await rpc.call('attachment/import', {
      uploads: payload,
      operationId: crypto.randomUUID(),
    })
    return response.attachments.map(attachment => attachment.id)
  }

  async function findPendingInteraction(
    predicate: (interaction: PendingInteraction) => boolean,
    threadId?: string,
  ): Promise<PendingInteraction> {
    const result = await rpc.call('interaction/listPending', {
      ...(threadId ? { threadId } : {}),
      limit: 500,
    })
    const interaction = result.interactions.find(predicate)
    if (!interaction) {
      throw new Error('该交互请求已失效或已由其他客户端处理，请刷新任务后重试。')
    }
    return interaction
  }

  async function respondToInteraction(
    interaction: PendingInteraction,
    response: RpcResult<'interaction/respond'>['response'],
  ): Promise<void> {
    await rpc.call('interaction/respond', {
      interactionId: interaction.interactionId,
      expectedVersion: interaction.version,
      response,
      operationId: crypto.randomUUID(),
    })
  }

  async function respondToQuestionInteraction(
    interaction: Extract<PendingInteraction, { kind: 'question' }>,
    answer: string | null,
    ignored: boolean,
  ): Promise<void> {
    if (ignored) {
      await respondToInteraction(interaction, {
        kind: 'question',
        status: 'ignored',
      })
      return
    }
    const rawAnswers = parseQuestionAnswerMap(answer)
    const answers = interaction.questions.map((question, index) => {
      const value =
        rawAnswers[question.id] ??
        (interaction.questions.length === 1 && index === 0 ? answer : null) ??
        ''
      const choice = question.choices.find(
        candidate =>
          candidate.id === value ||
          candidate.label === value ||
          candidate.label.replace(/\s+\(Recommended\)$/u, '') === value,
      )
      return {
        questionId: question.id,
        choiceIds: choice ? [choice.id] : [],
        ...(!choice && value ? { text: value } : {}),
      }
    })
    await respondToInteraction(interaction, {
      kind: 'question',
      status: 'answered',
      answers,
    })
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

  const operationError = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

  const isToolingStatus = (value: unknown): value is ToolingStatus => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const status = value as Partial<ToolingStatus>
    return (
      (status.id === 'nodejs' ||
        status.id === 'python' ||
        status.id === 'git-bash' ||
        status.id === 'ripgrep') &&
      (status.preference === 'managed' || status.preference === 'system') &&
      typeof status.pinnedVersion === 'string'
    )
  }

  const client: CodePilotXDesktopClient = {
    ...mockClient,
    getDataLocation: () =>
      environment.window?.codePilotXDesktop?.getDataLocation
        ? environment.window.codePilotXDesktop.getDataLocation()
        : mockClient.getDataLocation(),
    chooseDataLocation: async () =>
      environment.window?.codePilotXDesktop?.chooseDataLocation
        ? environment.window.codePilotXDesktop.chooseDataLocation(
            [...(await loadProjectsById()).values()]
              .map(
                project =>
                  project.folders.find(
                    folder => folder.id === project.primaryFolderId,
                  )?.path,
              )
              .filter((path): path is string => typeof path === 'string'),
          )
        : mockClient.chooseDataLocation(),
    listTooling: async () =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (await rpc.call('tooling/list', {})).statuses
      }),
    refreshTooling: async () =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (await rpc.call('tooling/refresh', {})).statuses
      }),
    setToolingPreference: async (id, preference) =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (
          await rpc.call('tooling/setPreference', {
            id,
            preference,
            operationId: crypto.randomUUID(),
          })
        ).status
      }),
    installTooling: async (id, force = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('tooling.management.v1')
        return (
          await rpc.call('tooling/install', {
            id,
            force,
            operationId: crypto.randomUUID(),
          })
        ).status
      }),
    listRuntimeSkills: (workspacePath, options) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/list', {
            ...(workspacePath ? { workspace: workspacePath } : {}),
            ...(options?.forceReload === undefined
              ? {}
              : { forceReload: options.forceReload }),
          })
          return {
            state: 'ready' as const,
            data: result.skills.map(desktopInstalledSkill),
            updatedAt: new Date(result.updatedAt).toISOString(),
          }
        },
        () => mockClient.listRuntimeSkills(workspacePath, options),
      ),
    readRuntimeSkill: (path, workspacePath) =>
      withAgentOrMock(
        async (): Promise<DesktopInstalledSkillDetails> => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/read', {
            path,
            ...(workspacePath ? { workspace: workspacePath } : {}),
          })
          return {
            ...desktopInstalledSkill(result.skill),
            content: result.content,
          }
        },
        () => mockClient.readRuntimeSkill(path, workspacePath),
      ),
    setRuntimeSkillEnabled: (path, enabled) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('skills.manage.v1')
          const result = await rpc.call('skill/setEnabled', {
            path,
            enabled,
            operationId: crypto.randomUUID(),
          })
          return desktopInstalledSkill(result.skill)
        },
        () => mockClient.setRuntimeSkillEnabled(path, enabled),
      ),
    onRuntimeSkillsUpdated: callback =>
      rpc.subscribeEnvelope({}, event => {
        if (event.type !== 'skill/updated') return
        callback(event.payload.generation)
      }),
    onToolingUpdated: callback =>
      rpc.subscribeEnvelope({}, event => {
        if (event.type !== 'tooling/updated') return
        const payload = event.payload
        if (!payload || typeof payload !== 'object') return
        const status = (payload as { status?: unknown }).status
        if (isToolingStatus(status)) callback(status)
      }),
    listPets: () =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (await rpc.call('pet/list', {})).pets
      }),
    listPetCatalog: (refresh = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return rpc.call('pet/catalog/list', { refresh })
      }),
    installCatalogPet: (slug, acceptedRestrictedLicense = false) =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (
          await rpc.call('pet/catalog/install', {
            slug,
            acceptedRestrictedLicense,
            operationId: crypto.randomUUID(),
          })
        ).pet
      }),
    previewPetInstall: url =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return rpc.call('pet/install/preview', { url })
      }),
    installPet: url =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        return (
          await rpc.call('pet/install', {
            url,
            operationId: crypto.randomUUID(),
          })
        ).pet
      }),
    removePet: id =>
      withRequiredAgent(async () => {
        requireAgentCapability('pets.management.v1')
        await rpc.call('pet/remove', {
          id,
          operationId: crypto.randomUUID(),
        })
      }),
    getGithubAuthStatus: async (): Promise<DesktopGithubAuthStatus> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          return rpc.call<DesktopGithubAuthStatus>('github/auth/status')
        })
      } catch (error) {
        return {
          configured: false,
          authenticated: false,
          user: null,
          error: operationError(error),
        }
      }
    },
    startGithubLogin: async input => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const status = await rpc.call('github/auth/start', {
            mode: input.mode,
          })
          activeGithubLoginId = status.loginId
          activeGithubLoginMode = status.mode
          return status
        })
      } catch (error) {
        return githubLoginFailure(
          operationError(error),
          activeGithubLoginId,
          input.mode,
        )
      }
    },
    pollGithubLogin: async () => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          if (!activeGithubLoginId) {
            throw new Error('当前没有可轮询的 GitHub 登录请求，请重新开始登录。')
          }
          const status = await rpc.call('github/auth/poll', {
            loginId: activeGithubLoginId,
          })
          if (status.state === 'completed' || status.state === 'failed') {
            activeGithubLoginId = null
          }
          return status
        })
      } catch (error) {
        return githubLoginFailure(
          operationError(error),
          activeGithubLoginId,
          activeGithubLoginMode,
        )
      }
    },
    logoutGithub: async (): Promise<DesktopGithubAuthStatus> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const status = await rpc.call<DesktopGithubAuthStatus>('github/auth/logout')
          activeGithubLoginId = null
          return status
        })
      } catch (error) {
        return {
          configured: false,
          authenticated: false,
          user: null,
          error: operationError(error),
        }
      }
    },
    listGithubRepositories: async (): Promise<DesktopGithubRepositoryListResult> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const result = await rpc.call<{
            repositories: Extract<DesktopGithubRepositoryListResult, { ok: true }>['repositories']
          }>('github/repositories')
          return { ok: true, repositories: result.repositories }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    getGithubProfileOverview: async (): Promise<DesktopGithubProfileOverviewResult> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          const result = await rpc.call<{
            overview: Extract<DesktopGithubProfileOverviewResult, { ok: true }>['overview']
          }>('github/profileOverview')
          return { ok: true, overview: result.overview }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    setGithubUserStatus: async () => ({
      ok: false,
      error: 'GitHub 用户状态编辑尚未接入 Agent。',
    }),
    clearGithubUserStatus: async () => ({
      ok: false,
      error: 'GitHub 用户状态编辑尚未接入 Agent。',
    }),
    pushWorkspaceBranch: async input => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopGitOperationResult> => {
          requireAgentCapability('github.pullRequests.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            repositoryUrl: string
            status: Extract<DesktopGitOperationResult, { ok: true }>['status']
          }>('github/push', {
            projectId: project.id,
            setUpstream: input.setUpstream === true,
            forceWithLease: input.forceWithLease === true,
          })
          return {
            ok: true,
            status: result.status,
            output: `已推送到 ${result.repositoryUrl}`,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    createPullRequest: async input => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopPullRequestResult> => {
          requireAgentCapability('github.pullRequests.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            pullRequest: { htmlUrl: string; number: number }
          }>('github/pullRequest/createForProject', {
            projectId: project.id,
            title: input.title,
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(input.draft === undefined ? {} : { draft: input.draft }),
          })
          return {
            ok: true,
            url: result.pullRequest.htmlUrl,
            output: `已创建 Pull Request #${result.pullRequest.number}`,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    getWorkspaceGitStatus: async workspacePath => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(workspacePath)
          const result = await rpc.call<{
            status: ReviewAgentGitStatus
          }>('review/status', { projectId: project.id })
          return { ok: true as const, status: desktopGitStatus(result.status) }
        })
      } catch (error) {
        return { ok: false as const, error: operationError(error) }
      }
    },
    commitWorkspaceChanges: async input => {
      try {
        return await withRequiredAgent(async (): Promise<DesktopGitOperationResult> => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            output: string
            status: ReviewAgentGitStatus
          }>('review/commit', {
            projectId: project.id,
            message: input.message,
            paths: input.paths,
          })
          return {
            ok: true,
            status: desktopGitStatus(result.status),
            output: result.output,
          }
        })
      } catch (error) {
        return { ok: false, error: operationError(error) }
      }
    },
    getAgentReviewSummary: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          return rpc.call<DesktopReviewAgentSummaryResult>(
            input.refresh ? 'review/refresh' : 'review/summary',
            { projectId: project.id, source: input.source },
          )
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    getAgentReviewFileDiff: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          return rpc.call<DesktopReviewAgentFileDiff>('review/fileDiff', {
            projectId: project.id,
            source: input.source,
            generation: input.generation,
            path: input.path,
            hideWhitespace: input.hideWhitespace,
          })
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    applyAgentReviewOperation: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          await rpc.call('review/apply', {
            projectId: project.id,
            source: input.source,
            generation: input.generation,
            expectedRevision: input.expectedRevision,
            action: input.action,
            target: input.target,
            atomic: true,
          })
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    getAgentReviewBranches: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(workspacePath)
          const result = await rpc.call<{
            branches: Array<{
              name: string
              sha: string
              current: boolean
              remote: boolean
            }>
          }>('review/branches', { projectId: project.id })
          return result.branches
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    getAgentReviewCommits: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(workspacePath)
          const result = await rpc.call<{
            commits: Array<{
              sha: string
              shortSha: string
              subject: string
              author: string
              authoredAt: string
            }>
          }>('review/commits', { projectId: project.id, limit: 20 })
          return result.commits
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    listAgentReviewComments: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            comments: DesktopReviewAgentComment[]
          }>('review/comment/list', {
            projectId: project.id,
            threadId: input.threadId,
            sourceKey: input.sourceKey,
          })
          return result.comments
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    saveAgentReviewComment: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            comment: DesktopReviewAgentComment
          }>('review/comment/save', {
            ...(input.id ? { id: input.id } : {}),
            projectId: project.id,
            threadId: input.threadId,
            sourceKey: input.sourceKey,
            path: input.path,
            side: input.side,
            line: input.line,
            hunkId: input.hunkId,
            revision: input.revision,
            body: input.body,
            ...(input.githubCommentId
              ? { githubCommentId: input.githubCommentId }
              : {}),
            ...(input.githubThreadId
              ? { githubThreadId: input.githubThreadId }
              : {}),
          })
          return result.comment
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    resolveAgentReviewComment: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<{
            comment: DesktopReviewAgentComment
          }>('review/comment/resolve', {
            projectId: project.id,
            threadId: input.threadId,
            id: input.id,
          })
          return result.comment
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    deleteAgentReviewComment: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('git.review.v1')
          const project = await loadProjectForPath(input.workspacePath)
          await rpc.call('review/comment/delete', {
            projectId: project.id,
            threadId: input.threadId,
            id: input.id,
          })
        },
        async () => unsupportedAgentOperation('git.review.v1'),
      ),
    publishAgentGithubReviewComment: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('github.pullRequests.v1')
          const result = await rpc.call<{
            comment: {
              id: number
              nodeId: string
              htmlUrl: string
              body: string
            }
          }>('github/pullRequest/comment', {
            owner: input.source.owner,
            repository: input.source.repository,
            number: input.source.number,
            body: input.body,
            path: input.path,
            side: input.side,
            line: input.line,
            expectedHeadRevision: input.expectedHeadRevision,
            ...(input.commitId ? { commitId: input.commitId } : {}),
          })
          return result.comment
        },
        async () => unsupportedAgentOperation('github.pullRequests.v1'),
      ),
    submitAgentGithubReview: input =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('github.pullRequests.v1')
          const result = await rpc.call<{
            review: { id: number; state: string; htmlUrl: string }
          }>('github/pullRequest/submitReview', {
            owner: input.source.owner,
            repository: input.source.repository,
            number: input.source.number,
            event: input.event,
            expectedHeadRevision: input.expectedHeadRevision,
            ...(input.body ? { body: input.body } : {}),
          })
          return result.review
        },
        async () => unsupportedAgentOperation('github.pullRequests.v1'),
      ),
    listExternalOpenTargets: async targetPath => {
      const listTargets =
        environment.window?.codePilotXDesktop?.listExternalOpenTargets
      if (!listTargets) return mockClient.listExternalOpenTargets(targetPath)
      const [targets, settings] = await Promise.all([
        listTargets(targetPath),
        client.getDesktopSettings(),
      ])
      const preferredId = targets.some(
        target => target.targetId === settings.defaultOpenTargetId,
      )
        ? settings.defaultOpenTargetId
        : 'default-app'
      return targets.map(target => ({
        id: target.targetId,
        label: target.label,
        kind: target.kind,
        ...(target.iconDataUrl ? { iconDataUrl: target.iconDataUrl } : {}),
        preferred: target.targetId === preferredId,
      }))
    },
    listOpenTargets: async () => {
      const settings = await client.getDesktopSettings()
      const targetPath =
        settings.lastActiveWorkspacePath ||
        settings.recentWorkspaces[0]?.path
      if (!targetPath) return mockClient.listOpenTargets()
      const targets = await client.listExternalOpenTargets(targetPath)
      return targets.map(target => ({
        id: target.id,
        label: target.label,
        kind: target.kind,
        ...(target.iconDataUrl ? { iconDataUrl: target.iconDataUrl } : {}),
      }))
    },
    openPathWithTarget: async (targetPath, targetId) => {
      const openPath =
        environment.window?.codePilotXDesktop?.openPathWithTarget
      if (openPath) await openPath(targetPath, targetId)
      else await mockClient.openPathWithTarget(targetPath, targetId)
      const settings = await client.getDesktopSettings()
      if (settings.defaultOpenTargetId !== targetId) {
        await client.saveDesktopSettings({
          ...settings,
          defaultOpenTargetId: targetId,
        })
      }
    },
    openPathWithDefaultTarget: async targetPath => {
      const openPath =
        environment.window?.codePilotXDesktop?.openPathWithTarget
      if (!openPath) return mockClient.openPathWithDefaultTarget(targetPath)
      const settings = await client.getDesktopSettings()
      const targets = await client.listExternalOpenTargets(targetPath)
      const targetId = targets.some(
        target => target.id === settings.defaultOpenTargetId,
      )
        ? settings.defaultOpenTargetId
        : 'default-app'
      return openPath(targetPath, targetId)
    },
    revealPathInFolder: async targetPath => {
      const revealPath =
        environment.window?.codePilotXDesktop?.revealPathInFolder
      if (revealPath) return revealPath(targetPath)
      return mockClient.revealPathInFolder(targetPath)
    },
    listMcpServers: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          const result = await rpc.call<RpcResult<'mcp/list'>>(
            'mcp/list',
            workspacePath ? { workspace: workspacePath } : {},
          )
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.listMcpServers(workspacePath),
      ),
    getMcpRuntimeStatus: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          return rpc.call<RpcResult<'mcp/status'>>(
            'mcp/status',
            workspacePath ? { workspace: workspacePath } : {},
          )
        },
        () => mockClient.getMcpRuntimeStatus(workspacePath),
      ),
    saveMcpServer: options =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          const result = await rpc.call<RpcResult<'mcp/save'>>(
            'mcp/save',
            {
              operationId: crypto.randomUUID(),
              server: {
                name: options.name,
                scope: options.scope,
                enabled: options.enabled,
                ...(options.diagnosticContext
                  ? { diagnosticContext: true }
                  : {}),
                transport: options.transport,
                ...(options.startupTimeoutMs
                  ? { startupTimeoutMs: options.startupTimeoutMs }
                  : {}),
                ...(options.toolTimeoutMs
                  ? { toolTimeoutMs: options.toolTimeoutMs }
                  : {}),
                ...(options.required !== undefined
                  ? { required: options.required }
                  : {}),
                ...(options.enabledTools?.length
                  ? { enabledTools: options.enabledTools }
                  : {}),
                ...(options.disabledTools?.length
                  ? { disabledTools: options.disabledTools }
                  : {}),
                ...(options.defaultToolsApprovalMode
                  ? { defaultToolsApprovalMode: options.defaultToolsApprovalMode }
                  : {}),
                ...(options.tools && Object.keys(options.tools).length
                  ? { tools: options.tools }
                  : {}),
              },
              ...(options.originalName
                ? { originalName: options.originalName }
                : {}),
              ...(options.workspacePath
                ? { workspace: options.workspacePath }
                : {}),
            },
          )
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.saveMcpServer(options),
      ),
    removeMcpServer: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          const result = await rpc.call<RpcResult<'mcp/remove'>>(
            'mcp/remove',
            {
              name,
              scope,
              operationId: crypto.randomUUID(),
              ...(workspacePath ? { workspace: workspacePath } : {}),
            },
          )
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.removeMcpServer(name, scope, workspacePath),
      ),
    setMcpServerEnabled: (name, scope, enabled, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          const result = await rpc.call<RpcResult<'mcp/setEnabled'>>(
            'mcp/setEnabled',
            {
              name,
              scope,
              enabled,
              operationId: crypto.randomUUID(),
              ...(workspacePath ? { workspace: workspacePath } : {}),
            },
          )
          return result.servers.map(desktopMcpServer)
        },
        () => mockClient.setMcpServerEnabled(name, scope, enabled, workspacePath),
      ),
    reloadMcpConfiguration: workspacePath =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.manage.v1')
          return rpc.call<RpcResult<'mcp/reload'>>(
            'mcp/reload',
            {
              operationId: crypto.randomUUID(),
              ...(workspacePath ? { workspace: workspacePath } : {}),
            },
          )
        },
        () => mockClient.reloadMcpConfiguration(workspacePath),
      ),
    startMcpOAuth: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.oauth.v1')
          return rpc.call<RpcResult<'mcp/oauth/start'>>(
            'mcp/oauth/start',
            {
              name,
              scope,
              operationId: crypto.randomUUID(),
              ...(workspacePath ? { workspace: workspacePath } : {}),
            },
          )
        },
        () => mockClient.startMcpOAuth(name, scope, workspacePath),
      ),
    getMcpOAuthStatus: attemptId =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.oauth.v1')
          return rpc.call<RpcResult<'mcp/oauth/status'>>(
            'mcp/oauth/status',
            { attemptId },
          )
        },
        () => mockClient.getMcpOAuthStatus(attemptId),
      ),
    logoutMcpOAuth: (name, scope, workspacePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('mcp.oauth.v1')
          return rpc.call<RpcResult<'mcp/oauth/logout'>>(
            'mcp/oauth/logout',
            {
              name,
              scope,
              operationId: crypto.randomUUID(),
              ...(workspacePath ? { workspace: workspacePath } : {}),
            },
          )
        },
        () => mockClient.logoutMcpOAuth(name, scope, workspacePath),
      ),
    restoreSessionTurnChanges: input =>
      withUnsupportedAgentFallback(
        'restoreSessionTurnChanges',
        () => mockClient.restoreSessionTurnChanges(input),
      ),
    listProjects: folderPath =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ projects: Project[] }>('project/list', {
            ...(folderPath ? { folderPath } : {}),
            limit: 100,
          })
          return result.projects.map(project =>
            projectToDesktopWorkspace(project, project.id),
          )
        },
        () => mockClient.listProjects(folderPath),
      ),
    updateProject: input =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/update', {
            ...input,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, input.projectId)
        },
        () => mockClient.updateProject(input),
      ),
    removeProject: projectId =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ archivedThreadCount: number }>(
            'project/remove',
            {
              projectId,
              operationId: crypto.randomUUID(),
            },
          )
          projectsByIdCache = null
          return result
        },
        () => mockClient.removeProject(projectId),
      ),
    addProjectFolder: (projectId, path) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/add', {
            projectId,
            path,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.addProjectFolder(projectId, path),
      ),
    removeProjectFolder: (projectId, folderId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/remove', {
            projectId,
            folderId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.removeProjectFolder(projectId, folderId),
      ),
    setPrimaryProjectFolder: (projectId, folderId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/set-primary', {
            projectId,
            folderId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.setPrimaryProjectFolder(projectId, folderId),
      ),
    updateProjectSettings: input =>
      withAgentOrMock(
        async () => {
          const { projectId, expectedVersion, ...settings } = input
          await rpc.call('project/settings/update', {
            projectId,
            settings,
            expectedVersion,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          const project = await loadProjectById(projectId)
          return projectToDesktopWorkspace(project, projectId)
        },
        () => mockClient.updateProjectSettings(input),
      ),
    listProjectSources: projectId =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>('project/source/list', {
            projectId,
            limit: 100,
          })
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.listProjectSources(projectId),
      ),
    importProjectSources: (projectId, uploads) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>('project/source/import', {
            projectId,
            uploads,
            operationId: crypto.randomUUID(),
          })
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.importProjectSources(projectId, uploads),
      ),
    addProjectSourceReference: (projectId, folderId, path) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>('project/source/reference/add', {
            projectId,
            folderId,
            path,
            operationId: crypto.randomUUID(),
          })
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.addProjectSourceReference(projectId, folderId, path),
      ),
    readProjectSource: (projectId, sourceId, range) =>
      withAgentOrMock(
        async () =>
          rpc.call<DesktopProjectSourceReadResult>('project/source/read', {
            projectId,
            sourceId,
            ...(range ? { range } : {}),
          }),
        () => mockClient.readProjectSource(projectId, sourceId, range),
      ),
    removeProjectSource: (projectId, sourceId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ removed: boolean }>('project/source/remove', {
            projectId,
            sourceId,
            operationId: crypto.randomUUID(),
          })
          return result.removed
        },
        () => mockClient.removeProjectSource(projectId, sourceId),
      ),
    chooseProjectFolder: async () => {
      const picker = environment.window?.codePilotXDesktop?.pickWorkspaceDirectory
      return picker ? picker() : mockClient.chooseProjectFolder()
    },
    chooseWorkspace: async () => {
      const picker = environment.window?.codePilotXDesktop?.pickWorkspaceDirectory
      if (!picker) return mockClient.chooseWorkspace()
      const workspacePath = await picker()
      if (!workspacePath) return null
      return withAgentOrMock(
        async () => {
          const project = await chooseProjectForPath(workspacePath)
          return project ? projectToDesktopWorkspace(project, project.id) : null
        },
        () => mockClient.openWorkspace(workspacePath),
      )
    },
    openWorkspace: (workspacePath, projectId) =>
      withAgentOrMock(
        async () => projectToDesktopWorkspace(
          projectId
            ? await loadProjectById(projectId)
            : await chooseProjectForPath(workspacePath)
              ?? (() => { throw new Error('已取消选择项目。') })(),
          projectId ?? null,
        ),
        () => mockClient.openWorkspace(workspacePath),
      ),
    getWorkspaceContext: workspacePath =>
      withAgentOrMock(
        async () => projectToDesktopWorkspace(await loadProjectForPath(workspacePath), null),
        () => mockClient.getWorkspaceContext(workspacePath),
      ),
    listWorkspaceFiles: (workspacePath, directoryPath = '.', folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          const result = await rpc.call<{ entries: DesktopFileEntry[] }>(
            'workspace/file/list',
            {
              projectId: project.id,
              folderId: projectFolderId(project, folderId, workspacePath),
              path: directoryPath,
            },
          )
          return result.entries
        },
        () => mockClient.listWorkspaceFiles(workspacePath, directoryPath),
      ),
    readWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          const preview = await rpc.call<DesktopFilePreview>('workspace/file/read', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
          return {
            ...preview,
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            rootPath: workspacePath,
          }
        },
        () => mockClient.readWorkspaceFile(workspacePath, filePath),
      ),
    readOptionalWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          try {
            const resolvedFolderId = projectFolderId(project, folderId, workspacePath)
            const preview = await rpc.call<DesktopFilePreview>('workspace/file/read', {
              projectId: project.id,
              folderId: resolvedFolderId,
              path: filePath,
            })
            return {
              ...preview,
              projectId: project.id,
              folderId: resolvedFolderId,
              rootPath: workspacePath,
            }
          } catch {
            return null
          }
        },
        () => mockClient.readOptionalWorkspaceFile(workspacePath, filePath),
      ),
    saveWorkspaceFile: input =>
      withAgentOrMock(
        async (): Promise<DesktopFileSaveResult> => {
          const project = input.projectId
            ? await loadProjectById(input.projectId)
            : await loadProjectForPath(input.workspacePath)
          const folderId = projectFolderId(project, input.folderId, input.workspacePath)
          const result = await rpc.call<
            | { outcome: 'saved'; revision: DesktopFileRevision }
            | { outcome: 'conflict'; revision: DesktopFileRevision }
          >('workspace/file/save', {
            projectId: project.id,
            folderId,
            path: input.filePath,
            content: input.content,
            expectedRevision: input.expectedRevision,
          })
          if (result.outcome === 'saved') return result
          const latest = await rpc.call<DesktopFilePreview>(
            'workspace/file/read',
            { projectId: project.id, folderId, path: input.filePath },
          )
          return {
            outcome: 'conflict',
            revision: latest.revision,
            content: latest.content,
          }
        },
        () => mockClient.saveWorkspaceFile(input),
      ),
    watchWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/watch', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
        },
        () => mockClient.watchWorkspaceFile(workspacePath, filePath),
      ),
    unwatchWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/unwatch', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
        },
        () => mockClient.unwatchWorkspaceFile(workspacePath, filePath),
      ),
    readConfig: params =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('config/read', params ?? {})
        },
        () => mockClient.readConfig(params),
      ),
    writeConfigBatch: params =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('config/batchWrite', params)
        },
        () => mockClient.writeConfigBatch(params),
      ),
    readProjectTrust: cwd =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('project/trust/read', { cwd })
        },
        () => mockClient.readProjectTrust(cwd),
      ),
    updateProjectTrust: params =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('project/trust/update', params)
        },
        () => mockClient.updateProjectTrust(params),
      ),
    getDesktopSettings: async () => {
      const getter =
        environment.window?.codePilotXDesktop?.getDesktopSettings
      return getter
        ? normalizeDesktopStoredSettings(await getter())
        : mockClient.getDesktopSettings()
    },
    getThemeSettings: async () => {
      try {
        requireAgentCapability('config.manage.v1')
        const result = await rpc.call('config/read', {})
        const desktop =
          result.config.desktop &&
          typeof result.config.desktop === 'object' &&
          !Array.isArray(result.config.desktop)
            ? result.config.desktop as Record<string, unknown>
            : {}
        if (
          desktop.appearance &&
          typeof desktop.appearance === 'object' &&
          !Array.isArray(desktop.appearance)
        ) {
          return normalizeDesktopThemeSettings(desktop.appearance)
        }
      } catch {
        // The initial Electron value remains the upgrade fallback until Agent migration completes.
      }
      const getter =
        environment.window?.codePilotXDesktop?.getAppearanceSettings
      return getter
        ? getter().then(normalizeDesktopThemeSettings)
        : mockClient.getThemeSettings()
    },
    saveThemeSettings: async settings => {
      const normalized = normalizeDesktopThemeSettings(settings)
      try {
        requireAgentCapability('config.manage.v1')
        const current = await rpc.call('config/read', { includeLayers: true })
        const version = current.layers?.find(layer => layer.kind === 'user')?.version
        const flatten = (
          value: Record<string, unknown>,
          prefix: string[],
        ): Array<{ keyPath: string[]; value: never }> =>
          Object.entries(value).flatMap(([key, child]) =>
            child && typeof child === 'object' && !Array.isArray(child)
              ? flatten(child as Record<string, unknown>, [...prefix, key])
              : [{ keyPath: [...prefix, key], value: child as never }],
          )
        await rpc.call('config/batchWrite', {
          edits: flatten(normalized as unknown as Record<string, unknown>, [
            'desktop',
            'appearance',
          ]),
          ...(version ? { expectedVersion: version } : {}),
        })
      } catch (error) {
        if (
          environment.window?.codePilotXDesktop
          && (!error
            || typeof error !== 'object'
            || !('code' in error)
            || error.code !== 'AGENT_OPERATION_UNSUPPORTED')
        ) {
          throw error
        }
      }
      const saver =
        environment.window?.codePilotXDesktop?.saveAppearanceSettings
      if (saver) {
        await saver(normalized)
        await mockClient.saveThemeSettings(normalized)
        return
      }
      await mockClient.saveThemeSettings(normalized)
    },
    saveDesktopSettings: async settings => {
      const normalized = normalizeDesktopStoredSettings(settings)
      const saver =
        environment.window?.codePilotXDesktop?.saveDesktopSettings
      if (!saver) return mockClient.saveDesktopSettings(normalized)
      const saved = normalizeDesktopStoredSettings(
        await saver(normalized),
      )
      await mockClient.saveDesktopSettings(saved)
      return saved
    },
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
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/save', { scope: 'project', projectId: project.id, ...(input.relativePath ? { id: input.relativePath } : {}), content: input.content, operationId: crypto.randomUUID() })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'project' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt }
        },
        () => mockClient.saveProjectMemory(input),
      ),
    deleteProjectMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); const project = await loadProjectForPath(input.workspacePath); await rpc.call('memory/delete', { id: input.relativePath, scope: 'project', projectId: project.id, operationId: crypto.randomUUID() }) }, () => mockClient.deleteProjectMemory(input)),
    resetProjectMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); const project = await loadProjectForPath(input.workspacePath); await rpc.call('memory/reset', { scope: 'project', projectId: project.id, includeEventLog: input.includeRecallLog === true, operationId: crypto.randomUUID() }) }, () => mockClient.resetProjectMemory(input)),
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
          const response = await rpc.call<{ entry: { id: string; content: string; updatedAt: number } }>('memory/save', { scope: 'user', ...(input.relativePath ? { id: input.relativePath } : {}), content: input.content, operationId: crypto.randomUUID() })
          return { relativePath: response.entry.id, absolutePath: response.entry.id, type: 'user' as const, description: response.entry.content.slice(0, 120), size: response.entry.content.length, mtimeMs: response.entry.updatedAt }
        },
        () => mockClient.saveUserMemory(input),
      ),
    deleteUserMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); await rpc.call('memory/delete', { id: input.relativePath, scope: 'user', operationId: crypto.randomUUID() }) }, () => mockClient.deleteUserMemory(input)),
    resetUserMemory: input =>
      withAgentOrMock(async () => { requireAgentCapability('memory', 2); await rpc.call('memory/reset', { scope: 'user', includeEventLog: input.includeEventLog, operationId: crypto.randomUUID() }) }, () => mockClient.resetUserMemory(input)),
    generateTaskSuggestions: (
      input: GenerateDesktopTaskSuggestionsInput,
    ) =>
      withRequiredAgent(async () => {
        requireAgentCapability('task-suggestions.v1')
        const project = input.workspacePath
          ? await loadProjectForPath(input.workspacePath)
          : null
        return rpc.call('task-suggestion/generate', {
          workspace: project
            ? { kind: 'project', projectId: project.id }
            : { kind: 'projectless' },
          context: input.context,
        })
      }),
    listModelProviders: async () => {
      const [directory, integrations] = await Promise.all([
        loadProviderCatalog(),
        loadIntegrations(),
      ])
      return directory.providers.map(provider =>
        catalogProviderToDesktop(
          {
            provider,
            models: providerModelCache.get(provider.id) ?? [],
          },
          integrations.find(
            integration => integration.id === provider.integrationID,
          ),
        ),
      )
    },
    getModelProviderState: () => providerState(),
    fetchProviderModels: async options => {
      const result = await loadProviderModelPage({
        providerID: options.providerID,
        query: options.query,
        cursor: options.cursor,
        limit: options.limit,
      })
      const provider = result.providers.find(
        item => item.provider.id === options.providerID,
      )
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      const metadata = catalogProviderToDesktop(provider).modelMetadata
      return {
        models: provider.models.filter(item => item.enabled).map(item => item.id),
        modelMetadata: metadata,
        total: result.total,
        nextCursor: result.nextCursor,
      }
    },
    listUsageSources: () =>
      withRequiredAgent(() => rpc.call('usage/source/list', {})),
    getLocalUsage: input =>
      withRequiredAgent(() => rpc.call('usage/local/get', input)),
    queryProviderUsage: input =>
      withRequiredAgent(() => rpc.call('usage/provider/query', input)),
    connectUsageCredential: input =>
      withRequiredAgent(() => {
        const operationId = crypto.randomUUID()
        if (input.sourceId === 'xai-management') {
          return rpc.call('usage/credential/connect', {
            sourceId: input.sourceId,
            key: input.key,
            teamId: input.teamId,
            operationId,
          })
        }
        if (input.sourceId === 'cloudflare-ai-gateway') {
          return rpc.call('usage/credential/connect', {
            sourceId: input.sourceId,
            key: input.key,
            accountId: input.accountId,
            operationId,
          })
        }
        return rpc.call('usage/credential/connect', {
          sourceId: input.sourceId,
          key: input.key,
          operationId,
        })
      }),
    disconnectUsageCredential: input =>
      withRequiredAgent(() =>
        rpc.call('usage/credential/disconnect', {
          ...input,
          operationId: crypto.randomUUID(),
        }),
      ),
    saveModelProvider: async options => {
      let directory = await loadProviderCatalog()
      let provider = directory.providers.find(item => item.id === options.providerID)
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      if (
        options.baseURL !== undefined &&
        options.baseURL !== provider.api.url
      ) {
        await rpc.call('provider/updateSettings', {
          providerId: provider.id,
          settings: {
            ...(options.baseURL ? { api: options.baseURL } : {}),
          },
          operationId: crypto.randomUUID(),
        })
        invalidateModelCatalog()
        directory = await loadProviderCatalog()
        provider = directory.providers.find(item => item.id === options.providerID)
        if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      }
      if (options.id) {
        const page = await loadProviderModelPage({
          providerID: options.providerID,
          query: options.id,
          limit: 100,
        })
        const selectedModel = page.providers
          .find(item => item.provider.id === provider.id)
          ?.models.find(model => model.id === options.id)
        if (!selectedModel) {
          throw new Error(`未找到模型：${options.providerID}/${options.id}`)
        }
        const selectedVariant = options.variant
          ? selectedModel.variants.find(variant => variant.id === options.variant)?.id
          : undefined
        const model: ModelRef = {
          providerID: provider.id,
          id: selectedModel.id,
          ...(selectedVariant ? { variant: selectedVariant } : {}),
        }
        await rpc.call('model/setDefault', {
          model,
          operationId: crypto.randomUUID(),
        })
      }
      invalidateModelCatalog()
      return providerState(options.providerID)
    },
    saveProviderApiKey: async (providerID, apiKey) => {
      const { integration } = await integrationForProvider(providerID)
      await rpc.call('integration/connect', {
        integrationId: integration.id,
        key: apiKey,
        operationId: crypto.randomUUID(),
      })
      integrationsCache = null
      invalidateModelCatalog()
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
        await rpc.call('integration/disconnect', {
          integrationId: integration.id,
          credentialId: connection.id,
          operationId: crypto.randomUUID(),
        })
      }
      integrationsCache = null
      invalidateModelCatalog()
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
    listApiKeys: providerId =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ apiKeys: DesktopApiKeySummary[] }>(
            'apiKey/list',
            providerId ? { providerId } : {},
          )
          return result.apiKeys
        },
        () => mockClient.listApiKeys(providerId),
      ),
    createApiKey: input =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/create', {
            ...input,
            operationId: crypto.randomUUID(),
          })
          integrationsCache = null
          invalidateModelCatalog()
        },
        () => mockClient.createApiKey(input),
      ),
    updateApiKey: input =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/update', {
            ...input,
            operationId: crypto.randomUUID(),
          })
          integrationsCache = null
          invalidateModelCatalog()
        },
        () => mockClient.updateApiKey(input),
      ),
    setActiveApiKey: (providerId, credentialId) =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/setActive', {
            providerId,
            credentialId,
            operationId: crypto.randomUUID(),
          })
          integrationsCache = null
          invalidateModelCatalog()
        },
        () => mockClient.setActiveApiKey(providerId, credentialId),
      ),
    setApiKeyEnabled: (credentialId, enabled) =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/setEnabled', {
            credentialId,
            enabled,
            operationId: crypto.randomUUID(),
          })
          integrationsCache = null
          invalidateModelCatalog()
        },
        () => mockClient.setApiKeyEnabled(credentialId, enabled),
      ),
    reorderApiKeys: (providerId, orderedCredentialIds) =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/reorder', {
            providerId,
            orderedCredentialIds,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.reorderApiKeys(providerId, orderedCredentialIds),
      ),
    testApiKey: credentialId =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<RpcResult<'apiKey/test'>>('apiKey/test', {
            credentialId,
          })
          return {
            ok: result.ok,
            message: result.message,
          }
        },
        () => mockClient.testApiKey(credentialId),
      ),
    deleteApiKey: credentialId =>
      withAgentOrMock(
        async () => {
          await rpc.call<void>('apiKey/delete', {
            credentialId,
            operationId: crypto.randomUUID(),
          })
          integrationsCache = null
          invalidateModelCatalog()
        },
        () => mockClient.deleteApiKey(credentialId),
      ),
    copyProviderApiKey: credentialId => {
      const copy = environment.window?.codePilotXDesktop?.copyProviderApiKey
      if (!copy) throw new Error('安全复制仅在桌面应用中可用。')
      return copy(credentialId)
    },
    testModelProvider: async providerID => {
      const directory = await loadProviderCatalog()
      const provider = directory.providers.find(item => item.id === providerID)
      if (!provider) throw new Error(`未找到模型提供商：${providerID}`)
      const result = await rpc.call('provider/test', {
        providerId: provider.id,
      })
      return result.status === 'reachable'
        ? {
            ok: true,
            message: `连接正常（${result.latencyMs} ms）`,
          }
        : {
            ok: false,
            message: result.message,
          }
    },
    listIntegrations: async () => [...await loadIntegrations(true)],
    connectIntegration: async input => {
      await rpc.call('integration/connect', {
        integrationId: input.integrationID,
        key: input.key,
        ...(input.label ? { label: input.label } : {}),
        operationId: crypto.randomUUID(),
      })
      integrationsCache = null
      invalidateModelCatalog()
      return { ok: true as const }
    },
    authorizeIntegration: async input => {
      const result = await rpc.call('integration/authorize', {
        integrationId: input.integrationID,
        methodId: input.methodID,
        inputs: input.inputs,
        ...(input.label ? { label: input.label } : {}),
        operationId: crypto.randomUUID(),
      })
      await openAuthorizationURL(result.attempt.url)
      return result
    },
    completeIntegrationAuthorization: async input => {
      await rpc.call('integration/authorizeComplete', {
        attemptId: input.attemptID,
        ...(input.code ? { code: input.code } : {}),
        operationId: crypto.randomUUID(),
      })
      integrationsCache = null
      invalidateModelCatalog()
      return { ok: true as const }
    },
    getIntegrationAuthorizationStatus: input =>
      rpc.call('integration/authorizeStatus', {
        attemptId: input.attemptID,
      }).then(result => ({ status: result.attempt.status })),
    disconnectIntegration: async input => {
      await rpc.call('integration/disconnect', {
        integrationId: input.integrationID,
        credentialId: input.credentialID,
        operationId: crypto.randomUUID(),
      })
      integrationsCache = null
      invalidateModelCatalog()
      return { ok: true as const }
    },
    createSession: async (options: CreateDesktopSessionOptions) =>
      withAgentOrMock<CreateDesktopSessionResult>(
        async () => {
          const workspacePath = options.workspacePath?.trim()
          const project = options.projectId
            ? await loadProjectById(options.projectId)
            : workspacePath
              ? await loadProjectForPath(workspacePath)
              : null
          const collaborationMode = resolveCodePilotXCollaborationMode({
            collaborationMode: options.collaborationMode,
            planModeActive: options.planModeActive,
          })
          const stored = await client.getDesktopSettings()
          const advancedPermission: PermissionConfig = options.permissionConfig ?? stored.permissionConfig
          const settings: ThreadSettings = {
            taskMode: planModeActiveFromCollaborationMode(collaborationMode)
              ? 'plan'
              : 'chat',
            permissionConfig: advancedPermission,
          }
          const { snapshot: sharedSnapshot } = await rpc.call('thread/create', {
            workspace: project
              ? { kind: 'project', projectId: project.id }
              : {
                  kind: 'projectless',
                  ...(options.projectlessPrompt?.trim()
                    ? { prompt: options.projectlessPrompt.trim() }
                    : {}),
                },
            settings,
            title: options.sessionName,
            operationId: crypto.randomUUID(),
          })
          const snapshot = agentThreadSnapshotToDesktop(sharedSnapshot, project)
          sessionSnapshots.set(snapshot.item.id, snapshot)
          activeSessionId = snapshot.item.id
          await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
          return {
            sessionId: snapshot.item.id,
            workspace: snapshot.workspace,
            standalone: sharedSnapshot.thread.workspace.kind === 'projectless',
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
      inputId: crypto.randomUUID(),
      message: desktopUserMessageInputToPreviewText(input),
      model: await resolveAgentModelRef(selectedModel, activeSessionId ?? ''),
      attachmentIds: await importAgentAttachments(input),
      ...(selectedPermissionMode ? { permissionConfig: desktopPermissionModeToPermissionConfig(selectedPermissionMode) } : {}),
    }),
    stopSubagent: taskId => rpc.call('subagent/stop', { taskId, operationId: crypto.randomUUID() }),
    retrySubagent: taskId => rpc.call('subagent/retry', { taskId, operationId: crypto.randomUUID() }),
    applySubagentWorktree: taskId => rpc.call('subagent/worktree/apply', { taskId, operationId: crypto.randomUUID() }),
    discardSubagentWorktree: taskId => rpc.call('subagent/worktree/discard', { taskId, operationId: crypto.randomUUID() }),
    restoreSubagentWorkspace: taskId => rpc.call('subagent/workspace/restore', { taskId, operationId: crypto.randomUUID() }),
    respondSubagentApproval: async (approval, decision) => {
      const interaction = await findPendingInteraction(
        candidate =>
          candidate.kind === 'approval' &&
          (candidate.interactionId === approval.id ||
            candidate.toolCallId === approval.toolCallID),
        approval.threadId,
      )
      if (interaction.kind !== 'approval') return
      await respondToInteraction(interaction, {
        kind: 'approval',
        decision,
      })
    },
    respondSubagentQuestion: async (questionId, answer, ignored) => {
      const interaction = await findPendingInteraction(
        candidate =>
          candidate.kind === 'question' &&
          candidate.questions.some(question => question.id === questionId),
      )
      if (interaction.kind !== 'question') return
      await respondToQuestionInteraction(interaction, answer, ignored)
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
            const response = await rpc.call('thread/update', {
              threadId: sessionId,
              patch: { archived: patch.archivedAt !== null },
              operationId: crypto.randomUUID(),
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
              },
              updatedAt: listSnapshot.updatedAt,
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
          const response = await rpc.call('thread/update', {
            threadId: sessionId,
            patch: { title: name },
            operationId: crypto.randomUUID(),
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
          await rpc.call('thread/delete', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
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
      withAgentOrMock(
        async () => {
          const shouldReplaceAttachments = input.attachments !== undefined
          const attachmentIds = shouldReplaceAttachments
            ? await importAgentAttachments(input)
            : undefined
          await callQueueMutation(sessionId, 'queue/update', {
            inputId: followUpId,
            content: desktopUserMessageInputToPreviewText(input),
            ...(shouldReplaceAttachments ? { attachmentIds } : {}),
          })
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.updateQueuedFollowUp(sessionId, followUpId, input),
      ),
    removeQueuedFollowUp: (sessionId, followUpId) =>
      withAgentOrMock(
        async () => {
          await callQueueMutation(sessionId, 'queue/remove', {
            inputId: followUpId,
          })
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.removeQueuedFollowUp(sessionId, followUpId),
      ),
    sendQueuedFollowUpNow: (sessionId, followUpId) =>
      withAgentOrMock(
        async () => {
          await callQueueMutation(sessionId, 'queue/steer', {
            inputId: followUpId,
          })
          await loadAgentSessionSnapshot(sessionId).catch(() => null)
          emitSessionStoreChange()
        },
        () => mockClient.sendQueuedFollowUpNow(sessionId, followUpId),
      ),
    reorderQueuedFollowUps: (sessionId, followUpIds) =>
      withAgentOrMock(
        async () => {
          await callQueueMutation(sessionId, 'queue/reorder', {
            inputIds: followUpIds,
          })
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.reorderQueuedFollowUps(sessionId, followUpIds),
      ),
    resumeQueuedFollowUps: sessionId =>
      withAgentOrMock(
        async () => {
          await callQueueMutation(sessionId, 'queue/resume', {})
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.resumeQueuedFollowUps(sessionId),
      ),
    compactSession: sessionId =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('compact')
          await rpc.call('thread/compact', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
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
      withAgentOrMock(
        async () => {
          if (
            !agentCapabilities.has('ai.review.v1')
          ) {
            unsupportedAgentOperation('startSessionReview (ai.review.v1)')
          }
          if (target.type === 'custom') {
            unsupportedAgentOperation('自定义 AI Review 目标')
          }
          const settings = await client.getDesktopSettings()
          return rpc.call('review/ai/start', {
            threadId: sessionId,
            target,
            delivery: settings.reviewDelivery,
          })
        },
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
          const response = await rpc.call('thread/settings/update', {
            threadId: sessionId,
            settings: { permissionConfig },
            operationId: crypto.randomUUID(),
          })
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
          const interaction = await findPendingInteraction(
            candidate =>
              questionId
                ? candidate.kind === 'question' &&
                  candidate.questions.some(question => question.id === questionId)
                : candidate.kind === 'approval' &&
                  candidate.interactionId === requestId,
            sessionId,
          )
          if (interaction.kind === 'question') {
            await respondToQuestionInteraction(
              interaction,
              questionAnswerFromDecision(decision),
              decision.behavior === 'deny',
            )
          } else if (interaction.kind === 'approval') {
            await respondToInteraction(interaction, {
              kind: 'approval',
              decision: decision.behavior === 'allow' ? 'allow-once' : 'deny',
              ...(decision.alwaysAllow
                ? {
                    remember: {
                      scope: 'tool' as const,
                      value: interaction.tool,
                    },
                  }
                : {}),
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
          await rpc.call('turn/interrupt', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
          scheduleSessionRefresh(sessionId)
        },
        () => mockClient.interruptSession(sessionId),
      ),
    readThreadHistoryPage: params =>
      withAgentOrMock(
        () => rpc.call('thread/history/read', params),
        async () => mockThreadHistoryPage(
          await mockClient.getSession(params.threadId),
        ),
      ),
    subscribeAgentEventEnvelopes: (options, callback) => {
      const makeEventSource = eventSourceFactory()
      if (!makeEventSource) return noop
      return rpc.subscribeEnvelope(options, callback)
    },
    onAgentEvent: callback => {
      const makeEventSource = eventSourceFactory()
      if (!makeEventSource) {
        return allowBrowserMockFallback
          ? mockClient.onAgentEvent(callback)
          : noop
      }
      return rpc.subscribe({
        onReplayComplete: () => {
          void reconcileAgentSessionStore().catch(() => {})
        },
      }, notification => {
        const notificationMethod = notification.method as string
        if (notificationMethod === 'catalog/updated') {
          invalidateModelCatalog()
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('desktop:model-provider-changed'))
          }
        }
        if (notificationMethod === 'integration/updated') {
          integrationsCache = null
          invalidateModelCatalog()
        }
        if (
          notificationMethod === 'config/updated' &&
          typeof window !== 'undefined'
        ) {
          window.dispatchEvent(
            new CustomEvent(CONFIG_UPDATED_EVENT, {
              detail: notification.params,
            }),
          )
        }
        if (
          notificationMethod === 'workspace/file/changed' &&
          notification.params &&
          typeof notification.params === 'object' &&
          typeof window !== 'undefined'
        ) {
          window.dispatchEvent(
            new CustomEvent(WORKSPACE_FILE_CHANGED_EVENT, {
              detail: notification.params,
            }),
          )
        }
        if (
          notificationMethod === 'workspace/git/changed' &&
          notification.params &&
          typeof notification.params === 'object' &&
          typeof window !== 'undefined'
        ) {
          window.dispatchEvent(
            new CustomEvent(WORKSPACE_GIT_CHANGED_EVENT, {
              detail: notification.params,
            }),
          )
        }
        for (const event of agentEventsFromNotification(notification)) {
          callback(event)
        }
        const params =
          notification.params && typeof notification.params === 'object'
            ? notification.params
            : null
        if (
          typeof params?.threadId === 'string' &&
          [
            'thread/snapshot',
            'thread/updated',
            'thread/settings/updated',
            'turn/queued',
            'queue/updated',
            'turn/started',
            'turn/statusChanged',
            'turn/completed',
            'turn/failed',
            'turn/interrupted',
            'item/completed',
            'turn/plan/updated',
            'approval/requested',
            'question/requested',
          ].includes(notificationMethod)
        ) {
          scheduleSessionRefresh(params.threadId)
        }
      })
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
    onDesktopSettingsChange: callback => {
      const subscribe =
        environment.window?.codePilotXDesktop?.onDesktopSettingsChange
      if (!subscribe) return mockClient.onDesktopSettingsChange(callback)
      return subscribe(change => {
        const value =
          change
          && typeof change === 'object'
          && 'settings' in change
            ? change.settings
            : change
        callback({
          settings: normalizeDesktopStoredSettings(value),
        })
      })
    },
  }

  return client
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

function parseQuestionAnswerMap(
  answer: string | null,
): Record<string, string> {
  if (!answer?.trim().startsWith('{')) return {}
  try {
    const parsed = JSON.parse(answer) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

function noop(): void {}

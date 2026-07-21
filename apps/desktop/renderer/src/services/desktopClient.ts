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
  ProtocolCapability,
  RpcResult,
} from '@codepilotx/agent-protocol'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../../shared/theme.js'
import { desktopUserMessageInputToPreviewText } from '../../shared/desktopUserMessage.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopApi,
  DesktopBrowserState,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopFollowUpBehavior,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopFileRevision,
  DesktopFileSaveResult,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopReviewSource,
  DesktopSessionEvent,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
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
export const WORKSPACE_FILE_CHANGED_EVENT =
  'codepilotx-workspace-file-changed'
export const WORKSPACE_GIT_CHANGED_EVENT =
  'codepilotx-workspace-git-changed'

const DEFAULT_BROWSER_DEBUG_PORT = 53271
const BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY =
  'codepilotx.desktop.appearance.v3'
const RENDERER_PROTOCOL = 'thread-rpc-v3' as const
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
] as const satisfies ReadonlyArray<ProtocolCapability>
type PendingInteraction =
  RpcResult<'interaction/listPending'>['interactions'][number]

type DesktopClientWindow = {
  desktopApi?: DesktopApi
  codePilotXDesktop?: {
    pickWorkspaceDirectory(): Promise<string | null>
    getAppearanceSettings?(): Promise<unknown>
    saveAppearanceSettings?(settings: unknown): Promise<unknown>
    getDesktopSettings?(): Promise<unknown>
    saveDesktopSettings?(settings: unknown): Promise<unknown>
    getSystemTheme?(): Promise<'light' | 'dark'>
    onSystemThemeChange?(
      listener: (theme: 'light' | 'dark') => void,
    ): () => void
    getWindowBackdropCapability?(): Promise<{
      supported: boolean
      platform: string
    }>
    applyWindowBackdrop?(enabled: boolean): Promise<boolean>
    listExternalOpenTargets?(targetPath: string): Promise<Array<{
      targetId: string
      label: string
      kind: 'default-app' | 'editor'
      iconDataUrl?: string
    }>>
    openPathWithTarget?(targetPath: string, targetId: string): Promise<void>
    revealPathInFolder?(targetPath: string): Promise<void>
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

export type DesktopReviewAgentFileSummary = {
  path: string
  previousPath: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'type-changed' | 'unknown'
  additions: number | null
  deletions: number | null
  changedLines: number
  changedBytes: number
  binary: boolean
  revision: string
}

export type DesktopReviewAgentSummary = {
  projectId: string
  generation: string
  source: DesktopReviewSource
  repositoryRoot: string
  headSha: string | null
  baseSha: string | null
  files: DesktopReviewAgentFileSummary[]
  totals: {
    files: number
    additions: number
    deletions: number
    changedLines: number
    changedBytes: number
  }
  largeDiffMode: boolean
}

export type DesktopReviewAgentSummaryResult = {
  snapshot: DesktopReviewAgentSummary
  cacheState: 'fresh' | 'stale'
}

export type DesktopReviewAgentFileDiff = {
  file: DesktopReviewAgentFileSummary
  revision: string
  patch: string
  hunks: Array<{
    id: string
    header: string
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patch: string
  }>
  renderable: boolean
  tooLargeReason: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type DesktopReviewAgentComment = {
  id: string
  threadId: string
  projectId: string
  sourceKey: string
  path: string
  side: 'old' | 'new'
  line: number
  hunkId: string | null
  revision: string
  body: string
  status: 'open' | 'resolved'
  githubCommentId: string | null
  githubThreadId: string | null
  createdAt: string
  updatedAt: string
}

type ReviewAgentGitStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: Array<{
    path: string
    previousPath: string | null
    stagedStatus: string
    unstagedStatus: string
    untracked: boolean
  }>
}

function desktopGitStatus(status: ReviewAgentGitStatus): DesktopGitStatus {
  return {
    branchName: status.branchName,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    clean: status.clean,
    files: status.files.map(file => ({
      path: file.path,
      ...(file.previousPath ? { originalPath: file.previousPath } : {}),
      status: `${file.stagedStatus}${file.unstagedStatus}`,
      stagedStatus: file.stagedStatus,
      unstagedStatus: file.unstagedStatus,
      additions: null,
      deletions: null,
      isUntracked: file.untracked,
    })),
  }
}

export type DesktopAgentReviewApi = {
  getAgentReviewSummary(input: {
    workspacePath: string
    source: DesktopReviewSource
    refresh?: boolean
  }): Promise<DesktopReviewAgentSummaryResult>
  getAgentReviewFileDiff(input: {
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    path: string
    hideWhitespace?: boolean
  }): Promise<DesktopReviewAgentFileDiff>
  applyAgentReviewOperation(input: {
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    expectedRevision: string
    action: 'stage' | 'unstage' | 'revert'
    target:
      | { kind: 'file'; path: string }
      | { kind: 'hunk'; path: string; hunkId: string }
  }): Promise<void>
  getAgentReviewBranches(workspacePath: string): Promise<Array<{
    name: string
    sha: string
    current: boolean
    remote: boolean
  }>>
  getAgentReviewCommits(workspacePath: string): Promise<Array<{
    sha: string
    shortSha: string
    subject: string
    author: string
    authoredAt: string
  }>>
  listAgentReviewComments(input: {
    workspacePath: string
    threadId: string
    sourceKey: string
  }): Promise<DesktopReviewAgentComment[]>
  saveAgentReviewComment(input: {
    id?: string
    workspacePath: string
    threadId: string
    sourceKey: string
    path: string
    side: 'old' | 'new'
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string
    githubThreadId?: string
  }): Promise<DesktopReviewAgentComment>
  resolveAgentReviewComment(input: {
    workspacePath: string
    threadId: string
    id: string
  }): Promise<DesktopReviewAgentComment>
  deleteAgentReviewComment(input: {
    workspacePath: string
    threadId: string
    id: string
  }): Promise<void>
  publishAgentGithubReviewComment(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    body: string
    path: string
    side: 'LEFT' | 'RIGHT'
    line: number
    expectedHeadRevision: string
    commitId?: string
  }): Promise<{ id: number; nodeId: string; htmlUrl: string }>
  submitAgentGithubReview(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    expectedHeadRevision: string
    body?: string
  }): Promise<{ id: number; state: string; htmlUrl: string }>
}

export type CodePilotXDesktopClient = DesktopApi & DesktopAgentReviewApi

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
): CodePilotXDesktopClient {
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

export const desktopClient: CodePilotXDesktopClient = createDesktopClient()

function createAgentSessionDesktopClient(
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
      | 'github.pullRequests.v1',
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
    const response = await rpc.call('project/list', {})
    projectsByIdCache = new Map(response.projects.map(project => [project.id, project]))
    return projectsByIdCache
  }

  async function loadProjectForPath(rootPath: string): Promise<Project> {
    const response = await rpc.call('project/open', {
      rootPath,
      operationId: crypto.randomUUID(),
    })
    projectsByIdCache = null
    return response.project
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

  const client: CodePilotXDesktopClient = {
    ...mockClient,
    getGithubAuthStatus: async (): Promise<DesktopGithubAuthStatus> => {
      try {
        return await withRequiredAgent(async () => {
          requireAgentCapability('github.oauth.v1')
          return rpc.call<DesktopGithubAuthStatus>('github/auth/status')
        })
      } catch (error) {
        const settings = await mockClient.getDesktopSettings()
        return {
          configured: Boolean(settings.githubOAuthClientId.trim()),
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
          const clientId = input?.clientId?.trim()
          if (!clientId) throw new Error('请先填写 GitHub OAuth Client ID。')
          const status = await rpc.call('github/auth/start', {
            clientId,
          })
          activeGithubLoginId = status.loginId
          return status
        })
      } catch (error) {
        return githubLoginFailure(operationError(error), activeGithubLoginId)
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
        return githubLoginFailure(operationError(error), activeGithubLoginId)
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
        const settings = await mockClient.getDesktopSettings()
        return {
          configured: Boolean(settings.githubOAuthClientId.trim()),
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
    listWorkspaceFiles: (workspacePath, directoryPath = '.') =>
      withAgentOrMock(
        async () => {
          const project = await loadProjectForPath(workspacePath)
          const result = await rpc.call<{ entries: DesktopFileEntry[] }>(
            'workspace/file/list',
            { projectId: project.id, path: directoryPath },
          )
          return result.entries
        },
        () => mockClient.listWorkspaceFiles(workspacePath, directoryPath),
      ),
    readWorkspaceFile: (workspacePath, filePath) =>
      withAgentOrMock(
        async () => {
          const project = await loadProjectForPath(workspacePath)
          return rpc.call<DesktopFilePreview>('workspace/file/read', {
            projectId: project.id,
            path: filePath,
          })
        },
        () => mockClient.readWorkspaceFile(workspacePath, filePath),
      ),
    readOptionalWorkspaceFile: (workspacePath, filePath) =>
      withAgentOrMock(
        async () => {
          const project = await loadProjectForPath(workspacePath)
          try {
            return await rpc.call<DesktopFilePreview>('workspace/file/read', {
              projectId: project.id,
              path: filePath,
            })
          } catch {
            return null
          }
        },
        () => mockClient.readOptionalWorkspaceFile(workspacePath, filePath),
      ),
    saveWorkspaceFile: input =>
      withAgentOrMock(
        async (): Promise<DesktopFileSaveResult> => {
          const project = await loadProjectForPath(input.workspacePath)
          const result = await rpc.call<
            | { outcome: 'saved'; revision: DesktopFileRevision }
            | { outcome: 'conflict'; revision: DesktopFileRevision }
          >('workspace/file/save', {
            projectId: project.id,
            path: input.filePath,
            content: input.content,
            expectedRevision: input.expectedRevision,
          })
          if (result.outcome === 'saved') return result
          const latest = await rpc.call<DesktopFilePreview>(
            'workspace/file/read',
            { projectId: project.id, path: input.filePath },
          )
          return {
            outcome: 'conflict',
            revision: latest.revision,
            content: latest.content,
          }
        },
        () => mockClient.saveWorkspaceFile(input),
      ),
    watchWorkspaceFile: (workspacePath, filePath) =>
      withAgentOrMock(
        async () => {
          const project = await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/watch', {
            projectId: project.id,
            path: filePath,
          })
        },
        () => mockClient.watchWorkspaceFile(workspacePath, filePath),
      ),
    unwatchWorkspaceFile: (workspacePath, filePath) =>
      withAgentOrMock(
        async () => {
          const project = await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/unwatch', {
            projectId: project.id,
            path: filePath,
          })
        },
        () => mockClient.unwatchWorkspaceFile(workspacePath, filePath),
      ),
    getDesktopSettings: async () => {
      const getter =
        environment.window?.codePilotXDesktop?.getDesktopSettings
      return getter
        ? normalizeDesktopStoredSettings(await getter())
        : mockClient.getDesktopSettings()
    },
    getThemeSettings: () => {
      const getter =
        environment.window?.codePilotXDesktop?.getAppearanceSettings
      return getter
        ? getter().then(normalizeDesktopThemeSettings)
        : mockClient.getThemeSettings()
    },
    saveThemeSettings: async settings => {
      const normalized = normalizeDesktopThemeSettings(settings)
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
          const { snapshot: sharedSnapshot } = await rpc.call('thread/create', {
            projectId: project.id,
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
          const planRunId = agentPlanRunIdFromRequestId(requestId)
          const interaction = await findPendingInteraction(
            candidate =>
              planRunId
                ? candidate.kind === 'plan' && candidate.turnId === planRunId
                : questionId
                  ? candidate.kind === 'question' &&
                    candidate.questions.some(question => question.id === questionId)
                  : candidate.kind === 'approval' &&
                    candidate.interactionId === requestId,
            sessionId,
          )
          if (interaction.kind === 'plan') {
            await respondToInteraction(interaction, {
              kind: 'plan',
              decision: decision.behavior === 'allow' ? 'continue' : 'reject',
            })
          } else if (interaction.kind === 'question') {
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
    mockClient ??= createBrowserMockDesktopClient(environment.localStorage)
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
  return createBrowserMockDesktopClient(environment.localStorage)
}

function createBrowserMockDesktopClient(storage?: Storage): DesktopApi {
  let settings: DesktopStoredSettings = defaultDesktopStoredSettings()
  let themeSettings: DesktopThemeSettings = readBrowserThemeSettings(storage)
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
    reorderQueuedFollowUps: async () => mockSessionSnapshot('mock', { path: '', name: 'Mock', branchName: null }, {}),
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
  return normalizeDesktopThemeSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
}

function readBrowserThemeSettings(storage?: Storage): DesktopThemeSettings {
  try {
    const value = storage?.getItem(BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY)
    return value
      ? normalizeDesktopThemeSettings(JSON.parse(value))
      : defaultMockThemeSettings()
  } catch {
    return defaultMockThemeSettings()
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

function createBrowserVisualFixture(): DesktopSessionSnapshot | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const visualCase = new URLSearchParams(window.location.search).get('visualCase')
  if (
    visualCase !== 'rich' &&
    visualCase !== 'permission' &&
    visualCase !== 'review' &&
    visualCase !== 'turn-nav'
  ) {
    return null
  }

  const sessionId = `visual-${visualCase}`
  const workspace = mockWorkspace('F:\\CodeProject\\CodePilotX-Ts')
  const snapshot = mockSessionSnapshot(sessionId, workspace, {
    workspacePath: workspace.path,
    sessionName:
      visualCase === 'rich'
        ? 'Codex 富消息工作台'
        : visualCase === 'permission'
          ? '权限与计划'
          : visualCase === 'turn-nav'
            ? '用户消息导航'
            : 'Review 与 Diff',
    collaborationMode: {
      mode: visualCase === 'permission' ? 'plan' : 'default',
    },
    planModeActive: visualCase === 'permission',
    thinkingMode: 'adaptive',
  })
  const baseTime = Date.now()
  const timestamp = (offsetMs: number): string =>
    new Date(baseTime + offsetMs).toISOString()
  const createdAt = timestamp(0)
  const events: DesktopSessionEvent[] = [
    {
      id: `${sessionId}-user`,
      sessionId,
      type: 'message',
      role: 'user',
      content:
        visualCase === 'review'
          ? '请审查主题重构并确认 diff。'
          : visualCase === 'turn-nav'
            ? '第一轮：梳理 Codex 导航轨。'
          : '把核心工作台重构成 Codex 风格，并保留现有 Agent 边界。',
      createdAt,
    },
    {
      id: `${sessionId}-assistant`,
      sessionId,
      type: 'message',
      role: 'assistant',
      content:
        visualCase === 'turn-nav'
          ? '第一轮已完成。'
          : '已完成工作台结构梳理。\n\n```ts\nconst theme = mode === \"dark\" ? \"codex-dark\" : \"codex-light\"\n```\n\n- 固定 Codex 语义表面\n- 高亮主题按需加载',
      createdAt: timestamp(2_000),
    },
  ]

  if (visualCase === 'turn-nav') {
    for (let turn = 2; turn <= 4; turn += 1) {
      events.push(
        {
          id: `${sessionId}-user-${turn}`,
          sessionId,
          type: 'message',
          role: 'user',
          content: `第 ${turn} 轮：继续校准交互和视觉。`,
          createdAt: timestamp(turn * 3_000),
        },
        {
          id: `${sessionId}-assistant-${turn}`,
          sessionId,
          type: 'message',
          role: 'assistant',
          content:
            turn === 4
              ? '第 4 轮已完成。\n\n- 卡片固定 320px\n- padding 为 8px\n- 摘要最多三行'
              : `第 ${turn} 轮已完成。`,
          createdAt: timestamp(turn * 3_000 + 1_000),
        },
      )
    }
    events.push({
      id: `${sessionId}-patch`,
      sessionId,
      type: 'file_patch',
      content: '更新用户消息导航轨',
      createdAt: timestamp(13_000),
      metadata: {
        turnScoped: true,
        files: [
          { path: 'apps/desktop/renderer/src/features/session/ConversationTurnNavRail.tsx' },
          { path: 'apps/desktop/renderer/src/styles/features/timeline.scss' },
          { path: 'apps/desktop/renderer/src/components/ui/Tooltip.tsx' },
        ],
      },
    })
  }

  if (visualCase === 'rich' || visualCase === 'review') {
    events.push(
      {
        id: `${sessionId}-tool`,
        sessionId,
        type: 'tool_call',
        content: 'Bash: bun run typecheck',
        createdAt: timestamp(3_000),
        metadata: { toolName: 'Bash', toolUseId: 'visual-tool-1' },
      },
      {
        id: `${sessionId}-tool-output`,
        sessionId,
        type: 'tool_output_delta',
        content: '63 tests passed\nrenderer build complete',
        createdAt: timestamp(4_000),
        metadata: { toolName: 'Bash', toolUseId: 'visual-tool-1' },
      },
      {
        id: `${sessionId}-patch`,
        sessionId,
        type: 'file_patch',
        content: '更新 Codex 主题与工作台样式',
        createdAt: timestamp(5_000),
        metadata: {
          turnScoped: true,
          files: [
            { path: 'apps/desktop/renderer/shared/theme.ts' },
            { path: 'apps/desktop/renderer/src/styles/index.scss' },
          ],
        },
      },
    )
  }

  if (visualCase === 'permission') {
    events.push({
      id: `${sessionId}-plan`,
      sessionId,
      type: 'proposed_plan',
      role: 'assistant',
      content:
        '# 实施计划\n\n1. 固定 Codex Light / Dark\n2. 生成 91 主题白名单\n3. 验证权限、Plan 与 Dock',
      createdAt: timestamp(3_000),
    })
    snapshot.view.pendingPermissions = [
      {
        requestId: `${sessionId}-permission`,
        toolName: 'Bash',
        requestKind: 'shell-command',
        description: '允许运行 renderer 验收命令',
        input: { command: 'bun run --cwd apps/desktop/renderer test' },
      },
    ]
  }

  snapshot.events = events
  snapshot.view.messages = events
    .filter(event => event.type === 'message')
    .map(event => ({
      id: event.id,
      role: event.role as 'user' | 'assistant',
      text: event.content,
      createdAt: event.createdAt,
    }))
  snapshot.item.status = visualCase === 'rich' ? 'running' : 'idle'
  snapshot.item.lastMessageAt = events.at(-1)?.createdAt ?? createdAt
  snapshot.updatedAt = snapshot.item.lastMessageAt
  return snapshot
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
    loginId: null,
    state: 'idle' as const,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error: null,
    auth: null,
    elapsedMs: 0,
  }
}

function githubLoginFailure(
  error: string,
  loginId: string | null = null,
): DesktopGithubLoginStatus {
  return {
    loginId,
    state: 'failed',
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error,
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

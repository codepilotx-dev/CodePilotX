import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getProviderConfig,
  listProviderConfigs,
  type ProviderConfig,
  type ProviderWireApi,
} from '@codepilotx/core/models/providerConfig.js'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import { buildDesktopPermissionRequestFromControlRequest } from './agentRuntime.js'
import type {
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopUserMessageContent,
  DesktopPermissionMode,
} from '../shared/types.js'
import type { DesktopAgentEvent } from '../shared/types.js'
import type { Attachment } from '@codepilotx/core/attachments/types.js'
import type { UserInput } from './rustAppServerProtocol/generated/v2/UserInput.js'
import {
  SidecarStartError,
  buildSidecarEnv,
  sanitizeChildEnvironment,
  type SidecarManagerOptions,
} from './sidecarManager.js'
import { RustJsonRpcError, RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import type { ReviewTarget } from './rustAppServerProtocol/index.js'
import { RustAppServerClient } from './rustAppServerClient.js'
import type {
  ThreadStartParams,
  ThreadStartResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadSettingsUpdateParams,
  ThreadSettingsUpdatedNotification,
  InitializeParams,
  InitializeResponse,
} from './rustAppServerProtocol/index.js'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import type { JsonRpcId } from './rustLineJsonRpcClient.js'
import { desktopDebug } from './desktopDebug.js'
import { terminateChildProcess } from './childProcessTermination.js'

// ── Tool request/response types (v2 protocol types for requestUserInput) ──

type ToolRequestUserInputQuestion = {
  id: string
  header: string
  question: string
  options?: Array<{ label: string; description: string }> | null
  isOther?: boolean
  isSecret?: boolean
}

type ToolRequestUserInputAnswer = {
  answers: string[]
}

type ToolRequestUserInputResponse = {
  answers: Record<string, ToolRequestUserInputAnswer>
}

type DynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

type DynamicToolCallResponse = {
  success: boolean
  contentItems: DynamicToolCallOutputContentItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isActiveTurnNotSteerable(error: unknown): boolean {
  if (!(error instanceof RustJsonRpcError)) return false
  const data = isRecord(error.data) ? error.data : null
  return (
    data?.type === 'activeTurnNotSteerable' ||
    error.message.toLowerCase().includes('not steerable')
  )
}

function isUnsupportedThreadSettingsUpdate(error: unknown): boolean {
  return (
    error instanceof RustJsonRpcError &&
    (error.code === -32601 || error.message.toLowerCase().includes('method not found'))
  )
}

function normalizeReviewTarget(
  target: import('../shared/types.js').DesktopAiReviewTarget,
): ReviewTarget {
  switch (target.type) {
    case 'uncommittedChanges':
      return { type: 'uncommittedChanges' }
    case 'baseBranch':
      return { type: 'baseBranch', branch: target.branch.trim() }
    case 'commit':
      return {
        type: 'commit',
        sha: target.sha.trim(),
        title: target.title?.trim() || null,
      }
    case 'custom':
      return { type: 'custom', instructions: target.instructions.trim() }
  }
}

function settingsForPermissionMode(
  mode: DesktopPermissionMode,
  context: DesktopAgentRuntimeContext,
): Omit<ThreadSettingsUpdateParams, 'threadId'> {
  switch (mode) {
    case 'auto-review':
      return {
        permissions: ':workspace',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      }
    case 'full-access':
      return {
        permissions: ':danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
      }
    case 'custom':
      return {
        permissions: context.permissionProfile ?? ':workspace',
        approvalPolicy: context.approvalPolicy ?? 'on-request',
        approvalsReviewer:
          context.approvalsReviewer === 'auto'
            ? 'auto_review'
            : (context.approvalsReviewer ?? 'user'),
      }
    case 'default':
    default:
      return {
        permissions: ':workspace',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      }
  }
}

/** Preserve compatibility with future clients that can return a cancellation. */
function compatiblePermissionBehavior(
  decision: DesktopPermissionDecision,
): 'allow' | 'deny' | 'cancel' {
  const behavior = (decision as unknown as { behavior?: string }).behavior
  return behavior === 'allow' || behavior === 'cancel' ? behavior : 'deny'
}

function isPermissionDecisionCancelled(decision: DesktopPermissionDecision): boolean {
  return decision.updatedInput?.cancelled === true || decision.updatedInput?.action === 'cancel'
}

function extractMcpSubmittedContent(
  updatedInput: Record<string, unknown> | undefined,
): unknown {
  if (!updatedInput) return {}
  if (Object.prototype.hasOwnProperty.call(updatedInput, 'content')) {
    return updatedInput.content
  }
  if (Object.prototype.hasOwnProperty.call(updatedInput, 'form')) {
    return updatedInput.form
  }
  const { action: _action, cancelled: _cancelled, ...content } = updatedInput
  return content
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const RUST_APP_SERVER_BINARY_ENV = 'CODEPILOTX_RUST_APP_SERVER'

export type RustAppServerExecutableSource =
  | 'env-override'
  | 'workspace'
  | 'bundled'

export type RustAppServerExecutableInfo = {
  path: string
  source: RustAppServerExecutableSource
}

export type RustAppServerResolverContext = {
  isPackaged: boolean
  resourcesPath: string
}

type RustSidecarStartupState = 'stopped' | 'starting' | 'ready' | 'failed'

export function resolveRustAppServerExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveRustAppServerExecutableInfo(env).path
}

export function resolveRustAppServerExecutableInfo(
  env: NodeJS.ProcessEnv = process.env,
  runtime: RustAppServerResolverContext = defaultRustAppServerResolverContext(env),
): RustAppServerExecutableInfo {
  const binaryName = process.platform === 'win32'
    ? 'codepilotx-app-server.exe'
    : 'codepilotx-app-server'
  if (runtime.isPackaged) {
    return {
      path: resolve(runtime.resourcesPath, 'desktop-rust-sidecar', binaryName),
      source: 'bundled',
    }
  }
  const explicitPath = env[RUST_APP_SERVER_BINARY_ENV]?.trim()
  if (explicitPath && !isReferenceCodePilotXMainAppServerPath(explicitPath)) {
    return { path: resolve(explicitPath), source: 'env-override' }
  }

  const workspaceCandidates = currentWorkspaceRustAppServerCandidates(binaryName)
  const workspaceCandidate = workspaceCandidates.find(candidate =>
    existsSync(candidate),
  ) ?? workspaceCandidates[0]
  if (workspaceCandidate) {
    return { path: workspaceCandidate, source: 'workspace' }
  }

  return {
    path: join(__dirname, '..', '..', 'desktop-rust-sidecar', binaryName),
    source: 'bundled',
  }
}

function defaultRustAppServerResolverContext(
  _env: NodeJS.ProcessEnv,
): RustAppServerResolverContext {
  return {
    isPackaged: isPackagedElectronProcess(process),
    resourcesPath:
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ??
      join(__dirname, '..', '..'),
  }
}

export function isPackagedElectronProcess(value: {
  versions: { electron?: string }
  defaultApp?: boolean
}): boolean {
  return Boolean(value.versions.electron) && value.defaultApp !== true
}

export function buildRustInitializeParams(): InitializeParams {
  return {
    clientInfo: {
      name: 'codepilotx-desktop',
      title: 'CodePilotX Desktop',
      version: '0.1.0',
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      mcpServerOpenaiFormElicitation: true,
    },
  }
}

function currentWorkspaceRustAppServerCandidates(binaryName: string): string[] {
  return uniqueResolvedPaths([
    process.cwd(),
    // Built Electron main output: dist/desktop/main -> repo root.
    join(__dirname, '..', '..', '..'),
    // Source/test path: apps/desktop/src/main -> repo root.
    join(__dirname, '..', '..', '..', '..'),
  ]).map(root =>
    join(root, 'rust', 'codex-rs', 'target', 'debug', binaryName),
  )
}

function uniqueResolvedPaths(paths: string[]): string[] {
  return [...new Set(paths.map(path => resolve(path)))]
}

function isReferenceCodePilotXMainAppServerPath(path: string): boolean {
  const normalized = resolve(path).replace(/\\/g, '/').toLowerCase()
  return normalized.includes('/codex-main/codex-rs/target/debug/')
}

export async function createRustSidecarOptions(
  context: DesktopAgentRuntimeContext,
): Promise<SidecarManagerOptions> {
  const executablePath = resolveRustAppServerExecutable()
  const providerConfig = await createRustModelProviderOverrides(context)
  return {
    command: executablePath,
    args: [
      '--listen',
      'stdio://',
      '--session-source',
      'vscode',
      ...(context.planModeActive ? ['-c', 'collaboration_mode=plan'] : []),
      ...providerConfig.args,
    ],
    cwd: context.workspacePath,
    env: {
      ...sanitizeChildEnvironment(process.env),
      ...buildSidecarEnv({
        sessionId: context.sessionId,
        workspacePath: context.workspacePath,
        model: context.model,
        providerID: context.providerID,
        providerBaseURL: context.providerBaseURL,
        sandboxMode: context.sandboxMode,
        approvalPolicy: context.approvalPolicy,
        approvalsReviewer: context.approvalsReviewer,
        permissionProfile: context.permissionProfile,
        configDirectoryPath: context.configDirectoryPath,
        debugConversationDump: context.debugConversationDump,
        thinkingMode: context.thinkingMode,
        systemPrompt: context.systemPrompt,
        appendSystemPrompt: context.appendSystemPrompt,
        additionalDirectories: context.additionalDirectories,
        installCodePilotXDependencies: context.installCodePilotXDependencies,
        enableMemory: context.enableMemory,
        runtimeEnvironment: context.toolchainEnvironment,
        reviewModel: context.reviewModel,
        smallFastModel: context.smallFastModel,
        fastModel: context.fastModel,
        defaultModel: context.defaultModel,
        deepModel: context.deepModel,
        sessionName: context.sessionName,
      }),
      // Explicitly override Rust state directories to use desktop config dir,
      // so Rust sidecar never inherits a stale path from env.
      ...(context.configDirectoryPath
        ? {
            CODEPILOTX_CONFIG_DIR: context.configDirectoryPath,
            CODEPILOTX_SQLITE_HOME: context.configDirectoryPath,
          }
        : {}),
    },
    startTimeoutMs: 15_000,
  }
}

type RustProviderConfigOverrides = {
  args: string[]
  env: Record<string, string | undefined>
}

async function createRustModelProviderOverrides(
  context: DesktopAgentRuntimeContext,
): Promise<RustProviderConfigOverrides> {
  const providerID = context.providerID?.trim()
  const model = context.model?.trim()
  if (!providerID) return { args: [], env: {} }
  if (!isRustConfigPathSegment(providerID)) {
    throw new Error(`Rust sidecar provider id is not supported: ${providerID}`)
  }

  const selectedProvider = await getProviderConfig(providerID)
  const providerConfigs = await listProviderConfigs()
  const providers = uniqueProvidersByID([selectedProvider, ...providerConfigs])
  desktopDebug('rust_provider_config', {
    providerID,
    wireApi: selectedProvider.wireApi ?? 'chat_completions',
    endpoint:
      context.providerBaseURL?.trim() ||
      selectedProvider.baseURL?.trim() ||
      null,
  })
  const providerOverrides = providers
    .filter(provider => {
      if (!isRustConfigPathSegment(provider.providerID)) return false
      return provider.providerID === providerID
    })
    .map(provider =>
      rustProviderConfigOverridesForProvider({
        provider,
        baseURL:
          provider.providerID === providerID
            ? context.providerBaseURL?.trim() || provider.baseURL?.trim()
            : provider.baseURL?.trim(),
      }),
    )

  const args = [
    ...(model ? rustConfigOverride('model', model) : []),
    ...rustConfigOverride('model_provider', providerID),
    ...providerOverrides.flatMap(override => override.args),
  ]
  return {
    args,
    env: Object.assign({}, ...providerOverrides.map(override => override.env)),
  }
}

function uniqueProvidersByID(providers: ProviderConfig[]): ProviderConfig[] {
  const result = new Map<string, ProviderConfig>()
  for (const provider of providers) {
    result.set(provider.providerID, provider)
  }
  return [...result.values()]
}

function rustProviderConfigOverridesForProvider({
  provider,
  baseURL,
}: {
  provider: ProviderConfig
  baseURL: string | undefined
}): RustProviderConfigOverrides {
  const providerID = provider.providerID
  const wireApi: ProviderWireApi = provider.wireApi ?? 'chat_completions'
  return {
    args: [
      ...rustConfigOverride(
        `model_providers.${providerID}.name`,
        provider.displayName || providerID,
      ),
      ...rustConfigOverride(
        `model_providers.${providerID}.wire_api`,
        wireApi,
      ),
      ...rustConfigOverride(
        `model_providers.${providerID}.requires_openai_auth`,
        false,
      ),
      ...rustConfigOverride(
        `model_providers.${providerID}.supports_websockets`,
        false,
      ),
      ...(baseURL
        ? rustConfigOverride(`model_providers.${providerID}.base_url`, baseURL)
        : []),
      ...rustConfigOverride(
        `model_providers.${providerID}.env_key`,
        `keyring:${providerID}`,
      ),
    ],
    env: {},
  }
}

function rustConfigOverride(
  key: string,
  value: string | boolean,
): string[] {
  return ['-c', `${key}=${formatRustConfigValue(value)}`]
}

function formatRustConfigValue(value: string | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function isRustConfigPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}

function normalizeOptionalRuntimeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Lifetime-managed Rust app-server process, JSON-RPC client, and workflow state.
 */
export class RustSidecarDesktopAgentRuntime implements DesktopAgentRuntime {
  private child: ChildProcess | null = null
  private rpcClient: RustLineJsonRpcClient | null = null
  private appServerClient: RustAppServerClient | null = null
  private workflowState: RustAppServerWorkflowState =
    createRustAppServerWorkflowState()
  private initialized = false
  private threadStarted = false
  private currentTurnPromise: Promise<void> | null = null
  private turnInProgress = false
  private currentTurnResolve: (() => void) | null = null
  private currentTurnReject: ((error: Error) => void) | null = null
  private currentTurnTerminal = false
  private activeRuntimeTurnId: string | null = null
  private readonly sealedRuntimeTurnIds = new Set<string>()
  private pendingTurnSignal: AbortSignal | null = null
  private disposeNotificationListener: (() => void) | null = null
  private disposeFatalTransportListener: (() => void) | null = null
  private disposeServerRequestHandlers: Array<() => void> | null = null
  private planModeActive = false
  private pendingServerRequest: {
    id: JsonRpcId
    method: string
    params: unknown
  } | null = null
  private lastInitResult: InitializeResponse | null = null
  private activeProviderID: string | undefined
  private activeProviderBaseURL: string | undefined
  private pendingProviderChange = false
  /** Guard against duplicate tool_start emissions per toolUseId */
  private emittedToolStartToolUseIds = new Set<string>()
  private disposePromise: Promise<void> | null = null
  private startupState: RustSidecarStartupState = 'stopped'
  private startupPromise: Promise<void> | null = null
  private cleanupPromise: Promise<void> | null = null

  constructor(private readonly context: DesktopAgentRuntimeContext) {}

  async setModel(model: string | undefined): Promise<void> {
    this.context.model = model
    await this.pushThreadSettings({ model: model ?? null })
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    const providerChanged =
      this.threadStarted &&
      (normalizeOptionalRuntimeText(providerID) !==
        normalizeOptionalRuntimeText(this.activeProviderID) ||
        normalizeOptionalRuntimeText(providerBaseURL) !==
          normalizeOptionalRuntimeText(this.activeProviderBaseURL))
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    this.context.model = model
    if (providerChanged) {
      this.pendingProviderChange = true
      desktopDebug('rust_provider_change_pending', {
        providerID: providerID ?? null,
        model: model ?? null,
      })
    }
  }

  async setPermissionMode(permissionMode: DesktopPermissionMode): Promise<void> {
    this.context.permissionMode = permissionMode
    const settings = settingsForPermissionMode(permissionMode, this.context)
    this.context.permissionProfile = settings.permissions ?? undefined
    this.context.approvalPolicy = (settings.approvalPolicy ?? undefined) as
      | DesktopAgentRuntimeContext['approvalPolicy']
    this.context.approvalsReviewer = (settings.approvalsReviewer ?? undefined) as
      | DesktopAgentRuntimeContext['approvalsReviewer']
    await this.pushThreadSettings(settings)
  }

  async setPlanModeActive(active: boolean): Promise<void> {
    this.planModeActive = active
    this.context.planModeActive = active
    this.context.collaborationMode = { mode: active ? 'plan' : 'default' }
    await this.pushThreadSettings({
      collaborationMode: this.context.collaborationMode,
    })
  }

  async steerUserTurn(
    content: DesktopUserMessageContent,
  ): Promise<'steered' | 'queueRequired'> {
    await this.ensureThreadLoaded()
    const expectedTurnId = this.workflowState.activeTurnId
    if (!expectedTurnId) return 'queueRequired'
    if (
      this.workflowState.activeTurnKind === 'review' ||
      this.workflowState.activeTurnKind === 'compact'
    ) {
      return 'queueRequired'
    }
    try {
      await this.appServerClient!.steerTurn({
        threadId: this.workflowState.threadId!,
        expectedTurnId,
        clientUserMessageId: randomUUID(),
        input: this.buildUserInputFromContent(content),
      })
      return 'steered'
    } catch (error) {
      if (isActiveTurnNotSteerable(error)) return 'queueRequired'
      throw error
    }
  }

  async runReview(
    target: import('../shared/types.js').DesktopAiReviewTarget,
    signal: AbortSignal,
  ): Promise<void> {
    await this.ensureThreadLoaded()
    this.workflowState.activeTurnKind = 'review'
    this.currentTurnPromise = new Promise<void>((resolve, reject) => {
      this.currentTurnResolve = resolve
      this.currentTurnReject = reject
    })
    this.pendingTurnSignal = signal
    const abortHandler = () => {
      this.interruptActiveTurn().catch(() => {})
    }
    signal.addEventListener('abort', abortHandler, { once: true })
    try {
      const response = await this.appServerClient!.startReview({
        threadId: this.workflowState.threadId!,
        delivery: 'inline',
        target: normalizeReviewTarget(target),
      })
      if (response.reviewThreadId !== this.workflowState.threadId) {
        throw new Error('AI 审查意外运行在独立 Thread。')
      }
      this.workflowState.activeTurnId = response.turn.id
      await this.currentTurnPromise
    } finally {
      this.currentTurnPromise = null
      this.currentTurnResolve = null
      this.currentTurnReject = null
      signal.removeEventListener('abort', abortHandler)
      this.pendingTurnSignal = null
    }
  }

  async compactThread(signal: AbortSignal): Promise<void> {
    await this.ensureThreadLoaded()
    if (this.workflowState.activeTurnId) {
      throw new Error('当前会话正在运行，无法压缩上下文。')
    }
    this.workflowState.activeTurnKind = 'compact'
    this.currentTurnPromise = new Promise<void>((resolve, reject) => {
      this.currentTurnResolve = resolve
      this.currentTurnReject = reject
    })
    this.pendingTurnSignal = signal
    const abortHandler = () => {
      this.interruptActiveTurn().catch(() => {})
    }
    signal.addEventListener('abort', abortHandler, { once: true })
    try {
      await this.appServerClient!.compactThread({
        threadId: this.workflowState.threadId!,
      })
      await this.currentTurnPromise
    } finally {
      this.currentTurnPromise = null
      this.currentTurnResolve = null
      this.currentTurnReject = null
      signal.removeEventListener('abort', abortHandler)
      this.pendingTurnSignal = null
    }
  }

  async getThreadGoal(): Promise<import('./rustAppServerProtocol/index.js').ThreadGoal | null> {
    await this.ensureThreadLoaded()
    const response = await this.appServerClient!.getThreadGoal({
      threadId: this.workflowState.threadId!,
    })
    return response.goal ?? null
  }

  async setThreadGoal(input: {
    objective?: string | null
    status?: import('../shared/types.js').DesktopThreadGoalStatus | null
  }): Promise<import('./rustAppServerProtocol/index.js').ThreadGoal> {
    await this.ensureThreadLoaded()
    const response = await this.appServerClient!.setThreadGoal({
      threadId: this.workflowState.threadId!,
      objective: input.objective ?? null,
      status: input.status as import('./rustAppServerProtocol/index.js').ThreadGoalStatus | null ?? null,
    })
    return response.goal
  }

  async clearThreadGoal(): Promise<boolean> {
    await this.ensureThreadLoaded()
    const response = await this.appServerClient!.clearThreadGoal({
      threadId: this.workflowState.threadId!,
    })
    return response.cleared
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
  }

  /**
   * Start the Rust sidecar server for probing and return available info.
   * The caller is responsible for calling dispose() after reading the result.
   *
   * Used by DebugToolProbeService to test Rust sidecar availability
   * without starting a full session turn.
   */
  async probeServer(): Promise<{
    userAgent: string
    /** @deprecated Use codepilotxHome instead */
    codexHome: string
    codepilotxHome: string
    platformFamily: string
    platformOs: string
  }> {
    await this.startAppServer()
    if (!this.lastInitResult) {
      throw new Error("Rust sidecar initialized without returning init result")
    }
    return {
      userAgent: this.lastInitResult.userAgent,
      codexHome: this.lastInitResult.codexHome,
      codepilotxHome: this.lastInitResult.codepilotxHome,
      platformFamily: this.lastInitResult.platformFamily,
      platformOs: this.lastInitResult.platformOs,
    }
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    // If there's already an active turn, reject (serial turns only for now)
    if (this.turnInProgress) {
      throw new Error(
        'Rust sidecar does not support concurrent turns. Wait for the current turn to complete.',
      )
    }

    this.turnInProgress = true
    this.currentTurnTerminal = false
    this.activeRuntimeTurnId = null

    this.pendingTurnSignal = signal
    const abortHandler = () => {
      this.interruptActiveTurn().catch(() => {})
    }
    signal.addEventListener('abort', abortHandler, { once: true })

    try {
      // Lazy startup is part of this turn: every startup failure must produce
      // the same single terminal error as a turn/start transport failure.
      if (!this.initialized) {
        await this.startAppServer()
      }

      // Reset workflow state for new turn
      this.workflowState.assistantDeltaBuffer = ''

      // Build UserInput[] from structured content (text + optional attachments)
      const input = this.buildUserInputFromContent(content)

      await this.applyPendingProviderChange()

      // Only create the notification completion promise after startup/provider
      // work succeeds, so a startup child exit cannot reject an unobserved
      // promise.
      this.currentTurnPromise = new Promise<void>((resolve, reject) => {
        this.currentTurnResolve = resolve
        this.currentTurnReject = reject
      })
      // startTurn and the transport fatal path can reject in the same tick.
      // Observe the completion promise immediately while preserving the later
      // await on the original promise when turn/start succeeds.
      void this.currentTurnPromise.catch(() => undefined)

      // Send turn/start with the converted input
      const turnResult = await this.appServerClient!.startTurn({
        threadId: this.workflowState.threadId!,
        input,
        model: this.context.model ?? undefined,
      })
      this.activeRuntimeTurnId = turnResult.turn.id

      await this.currentTurnPromise
    } catch (error) {
      this.emitCurrentTurnError(
        error instanceof Error ? error : new Error(String(error)),
      )
      throw error
    } finally {
      this.turnInProgress = false
      this.currentTurnPromise = null
      this.currentTurnResolve = null
      this.currentTurnReject = null
      signal.removeEventListener('abort', abortHandler)
      this.pendingTurnSignal = null
    }
  }

  /**
   * Convert the structured UserMessage (text + optional attachments) into
   * the Rust v2 protocol UserInput[] format.
   *
   * Conversion rules:
   * - image    → { type: 'image', url: dataUrl, detail: 'auto' } or localImage
   * - document → { type: 'document', data, mediaType, name }
   * - text     → { type: 'textFile', text, mediaType, name }
   * - audio    → { type: 'audio', data, mediaType, name }
   * - video    → { type: 'video', data, mediaType, name }
   * - binary   → { type: 'file', data, mediaType, name }
   */
  private buildUserInputFromContent(
    content: DesktopUserMessageContent,
  ): UserInput[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content, text_elements: [] }]
    }

    const input: UserInput[] = []

    // Add text block
    if (content.text) {
      input.push({ type: 'text', text: content.text, text_elements: [] })
    }

    // Convert each attachment to the appropriate UserInput variant
    for (const attachment of content.attachments ?? []) {
      input.push(this.attachmentToUserInput(attachment))
    }

    return input
  }

  private attachmentToUserInput(attachment: Attachment): UserInput {
    switch (attachment.kind) {
      case 'image': {
        // If contentBase64 is available, construct a data URL
        if (attachment.contentBase64 && attachment.mediaType) {
          const dataUrl = `data:${attachment.mediaType};base64,${attachment.contentBase64}`
          return { type: 'image', url: dataUrl, detail: 'auto' }
        }
        // Fall back to localImage path if no base64 content
        return { type: 'localImage', path: attachment.path, detail: 'auto' }
      }

      case 'text': {
        return {
          type: 'textFile',
          text: attachment.textContent ?? '',
          mediaType: attachment.mediaType,
          name: attachment.name,
        }
      }

      case 'document':
        return {
          type: 'document',
          data: this.requireAttachmentBase64(attachment),
          mediaType: attachment.mediaType,
          name: attachment.name,
        }

      case 'audio':
        return {
          type: 'audio',
          data: this.requireAttachmentBase64(attachment),
          mediaType: attachment.mediaType,
          name: attachment.name,
        }

      case 'video':
        return {
          type: 'video',
          data: this.requireAttachmentBase64(attachment),
          mediaType: attachment.mediaType,
          name: attachment.name,
        }

      case 'binary':
        return {
          type: 'file',
          data: this.requireAttachmentBase64(attachment),
          mediaType: attachment.mediaType,
          name: attachment.name,
        }

      default:
        throw new Error(
          `Unknown attachment kind: ${(attachment as { kind: string }).kind}`,
        )
    }
  }

  private requireAttachmentBase64(attachment: Attachment): string {
    if (attachment.contentBase64) return attachment.contentBase64
    throw new Error(
      `Attachment "${attachment.name}" (${attachment.mediaType}) is missing readable content.`,
    )
  }

  async runControlResponse(
    response: Record<string, unknown>,
    _signal: AbortSignal,
  ): Promise<void> {
    // Permission requests are now handled directly in handlePermissionRequest
    // via context.requestPermission(). Tool calls use async execution +
    // notifyToolResult. runControlResponse is required by the interface but
    // not needed for the normal Rust sidecar permission/tool flow.
    // It may be needed in the future for AskUserQuestion recovery or similar
    // control flows.
    desktopDebug('rust_control_response_unexpected', {
      keys: Object.keys(response),
    })

    // Still handle any pending server request (e.g., from edge cases)
    const ctrlResponse = response.response as Record<string, unknown> | undefined
    if (ctrlResponse && this.pendingServerRequest) {
      const subtype = ctrlResponse.subtype
      if (subtype === 'success') {
        const decision = ctrlResponse.response as Record<string, unknown> | undefined
        this.appServerClient?.sendControlResponse(this.pendingServerRequest.id, {
          behavior: 'allow',
          ...(decision ?? {}),
        })
        this.pendingServerRequest = null
        return
      }
      if (subtype === 'error') {
        this.appServerClient?.sendControlResponse(this.pendingServerRequest.id, {
          behavior: 'deny',
          error: String(ctrlResponse.error ?? 'Permission denied'),
        })
        this.pendingServerRequest = null
        return
      }
    }

    // Direct response (without wrapping)
    if (this.pendingServerRequest && typeof response.behavior === 'string') {
      this.appServerClient?.sendControlResponse(
        this.pendingServerRequest.id,
        response,
      )
      this.pendingServerRequest = null
      return
    }

    // Unknown control response format
    throw new Error(
      `Rust sidecar control response not supported in current architecture: ${JSON.stringify(response).slice(0, 200)}`,
    )
  }

  getMcpRuntimeStatus(): {
    servers: Array<{
      name: string
      scope: string
      type: string
      status: 'connected' | 'failed' | 'pending' | 'disabled' | 'unsupported'
      error?: string
      toolCount: number
      resourceCount: number
      promptCount: number
    }>
    totalTools: number
    totalResources: number
    totalPrompts: number
  } {
    return { servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }
  }

  /**
   * Tell the app-server to re-read MCP server config from disk.
   *
   * Returns 'not_loaded' when the sidecar has not been started (the
   * session has never run a user turn); the config will be read
   * naturally on the next thread start.
   */
  async refreshMcpConfig(): Promise<'refreshed' | 'not_loaded'> {
    if (!this.appServerClient) return 'not_loaded'
    await this.appServerClient.reloadMcpConfig()
    return 'refreshed'
  }

  /**
   * Tear down the child process and transport.
   */
  async dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = this.disposeOnce()
    }
    await this.disposePromise
  }

  private emitCurrentTurnError(error: Error): void {
    if (this.currentTurnTerminal) return
    this.currentTurnTerminal = true
    const turnId = this.activeRuntimeTurnId ?? this.workflowState.activeTurnId
    if (turnId) this.sealedRuntimeTurnIds.add(turnId)
    this.context.emit({
      type: 'error',
      sessionId: this.context.sessionId,
      message: error.message,
    })
  }

  private async disposeOnce(): Promise<void> {
    this.currentTurnReject?.(
      new Error('Rust sidecar runtime disposed during an active turn.'),
    )
    this.currentTurnReject = null

    await this.cleanupAppServer()
    this.startupState = 'stopped'
    this.initialized = false
    this.threadStarted = false
    this.activeProviderID = undefined
    this.activeProviderBaseURL = undefined
    this.pendingProviderChange = false
    this.emittedToolStartToolUseIds.clear()
  }

  // ── Private ───────────────────────────────────────────────────────

  private async startAppServer(): Promise<void> {
    if (this.startupState === 'ready') return
    if (this.startupState === 'starting' && this.startupPromise) {
      await this.startupPromise
      return
    }
    if (this.startupState === 'failed') {
      await this.cleanupAppServer()
    }

    this.startupState = 'starting'
    const attempt = this.startAppServerAttempt()
    this.startupPromise = attempt
    try {
      await attempt
      this.startupState = 'ready'
    } catch (error) {
      this.startupState = 'failed'
      await this.cleanupAppServer()
      throw error
    } finally {
      if (this.startupPromise === attempt) {
        this.startupPromise = null
      }
    }
  }

  private async startAppServerAttempt(): Promise<void> {
    const executableInfo = resolveRustAppServerExecutableInfo()
    const executablePath = executableInfo.path
    desktopDebug('rust_sidecar_start', {
      executable: executablePath,
      executableSource: executableInfo.source,
      cwd: this.context.workspacePath,
      providerID: this.context.providerID ?? null,
      model: this.context.model ?? null,
    })

    if (!existsSync(executablePath)) {
      throw new SidecarStartError(
        `Rust app-server binary not found at: ${executablePath}. ` +
          `Build it with "cargo build -p codepilotx-app-server" in rust/codex-rs, ` +
          `or set ${RUST_APP_SERVER_BINARY_ENV} to a codepilotx-app-server binary.`,
      )
    }

    const options = await createRustSidecarOptions(this.context)

    // 1. Spawn child process
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    // Forward stderr to debug
    child.stderr?.on('data', (chunk: Buffer) => {
      desktopDebug('rust_sidecar_stderr', {
        text: chunk.toString('utf8').slice(0, 2000),
      })
    })

    // Handle unexpected exit
    child.on('exit', (code, signal) => {
      desktopDebug('rust_sidecar_exit', { code, signal })
      this.currentTurnReject?.(
        new Error(
          `Rust app-server exited unexpectedly (code=${code}, signal=${signal})`,
        ),
      )
      if (this.child === child) {
        this.initialized = false
        this.threadStarted = false
        this.startupState = 'failed'
      }
    })

    child.on('error', (err) => {
      desktopDebug('rust_sidecar_error', {
        message: err.message,
      })
      this.currentTurnReject?.(err)
      if (this.child === child) {
        this.initialized = false
        this.threadStarted = false
        this.startupState = 'failed'
      }
    })

    // 2. Create transport
    this.rpcClient = new RustLineJsonRpcClient({
      input: child.stdout!,
      output: child.stdin!,
    })
    this.disposeFatalTransportListener = this.rpcClient.onFatalError(error => {
      this.handleFatalTransport(error)
    })
    this.appServerClient = new RustAppServerClient(this.rpcClient)

    // 3. Wire up notification handler
    this.disposeNotificationListener = this.appServerClient.onServerNotification(
      (method, params) => {
        this.handleNotification(method, params)
      },
    )

    // 4. Wire up server request handlers (tool calls, permissions, etc.)
    this.setupServerRequestHandlers()

    // 5. Initialize
    const initResult = await this.appServerClient.initialize(
      buildRustInitializeParams(),
    )
    this.lastInitResult = initResult
    desktopDebug('rust_sidecar_initialized', {
      userAgent: initResult.userAgent,
    })

    // 6. Send initialized notification
    this.appServerClient.notifyInitialized()
    this.initialized = true

    // 7. Start thread. Built-in tools (including request_user_input)
    //    are handled natively by the Rust app-server's internal tool
    //    registry — no client-side dynamic tools are registered here.
    const persistedThreadId = normalizeOptionalRuntimeText(this.context.appServerThreadId)
    const threadResult = await this.startOrResumeThread(persistedThreadId)
    this.workflowState.threadId = threadResult.thread.id
    this.threadStarted = true
    this.activeProviderID = this.context.providerID
    this.activeProviderBaseURL = this.context.providerBaseURL
    desktopDebug('rust_sidecar_thread_started', {
      threadId: this.workflowState.threadId,
    })
    this.context.onAppServerThreadId?.(threadResult.thread.id)
  }

  private async ensureThreadLoaded(): Promise<void> {
    if (!this.initialized) await this.startAppServer()
    if (!this.appServerClient || !this.workflowState.threadId) {
      throw new Error('Rust app-server thread is not available.')
    }
  }

  private async pushThreadSettings(
    patch: Omit<ThreadSettingsUpdateParams, 'threadId'>,
  ): Promise<void> {
    if (!this.initialized || !this.appServerClient || !this.workflowState.threadId) {
      return
    }
    try {
      await this.appServerClient.updateThreadSettings({
        threadId: this.workflowState.threadId,
        ...patch,
      })
    } catch (error) {
      if (isUnsupportedThreadSettingsUpdate(error)) {
        desktopDebug('rust_thread_settings_update_deferred', {
          keys: Object.keys(patch),
        })
        return
      }
      throw error
    }
  }

  private cleanupAppServer(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.cleanupAppServerOnce().finally(() => {
        this.cleanupPromise = null
      })
    }
    return this.cleanupPromise
  }

  private handleFatalTransport(error: Error): void {
    this.currentTurnReject?.(error)
    this.initialized = false
    this.threadStarted = false
    this.startupState = 'failed'
    void this.cleanupAppServer().catch(cleanupError => {
      desktopDebug('rust_sidecar_transport_cleanup_failed', {
        message:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      })
    })
  }

  private async cleanupAppServerOnce(): Promise<void> {
    this.disposeFatalTransportListener?.()
    this.disposeFatalTransportListener = null
    this.disposeNotificationListener?.()
    this.disposeNotificationListener = null
    this.disposeServerRequestHandlers?.forEach(dispose => dispose())
    this.disposeServerRequestHandlers = null

    const child = this.child
    this.appServerClient?.close()
    this.appServerClient = null
    this.rpcClient = null
    if (child) {
      await terminateChildProcess(child)
    }
    if (this.child === child) {
      this.child = null
    }
    this.initialized = false
    this.threadStarted = false
  }

  private async startOrResumeThread(
    persistedThreadId: string | null,
  ): Promise<ThreadStartResponse | ThreadResumeResponse> {
    if (!this.appServerClient) {
      throw new Error('Rust app-server client is not initialized')
    }
    if (!persistedThreadId) {
      return this.appServerClient.startThread(this.buildThreadStartParams())
    }

    try {
      return await this.appServerClient.resumeThread(this.buildThreadResumeParams())
    } catch (error) {
      desktopDebug('rust_sidecar_thread_resume_failed', {
        threadId: persistedThreadId,
        message: error instanceof Error ? error.message : String(error),
      })
      // A persisted id can outlive the server's state DB. Start a fresh
      // persistent thread so the session remains usable and gets a new id.
      return this.appServerClient.startThread(this.buildThreadStartParams())
    }
  }

  private async applyPendingProviderChange(): Promise<void> {
    if (!this.pendingProviderChange) return
    if (!this.appServerClient || !this.workflowState.threadId) return

    const previousThreadId = this.workflowState.threadId
    desktopDebug('rust_provider_change_fork_start', {
      threadId: previousThreadId,
      providerID: this.context.providerID ?? null,
      model: this.context.model ?? null,
    })
    const forkResult = await this.appServerClient.forkThread({
      threadId: previousThreadId,
      model: this.context.model ?? undefined,
      modelProvider: this.context.providerID ?? undefined,
      cwd: this.context.workspacePath,
      ephemeral: true,
    })
    this.workflowState.threadId = forkResult.thread.id
    this.activeProviderID = this.context.providerID
    this.activeProviderBaseURL = this.context.providerBaseURL
    this.pendingProviderChange = false
    desktopDebug('rust_provider_change_fork_done', {
      previousThreadId,
      threadId: this.workflowState.threadId,
      providerID: this.activeProviderID ?? null,
      model: this.context.model ?? null,
    })
  }

  private handleNotification(method: string, params: unknown): void {
	    const notificationTurnId = rustNotificationTurnId(params)
	    if (
	      notificationTurnId &&
	      (this.sealedRuntimeTurnIds.has(notificationTurnId) ||
	        (this.activeRuntimeTurnId !== null &&
	          notificationTurnId !== this.activeRuntimeTurnId))
	    ) {
	      return
	    }
	    if (method === 'turn/started' && notificationTurnId) {
	      this.activeRuntimeTurnId = notificationTurnId
	    }
	    if (method === 'thread/settings/updated') {
	      const notification = params as ThreadSettingsUpdatedNotification
	      if (notification?.threadId === this.workflowState.threadId) {
	        this.context.onThreadSettingsUpdated?.(notification.threadSettings)
	      }
	    }
	    if (method === 'thread/goal/updated') {
	      const notification = params as {
	        threadId: string
	        turnId: string | null
	        goal: import('./rustAppServerProtocol/index.js').ThreadGoal
	      }
	      if (notification?.threadId === this.workflowState.threadId) {
	        this.context.onThreadGoalUpdated?.(notification.goal)
	      }
	    }
	    if (method === 'thread/goal/cleared') {
	      const notification = params as { threadId: string }
	      if (notification?.threadId === this.workflowState.threadId) {
	        this.context.onThreadGoalCleared?.()
	      }
	    }
	    handleServerNotification(
	      method,
	      params,
	      (event: DesktopAgentEvent) => {
	        if (
	          (event.type === 'done' || event.type === 'error') &&
	          this.currentTurnTerminal
	        ) {
	          return
	        }
	        if (event.type === 'done' || event.type === 'error') {
	          this.currentTurnTerminal = true
	          const terminalTurnId =
	            notificationTurnId ?? this.activeRuntimeTurnId
	          if (terminalTurnId) {
	            this.sealedRuntimeTurnIds.add(terminalTurnId)
	          }
	        }
	        this.context.emit(event)

	        if (event.type === 'done') {
	          this.emittedToolStartToolUseIds.clear()
	          this.currentTurnResolve?.()
	        } else if (event.type === 'error') {
	          this.emittedToolStartToolUseIds.clear()
	          this.currentTurnReject?.(
	            new Error(
	              typeof event.message === 'string'
	                ? event.message
	                : 'Rust app-server turn error',
	            ),
	          )
	        }
	      },
	      this.workflowState,
	      this.context.sessionId,
	      { model: this.context.model, providerID: this.context.providerID },
	    )
  }

  /**
   * Register handlers for server-initiated JSON-RPC requests.
   * These handle tool execution and permission approval flows.
   */
  private setupServerRequestHandlers(): void {
    if (!this.appServerClient) return
    const disposers: Array<() => void> = []

    // Dynamic tool call — server asks client to execute a tool
    disposers.push(
      this.appServerClient.onServerRequest(
        'item/tool/call',
        async (params, id) => this.handleToolCallRequest(params, id),
      ),
    )

    // Permission approval requests
    for (const method of [
      'item/permissions/requestApproval',
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
    ]) {
      disposers.push(
        this.appServerClient.onServerRequest(
          method,
          async (params, id) => this.handlePermissionRequest(params, id, method),
        ),
      )
    }

    // MCP elicitation requests (tool + resource request for MCP servers)
    disposers.push(
      this.appServerClient.onServerRequest(
        'mcpServer/elicitation/request',
        async (params, id) => this.handleMcpElicitationRequest(params, id),
      ),
    )

    // User input request — server asks client to ask the user questions
    disposers.push(
      this.appServerClient.onServerRequest(
        'item/tool/requestUserInput',
        async (params, id) => this.handleRequestUserInputRequest(params, id),
      ),
    )

    this.disposeServerRequestHandlers = disposers
  }

  /**
   * Handle item/tool/requestUserInput — server asks client to prompt the user.
   * Maps to the desktop AskUserQuestion flow via requestPermission.
   *
   * BATCH SEMANTICS: All questions are sent in a single permission request
   * via input.questions (array). The renderer submits answers keyed by
   * question id (preferred) or question text (fallback). A legacy single
   * answer field (updatedInput.answer) is also checked for backward
   * compatibility.
   */
  private async handleRequestUserInputRequest(
    params: unknown,
    _requestId: JsonRpcId,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null
    const itemId = String(p?.itemId ?? '')
    const questions = (p?.questions as ToolRequestUserInputQuestion[]) ?? []

    desktopDebug('rust_request_user_input', {
      questionCount: questions.length,
      itemId,
    })

    // Batch all questions into a single permission request
    const permissionRequest: DesktopPermissionRequest = {
      requestId: `rust-ask-${randomUUID()}`,
      toolName: 'AskUserQuestion',
      toolUseId: itemId,
      input: {
        questions: questions.map(q => ({
          id: q.id,
          question: q.question,
          header: q.header,
          options: q.options,
          isOther: q.isOther,
          isSecret: q.isSecret,
        })),
      },
      description: questions.length > 0
        ? String(questions[0]!.question ?? '').slice(0, 200)
        : '用户输入请求',
    }

    const decision = await this.context.requestPermission(permissionRequest)

    if (decision.behavior === 'deny') {
      const answers: Record<string, ToolRequestUserInputAnswer> = {}
      for (const question of questions) {
        answers[question.id] = { answers: ['[User declined to answer]'] }
      }
      return { answers }
    }

    // Read answers — try updatedInput.answers (keyed by id or question text),
    // then fall back to legacy updatedInput.answer (single-question field).
    const updatedInput = (decision.updatedInput ?? {}) as Record<string, unknown>
    const answers: Record<string, ToolRequestUserInputAnswer> = {}

    for (const question of questions) {
      const answerText = this.resolveAskUserAnswer(updatedInput, question)
      answers[question.id] = { answers: [answerText] }
    }

    return { answers }
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Resolve a single question's answer text from the renderer's
   * updatedInput record.
   *
   * Priority:
   *  1. updatedInput.answers[question.id]         (new batch format by id)
   *  2. updatedInput.answers[question.question]    (batch format by question text)
   *  3. updatedInput.answer                       (legacy single-question field)
   */
  private resolveAskUserAnswer(
    updatedInput: Record<string, unknown>,
    question: ToolRequestUserInputQuestion,
  ): string {
    // Try updatedInput.answers sub-record first
    const answersRecord = (
      typeof updatedInput.answers === 'object' && updatedInput.answers !== null && !Array.isArray(updatedInput.answers)
        ? updatedInput.answers
        : {}
    ) as Record<string, unknown>

    const candidates = [question.id, question.question]
    for (const key of candidates) {
      if (!key) continue
      const value = answersRecord[key]
      if (typeof value === 'string') return value
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
        return (value as string[]).join(', ')
      }
    }

    // Legacy single-question field
    if (typeof updatedInput.answer === 'string') {
      return updatedInput.answer
    }

    return ''
  }

  /**
   * Build thread start parameters without any client-side dynamic tools.
   * The Rust app-server handles all built-in tools (including
   * request_user_input) natively via its internal tool registry;
   * no dynamic tool registration is needed from the desktop client.
   */
  private buildThreadStartParams(): ThreadStartParams {
    return {
      model: this.context.model ?? undefined,
      modelProvider: this.context.providerID ?? undefined,
      cwd: this.context.workspacePath,
      approvalPolicy: this.context.approvalPolicy ?? undefined,
      sandbox: this.context.permissionProfile ?? undefined,
      ephemeral: false,
    }
  }

  private buildThreadResumeParams(): ThreadResumeParams {
    return {
      threadId: normalizeOptionalRuntimeText(this.context.appServerThreadId) ?? '',
      cwd: this.context.workspacePath,
      model: this.context.model ?? undefined,
      modelProvider: this.context.providerID ?? undefined,
      approvalPolicy: this.context.approvalPolicy ?? undefined,
      approvalsReviewer: this.context.approvalsReviewer ?? undefined,
      sandbox: this.context.permissionProfile ?? undefined,
      collaborationMode: this.context.collaborationMode ?? undefined,
    }
  }

  private async handleToolCallRequest(
    params: unknown,
    _requestId: JsonRpcId,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null
    // v2 protocol fields only — no old fallback names
    const toolName = String(p?.tool ?? 'Tool')
    const toolUseId = String(p?.callId ?? '')
    const toolArgs = p?.arguments ?? {}

    desktopDebug('rust_tool_call_request', {
      toolName,
      toolUseId,
      namespace: p?.namespace as string | undefined,
    })

    // Guard: item/started notification already emits tool_start via adapter.
    // Avoid emitting a second tool_start for the same toolUseId here.
    if (!this.emittedToolStartToolUseIds.has(toolUseId)) {
      this.emittedToolStartToolUseIds.add(toolUseId)
      this.context.emit({
        type: 'tool_start',
        sessionId: this.context.sessionId,
        toolName,
        summary: JSON.stringify(toolArgs).slice(0, 500),
        toolUseId,
      })
    }

    // Dispatch to client-side tool handler if registered as a dynamic tool;
    // otherwise return success: false so the Rust server knows this tool
    // is not handled client-side (it should handle built-in tools internally).
    return this.executeDesktopTool(toolName, toolArgs, toolUseId)
  }

  private async handlePermissionRequest(
    params: unknown,
    _requestId: JsonRpcId,
    method: string,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null

    desktopDebug('rust_permission_request', {
      method,
      paramKeys: p ? Object.keys(p) : [],
    })

    // Build DesktopPermissionRequest using existing helper from agentRuntime
    const requestId = `rust-perm-${randomUUID()}`
    const controlRequest = this.buildPermissionControlRequest(method, p)
    const permissionRequest = buildDesktopPermissionRequestFromControlRequest(
      requestId,
      controlRequest,
    )

    // Show permission dialog and await user decision (blocks the JSON-RPC
    // handler until the user responds — other messages can still be processed
    // since the event loop keeps running during async/await)
    const decision = await this.context.requestPermission(permissionRequest)

    // Map decision back to Rust protocol response type
    return this.mapPermissionDecision(method, decision, p)
  }

  /**
   * Handle MCP elicitation request — server asks client to elicit input
   * from an MCP server (e.g., a form fill or tool selection request).
   */
  private async handleMcpElicitationRequest(
    params: unknown,
    _requestId: JsonRpcId,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null
    const serverName = p?.serverName as string | undefined

    desktopDebug('rust_mcp_elicitation_request', {
      serverName,
      requestKeys: p?.request ? Object.keys(p.request as Record<string, unknown>) : [],
    })

    // Build DesktopPermissionRequest for MCP elicitation
    const request = p?.request ?? {
      mode: p?.mode,
      message: p?.message,
      requestedSchema: p?.requestedSchema,
      _meta: p?._meta,
      url: p?.url,
      elicitationId: p?.elicitationId,
    }
    const permissionRequest: DesktopPermissionRequest = {
      requestId: `rust-mcp-${randomUUID()}`,
      toolName: 'McpElicitation',
      toolUseId: p?.turnId as string | undefined,
      input: {
        serverName,
        request,
      },
      description: serverName
        ? `MCP 服务器 "${serverName}" 请求输入`
        : 'MCP 服务器请求输入',
    }

    // Ask user for permission
    const decision = await this.context.requestPermission(permissionRequest)

    const behavior = compatiblePermissionBehavior(decision)
    const updatedInput = decision.updatedInput
    if (behavior === 'cancel' || updatedInput?.cancelled === true || updatedInput?.action === 'cancel') {
      return { action: 'cancel', content: null, _meta: null }
    }
    if (behavior === 'deny') {
      return { action: 'decline', content: null, _meta: null }
    }

    return {
      action: 'accept',
      content: extractMcpSubmittedContent(updatedInput),
      _meta: null,
    }
  }

  /**
   * Map raw server notification to protocol-specific control request record
   * suitable for buildDesktopPermissionRequestFromControlRequest.
   */
  private buildPermissionControlRequest(
    method: string,
    p: Record<string, unknown> | null,
  ): Record<string, unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval':
        return {
          tool_name: 'Bash',
          tool_use_id: p?.itemId ?? null,
          input: {
            command: p?.command,
            cwd: p?.cwd,
            reason: p?.reason,
          },
          description: p?.command
            ? `运行命令: ${String(p.command).slice(0, 200)}`
            : '执行命令',
        }
      case 'item/fileChange/requestApproval':
        return {
          tool_name: 'ApplyPatch',
          tool_use_id: p?.itemId ?? null,
          input: {
            filePath: p?.filePath,
            changes: p?.changes,
          },
          description: '修改文件',
        }
      case 'item/permissions/requestApproval':
      default:
        return {
          tool_name: 'Permissions',
          tool_use_id: p?.itemId ?? null,
          input: {
            permissions: p?.permissions,
            reason: p?.reason,
          },
          description:
            typeof p?.reason === 'string' ? p.reason : '请求权限',
        }
    }
  }

  /**
   * Map DesktopPermissionDecision back to Rust protocol response type.
   */
  private mapPermissionDecision(
    method: string,
    decision: DesktopPermissionDecision,
    requestParams?: Record<string, unknown> | null,
  ): unknown {
    const behavior = compatiblePermissionBehavior(decision)
    const allowed = behavior === 'allow'
    const cancelled = behavior === 'cancel' || isPermissionDecisionCancelled(decision)

    switch (method) {
      case 'item/commandExecution/requestApproval':
        return {
          decision: cancelled
            ? 'cancel'
            : allowed && decision.rememberOptionId === 'session'
              ? 'acceptForSession'
              : allowed
                ? 'accept'
                : 'decline',
        }
      case 'item/fileChange/requestApproval':
        return {
          decision: cancelled
            ? 'cancel'
            : allowed && decision.rememberOptionId === 'session'
              ? 'acceptForSession'
              : allowed
                ? 'accept'
                : 'decline',
        }
      case 'item/permissions/requestApproval':
      default:
        const requestedPermissions = isRecord(requestParams?.permissions)
          ? requestParams.permissions
          : {}
        const permissions: Record<string, unknown> = {}
        for (const key of ['fileSystem', 'network']) {
          const value = requestedPermissions[key]
          if (value !== null && value !== undefined) permissions[key] = value
        }
        return {
          permissions: allowed ? permissions : {},
          scope: allowed && decision.rememberOptionId === 'session'
            ? 'session' as const
            : 'turn' as const,
        }
    }
  }

  /**
   * Handle a tool call request from the Rust app-server that was not
   * handled natively by the server.
   *
   * The Rust server handles all built-in tools (Bash, Read, Write, Edit,
   * request_user_input, etc.) natively via its internal tool registry.
   * No client-side dynamic tools are registered at thread start, so any
   * tool call arriving here is unexpected — return success: false so the
   * server knows this tool is not handled client-side.
   */
  private async executeDesktopTool(
    toolName: string,
    args: unknown,
    _toolUseId: string,
  ): Promise<DynamicToolCallResponse> {
    return {
      contentItems: [
        {
          type: 'inputText' as const,
          text: `Tool "${toolName}" is not a registered client-side dynamic tool. ` +
            `The Rust app-server should handle this tool internally.`,
        },
      ],
      success: false,
    }
  }

  private async interruptActiveTurn(): Promise<void> {
    if (
      !this.appServerClient ||
      !this.workflowState.threadId ||
      !this.workflowState.activeTurnId
    ) {
      // If there's no active turn to interrupt but the turn promise is still
      // pending, resolve it so the UI doesn't hang.
      this.completeInterruptedTurn()
      return
    }
    try {
      await this.appServerClient.interruptTurn({
        threadId: this.workflowState.threadId,
        turnId: this.workflowState.activeTurnId,
      })
      // Resolve the turn promise immediately on successful interrupt response,
      // rather than waiting for a delayed turn/completed notification.
      this.completeInterruptedTurn()
    } catch (err) {
      desktopDebug('rust_sidecar_interrupt_failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      // Safety net: resolve so the UI clears even if the interrupt RPC fails.
      this.completeInterruptedTurn()
    }
  }

  private completeInterruptedTurn(): void {
    if (this.currentTurnTerminal) return
    this.currentTurnTerminal = true
    const turnId = this.activeRuntimeTurnId ?? this.workflowState.activeTurnId
    if (turnId) this.sealedRuntimeTurnIds.add(turnId)
    this.context.emit({ type: 'done', sessionId: this.context.sessionId })
    this.currentTurnResolve?.()
  }
}

function rustNotificationTurnId(params: unknown): string | null {
  if (!isRecord(params)) return null
  const turn = params.turn
  if (isRecord(turn) && typeof turn.id === 'string') return turn.id
  return typeof params.turnId === 'string' ? params.turnId : null
}

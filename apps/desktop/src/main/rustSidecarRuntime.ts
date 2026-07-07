import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getProviderApiKey,
  getProviderConfig,
  type ProviderConfig,
  type ProviderWireApi,
} from '@codepilotx/core/models/providerConfig.js'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import type {
  DesktopUserMessageContent,
  DesktopPermissionMode,
} from '../shared/types.js'
import type { DesktopAgentEvent } from '../shared/types.js'
import {
  SidecarStartError,
  buildSidecarEnv,
  type SidecarManagerOptions,
} from './sidecarManager.js'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import { RustAppServerClient } from './rustAppServerClient.js'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import type { JsonRpcId } from './rustLineJsonRpcClient.js'
import { desktopDebug } from './desktopDebug.js'

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

export function resolveRustAppServerExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveRustAppServerExecutableInfo(env).path
}

export function resolveRustAppServerExecutableInfo(
  env: NodeJS.ProcessEnv = process.env,
): RustAppServerExecutableInfo {
  const binaryName = process.platform === 'win32'
    ? 'codex-app-server.exe'
    : 'codex-app-server'
  const explicitPath = env[RUST_APP_SERVER_BINARY_ENV]?.trim()
  if (explicitPath && !isReferenceCodexMainAppServerPath(explicitPath)) {
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

function isReferenceCodexMainAppServerPath(path: string): boolean {
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
      ...providerConfig.args,
    ],
    cwd: context.workspacePath,
    env: {
      ...process.env,
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
        installCodexDependencies: context.installCodexDependencies,
        enableMemory: context.enableMemory,
        runtimeEnvironment: context.toolchainEnvironment,
        reviewModel: context.reviewModel,
        smallFastModel: context.smallFastModel,
        fastModel: context.fastModel,
        defaultModel: context.defaultModel,
        deepModel: context.deepModel,
        sessionName: context.sessionName,
      }),
      ...providerConfig.env,
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

  const provider = await getProviderConfig(providerID)
  const baseURL = context.providerBaseURL?.trim() || provider.baseURL?.trim()
  const envKey = getRustProviderEnvKey(provider)
  // Use wireApi resolved by core provider config — no local DeepSeek check needed.
  const wireApi: ProviderWireApi = provider.wireApi ?? 'chat_completions'
  const apiKey = getProviderApiKey(providerID)?.trim()
  desktopDebug('rust_provider_config', {
    providerID,
    wireApi,
    endpoint: baseURL || provider.baseURL || null,
  })
  const args = [
    ...(model ? rustConfigOverride('model', model) : []),
    ...rustConfigOverride('model_provider', providerID),
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
    ...(envKey
      ? rustConfigOverride(`model_providers.${providerID}.env_key`, envKey)
      : []),
  ]
  return {
    args,
    env: envKey && apiKey ? { [envKey]: apiKey } : {},
  }
}

function getRustProviderEnvKey(provider: ProviderConfig): string | undefined {
  return (
    provider.envVars?.find(value => Boolean(value?.trim())) ??
    provider.apiKeyEnvVar?.trim() ??
    undefined
  )
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
  private currentTurnResolve: (() => void) | null = null
  private currentTurnReject: ((error: Error) => void) | null = null
  private pendingTurnSignal: AbortSignal | null = null
  private disposeNotificationListener: (() => void) | null = null
  private disposeServerRequestHandlers: Array<() => void> | null = null
  private pendingServerRequest: {
    id: JsonRpcId
    method: string
    params: unknown
  } | null = null

  constructor(private readonly context: DesktopAgentRuntimeContext) {}

  setModel(model: string | undefined): void {
    this.context.model = model
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    this.setModel(model)
  }

  setPermissionMode(_permissionMode: DesktopPermissionMode): void {}

  setPlanModeActive(_active: boolean): void {}

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    // Reject non-text input for first version
    if (typeof content !== 'string') {
      throw new Error('Rust sidecar currently supports text-only turns.')
    }

    // Lazy startup: spawn & initialize on first turn
    if (!this.initialized) {
      await this.startAppServer()
    }

    // If there's already an active turn, reject (serial turns only for now)
    if (this.currentTurnPromise) {
      throw new Error(
        'Rust sidecar does not support concurrent turns. Wait for the current turn to complete.',
      )
    }

    // Turn promise that resolves/rejects when turn/completed or error arrives
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
      // Reset workflow state for new turn
      this.workflowState.assistantDeltaBuffer = ''

      // Send turn/start with text input
      const text = content
      await this.appServerClient!.startTurn({
        threadId: this.workflowState.threadId!,
        input: [{ type: 'text', text, text_elements: [] }],
        model: this.context.model ?? undefined,
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

  async runControlResponse(
    response: Record<string, unknown>,
    _signal: AbortSignal,
  ): Promise<void> {
    // Permission/tool decision from the desktop permission UI
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
      `Rust sidecar control response unsupported: ${JSON.stringify(response).slice(0, 200)}`,
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
   * Tear down the child process and transport.
   */
  async dispose(): Promise<void> {
    this.currentTurnReject?.(
      new Error('Rust sidecar runtime disposed during an active turn.'),
    )
    this.currentTurnReject = null

    this.disposeNotificationListener?.()
    this.disposeNotificationListener = null

    this.disposeServerRequestHandlers?.forEach(dispose => dispose())
    this.disposeServerRequestHandlers = null

    this.appServerClient?.close()
    this.appServerClient = null
    this.rpcClient = null

    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    this.initialized = false
    this.threadStarted = false
  }

  // ── Private ───────────────────────────────────────────────────────

  private async startAppServer(): Promise<void> {
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
          `Build it with "cargo build -p codex-app-server" in rust/codex-rs, ` +
          `or set ${RUST_APP_SERVER_BINARY_ENV} to a codex-app-server binary.`,
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
      this.initialized = false
    })

    child.on('error', (err) => {
      desktopDebug('rust_sidecar_error', {
        message: err.message,
      })
      this.currentTurnReject?.(err)
      this.initialized = false
    })

    // 2. Create transport
    this.rpcClient = new RustLineJsonRpcClient({
      input: child.stdout!,
      output: child.stdin!,
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
    const initResult = await this.appServerClient.initialize({
      clientInfo: {
        name: 'codepilotx-desktop',
        title: 'CodePilotX Desktop',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    })
    desktopDebug('rust_sidecar_initialized', {
      userAgent: initResult.userAgent,
    })

    // 6. Send initialized notification
    this.appServerClient.notifyInitialized()
    this.initialized = true

    // 7. Start thread
    const threadResult = await this.appServerClient.startThread({
      model: this.context.model ?? undefined,
      modelProvider: this.context.providerID ?? undefined,
      cwd: this.context.workspacePath,
      ephemeral: true,
    })
    this.workflowState.threadId = threadResult.thread.id
    this.threadStarted = true
    desktopDebug('rust_sidecar_thread_started', {
      threadId: this.workflowState.threadId,
    })
  }

  private handleNotification(method: string, params: unknown): void {
    handleServerNotification(
      method,
      params,
      (event: DesktopAgentEvent) => {
        this.context.emit(event)

        // If we received error or done, resolve the current turn promise
        if (event.type === 'done' || event.type === 'error') {
          if (this.currentTurnResolve) {
            this.currentTurnResolve()
          }
          if (event.type === 'error') {
            // For error events, also reject so caller knows it failed
            this.currentTurnReject?.(
              new Error(
                typeof event.message === 'string'
                  ? event.message
                  : 'Rust app-server turn error',
              ),
            )
          }
        }
      },
      this.workflowState,
      this.context.sessionId,
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

    this.disposeServerRequestHandlers = disposers
  }

  private async handleToolCallRequest(
    params: unknown,
    requestId: JsonRpcId,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null
    const toolName = String(p?.name ?? p?.tool_name ?? 'Tool')
    const toolUseId = String(p?.id ?? p?.tool_use_id ?? p?.toolUseId ?? '')

    desktopDebug('rust_tool_call_request', {
      toolName,
      toolUseId,
    })

    // Store pending request for runControlResponse forwarding
    this.pendingServerRequest = { id: requestId, method: 'item/tool/call', params }

    // Emit tool_start event so desktop UI renders a tool card
    this.context.emit({
      type: 'tool_start',
      sessionId: this.context.sessionId,
      toolName,
      summary: p?.input ? JSON.stringify(p.input).slice(0, 500) : '',
      toolUseId,
    })

    // Return acknowledgment — real result comes via runControlResponse
    return { status: 'pending' }
  }

  private async handlePermissionRequest(
    params: unknown,
    requestId: JsonRpcId,
    method: string,
  ): Promise<unknown> {
    const p = params as Record<string, unknown> | null
    const toolName = String(p?.tool_name ?? 'Tool')

    desktopDebug('rust_permission_request', {
      method,
      toolName,
    })

    // Store pending request for runControlResponse forwarding
    this.pendingServerRequest = { id: requestId, method, params }

    // Desktop permission flow is handled by runControlResponse
    return { status: 'pending' }
  }

  private async interruptActiveTurn(): Promise<void> {
    if (
      !this.appServerClient ||
      !this.workflowState.threadId ||
      !this.workflowState.activeTurnId
    ) {
      // If there's no active turn to interrupt but the turn promise is still
      // pending, resolve it so the UI doesn't hang.
      this.currentTurnResolve?.()
      return
    }
    try {
      await this.appServerClient.interruptTurn({
        threadId: this.workflowState.threadId,
        turnId: this.workflowState.activeTurnId,
      })
      // Resolve the turn promise immediately on successful interrupt response,
      // rather than waiting for a delayed turn/completed notification.
      this.currentTurnResolve?.()
    } catch (err) {
      desktopDebug('rust_sidecar_interrupt_failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      // Safety net: resolve so the UI clears even if the interrupt RPC fails.
      this.currentTurnResolve?.()
    }
  }
}

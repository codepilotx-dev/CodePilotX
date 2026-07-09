import { randomUUID } from 'node:crypto'
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
import { buildDesktopPermissionRequestFromControlRequest } from './agentRuntime.js'
import type {
  DesktopPermissionDecision,
  DesktopPermissionRequest,
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
import type { ThreadStartParams, InitializeParams, InitializeResponse } from './rustAppServerProtocol/index.js'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import type { JsonRpcId } from './rustLineJsonRpcClient.js'
import { desktopDebug } from './desktopDebug.js'

// ── Inline protocol types (v2, not yet generated in rustAppServerProtocol) ──

/**
 * Dynamic tool function spec matching the Rust DynamicToolFunctionSpec type.
 * Used to register client-side tools at thread start so the Rust server
 * delegates their execution back to the desktop client via item/tool/call.
 */
type DynamicToolFunctionSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  deferLoading?: boolean
}

/**
 * Client-side dynamic tools registered at thread start. The Rust server
 * handles built-in tools (Bash, Read, Write, Edit, etc.) internally;
 * only desktop-interactive tools that need permission or user input
 * infrastructure are registered here.
 */
const CLIENT_DYNAMIC_TOOLS: DynamicToolFunctionSpec[] = [
  {
    name: 'request_user_input',
    description:
      'Ask the user for input when you need information, clarification, ' +
      'or a decision to proceed with the task.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user',
        },
        header: {
          type: 'string',
          description: 'Optional header or title for the question',
        },
      },
      required: ['question'],
    },
  },
]

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
    ? 'codepilotx-app-server.exe'
    : 'codepilotx-app-server'
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
      ...(context.planModeActive ? ['-c', 'collaboration_mode=plan'] : []),
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
  private planModeActive = false
  private pendingServerRequest: {
    id: JsonRpcId
    method: string
    params: unknown
  } | null = null
  private lastInitResult: InitializeResponse | null = null

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

  setPlanModeActive(active: boolean): void {
    this.planModeActive = active
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
    codexHome: string
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
      platformFamily: this.lastInitResult.platformFamily,
      platformOs: this.lastInitResult.platformOs,
    }
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
          `Build it with "cargo build -p codex-app-server --bin codepilotx-app-server" in rust/codex-rs, ` +
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

    // 7. Start thread — register client-side dynamic tools so the Rust
    //    server delegates their execution back to the desktop client.
    const threadResult = await this.appServerClient.startThread({
      model: this.context.model ?? undefined,
      modelProvider: this.context.providerID ?? undefined,
      cwd: this.context.workspacePath,
      ephemeral: true,
      dynamicTools: CLIENT_DYNAMIC_TOOLS.map(t => ({
        type: 'function' as const,
        ...t,
      })),
    } as ThreadStartParams & { dynamicTools: unknown })
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

    const answers: Record<string, ToolRequestUserInputAnswer> = {}

    for (const question of questions) {
      const permissionRequest: DesktopPermissionRequest = {
        requestId: `rust-ask-${randomUUID()}`,
        toolName: 'AskUserQuestion',
        toolUseId: itemId,
        input: {
          question: question.question,
          header: question.header,
          options: question.options,
          isOther: question.isOther,
          isSecret: question.isSecret,
        },
        description: question.question?.slice(0, 200) ?? '用户输入请求',
      }

      const decision = await this.context.requestPermission(permissionRequest)

      if (decision.behavior === 'deny') {
        answers[question.id] = { answers: ['[User declined to answer]'] }
      } else {
        const userAnswer =
          (decision.updatedInput?.answer as string | undefined) ?? ''
        answers[question.id] = { answers: [userAnswer] }
      }
    }

    const response: ToolRequestUserInputResponse = { answers }
    return response
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

    // Emit tool_start event so desktop UI renders a tool card
    // (item/started notification also emits tool_start via adapter)
    this.context.emit({
      type: 'tool_start',
      sessionId: this.context.sessionId,
      toolName,
      summary: JSON.stringify(toolArgs).slice(0, 500),
      toolUseId,
    })

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
    return this.mapPermissionDecision(method, decision)
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
    const permissionRequest: DesktopPermissionRequest = {
      requestId: `rust-mcp-${randomUUID()}`,
      toolName: 'McpElicitation',
      toolUseId: p?.turnId as string | undefined,
      input: {
        serverName,
        request: p?.request,
      },
      description: serverName
        ? `MCP 服务器 "${serverName}" 请求输入`
        : 'MCP 服务器请求输入',
    }

    // Ask user for permission
    const decision = await this.context.requestPermission(permissionRequest)

    if (decision.behavior === 'deny') {
      return { cancelled: true }
    }

    // For now, return cancelled since full MCP elicitation requires
    // desktop-side form rendering which is not yet implemented
    return { cancelled: true, reason: 'MCP elicitation form not yet supported on desktop' }
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
  ): unknown {
    const allowed = decision.behavior === 'allow'

    switch (method) {
      case 'item/commandExecution/requestApproval':
        return { decision: allowed ? 'accept' : 'decline' }
      case 'item/fileChange/requestApproval':
        return { decision: allowed ? 'accept' : 'decline' }
      case 'item/permissions/requestApproval':
      default:
        return {
          permissions: allowed ? { fileSystem: {}, network: {} } : {},
          scope: 'turn' as const,
        }
    }
  }

  /**
   * Execute a client-side dynamic tool delegated by the Rust app-server.
   *
   * The Rust server handles built-in tools (Bash, Read, Write, Edit, etc.)
   * internally. Only tools registered in CLIENT_DYNAMIC_TOOLS are dispatched
   * here; unknown tools return success: false so the caller knows this tool
   * is not handled on the desktop client.
   */
  private async executeDesktopTool(
    toolName: string,
    args: unknown,
    toolUseId: string,
  ): Promise<DynamicToolCallResponse> {
    switch (toolName) {
      case 'request_user_input':
        return this.handleRequestUserInputTool(args, toolUseId)

      // Future client-side tools (e.g., desktop extension tools, MCP
      // bridging tools) can be added here as new cases.

      default:
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
  }

  /**
   * Handle request_user_input dynamic tool call.
   *
   * Shows a permission dialog via context.requestPermission() to ask the
   * user a question and returns the user's answer. If the user declines,
   * returns a sentinel text indicating the user declined.
   */
  private async handleRequestUserInputTool(
    args: unknown,
    toolUseId: string,
  ): Promise<DynamicToolCallResponse> {
    const input = args as Record<string, unknown> | null
    const question = String(input?.question ?? '')
    const header = String(input?.header ?? '')

    const permissionRequest: DesktopPermissionRequest = {
      requestId: `rust-dynamic-ask-${randomUUID()}`,
      toolName: 'request_user_input',
      toolUseId,
      input: { question, header },
      description: question.slice(0, 200) || '用户输入请求',
    }

    const decision = await this.context.requestPermission(permissionRequest)

    if (decision.behavior === 'deny') {
      return {
        success: true,
        contentItems: [
          {
            type: 'inputText' as const,
            text: '[User declined to answer]',
          },
        ],
      }
    }

    const userAnswer =
      (decision.updatedInput?.answer as string | undefined) ?? ''
    return {
      success: true,
      contentItems: [
        {
          type: 'inputText' as const,
          text: userAnswer,
        },
      ],
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

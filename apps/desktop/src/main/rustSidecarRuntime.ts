import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type {
  DesktopAgentRuntime,
  DesktopAgentRuntimeContext,
} from './agentRuntime.js'
import type {
  DesktopUserMessageContent,
  DesktopPermissionMode,
} from '../shared/types.js'
import type { DesktopAgentEvent } from '../shared/types.js'
import { buildSidecarEnv, type SidecarManagerOptions } from './sidecarManager.js'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import { RustAppServerClient } from './rustAppServerClient.js'
import {
  createRustAppServerWorkflowState,
  handleServerNotification,
  type RustAppServerWorkflowState,
} from './rustAppServerWorkflowAdapter.js'
import { desktopDebug } from './desktopDebug.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const RUST_APP_SERVER_BINARY_ENV = 'CODEPILOTX_RUST_APP_SERVER'

export function resolveRustAppServerExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicitPath = env[RUST_APP_SERVER_BINARY_ENV]?.trim()
  if (explicitPath) {
    return resolve(explicitPath)
  }

  const binaryName = process.platform === 'win32'
    ? 'codex-app-server.exe'
    : 'codex-app-server'
  const candidates = [
    join(__dirname, '..', '..', 'desktop-rust-sidecar', binaryName),
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'rust',
      'codex-rs',
      'target',
      'debug',
      binaryName,
    ),
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]
}

export function createRustSidecarOptions(
  context: DesktopAgentRuntimeContext,
): SidecarManagerOptions {
  const executablePath = resolveRustAppServerExecutable()
  return {
    command: executablePath,
    args: ['--listen', 'stdio://', '--session-source', 'vscode'],
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
    },
    startTimeoutMs: 15_000,
  }
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
    _response: Record<string, unknown>,
    _signal: AbortSignal,
  ): Promise<void> {
    throw new Error(
      'Rust sidecar control responses (permissions/tools) are not supported in the first text-only version.',
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
    const executablePath = resolveRustAppServerExecutable()
    desktopDebug('rust_sidecar_start', {
      executable: executablePath,
      cwd: this.context.workspacePath,
      providerID: this.context.providerID ?? null,
      model: this.context.model ?? null,
    })

    if (!existsSync(executablePath)) {
      throw new Error(
        `Rust app-server binary not found at: ${executablePath}. ` +
          `Set ${RUST_APP_SERVER_BINARY_ENV} to point at codex-app-server binary.`,
      )
    }

    const options = createRustSidecarOptions(this.context)

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

    // 4. Initialize
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

    // 5. Send initialized notification
    this.appServerClient.notifyInitialized()
    this.initialized = true

    // 6. Start thread
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

  private async interruptActiveTurn(): Promise<void> {
    if (
      !this.appServerClient ||
      !this.workflowState.threadId ||
      !this.workflowState.activeTurnId
    ) {
      return
    }
    try {
      await this.appServerClient.interruptTurn({
        threadId: this.workflowState.threadId,
        turnId: this.workflowState.activeTurnId,
      })
    } catch (err) {
      desktopDebug('rust_sidecar_interrupt_failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

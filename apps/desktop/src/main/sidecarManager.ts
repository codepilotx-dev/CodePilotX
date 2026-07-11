import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node'
import type {
  JsonRpcInitializeResult,
  JsonRpcThreadStartParams,
  JsonRpcThreadStartResult,
  JsonRpcTurnStartParams,
  JsonRpcTurnStartResult,
  JsonRpcTurnInterruptParams,
  JsonRpcSessionGetSnapshotParams,
  JsonRpcSessionSnapshot,
} from '@codepilotx/core/appServer/protocol.js'
import {
  THREAD_EVENT_NOTIFICATION,
  SESSION_SNAPSHOT_UPDATED_NOTIFICATION,
} from '@codepilotx/core/appServer/protocol.js'
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import { desktopDebug } from './desktopDebug.js'
import { terminateChildProcess } from './childProcessTermination.js'

/**
 * SidecarManager 管理 app-server sidecar 子进程的生命周期与 JSON-RPC 通信。
 *
 * 生命周期：
 *   1. 构造 SidecarManager（传入 sidecar 进程路径、cwd、env）
 *   2. start() → spawn 子进程 → 建立 JSON-RPC 连接 → initialize 握手
 *   3. 调用 JSON-RPC 方法（startThread / startTurn / interruptTurn / …）
 *   4. 订阅 thread/event、session/snapshot.updated 通知
 *   5. stop() → 清理子进程与连接
 *   6. 失败时通过 FallbackError 通知调用方回退到 embedded 模式
 */

// ── Public types ──────────────────────────────────────────────────────────

export type SidecarEventMap = {
  threadEvent: [event: ThreadEvent]
  sessionSnapshotUpdated: [snapshot: JsonRpcSessionSnapshot]
  /** sidecar 进程异常退出时的通知 */
  crash: [error: Error]
  /** 来自 sidecar 的工具权限请求 */
  permissionRequest: [context: SidecarPermissionContext]
}

export type SidecarPermissionContext = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description: string
}

export type SidecarPermissionDecision = {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  alwaysAllow?: boolean
  message?: string
}

export const SIDECAR_RUNNER_ENV = 'CODEPILOTX_JSON_RPC_APP_SERVER' as const

export type SidecarManagerOptions = {
  /** sidecar entrypoint JS/TS path for script runtimes */
  entrypoint?: string
  /** Direct executable to spawn, used by the Rust app-server sidecar */
  command?: string
  /** Working directory */
  cwd: string
  /** Environment passed to the sidecar */
  env: Record<string, string | undefined>
  /** Runtime used to execute entrypoint (bun / node) */
  runtime?: string
  /** Extra runtime args before entrypoint */
  runtimeArgs?: string[]
  /** Direct executable args */
  args?: string[]
  /** Connection timeout in milliseconds */
  startTimeoutMs?: number
  stopTimeoutMs?: number
  forceKill?: (child: ChildProcess) => Promise<void>
}

// ── SidecarManager ────────────────────────────────────────────────────────

export class SidecarManager {
  private child: ChildProcess | null = null
  private connection: MessageConnection | null = null
  private initialized = false
  private readonly emitter = new EventEmitter()
  private cleanupSteps: Array<() => void> = []
  private startupResolve: (() => void) | null = null
  private startupReject: ((err: Error) => void) | null = null
  private stopPromise: Promise<void> | null = null

  constructor(private readonly options: SidecarManagerOptions) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.initialized) return
    this.stopPromise = null

    desktopDebug('sidecar_start', {
      entrypoint: this.options.entrypoint,
      command: this.options.command,
      cwd: this.options.cwd,
    })

    const timeout = this.options.startTimeoutMs ?? 15_000
    const runtime = this.options.runtime ?? 'bun'
    const runtimeArgs = this.options.runtimeArgs ?? ['run']
    const command = this.options.command ?? runtime
    const args = this.options.command
      ? (this.options.args ?? [])
      : [...runtimeArgs, requireSidecarEntrypoint(this.options)]

    // 1. Spawn 子进程
    const child = spawn(command, args, {
      cwd: this.options.cwd,
      windowsHide: true,
      env: sanitizeChildEnvironment({
        ...process.env,
        ...this.options.env,
        // 标记自身为 sidecar 模式
        [SIDECAR_RUNNER_ENV]: '1',
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    // 2. 捕获 stderr
    const stderrChunks: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    // 3. 先监听子进程错误；Windows 上 bun 不在 PATH 时会异步触发 ENOENT。
    const startupPromise = new Promise<void>((resolve, reject) => {
      this.startupResolve = resolve
      this.startupReject = reject
    })
    void startupPromise.catch(() => undefined)

    const exitHandler = (code: number | null, signal: string | null) => {
      const error = createSidecarExitError(code, signal, stderrChunks)
      this.emitter.emit('crash', error)
      this.startupReject?.(error)
    }
    child.on('exit', exitHandler)
    this.cleanupSteps.push(() => child.off('exit', exitHandler))

    const errorHandler = (err: Error) => {
      this.emitter.emit('crash', err)
      this.startupReject?.(err)
    }
    child.on('error', errorHandler)
    this.cleanupSteps.push(() => child.off('error', errorHandler))

    await this.withTimeout(
      waitForSpawnReady(child, stderrChunks),
      timeout,
      'Sidecar spawn timeout',
    )

    // 4. 建立 JSON-RPC 连接
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    )
    this.connection = connection
    connection.listen()

    // 5. 注册通知处理器
    connection.onNotification(THREAD_EVENT_NOTIFICATION, (params: { event: ThreadEvent }) => {
      desktopDebug('sidecar_thread_event', {
        type: params.event.type,
        threadId: params.event.threadId,
      })
      this.emitter.emit('threadEvent', params.event)
    })

    connection.onNotification(
      SESSION_SNAPSHOT_UPDATED_NOTIFICATION,
      (params: { snapshot: JsonRpcSessionSnapshot }) => {
        this.emitter.emit('sessionSnapshotUpdated', params.snapshot)
      },
    )

    // 6. 注册 pending/tool/permission 通知处理器
    connection.onNotification('pending/tool/permission', (params: SidecarPermissionContext) => {
      desktopDebug('sidecar_permission_request', {
        requestId: params.requestId,
        toolName: params.toolName,
      })
      this.handlePermissionRequest(params)
    })

    // 7. 发送 initialize 握手
    try {
      const result = await this.withTimeout(
        connection.sendRequest<JsonRpcInitializeResult>('initialize', {}),
        timeout,
        'Sidecar initialize timeout',
      )
      desktopDebug('sidecar_initialized', { result })
      this.initialized = true
      this.startupResolve?.()
    } catch (err) {
      this.startupReject?.(err instanceof Error ? err : new Error(String(err)))
      throw err
    }

    return startupPromise
  }

  async stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.stopOnce()
    }
    await this.stopPromise
  }

  private async stopOnce(): Promise<void> {
    desktopDebug('sidecar_stop', {})
    const errors: unknown[] = []
    try {
      this.connection?.dispose()
    } catch (error) {
      errors.push(error)
    }
    for (const step of this.cleanupSteps.reverse()) {
      try {
        step()
      } catch (error) {
        errors.push(error)
      }
    }
    this.cleanupSteps = []
    const child = this.child
    let terminated = child === null
    if (child) {
      try {
        await terminateChildProcess(child, {
          timeoutMs: this.options.stopTimeoutMs,
          forceKill: this.options.forceKill,
        })
        terminated = true
      } catch (error) {
        errors.push(error)
      }
    }
    this.connection = null
    if (terminated) this.child = null
    this.initialized = false
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Sidecar cleanup and termination failed')
    }
  }

  // ── JSON-RPC 方法 ───────────────────────────────────────────────────────

  async startThread(
    params: JsonRpcThreadStartParams,
  ): Promise<JsonRpcThreadStartResult> {
    this.ensureConnected()
    return this.connection!.sendRequest('thread/start', params)
  }

  async startTurn(
    params: JsonRpcTurnStartParams,
  ): Promise<JsonRpcTurnStartResult> {
    this.ensureConnected()
    return this.connection!.sendRequest('turn/start', params)
  }

  async interruptTurn(
    params: JsonRpcTurnInterruptParams,
  ): Promise<ThreadEvent> {
    this.ensureConnected()
    return this.connection!.sendRequest('turn/interrupt', params)
  }

  async getSessionSnapshot(
    params: JsonRpcSessionGetSnapshotParams,
  ): Promise<JsonRpcSessionSnapshot> {
    this.ensureConnected()
    return this.connection!.sendRequest('session/getSnapshot', params)
  }

  /** 响应 sidecar 的权限请求（由 Desktop 在收到 pending/tool/permission 后调用） */
  respondPermission(
    requestId: string,
    decision: SidecarPermissionDecision,
  ): void {
    this.ensureConnected()
    void this.connection!
      .sendRequest('control/submit', { requestId, decision })
      .catch(error => {
        desktopDebug('sidecar_permission_response_failed', {
          requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }

  // ── Event 订阅 ──────────────────────────────────────────────────────────

  on<K extends keyof SidecarEventMap>(
    event: K,
    listener: (...args: SidecarEventMap[K]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof SidecarEventMap>(
    event: K,
    listener: (...args: SidecarEventMap[K]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  get isRunning(): boolean {
    return this.initialized && this.child !== null && !this.child.killed
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.connection || !this.initialized) {
      throw new Error('Sidecar not initialized. Call start() first.')
    }
  }

  private handlePermissionRequest(
    context: SidecarPermissionContext,
  ): void {
    // 通知 Desktop 层显示权限对话框，Desktop 层通过 respondPermission() 响应
    this.emitter.emit('permissionRequest', context)
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms),
      ),
    ])
  }
}

function requireSidecarEntrypoint(options: SidecarManagerOptions): string {
  if (!options.entrypoint) {
    throw new Error('Sidecar entrypoint is required when command is not set.')
  }
  return options.entrypoint
}

// ── 工具：构建 sidecar env ─────────────────────────────────────────────────

/**
 * 根据 DesktopAgentRuntimeContext 构建传递给 sidecar 进程的 env。
 * 这些 env 会被 entrypoints/appServer.ts 读取并用来初始化运行时。
 */
export function buildSidecarEnv(
  context: SidecarEnvContext,
): Record<string, string | undefined> {
  return {
    ...sanitizeChildEnvironment(context.runtimeEnvironment ?? {}),
    CODEPILOTX_SIDECAR_SESSION_ID: context.sessionId,
    CODEPILOTX_SIDECAR_WORKSPACE: context.workspacePath,
    CODEPILOTX_SIDECAR_MODEL: context.model,
    CODEPILOTX_SIDECAR_PROVIDER_ID: context.providerID,
    CODEPILOTX_SIDECAR_PROVIDER_BASE_URL: context.providerBaseURL,
    CODEPILOTX_SIDECAR_PERMISSION_MODE: context.permissionMode,
    CODEPILOTX_SIDECAR_SANDBOX_MODE: context.sandboxMode,
    CODEPILOTX_SIDECAR_APPROVAL_POLICY: context.approvalPolicy,
    CODEPILOTX_SIDECAR_APPROVALS_REVIEWER: context.approvalsReviewer,
    CODEPILOTX_SIDECAR_PERMISSION_PROFILE: context.permissionProfile,
    CODEPILOTX_SIDECAR_CONFIG_DIR: context.configDirectoryPath,
    CODEPILOTX_SIDECAR_DEBUG_DUMP: context.debugConversationDump ? '1' : '0',
    CODEPILOTX_SIDECAR_THINKING_MODE: context.thinkingMode,
    CODEPILOTX_SIDECAR_SYSTEM_PROMPT: context.systemPrompt,
    CODEPILOTX_SIDECAR_APPEND_SYSTEM_PROMPT: context.appendSystemPrompt,
    CODEPILOTX_SIDECAR_ADDITIONAL_DIRS: context.additionalDirectories?.join(';'),
    CODEPILOTX_SIDECAR_INSTALL_DEPS: context.installCodePilotXDependencies ? '1' : '0',
    CODEPILOTX_SIDECAR_ENABLE_MEMORY: context.enableMemory ? '1' : '0',
    CODEPILOTX_SIDECAR_REVIEW_MODEL: context.reviewModel,
    CODEPILOTX_SIDECAR_SMALL_FAST_MODEL: context.smallFastModel,
    CODEPILOTX_SIDECAR_FAST_MODEL: context.fastModel,
    CODEPILOTX_SIDECAR_DEFAULT_MODEL: context.defaultModel,
    CODEPILOTX_SIDECAR_DEEP_MODEL: context.deepModel,
    CODEPILOTX_SIDECAR_SESSION_NAME: context.sessionName,
  }
}

const CHILD_ENV_ALLOWLIST = new Set([
  'APPDATA',
  'COMSPEC',
  'HOME',
  'LANG',
  'LOCALAPPDATA',
  'NO_COLOR',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'RUST_BACKTRACE',
  'RUST_LOG',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'USERPROFILE',
  'WINDIR',
])

const SENSITIVE_ENV_NAME = /(?:API[_-]?KEY|AUTH|BEARER|CREDENTIAL|PASSWORD|SECRET|TOKEN)/i

/** Preserve only process-launch essentials and explicit sidecar configuration. */
export function sanitizeChildEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const sanitized: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    const upperKey = key.toUpperCase()
    if (SENSITIVE_ENV_NAME.test(upperKey)) continue
    if (
      CHILD_ENV_ALLOWLIST.has(upperKey) ||
      upperKey.startsWith('LC_') ||
      upperKey.startsWith('CODEPILOTX_SIDECAR_') ||
      upperKey === 'CODEPILOTX_CONFIG_DIR' ||
      upperKey === 'CODEPILOTX_SQLITE_HOME' ||
      upperKey === 'CLAUDE_CONFIG_DIR' ||
      upperKey === SIDECAR_RUNNER_ENV
    ) {
      sanitized[key] = value
    }
  }
  return sanitized
}

export type SidecarEnvContext = {
  sessionId: string
  workspacePath: string
  model?: string
  providerID?: string
  providerBaseURL?: string
  permissionMode?: string
  sandboxMode?: string
  approvalPolicy?: string
  approvalsReviewer?: string
  permissionProfile?: string
  configDirectoryPath?: string
  debugConversationDump?: boolean
  thinkingMode?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  installCodePilotXDependencies?: boolean
  enableMemory?: boolean
  runtimeEnvironment?: Record<string, string | undefined>
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
}

function waitForSpawnReady(
  child: ChildProcess,
  stderrChunks: Buffer[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Immediate | null = null

    const cleanup = () => {
      if (settled) return false
      settled = true
      if (timer) {
        clearImmediate(timer)
      }
      child.off('spawn', onSpawn)
      child.off('error', onError)
      child.off('exit', onExit)
      return true
    }
    const onSpawn = () => {
      if (cleanup()) resolve()
    }
    const onError = (error: Error) => {
      if (cleanup()) reject(error)
    }
    const onExit = (code: number | null, signal: string | null) => {
      if (cleanup()) reject(createSidecarExitError(code, signal, stderrChunks))
    }

    child.once('spawn', onSpawn)
    child.once('error', onError)
    child.once('exit', onExit)
    timer = setImmediate(onSpawn)
  })
}

function createSidecarExitError(
  code: number | null,
  signal: string | null,
  stderrChunks: Buffer[],
): Error {
  return new Error(
    `Sidecar process exited unexpectedly (code=${code}, signal=${signal})` +
      (stderrChunks.length > 0
        ? `: ${Buffer.concat(stderrChunks).toString('utf8').slice(0, 1000)}`
        : ''),
  )
}

export class SidecarStartError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message)
    this.name = 'SidecarStartError'
  }
}

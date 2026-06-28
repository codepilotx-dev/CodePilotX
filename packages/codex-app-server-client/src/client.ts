import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { CodexAppServerError } from './errors.js'
import type {
  AppServerNotification,
  ClientInfo,
  CollaborationModeListResponse,
  ConfigBatchWriteParams,
  ConfigEdit,
  FsReadDirectoryParams,
  FsReadDirectoryResponse,
  FsReadFileParams,
  FsReadFileResponse,
  FuzzyFileSearchParams,
  FuzzyFileSearchResponse,
  HooksListResponse,
  InitializeParams,
  InitializeResult,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ListModelsParams,
  ListModelsResult,
  McpServerStatus,
  ThreadApproveGuardianDeniedActionParams,
  ThreadBackgroundTerminalsCleanParams,
  ThreadBackgroundTerminalsListParams,
  ThreadBackgroundTerminalsListResponse,
  ThreadBackgroundTerminalsTerminateParams,
  ThreadBackgroundTerminalsTerminateResponse,
  ThreadGoalClearParams,
  ThreadGoalGetParams,
  ThreadGoalGetResponse,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
  Thread,
  ThreadArchiveResponse,
  ThreadForkParams,
  ThreadListParams,
  ThreadListResponse,
  ThreadStartParams,
  ThreadStartResult,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadUnarchiveResponse,
  ThreadMemoryModeSetParams,
  Turn,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResult,
  UserInput,
} from './protocol.js'
import {
  buildAppServerArgs,
  findCodexBinary,
  spawnCodex,
  type CodexPathResolution,
} from './exec.js'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export type CodexTransport =
  | { type: 'stdio' }
  | { type: 'unix'; socketPath: string }

export type CodexAppServerClientOptions = {
  /** Absolute path to the codex CLI binary. Defaults to `findCodexBinary()`. */
  codexPath?: string
  /** Codex home directory. Defaults to `~/.codex`. */
  codexHome?: string
  /** Transport to use for talking to the app-server. */
  transport: CodexTransport
  /** Identifies this client in OpenAI compliance logs. */
  clientInfo: ClientInfo
  /** Additional environment overrides applied before spawning. */
  env?: Record<string, string | undefined>
  /** Timeout in ms for individual RPC calls. Defaults to 60_000. */
  requestTimeoutMs?: number
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

export type CodexAppServerClientStatus =
  | 'idle'
  | 'starting'
  | 'initializing'
  | 'ready'
  | 'shuttingDown'
  | 'closed'
  | 'crashed'

/**
 * Lightweight JSON-RPC 2.0 client for the OpenAI Codex `app-server`.
 *
 * Spawns a `codex app-server` subprocess (stdio or unix socket transport),
 * sends `initialize`, and exposes a typed façade over the v2 protocol.
 *
 * The client emits `notification` events for every server-pushed message and
 * automatically demultiplexes request/response pairs by `id`.
 */
export class CodexAppServerClient extends EventEmitter {
  private readonly opts: Required<
    Pick<CodexAppServerClientOptions, 'transport' | 'clientInfo' | 'requestTimeoutMs'>
  > &
    Pick<CodexAppServerClientOptions, 'codexPath' | 'codexHome' | 'env'>
  private readonly resolution: CodexPathResolution
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private nextRequestId = 0
  private initialized = false
  private status: CodexAppServerClientStatus = 'idle'
  private notificationListeners = new Set<(n: AppServerNotification) => void>()
  private requestListeners = new Set<(r: JsonRpcRequest) => void>()
  private statusListeners = new Set<(s: CodexAppServerClientStatus) => void>()
  private unixSocketDir: string | null = null

  constructor(options: CodexAppServerClientOptions) {
    super()
    this.opts = {
      codexPath: options.codexPath,
      codexHome: options.codexHome,
      transport: options.transport,
      clientInfo: options.clientInfo,
      env: options.env,
      requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
    }
    this.resolution = findCodexBinary(options.codexPath ?? null)
  }

  getStatus(): CodexAppServerClientStatus {
    return this.status
  }

  getCodexHome(): string {
    return this.opts.codexHome ?? path.join(this.resolution.packageRoot, 'home')
  }

  /**
   * Spawn the subprocess and complete the `initialize` handshake.
   */
  async start(): Promise<InitializeResult> {
    if (this.status === 'ready' || this.status === 'starting') {
      throw new Error('Codex app-server is already started.')
    }
    this.setStatus('starting')

    const env = this.buildEnv()
    const args = buildAppServerArgs({ transport: this.opts.transport })

    let socketPath: string | null = null
    if (this.opts.transport.type === 'unix') {
      socketPath = this.opts.transport.socketPath
      const dir = path.dirname(socketPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      try {
        unlinkSync(socketPath)
      } catch {
        // ignore: socket may not exist yet
      }
      this.unixSocketDir = dir
    }

    this.child = spawnCodex(this.resolution.executablePath, args, env)

    this.child.stderr?.on('data', chunk => {
      const text = chunk.toString('utf8')
      this.emit('stderr', text)
    })

    this.child.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal)
    })
    this.child.on('error', err => {
      this.setStatus('crashed')
      this.rejectAllPending(err)
      this.emit('error', err)
    })

    const rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })
    rl.on('line', line => {
      this.handleLine(line)
    })

    if (socketPath) {
      await this.waitForUnixSocket(socketPath)
    }

    this.setStatus('initializing')
    const params: InitializeParams = {
      clientInfo: this.opts.clientInfo,
      capabilities: {
        experimentalApi: true,
      },
    }
    const result = await this.request<InitializeParams, InitializeResult>(
      'initialize',
      params,
    )
    this.notify('initialized', undefined)
    this.initialized = true
    this.setStatus('ready')
    return result
  }

  /**
   * Send `shutdown`, then `exit`, then kill the subprocess.
   */
  async shutdown(): Promise<void> {
    if (this.status === 'closed' || this.status === 'shuttingDown') {
      return
    }
    this.setStatus('shuttingDown')
    if (this.initialized) {
      try {
        await this.request('shutdown', undefined, 5_000)
      } catch {
        // ignore: server may already be exiting
      }
    }
    this.cleanup()
  }

  // ---------- Typed façade ----------

  startThread(params: ThreadStartParams): Promise<ThreadStartResult> {
    return this.request('thread/start', params)
  }

  resumeThread(threadId: string): Promise<ThreadStartResult> {
    return this.request('thread/resume', { threadId })
  }

  forkThread(threadId: string): Promise<ThreadStartResult> {
    return this.request('thread/fork', { threadId })
  }

  forkThreadWithParams(params: ThreadForkParams): Promise<ThreadStartResult> {
    return this.request('thread/fork', params)
  }

  readThread(
    threadId: string,
    opts?: Omit<ThreadReadParams, 'threadId'>,
  ): Promise<ThreadReadResponse> {
    return this.request('thread/read', { threadId, ...(opts ?? {}) })
  }

  listThreads(params?: ThreadListParams | string | null): Promise<ThreadListResponse> {
    const requestParams =
      typeof params === 'string' || params === null
        ? { cursor: params }
        : (params ?? {})
    return this.request('thread/list', requestParams)
  }

  archiveThread(threadId: string): Promise<ThreadArchiveResponse> {
    return this.request('thread/archive', { threadId })
  }

  unarchiveThread(threadId: string): Promise<ThreadUnarchiveResponse> {
    return this.request('thread/unarchive', { threadId })
  }

  nameThread(threadId: string, name: string): Promise<void> {
    return this.request('thread/name/set', { threadId, name })
  }

  startTurn(params: TurnStartParams): Promise<TurnStartResult> {
    return this.request('turn/start', params)
  }

  steerTurn(
    threadId: string,
    turnId: string,
    input: UserInput[],
    opts?: { clientUserMessageId?: string },
  ): Promise<{ turnId: string }> {
    return this.request('turn/steer', {
      threadId,
      turnId,
      input,
      ...(opts?.clientUserMessageId ? { clientUserMessageId: opts.clientUserMessageId } : {}),
    })
  }

  interruptTurn(params: TurnInterruptParams): Promise<void> {
    return this.request('turn/interrupt', params)
  }

  rollback(threadId: string, numTurns: number): Promise<{ thread: Thread }> {
    return this.request('thread/rollback', { threadId, numTurns })
  }

  // ---------- Config ----------

  readConfig(): Promise<{ config: Record<string, unknown> }> {
    return this.request('config/read', undefined)
  }

  configBatchWrite(edits: ConfigEdit[], opts?: { reloadUserConfig?: boolean }): Promise<void> {
    const params: ConfigBatchWriteParams = { edits, reloadUserConfig: opts?.reloadUserConfig }
    return this.request('config/batchWrite', params)
  }

  configValueWrite(key: string, value: unknown): Promise<void> {
    return this.request('config/value/write', { key, value })
  }

  // ---------- Files / search ----------

  readDirectory(path: string): Promise<FsReadDirectoryResponse> {
    const params: FsReadDirectoryParams = { path }
    return this.request('fs/readDirectory', params)
  }

  readFile(path: string): Promise<FsReadFileResponse> {
    const params: FsReadFileParams = { path }
    return this.request('fs/readFile', params)
  }

  fuzzyFileSearch(
    params: FuzzyFileSearchParams,
  ): Promise<FuzzyFileSearchResponse> {
    return this.request('fuzzyFileSearch', params)
  }

  // ---------- Models ----------

  listModels(params?: ListModelsParams): Promise<ListModelsResult> {
    return this.request('model/list', params ?? {})
  }

  // ---------- MCP ----------

  listMcpServers(params?: { threadId?: string }): Promise<{ data: McpServerStatus[] }> {
    return this.request('mcpServerStatus/list', params ?? {})
  }

  reloadMcpServers(): Promise<void> {
    return this.request('config/mcpServer/reload', undefined)
  }

  // ---------- Goals / plan ----------

  getThreadGoal(params: ThreadGoalGetParams): Promise<ThreadGoalGetResponse> {
    return this.request('thread/goal/get', params)
  }

  setThreadGoal(params: ThreadGoalSetParams): Promise<ThreadGoalSetResponse> {
    return this.request('thread/goal/set', params)
  }

  clearThreadGoal(params: ThreadGoalClearParams): Promise<void> {
    return this.request('thread/goal/clear', params)
  }

  // ---------- Background terminals ----------

  listBackgroundTerminals(
    params: ThreadBackgroundTerminalsListParams,
  ): Promise<ThreadBackgroundTerminalsListResponse> {
    return this.request('thread/backgroundTerminals/list', params)
  }

  terminateBackgroundTerminal(
    params: ThreadBackgroundTerminalsTerminateParams,
  ): Promise<ThreadBackgroundTerminalsTerminateResponse> {
    return this.request('thread/backgroundTerminals/terminate', params)
  }

  cleanBackgroundTerminals(
    params: ThreadBackgroundTerminalsCleanParams,
  ): Promise<void> {
    return this.request('thread/backgroundTerminals/clean', params)
  }

  // ---------- Hooks / collaboration / memory ----------

  listHooks(): Promise<HooksListResponse> {
    return this.request('hooks/list', {})
  }

  listCollaborationModes(): Promise<CollaborationModeListResponse> {
    return this.request('collaborationMode/list', {})
  }

  setThreadMemoryMode(params: ThreadMemoryModeSetParams): Promise<void> {
    return this.request('thread/memoryMode/set', params)
  }

  resetMemory(): Promise<void> {
    return this.request('memory/reset', {})
  }

  approveGuardianDeniedAction(
    params: ThreadApproveGuardianDeniedActionParams,
  ): Promise<void> {
    return this.request('thread/approveGuardianDeniedAction', params)
  }

  // ---------- Server request responses ----------

  respondToRequest(id: JsonRpcId, result: unknown): void {
    this.writeResponse({ id, result })
  }

  respondToRequestError(
    id: JsonRpcId,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.writeResponse({ id, error: { code, message, data } })
  }

  // ---------- Events ----------

  onNotification(
    handler: (notification: AppServerNotification) => void,
  ): () => void {
    this.notificationListeners.add(handler)
    return () => {
      this.notificationListeners.delete(handler)
    }
  }

  onRequest(handler: (request: JsonRpcRequest) => void): () => void {
    this.requestListeners.add(handler)
    return () => {
      this.requestListeners.delete(handler)
    }
  }

  onStatus(handler: (status: CodexAppServerClientStatus) => void): () => void {
    this.statusListeners.add(handler)
    return () => {
      this.statusListeners.delete(handler)
    }
  }

  // ---------- Internal helpers ----------

  private setStatus(next: CodexAppServerClientStatus) {
    this.status = next
    for (const listener of this.statusListeners) {
      try {
        listener(next)
      } catch {
        // ignore listener errors
      }
    }
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[key] = value
      }
    }
    if (this.opts.env) {
      for (const [key, value] of Object.entries(this.opts.env)) {
        if (value === undefined) continue
        env[key] = value
      }
    }
    if (this.opts.codexHome) {
      env.CODEX_HOME = this.opts.codexHome
    }
    env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'codex_app_server_client'
    env.CODEX_MANAGED_PACKAGE_ROOT = this.resolution.packageRoot
    return env
  }

  private async waitForUnixSocket(socketPath: string): Promise<void> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (existsSync(socketPath)) return
      if (this.status === 'crashed') {
        throw new Error('Codex app-server exited before the unix socket appeared.')
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(
      `Timed out waiting for Codex app-server unix socket at ${socketPath}.`,
    )
  }

  private handleLine(rawLine: string): void {
    const trimmed = rawLine.trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      this.emit('parseError', { raw: rawLine, error: String(err) })
      return
    }
    const message = classifyMessage(parsed)
    if (message.kind === 'response') {
      this.handleResponse(message.response)
    } else if (message.kind === 'notification') {
      this.handleNotification(message.notification)
    } else if (message.kind === 'request') {
      this.handleServerRequest(message.request)
    } else if (message.kind === 'parse-error') {
      this.emit('parseError', { raw: message.raw, error: message.error })
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) {
      this.emit('orphanResponse', response)
      return
    }
    this.pending.delete(response.id)
    if (pending.timer) clearTimeout(pending.timer)
    if (response.error) {
      pending.reject(
        new CodexAppServerError(response.error.message, response.error.code, response.error.data),
      )
    } else {
      pending.resolve(response.result)
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    for (const listener of this.notificationListeners) {
      try {
        listener(notification as AppServerNotification)
      } catch (err) {
        this.emit('listenerError', err)
      }
    }
    this.emit('notification', notification)
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    for (const listener of this.requestListeners) {
      try {
        listener(request)
      } catch (err) {
        this.emit('listenerError', err)
      }
    }
    this.emit('request', request)
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.status === 'shuttingDown' || this.status === 'closed') {
      this.setStatus('closed')
      this.emit('exit', { code, signal, graceful: true })
      return
    }
    const err = new Error(
      `Codex app-server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
    )
    this.setStatus('crashed')
    this.rejectAllPending(err)
    this.emit('exit', { code, signal, graceful: false })
  }

  private cleanup(): void {
    const child = this.child
    this.child = null
    if (child) {
      try {
        if (!child.killed) child.kill()
      } catch {
        // ignore
      }
    }
    if (this.unixSocketDir) {
      try {
        if (existsSync(this.opts.transport.type === 'unix' ? this.opts.transport.socketPath : '')) {
          if (this.opts.transport.type === 'unix') {
            unlinkSync(this.opts.transport.socketPath)
          }
        }
      } catch {
        // ignore
      }
    }
    this.setStatus('closed')
  }

  private request<P, R>(
    method: string,
    params: P | undefined,
    timeoutMs?: number,
  ): Promise<R> {
    if (!this.child || (this.status !== 'ready' && this.status !== 'initializing')) {
      return Promise.reject(
        new Error(`Cannot send ${method}: app-server is not running (status=${this.status}).`),
      )
    }
    const id = ++this.nextRequestId
    const message: JsonRpcRequest<P> = params === undefined
      ? { id, method }
      : { id, method, params }
    return new Promise<R>((resolve, reject) => {
      const timer =
        timeoutMs ?? this.opts.requestTimeoutMs
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(new Error(`Codex app-server request ${method} (id=${id}) timed out.`))
            }, timeoutMs ?? this.opts.requestTimeoutMs)
          : null
      if (timer && typeof timer.unref === 'function') timer.unref()
      this.pending.set(id, {
        method,
        resolve: value => resolve(value as R),
        reject,
        timer,
      })
      try {
        this.child!.stdin!.write(`${JSON.stringify(message)}\n`)
      } catch (err) {
        this.pending.delete(id)
        if (timer) clearTimeout(timer)
        reject(err as Error)
      }
    })
  }

  private notify<P>(method: string, params: P | undefined): void {
    if (!this.child) return
    const message: JsonRpcNotification<P> = params === undefined
      ? { method }
      : { method, params }
    try {
      this.child.stdin!.write(`${JSON.stringify(message)}\n`)
    } catch (err) {
      this.emit('error', err)
    }
  }

  private writeResponse(response: JsonRpcResponse): void {
    if (!this.child) return
    try {
      this.child.stdin!.write(`${JSON.stringify(response)}\n`)
    } catch (err) {
      this.emit('error', err)
    }
  }
}

function classifyMessage(value: unknown): JsonRpcMessage {
  if (!value || typeof value !== 'object') {
    return { kind: 'parse-error', raw: String(value), error: 'not an object' }
  }
  const obj = value as Record<string, unknown>
  const hasId = 'id' in obj
  const hasMethod = typeof obj.method === 'string'
  const hasResult = 'result' in obj
  const hasError = 'error' in obj
  if (hasId && (hasResult || hasError)) {
    return { kind: 'response', response: obj as unknown as JsonRpcResponse }
  }
  if (hasMethod && !hasId) {
    return { kind: 'notification', notification: obj as unknown as JsonRpcNotification }
  }
  if (hasId && hasMethod) {
    return { kind: 'request', request: obj as unknown as JsonRpcRequest }
  }
  return { kind: 'parse-error', raw: JSON.stringify(value), error: 'unrecognized message shape' }
}

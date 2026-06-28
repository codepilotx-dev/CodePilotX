import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexAppServerClientStatus,
  type AppServerNotification,
  type JsonRpcId,
  type JsonRpcRequest,
  type SandboxMode,
  type SandboxPolicy,
} from '@codepilotx/codex-app-server-client'

export type DesktopHeadlessThinkingMode =
  | 'default'
  | 'enabled'
  | 'adaptive'
  | 'disabled'

export type DesktopHeadlessOutputControls = {
  injectControlResponse(response: Record<string, unknown>): void
}

export type DesktopHeadlessRuntimeOptions = {
  sessionId: string
  workspacePath: string
  configDirectoryPath?: string
  resumeExistingSession?: boolean
  permissionProfile?: string
  sandboxMode?: SandboxMode
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  permissionMode?: string
  providerID?: string
  providerBaseURL?: string
  codexAppServerThreadId?: string | null
  onCodexAppServerThreadId?(threadId: string): void
  debugConversationDump?: boolean
  model?: string
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode?: DesktopHeadlessThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  askUserQuestionMaxQuestions?: number
  permissionPromptToolName?: string
  onOutput(
    message: Record<string, unknown>,
    controls: DesktopHeadlessOutputControls,
  ): Promise<void> | void
}

export type DesktopHeadlessCodexPermissionConfig = {
  permissionProfile?: string
  sandboxMode?: SandboxMode
  approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
}

export type DesktopHeadlessRuntime = {
  setModel(model: string | undefined): void
  setProvider(
    providerID: string | undefined,
    providerBaseURL: string | undefined,
  ): void
  setDebugConversationDump(enabled: boolean): void
  setPermissionMode(permissionMode: string | undefined): void
  setCodexPermissionConfig(config: DesktopHeadlessCodexPermissionConfig): void
  runUserTurn(
    content: string | Array<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void>
  runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>
  /** Tear down the underlying app-server subprocess. Safe to call multiple times. */
  dispose(): Promise<void>
}

const CODEX_DESKTOP_CLIENT_INFO = {
  name: 'codepilotx_desktop',
  title: 'CodePilotX Desktop',
  version: '0.0.0-local',
}

export function sandboxPolicyForTurnSandboxMode(
  sandboxMode: SandboxMode,
): SandboxPolicy {
  switch (sandboxMode) {
    case 'read-only':
      return { type: 'readOnly', networkAccess: false }
    case 'workspace-write':
      return {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      }
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
  }
}

type ActiveTurn = {
  turnId: string
  threadId: string
  input: Array<Record<string, unknown>>
  controls: DesktopHeadlessOutputControls
  signal: AbortSignal
  assistantText: string
  toolNameByUseId: Map<string, string>
  resolvedToolInputs: Map<string, Record<string, unknown>>
  reasoningSummaryByItemId: Map<string, string>
  reasoningContentByItemId: Map<string, string>
  outputByCommandItemId: Map<string, string>
  resolveDone: () => void
  rejectDone: (err: Error) => void
  finish: (err?: Error) => void
}

function unixSocketPathFromOptions(
  options: DesktopHeadlessRuntimeOptions,
): string {
  const base = options.configDirectoryPath ?? ''
  const safeBase = base.replace(/[\\/:*?"<>|]/g, '_') || 'codepilotx-desktop'
  // socket path length is limited on macOS/Linux (~104 chars), keep it short.
  return `${safeBase.slice(0, 64)}-app-server.sock`
}

export function createDesktopHeadlessRuntime(
  options: DesktopHeadlessRuntimeOptions,
): DesktopHeadlessRuntime {
  return new CodexAppServerDesktopHeadlessRuntime(options)
}

export async function runDesktopHeadlessTurn(
  runtime: DesktopHeadlessRuntime,
  content: string | Array<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<void> {
  await runtime.runUserTurn(content, signal)
}

export async function runDesktopHeadlessControlResponse(
  runtime: DesktopHeadlessRuntime,
  response: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  await runtime.runControlResponse(response, signal)
}

class CodexAppServerDesktopHeadlessRuntime implements DesktopHeadlessRuntime {
  private readonly options: DesktopHeadlessRuntimeOptions
  private client: CodexAppServerClient | null = null
  private clientInitPromise: Promise<CodexAppServerClient> | null = null
  private activeTurn: ActiveTurn | null = null
  private threadId: string | null = null
  private disposePromise: Promise<void> | null = null
  private readonly unixSocketPath: string

  constructor(options: DesktopHeadlessRuntimeOptions) {
    this.options = options
    this.unixSocketPath = unixSocketPathFromOptions(options)
    if (options.configDirectoryPath) {
      process.env.CODEX_HOME = options.configDirectoryPath
    }
  }

  setModel(model: string | undefined): void {
    this.options.model = model
  }

  setProvider(
    providerID: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.options.providerID = providerID
    this.options.providerBaseURL = providerBaseURL
  }

  setDebugConversationDump(_enabled: boolean): void {
    // Reserved for future use; Codex app-server doesn't expose conversation dumps yet.
    this.options.debugConversationDump = _enabled
  }

  setPermissionMode(permissionMode: string | undefined): void {
    this.options.permissionMode = permissionMode
  }

  setCodexPermissionConfig(config: DesktopHeadlessCodexPermissionConfig): void {
    this.options.permissionProfile = config.permissionProfile
    this.options.sandboxMode = config.sandboxMode
    this.options.approvalPolicy = config.approvalPolicy
    this.options.approvalsReviewer = config.approvalsReviewer
  }

  async runUserTurn(
    content: string | Array<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.model?.trim()) {
      throw new Error('Desktop headless runtime requires a specific model.')
    }
    const client = await this.ensureClient()
    if (signal.aborted) return

    const threadId = await this.ensureThread(client)
    const input = normalizeInput(content)
    const turn = await this.startTurn(client, threadId, input, signal)
    await turn.donePromise
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.model?.trim()) {
      throw new Error('Desktop headless runtime requires a specific model.')
    }
    const client = await this.ensureClient()
    if (signal.aborted) return

    const threadId = await this.ensureThread(client)
    const input = responseToInput(response)
    await this.startTurn(client, threadId, input, signal).donePromise
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposePromise = (async () => {
      const client = this.client
      this.client = null
      this.clientInitPromise = null
      this.threadId = null
      if (client) {
        try {
          await client.shutdown()
        } catch {
          // ignore: best effort
        }
      }
    })()
    return this.disposePromise
  }

  // ---------- Internals ----------

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client) return this.client
    if (this.clientInitPromise) return this.clientInitPromise
    this.clientInitPromise = (async () => {
      const clientOptions: CodexAppServerClientOptions = {
        transport:
          process.platform === 'win32'
            ? { type: 'stdio' }
            : { type: 'unix', socketPath: this.unixSocketPath },
        clientInfo: CODEX_DESKTOP_CLIENT_INFO,
        ...(this.options.configDirectoryPath
          ? { codexHome: this.options.configDirectoryPath }
          : {}),
      }
      const client = new CodexAppServerClient(clientOptions)
      client.onNotification(notification => {
        this.handleNotification(notification)
      })
      client.onRequest(request => {
        void this.handleServerRequest(request)
      })
      client.onStatus(status => {
        logDesktopHeadless('client_status', { status })
      })
      await client.start()
      this.client = client
      // Apply initial provider / model configuration to config.toml so the
      // first turn uses them. Subsequent setModel/setProvider calls go
      // through the same path.
      await this.applyProviderConfig(client).catch(err => {
        logDesktopHeadless('apply_provider_config_failed', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
      return client
    })()
    try {
      return await this.clientInitPromise
    } catch (err) {
      this.clientInitPromise = null
      throw err
    }
  }

  private async applyProviderConfig(client: CodexAppServerClient): Promise<void> {
    const providerID = this.options.providerID?.trim()
    const model = this.options.model?.trim()
    if (!providerID && !model) return
    const edits: Array<{ keyPath: string; value: unknown; mergeStrategy: 'replace' }> = []
    if (model) {
      edits.push({ keyPath: 'model', value: model, mergeStrategy: 'replace' })
    }
    if (providerID) {
      edits.push({
        keyPath: 'model_provider',
        value: providerID,
        mergeStrategy: 'replace',
      })
    }
    if (this.options.providerBaseURL?.trim()) {
      edits.push({
        keyPath: `model_providers.${providerID}.base_url`,
        value: this.options.providerBaseURL.trim(),
        mergeStrategy: 'replace',
      })
    }
    if (providerID) {
      edits.push({
        keyPath: `model_providers.${providerID}.name`,
        value: providerID,
        mergeStrategy: 'replace',
      })
    }
    if (this.options.approvalPolicy) {
      edits.push({
        keyPath: 'approval_policy',
        value: this.options.approvalPolicy,
        mergeStrategy: 'replace',
      })
    }
    if (this.options.sandboxMode) {
      const sandbox = this.options.sandboxMode
      edits.push({
        keyPath: 'sandbox',
        value: sandbox === 'workspace-write' ? 'workspaceWrite' : sandbox,
        mergeStrategy: 'replace',
      })
    }
    if (edits.length === 0) return
    await client.configBatchWrite(edits, { reloadUserConfig: false })
  }

  private async ensureThread(client: CodexAppServerClient): Promise<string> {
    if (this.threadId) return this.threadId
    const savedThreadId = this.options.codexAppServerThreadId?.trim()
    let threadId: string
    if (savedThreadId) {
      try {
        const resumed = await client.resumeThread(savedThreadId)
        threadId = resumed.thread.id
        logDesktopHeadless('thread_resumed', { threadId })
      } catch {
        const started = await this.startThread(client)
        threadId = started.thread.id
      }
    } else {
      const started = await this.startThread(client)
      threadId = started.thread.id
    }
    this.rememberThreadId(threadId)
    return threadId
  }

  private rememberThreadId(threadId: string): void {
    this.threadId = threadId
    this.options.codexAppServerThreadId = threadId
    try {
      this.options.onCodexAppServerThreadId?.(threadId)
    } catch (err) {
      logDesktopHeadless('thread_id_callback_failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async startThread(client: CodexAppServerClient) {
    const params: Parameters<typeof client.startThread>[0] = {
      cwd: this.options.workspacePath,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.providerID
        ? { modelProvider: this.options.providerID }
        : {}),
      ...(this.options.approvalPolicy
        ? { approvalPolicy: this.options.approvalPolicy }
        : {}),
      ...(this.options.approvalsReviewer
        ? { approvalsReviewer: this.options.approvalsReviewer }
        : {}),
      ...(this.options.sandboxMode
        ? {
            sandbox:
              this.options.sandboxMode === 'workspace-write'
                ? 'workspace-write'
                : this.options.sandboxMode,
          }
        : {}),
    }
    return client.startThread(params)
  }

  private startTurn(
    client: CodexAppServerClient,
    threadId: string,
    input: Array<Record<string, unknown>>,
    signal: AbortSignal,
  ): { donePromise: Promise<void> } {
    const donePromise = new Promise<void>((resolve, reject) => {
      const turn: ActiveTurn = {
        turnId: '',
        threadId,
        input,
        controls: {
          injectControlResponse: _response => {
            // Phase 2 stub: control responses are sent via approval RPCs.
          },
        },
        signal,
        assistantText: '',
        toolNameByUseId: new Map(),
        resolvedToolInputs: new Map(),
        reasoningSummaryByItemId: new Map(),
        reasoningContentByItemId: new Map(),
        outputByCommandItemId: new Map(),
        resolveDone: () => resolve(),
        rejectDone: err => reject(err),
        finish: () => {},
      }
      this.activeTurn = turn

      const cleanupAbort = () => {
        signal.removeEventListener('abort', onAbort)
      }

      const finish = (err?: Error) => {
        if (turn.resolveDone === noopResolve && turn.rejectDone === noopReject) {
          return
        }
        if (this.activeTurn === turn) {
          this.activeTurn = null
        }
        cleanupAbort()
        const resolveFn = turn.resolveDone
        const rejectFn = turn.rejectDone
        // prevent double resolution
        turn.resolveDone = noopResolve
        turn.rejectDone = noopReject
        if (err) rejectFn(err)
        else resolveFn()
      }
      turn.finish = finish

      const onAbort = () => {
        const interruptPromise = turn.turnId
          ? client
              .interruptTurn({ threadId, turnId: turn.turnId })
              .catch(err => {
                logDesktopHeadless('interrupt_failed', {
                  message: err instanceof Error ? err.message : String(err),
                })
              })
          : Promise.resolve()
        interruptPromise.finally(() => finish())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        finish()
        return
      }

      client
        .startTurn({
          threadId,
          input: input as never,
          cwd: this.options.workspacePath,
          ...(this.options.model ? { model: this.options.model } : {}),
          ...(this.options.approvalPolicy
            ? { approvalPolicy: this.options.approvalPolicy }
            : {}),
          ...(this.options.approvalsReviewer
            ? { approvalsReviewer: this.options.approvalsReviewer }
            : {}),
          ...(this.options.sandboxMode
            ? {
                sandboxPolicy: sandboxPolicyForTurnSandboxMode(
                  this.options.sandboxMode,
                ),
              }
            : {}),
          ...(this.options.systemPrompt
            ? { personality: 'none' }
            : {}),
        })
        .then(result => {
          turn.turnId = result.turn.id
          logDesktopHeadless('turn_started', {
            threadId,
            turnId: turn.turnId,
          })
        })
        .catch(err => {
          finish(err instanceof Error ? err : new Error(String(err)))
        })
    })
    return { donePromise }
  }

  private handleNotification(notification: AppServerNotification): void {
    const turn = this.activeTurn
    if (!turn) return
    const signal = turn.signal
    if (signal.aborted) return

    switch (notification.method) {
      case 'item/agentMessage/delta': {
        const params = notification.params as { delta: string; itemId: string }
        const delta = params.delta ?? ''
        turn.assistantText += delta
        void this.emit(turn, {
          type: 'stream_event',
          event:
            delta && delta.length > 0
              ? {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: delta },
                }
              : { type: 'content_block_stop', index: 0 },
        })
        return
      }
      case 'item/commandExecution/outputDelta': {
        const params = notification.params as { itemId: string; delta: string }
        const itemId = params.itemId ?? ''
        const delta = params.delta ?? ''
        turn.outputByCommandItemId.set(
          itemId,
          (turn.outputByCommandItemId.get(itemId) ?? '') + delta,
        )
        if (delta) {
          void this.emit(turn, {
            type: 'tool_result',
            tool_use_id: itemId,
            output: delta,
            is_error: false,
          })
        }
        return
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const params = notification.params as { itemId: string; delta: string }
        const itemId = params.itemId ?? ''
        const delta = params.delta ?? ''
        const summary =
          notification.method === 'item/reasoning/summaryTextDelta'
            ? (turn.reasoningSummaryByItemId.get(itemId) ?? '') + delta
            : turn.reasoningSummaryByItemId.get(itemId) ?? ''
        const content =
          notification.method === 'item/reasoning/textDelta'
            ? (turn.reasoningContentByItemId.get(itemId) ?? '') + delta
            : turn.reasoningContentByItemId.get(itemId) ?? ''
        turn.reasoningSummaryByItemId.set(itemId, summary)
        turn.reasoningContentByItemId.set(itemId, content)
        void this.emit(turn, {
          type: 'thinking',
          thinking: { summary, content, delta },
        })
        return
      }
      case 'item/reasoning/summaryPartAdded': {
        const params = notification.params as { itemId: string; text?: string }
        const itemId = params.itemId ?? ''
        const delta = params.text ?? ''
        const summary = (turn.reasoningSummaryByItemId.get(itemId) ?? '') + delta
        turn.reasoningSummaryByItemId.set(itemId, summary)
        void this.emit(turn, {
          type: 'thinking',
          thinking: {
            summary,
            content: turn.reasoningContentByItemId.get(itemId) ?? '',
            delta,
          },
        })
        return
      }
      case 'item/started': {
        const params = notification.params as { item: Record<string, unknown> }
        this.onItemStarted(turn, params.item)
        return
      }
      case 'item/completed': {
        const params = notification.params as { item: Record<string, unknown> }
        this.onItemCompleted(turn, params.item)
        return
      }
      case 'turn/completed': {
        const params = notification.params as { turn: { status: string; error?: { message: string } } }
        const turnResult = params.turn
        void this.emit(turn, {
          type: 'result',
          subtype: turnResult.status === 'failed' ? 'error' : 'success',
          is_error: turnResult.status === 'failed',
          ...(turnResult.error ? { errors: [turnResult.error.message] } : {}),
        })
        if (turnResult.status === 'failed') {
          turn.finish(
            new Error(turnResult.error?.message ?? 'Codex turn failed.'),
          )
        } else {
          turn.finish()
        }
        return
      }
      case 'error': {
        const params = notification.params as { message: string }
        void this.emit(turn, {
          type: 'result',
          subtype: 'error',
          is_error: true,
          errors: [params.message],
        })
        turn.finish(new Error(params.message))
        return
      }
      case 'thread/tokenUsage/updated': {
        const params = notification.params as {
          tokenUsage?: {
            last?: Record<string, unknown>
            total?: Record<string, unknown>
            modelContextWindow?: number
          }
        }
        const usage = params.tokenUsage?.last ?? params.tokenUsage?.total ?? {}
        void this.emit(turn, {
          type: 'usage',
          usage: {
            input_tokens: usage.inputTokens,
            cached_input_tokens: usage.cachedInputTokens,
            output_tokens: usage.outputTokens,
            reasoning_output_tokens: usage.reasoningOutputTokens,
            total_tokens: usage.totalTokens,
            model_context_window: params.tokenUsage?.modelContextWindow,
          },
        })
        return
      }
      default:
        // ignore other notifications for now
        return
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const turn = this.activeTurn
    const client = this.client
    if (!turn || turn.signal.aborted || !client) {
      client?.respondToRequestError(
        request.id,
        -32000,
        'No active desktop turn is available for this request.',
      )
      return
    }
    try {
      switch (request.method) {
        case 'item/commandExecution/requestApproval':
          await this.handleCommandApproval(
            turn,
            request.id,
            request.params as never,
          )
          return
        case 'item/fileChange/requestApproval':
          await this.handleFileChangeApproval(
            turn,
            request.id,
            request.params as never,
          )
          return
        case 'item/permissions/requestApproval':
          await this.handlePermissionsApproval(
            turn,
            request.id,
            request.params as never,
          )
          return
        case 'item/tool/requestUserInput':
          await this.handleAskUserQuestion(
            turn,
            request.id,
            request.params as never,
          )
          return
        default:
          client.respondToRequestError(
            request.id,
            -32601,
            `Unsupported server request: ${request.method}`,
          )
      }
    } catch (err) {
      client.respondToRequestError(
        request.id,
        -32000,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  private onItemStarted(turn: ActiveTurn, item: Record<string, unknown>): void {
    const type = item.type
    if (type === 'commandExecution') {
      const id = typeof item.id === 'string' ? item.id : ''
      const command = typeof item.command === 'string' ? item.command : ''
      turn.toolNameByUseId.set(id, 'Bash')
      void this.emit(turn, {
        type: 'tool_start',
        tool: 'Bash',
        tool_use_id: id,
        summary: command,
      })
    } else if (type === 'fileEdit' || type === 'fileChange') {
      const id = typeof item.id === 'string' ? item.id : ''
      turn.toolNameByUseId.set(id, 'Edit')
      const path = typeof item.path === 'string' ? item.path : ''
      void this.emit(turn, {
        type: 'tool_start',
        tool: 'Edit',
        tool_use_id: id,
        summary: path,
      })
    } else if (type === 'todoList') {
      const id = typeof item.id === 'string' ? item.id : ''
      turn.toolNameByUseId.set(id, 'TodoList')
      void this.emit(turn, {
        type: 'tool_start',
        tool: 'TodoList',
        tool_use_id: id,
        summary: summarizeTodoList(item.items),
      })
    } else if (type === 'webSearch') {
      const id = typeof item.id === 'string' ? item.id : ''
      const query = typeof item.query === 'string' ? item.query : ''
      turn.toolNameByUseId.set(id, 'WebSearch')
      void this.emit(turn, {
        type: 'tool_start',
        tool: 'WebSearch',
        tool_use_id: id,
        summary: query,
      })
    } else if (type === 'mcpToolCall') {
      const id = typeof item.id === 'string' ? item.id : ''
      const server = typeof item.server === 'string' ? item.server : ''
      const tool = typeof item.tool === 'string' ? item.tool : ''
      const toolName = `mcp__${server}__${tool}`
      turn.toolNameByUseId.set(id, toolName)
      void this.emit(turn, {
        type: 'tool_start',
        tool: toolName,
        tool_use_id: id,
        summary: tool,
      })
    } else if (type === 'agentMessage') {
      // Full message eventually delivered via item/completed
      void this.emit(turn, {
        type: 'message_start',
        message: { role: 'assistant', content: '' },
      })
    }
  }

  private onItemCompleted(turn: ActiveTurn, item: Record<string, unknown>): void {
    const type = item.type
    if (type === 'agentMessage') {
      const text = typeof item.text === 'string' ? item.text : ''
      void this.emit(turn, {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      })
      turn.assistantText = text
    } else if (type === 'commandExecution') {
      const id = typeof item.id === 'string' ? item.id : ''
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
      const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
      void this.emit(turn, {
        type: 'tool_result',
        tool_use_id: id,
        output: output || (exitCode === 0 ? '(completed)' : `exit ${exitCode ?? '?'}`),
        is_error: exitCode !== null && exitCode !== 0,
      })
    } else if (type === 'fileEdit' || type === 'fileChange') {
      const id = typeof item.id === 'string' ? item.id : ''
      const diff =
        typeof item.diff === 'string'
          ? item.diff
          : item.changes
            ? JSON.stringify(item.changes)
            : ''
      void this.emit(turn, {
        type: 'tool_result',
        tool_use_id: id,
        output: diff,
        is_error: false,
      })
    } else if (type === 'reasoning') {
      const summary = textFromReasoningPart(item.summary)
      const content = textFromReasoningPart(item.content)
      void this.emit(turn, {
        type: 'thinking',
        thinking: { summary, content },
      })
    } else if (type === 'todoList') {
      const id = typeof item.id === 'string' ? item.id : ''
      void this.emit(turn, {
        type: 'tool_result',
        tool_use_id: id,
        output: summarizeTodoList(item.items),
        is_error: false,
      })
    } else if (type === 'mcpToolCall') {
      const id = typeof item.id === 'string' ? item.id : ''
      const result = item.result
      const error = item.error
      void this.emit(turn, {
        type: 'tool_result',
        tool_use_id: id,
        output: error
          ? (error as { message?: string }).message ?? 'tool failed'
          : JSON.stringify(result ?? {}),
        is_error: Boolean(error),
      })
    } else if (type === 'error') {
      const message = typeof item.message === 'string' ? item.message : 'agent error'
      void this.emit(turn, {
        type: 'result',
        subtype: 'error',
        is_error: true,
        errors: [message],
      })
      turn.rejectDone(new Error(message))
    }
  }

  private async handleCommandApproval(
    turn: ActiveTurn,
    requestId: JsonRpcId,
    params: {
      threadId: string
      turnId: string
      itemId: string
      command: string
      reason?: string
    },
  ): Promise<void> {
    const decision = await this.requestDecisionViaOnOutput(turn, {
      type: 'control_request',
      request_id: params.itemId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: params.command },
        ...(params.reason ? { reason: params.reason } : {}),
      },
    })
    if (!this.client) return
    this.client.respondToRequest(requestId, {
      decision: decision?.behavior === 'allow' ? 'accept' : 'decline',
    })
  }

  private async handleFileChangeApproval(
    turn: ActiveTurn,
    requestId: JsonRpcId,
    params: {
      threadId: string
      turnId: string
      itemId: string
      reason?: string
      grantRoot?: string
    },
  ): Promise<void> {
    const decision = await this.requestDecisionViaOnOutput(turn, {
      type: 'control_request',
      request_id: params.itemId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        input: { path: params.grantRoot ?? '' },
        ...(params.reason ? { reason: params.reason } : {}),
      },
    })
    if (!this.client) return
    this.client.respondToRequest(requestId, {
      decision: decision?.behavior === 'allow' ? 'accept' : 'decline',
    })
  }

  private async handlePermissionsApproval(
    turn: ActiveTurn,
    requestId: JsonRpcId,
    params: {
      threadId: string
      turnId: string
      itemId: string
      cwd?: string
      reason?: string | null
      permissions: unknown
    },
  ): Promise<void> {
    const decision = await this.requestDecisionViaOnOutput(turn, {
      type: 'control_request',
      request_id: params.itemId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Permissions',
        input: {
          permissions: params.permissions,
          ...(params.cwd ? { cwd: params.cwd } : {}),
        },
        ...(params.reason ? { reason: params.reason } : {}),
      },
    })
    if (!this.client) return
    if (decision?.behavior === 'allow') {
      this.client.respondToRequest(requestId, {
        permissions: params.permissions,
        scope: 'session',
      })
    } else {
      this.client.respondToRequestError(
        requestId,
        -32001,
        decision?.message ?? 'denied by desktop',
      )
    }
  }

  private async handleAskUserQuestion(
    turn: ActiveTurn,
    requestId: JsonRpcId,
    params: {
      threadId: string
      turnId: string
      itemId: string
      questions: Array<{
        header: string
        question: string
        options: Array<{ label: string; description?: string }>
        multiSelect: boolean
      }>
    },
  ): Promise<void> {
    const decision = await this.requestDecisionViaOnOutput(turn, {
      type: 'control_request',
      request_id: params.itemId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: { questions: params.questions },
      },
    })
    if (!this.client) return
    if (decision?.behavior === 'allow' && decision.updatedInput) {
      const answers = answersFromUpdatedInput(decision.updatedInput)
      if (answers) {
        this.client.respondToRequest(requestId, { answers })
        return
      }
    }
    this.client.respondToRequest(requestId, { answers: {} })
  }

  private async requestDecisionViaOnOutput(
    turn: ActiveTurn,
    request: Record<string, unknown>,
  ): Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown } | null> {
    return new Promise(resolve => {
      const originalInject = turn.controls.injectControlResponse
      turn.controls.injectControlResponse = response => {
        turn.controls.injectControlResponse = originalInject
        resolve(extractDecision(response))
      }
      void this.emit(turn, request)
    })
  }

  private async emit(
    turn: ActiveTurn,
    message: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.options.onOutput(message, turn.controls)
    } catch (err) {
      logDesktopHeadless('on_output_threw', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ---------- Helpers ----------

function normalizeInput(
  content: string | Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content
}

function responseToInput(response: Record<string, unknown>): Array<Record<string, unknown>> {
  const wrapper = (response as { message?: { content?: unknown } }).message
  if (wrapper && typeof wrapper === 'object') {
    const inner = (wrapper as { content?: unknown }).content
    if (typeof inner === 'string') {
      return [{ type: 'text', text: inner }]
    }
    if (Array.isArray(inner)) {
      return inner as Array<Record<string, unknown>>
    }
  }
  return [{ type: 'text', text: JSON.stringify(response) }]
}

function extractDecision(response: unknown): {
  behavior: 'allow' | 'deny'
  message?: string
  updatedInput?: unknown
} | null {
  if (!response || typeof response !== 'object') return null
  const r = response as Record<string, unknown>
  if (typeof r.behavior === 'string') {
    return {
      behavior: r.behavior === 'allow' ? 'allow' : 'deny',
      ...(typeof r.message === 'string' ? { message: r.message } : {}),
      ...(r.updatedInput !== undefined ? { updatedInput: r.updatedInput } : {}),
    }
  }
  const responseField = (r.response as Record<string, unknown> | undefined)?.response as
    | Record<string, unknown>
    | undefined
  if (responseField && typeof responseField.allow_behavior === 'string') {
    return {
      behavior: responseField.allow_behavior === 'allow' ? 'allow' : 'deny',
      ...(typeof responseField.message === 'string' ? { message: responseField.message } : {}),
      ...(responseField.updatedInput !== undefined
        ? { updatedInput: responseField.updatedInput }
        : {}),
    }
  }
  return null
}

function answersFromUpdatedInput(
  updatedInput: unknown,
): Record<string, { answers: string[] }> | null {
  if (!updatedInput || typeof updatedInput !== 'object') return null
  const input = updatedInput as { answers?: unknown }
  const raw = input.answers
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, { answers: string[] }> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = { answers: value.filter(v => typeof v === 'string') as string[] }
    } else if (value && typeof value === 'object') {
      const arr = (value as { answers?: unknown }).answers
      if (Array.isArray(arr)) {
        out[key] = { answers: arr.filter(v => typeof v === 'string') as string[] }
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function textFromReasoningPart(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string').join('\n')
  }
  return ''
}

function summarizeTodoList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const record = item as Record<string, unknown>
      const text = typeof record.text === 'string' ? record.text : ''
      const completed =
        record.completed === true ||
        record.status === 'completed' ||
        record.status === 'done'
      return text ? `${completed ? '[x]' : '[ ]'} ${text}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function noopResolve(): void {}

function noopReject(_err: Error): void {}

function logDesktopHeadless(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const suffix =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : ''
  console.info(
    `[desktop-headless] ${new Date().toISOString()} ${event}${suffix}`,
  )
}

export type { CodexAppServerClientStatus }

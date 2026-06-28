import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { CodexAppServerClient } from '@codepilotx/codex-app-server-client'
import { parseProposedPlanText } from '@codepilotx/core/agent/proposedPlan.js'
import {
  planModeActiveFromCollaborationMode,
  resolveCodexCollaborationMode,
  type CodexCollaborationMode,
} from '@codepilotx/core/agent/codexSessionContract.js'
import type {
  DesktopHeadlessOutputControls,
  DesktopHeadlessRuntime,
} from '@codepilotx/tui/headless/desktopRuntime.js'
import type { StdoutMessage } from '@codepilotx/tui/entrypoints/sdk/controlTypes.js'
import type {
  AppServerNotification,
  CollaborationModeListResponse,
  FsReadDirectoryResponse,
  FsReadFileResponse,
  FuzzyFileSearchParams,
  FuzzyFileSearchResponse,
  HooksListResponse,
  JsonRpcId,
  JsonRpcRequest,
  Thread,
  ThreadReadResponse,
  ThreadBackgroundTerminal,
  Turn,
  UserInput,
} from '@codepilotx/codex-app-server-client'
import type {
  DesktopAgentEvent,
  DesktopAgentPickerEntry,
  DesktopBackgroundTerminal,
  DesktopCollaborationModePreset,
  DesktopHookListEntry,
  DesktopPermissionMode,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopThreadGoal,
  DesktopThreadGoalStatus,
  DesktopThinkingMode,
  DesktopUserMessageContent,
} from '../shared/types.js'
import type { PermissionMode } from '@codepilotx/core/agent/permissionMode.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  buildDesktopContextUsage,
  getUsageFromAssistantRecord,
} from './desktopContextUsage.js'
import {
  buildToolResultMetadata,
  extractPartialText,
  getMessageContent,
  getResultErrorMessage,
  getToolUseId,
  getUpdatedPermissions,
  summarizeToolInput,
} from './agentRuntimeSupport.js'
import { desktopDebug } from './desktopDebug.js'

export type DesktopAgentRuntimePreference =
  | 'auto'
  | 'app-server'
  | 'embedded-headless'
  | 'subprocess'

export type DesktopCodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'

export type DesktopCodexApprovalsReviewer = 'user' | 'auto_review'
type LegacyDesktopCodexApprovalsReviewer = 'auto'
export type DesktopCodexSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type DesktopAgentRuntimeContext = {
  sessionId: string
  workspacePath: string
  agentExecutablePath?: string
  configDirectoryPath?: string
  runtimePreference?: DesktopAgentRuntimePreference
  resumeExistingSession?: boolean
  permissionProfile?: string
  sandboxMode?: DesktopCodexSandboxMode
  approvalPolicy?: DesktopCodexApprovalPolicy
  approvalsReviewer?: DesktopCodexApprovalsReviewer | LegacyDesktopCodexApprovalsReviewer
  permissionMode?: DesktopPermissionMode
  collaborationMode?: CodexCollaborationMode
  planModeActive?: boolean
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
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  rustSearchAndDiffKernels?: boolean
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopAgentRuntime = {
  setModel(model: string | undefined): void
  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void
  setPermissionMode(permissionMode: DesktopPermissionMode): void
  setPlanModeActive(active: boolean): void
  setDebugConversationDump(enabled: boolean): void
  runUserTurn(content: DesktopUserMessageContent, signal: AbortSignal): Promise<void>
  runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>
  getThreadGoal(): Promise<DesktopThreadGoal | null>
  setThreadGoal(input: {
    objective?: string | null
    status?: DesktopThreadGoalStatus | null
    tokenBudget?: number | null
  }): Promise<DesktopThreadGoal>
  clearThreadGoal(): Promise<void>
  listBackgroundTerminals(): Promise<DesktopBackgroundTerminal[]>
  terminateBackgroundTerminal(processId: string): Promise<{ terminated: boolean }>
  cleanBackgroundTerminals(): Promise<void>
  listHooks(): Promise<DesktopHookListEntry[]>
  listCollaborationModes(): Promise<DesktopCollaborationModePreset[]>
  listAgentPickerEntries(): Promise<DesktopAgentPickerEntry[]>
  readAgentThread(threadId: string): Promise<ThreadReadResponse>
  sendAgentThreadMessage(threadId: string, content: DesktopUserMessageContent): Promise<void>
  interruptAgentThread(threadId: string): Promise<void>
  closeAgentThread(threadId: string): Promise<void>
  resumeAgentThread(threadId: string): Promise<ThreadReadResponse>
  forkThread(): Promise<Thread>
  trustHook(key: string, currentHash: string): Promise<void>
  readDirectory(path: string): Promise<FsReadDirectoryResponse>
  readFile(path: string): Promise<FsReadFileResponse>
  fuzzyFileSearch(params: FuzzyFileSearchParams): Promise<FuzzyFileSearchResponse>
}

let headlessQueue: Promise<void> = Promise.resolve()
const DESKTOP_ENABLED_THINKING_BUDGET = 1_000_000_000
const SUBPROCESS_STDERR_BUFFER_LIMIT = 16 * 1024
const APP_SERVER_CLIENT_INFO = {
  name: 'codepilotx_desktop',
  title: 'CodePilotX Desktop',
  version: '0.0.0-local',
} as const

type DesktopHeadlessModule = typeof import('@codepilotx/tui/headless/desktopRuntime.js')

let desktopHeadlessModulePromise: Promise<DesktopHeadlessModule> | null = null

function loadDesktopHeadlessModule(): Promise<DesktopHeadlessModule> {
  desktopHeadlessModulePromise ??= import('@codepilotx/tui/headless/desktopRuntime.js')
  return desktopHeadlessModulePromise
}

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = headlessQueue.then(operation, operation)
  headlessQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function appendCappedText(
  current: string,
  next: string,
  maxLength: number,
): string {
  if (maxLength <= 0) {
    return ''
  }
  const combined = current + next
  return combined.length <= maxLength
    ? combined
    : combined.slice(combined.length - maxLength)
}

export function createDesktopAgentRuntime(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntime {
  context = normalizeDesktopAgentRuntimeContext(context)
  const preference = context.runtimePreference ?? 'auto'
  if (preference === 'auto' || preference === 'app-server') {
    desktopDebug('runtime_create_app_server', {
      sessionId: context.sessionId,
      preference,
    })
    return new AppServerDesktopAgentRuntime(
      context,
      preference === 'auto'
        ? () => new InProcessDesktopAgentRuntime(context)
        : undefined,
    )
  }
  if (preference === 'subprocess') {
    desktopDebug('runtime_create_subprocess', {
      sessionId: context.sessionId,
      preference,
    })
    return new CliDesktopAgentRuntime(context)
  }
  try {
    desktopDebug('runtime_create_embedded', {
      sessionId: context.sessionId,
      preference,
    })
    return new InProcessDesktopAgentRuntime(context)
  } catch (error) {
    desktopDebug('runtime_create_embedded_failed', {
      sessionId: context.sessionId,
      preference,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function normalizeDesktopAgentRuntimeContext(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntimeContext {
  const collaborationMode = resolveCodexCollaborationMode({
    collaborationMode: context.collaborationMode,
    planModeActive: context.planModeActive,
  })
  return {
    ...context,
    collaborationMode,
    planModeActive: planModeActiveFromCollaborationMode(collaborationMode),
  }
}

class AppServerDesktopAgentRuntime implements DesktopAgentRuntime {
  private client: CodexAppServerClient | null = null
  private fallback: DesktopAgentRuntime | null = null
  private appServerReady = false
  private threadId: string | null
  private currentTurnId: string | null = null
  private currentTurnResolve: (() => void) | null = null
  private currentTurnReject: ((error: Error) => void) | null = null
  private readonly completedTurns = new Map<string, Error | null>()

  constructor(
    private readonly context: DesktopAgentRuntimeContext,
    private readonly createFallback?: () => DesktopAgentRuntime,
  ) {
    this.threadId = context.codexAppServerThreadId?.trim() || null
  }

  setModel(model: string | undefined): void {
    this.context.model = model
    this.fallback?.setModel(model)
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    this.setModel(model)
    this.fallback?.setModelProvider(providerID, model, providerBaseURL)
  }

  setPermissionMode(permissionMode: DesktopPermissionMode): void {
    this.context.permissionMode = permissionMode
    this.fallback?.setPermissionMode(permissionMode)
  }

  setPlanModeActive(active: boolean): void {
    this.context.collaborationMode = resolveCodexCollaborationMode({
      planModeActive: active,
    })
    this.context.planModeActive = active
    this.fallback?.setPlanModeActive(active)
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
    this.fallback?.setDebugConversationDump(enabled)
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.runUserTurnWithAppServer(content, signal)
    } catch (error) {
      if (!this.createFallback || this.appServerReady) {
        throw error
      }
      desktopDebug('runtime_app_server_fallback', {
        sessionId: this.context.sessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      this.fallback ??= this.createFallback()
      await this.fallback.runUserTurn(content, signal)
    }
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.fallback) {
      await this.fallback.runControlResponse(response, signal)
    }
  }

  async getThreadGoal(): Promise<DesktopThreadGoal | null> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    const result = await client.getThreadGoal({ threadId })
    return result.goal ? mapThreadGoal(result.goal) : null
  }

  async setThreadGoal(input: {
    objective?: string | null
    status?: DesktopThreadGoalStatus | null
    tokenBudget?: number | null
  }): Promise<DesktopThreadGoal> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    const result = await client.setThreadGoal({
      threadId,
      objective: input.objective,
      status: input.status,
      tokenBudget: input.tokenBudget,
    })
    return mapThreadGoal(result.goal)
  }

  async clearThreadGoal(): Promise<void> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    await client.clearThreadGoal({ threadId })
  }

  async listBackgroundTerminals(): Promise<DesktopBackgroundTerminal[]> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    const terminals: DesktopBackgroundTerminal[] = []
    let cursor: string | null | undefined = undefined
    do {
      const result = await client.listBackgroundTerminals({
        threadId,
        cursor,
      })
      terminals.push(...result.data.map(mapBackgroundTerminal))
      cursor = result.nextCursor
    } while (cursor)
    return terminals
  }

  async terminateBackgroundTerminal(
    processId: string,
  ): Promise<{ terminated: boolean }> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    return client.terminateBackgroundTerminal({ threadId, processId })
  }

  async cleanBackgroundTerminals(): Promise<void> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    await client.cleanBackgroundTerminals({ threadId })
  }

  async listHooks(): Promise<DesktopHookListEntry[]> {
    const client = await this.ensureClient()
    const result = await client.listHooks()
    return mapHookEntries(result)
  }

  async listCollaborationModes(): Promise<DesktopCollaborationModePreset[]> {
    const client = await this.ensureClient()
    const result = await client.listCollaborationModes()
    return mapCollaborationModes(result)
  }

  async listAgentPickerEntries(): Promise<DesktopAgentPickerEntry[]> {
    const client = await this.ensureClient()
    const rootThreadId = await this.ensureThread(client)
    const entries: DesktopAgentPickerEntry[] = []
    let cursor: string | null | undefined = undefined
    do {
      const result = await client.listThreads({
        cursor,
        useStateDbOnly: true,
      })
      entries.push(
        ...result.data
          .filter(thread => thread.id === rootThreadId || thread.forkedFromId === rootThreadId)
          .map(thread => mapAgentPickerEntry(thread, rootThreadId)),
      )
      cursor = result.nextCursor
    } while (cursor)
    return entries.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1
      return left.nickname.localeCompare(right.nickname)
    })
  }

  async readAgentThread(threadId: string): Promise<ThreadReadResponse> {
    const client = await this.ensureClient()
    return client.readThread(threadId, { includeTurns: true })
  }

  async sendAgentThreadMessage(
    threadId: string,
    content: DesktopUserMessageContent,
  ): Promise<void> {
    const client = await this.ensureClient()
    const permissionConfig = codexPermissionConfigForMode(this.context)
    await client.startTurn({
      threadId,
      input: desktopContentToUserInput(content),
      cwd: this.context.workspacePath,
      model: this.context.model,
      approvalPolicy: permissionConfig.approvalPolicy,
      approvalsReviewer: permissionConfig.approvalsReviewer,
    })
  }

  async interruptAgentThread(threadId: string): Promise<void> {
    if (threadId !== this.threadId || !this.currentTurnId) return
    const client = await this.ensureClient()
    await client.interruptTurn({ threadId, turnId: this.currentTurnId })
  }

  async closeAgentThread(threadId: string): Promise<void> {
    const client = await this.ensureClient()
    await client.archiveThread(threadId)
  }

  async resumeAgentThread(threadId: string): Promise<ThreadReadResponse> {
    const client = await this.ensureClient()
    await client.unarchiveThread(threadId)
    await client.resumeThread(threadId)
    return client.readThread(threadId, { includeTurns: true })
  }

  async forkThread(): Promise<Thread> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    const permissionConfig = codexPermissionConfigForMode(this.context)
    const result = await client.forkThreadWithParams({
      threadId,
      cwd: this.context.workspacePath,
      model: this.context.model,
      approvalPolicy: permissionConfig.approvalPolicy,
      approvalsReviewer: permissionConfig.approvalsReviewer,
      sandbox: permissionConfig.sandboxMode,
      threadSource: 'codepilotx_desktop',
    })
    return result.thread
  }

  async trustHook(key: string, currentHash: string): Promise<void> {
    const client = await this.ensureClient()
    await client.configBatchWrite(
      [
        {
          keyPath: 'hooks.state',
          value: { [key]: { trusted_hash: currentHash } },
          mergeStrategy: 'upsert',
        },
      ],
      { reloadUserConfig: true },
    )
  }

  async readDirectory(path: string): Promise<FsReadDirectoryResponse> {
    const client = await this.ensureClient()
    return client.readDirectory(path)
  }

  async readFile(path: string): Promise<FsReadFileResponse> {
    const client = await this.ensureClient()
    return client.readFile(path)
  }

  async fuzzyFileSearch(
    params: FuzzyFileSearchParams,
  ): Promise<FuzzyFileSearchResponse> {
    const client = await this.ensureClient()
    return client.fuzzyFileSearch(params)
  }

  private async runUserTurnWithAppServer(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    const client = await this.ensureClient()
    const threadId = await this.ensureThread(client)
    const abortHandler = () => {
      if (this.currentTurnId) {
        void client.interruptTurn({ threadId, turnId: this.currentTurnId })
      }
    }
    signal.addEventListener('abort', abortHandler, { once: true })
    try {
      if (signal.aborted) return
      const permissionConfig = codexPermissionConfigForMode(this.context)
      const result = await client.startTurn({
        threadId,
        input: desktopContentToUserInput(content),
        cwd: this.context.workspacePath,
        model: this.context.model,
        approvalPolicy: permissionConfig.approvalPolicy,
        approvalsReviewer: permissionConfig.approvalsReviewer,
      })
      this.currentTurnId = result.turn.id
      if (signal.aborted) return
      if (result.turn.status === 'failed') {
        throw new Error(result.turn.error?.message ?? 'Codex app-server turn failed')
      }
      if (result.turn.status === 'completed' || result.turn.status === 'interrupted') {
        this.context.emit({ type: 'status', sessionId: this.context.sessionId, status: 'done' })
        return
      }
      await new Promise<void>((resolve, reject) => {
        const completed = this.completedTurns.get(result.turn.id)
        if (this.completedTurns.has(result.turn.id)) {
          this.completedTurns.delete(result.turn.id)
          if (completed) {
            reject(completed)
          } else {
            resolve()
          }
          return
        }
        this.currentTurnResolve = resolve
        this.currentTurnReject = reject
        signal.addEventListener(
          'abort',
          () => {
            this.currentTurnResolve = null
            this.currentTurnReject = null
            resolve()
          },
          { once: true },
        )
      })
    } finally {
      signal.removeEventListener('abort', abortHandler)
      this.currentTurnId = null
      this.currentTurnResolve = null
      this.currentTurnReject = null
    }
  }

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client) return this.client
    const client = new CodexAppServerClient({
      transport: { type: 'stdio' },
      codexHome: this.context.configDirectoryPath,
      clientInfo: APP_SERVER_CLIENT_INFO,
    })
    client.onNotification(notification => {
      this.handleNotification(notification)
    })
    client.onRequest(request => {
      void this.handleServerRequest(request)
    })
    await client.start()
    this.appServerReady = true
    this.client = client
    return client
  }

  private async ensureThread(client: CodexAppServerClient): Promise<string> {
    if (this.threadId) {
      const result = await client.resumeThread(this.threadId)
      this.rememberThread(result.thread)
      return result.thread.id
    }
    const permissionConfig = codexPermissionConfigForMode(this.context)
    const result = await client.startThread({
      cwd: this.context.workspacePath,
      model: this.context.model,
      approvalPolicy: permissionConfig.approvalPolicy,
      approvalsReviewer: permissionConfig.approvalsReviewer,
      sandbox: permissionConfig.sandboxMode,
      threadSource: 'codepilotx_desktop',
    })
    this.rememberThread(result.thread)
    return result.thread.id
  }

  private rememberThread(thread: Thread): void {
    this.threadId = thread.id
    this.context.onCodexAppServerThreadId?.(thread.id)
  }

  private handleNotification(notification: AppServerNotification): void {
    switch (notification.method) {
      case 'thread/started':
        this.rememberThread(notification.params.thread)
        return
      case 'turn/started':
        this.currentTurnId = notification.params.turn.id
        this.context.emit({
          type: 'status',
          sessionId: this.context.sessionId,
          status: 'running',
        })
        return
      case 'turn/completed':
        this.handleTurnCompleted(notification.params.turn)
        return
      case 'thread/status/changed':
        this.context.emit({
          type: 'thread_status_changed',
          sessionId: this.context.sessionId,
          threadId: notification.params.threadId,
          status: mapThreadStatus(notification.params.status),
        })
        return
      case 'thread/goal/updated':
        this.context.emit({
          type: 'thread_goal_updated',
          sessionId: this.context.sessionId,
          goal: mapThreadGoal(notification.params.goal),
        })
        return
      case 'thread/goal/cleared':
        this.context.emit({
          type: 'thread_goal_cleared',
          sessionId: this.context.sessionId,
          threadId: notification.params.threadId,
        })
        return
      case 'item/started':
        this.emitItemStarted(
          notification.params.item,
          notification.params.threadId,
        )
        return
      case 'item/completed':
        this.emitItemCompleted(
          notification.params.item,
          notification.params.threadId,
        )
        return
      case 'item/agentMessage/delta':
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: notification.params.delta,
          sourceThreadId: notification.params.threadId,
        })
        return
      case 'item/commandExecution/outputDelta':
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName: 'Command',
          summary: notification.params.delta,
          toolUseId: notification.params.itemId,
          sourceThreadId: notification.params.threadId,
        })
        return
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName: 'Thinking',
          summary: notification.params.delta,
          toolUseId: notification.params.itemId,
          sourceThreadId: notification.params.threadId,
        })
        return
      case 'thread/tokenUsage/updated':
        this.emitTokenUsage(notification.params.tokenUsage)
        return
      case 'error': {
        const message = notification.params.message
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'system',
          text: message,
        })
        this.currentTurnReject?.(new Error(message))
        return
      }
      default:
        return
    }
  }

  private handleTurnCompleted(turn: Turn): void {
    if (turn.status === 'failed') {
      const error = new Error(turn.error?.message ?? 'Codex app-server turn failed')
      if (this.currentTurnReject) {
        this.currentTurnReject(error)
      } else {
        this.completedTurns.set(turn.id, error)
      }
      return
    }
    this.context.emit({
      type: 'status',
      sessionId: this.context.sessionId,
      status: 'done',
    })
    if (this.currentTurnResolve) {
      this.currentTurnResolve()
      this.currentTurnResolve = null
      this.currentTurnReject = null
    } else {
      this.completedTurns.set(turn.id, null)
    }
  }

  private emitItemStarted(item: Record<string, unknown>, threadId?: string): void {
    const tool = appServerToolName(item)
    if (!tool) return
    this.context.emit({
      type: 'tool_start',
      sessionId: this.context.sessionId,
      toolName: tool,
      summary: summarizeToolInput(tool, item),
      toolUseId: typeof item.id === 'string' ? item.id : undefined,
      sourceThreadId: threadId,
    })
  }

  private emitItemCompleted(item: Record<string, unknown>, threadId?: string): void {
    if (item.type === 'agentMessage' && typeof item.text === 'string') {
      this.context.emit({
        type: 'message',
        sessionId: this.context.sessionId,
        role: 'assistant',
        text: item.text,
        sourceThreadId: threadId,
      })
      return
    }
    const tool = appServerToolName(item)
    if (!tool) return
    this.context.emit({
      type: 'tool_result',
      sessionId: this.context.sessionId,
      toolName: tool,
      summary: summarizeToolInput(tool, item),
      toolUseId: typeof item.id === 'string' ? item.id : undefined,
      isError: item.status === 'failed',
      metadata: buildToolResultMetadata(item),
      sourceThreadId: threadId,
    })
  }

  private emitTokenUsage(tokenUsage: unknown): void {
    if (!tokenUsage || typeof tokenUsage !== 'object') return
    const total = (tokenUsage as Record<string, unknown>).total
    if (!total || typeof total !== 'object') return
    const usage = buildDesktopContextUsage({
      model: this.context.model ?? 'unknown',
      provider: this.context.providerID,
      usage: {
        input_tokens: (total as Record<string, unknown>).inputTokens,
        output_tokens: (total as Record<string, unknown>).outputTokens,
        cache_read_input_tokens: (total as Record<string, unknown>).cachedInputTokens,
        reasoning_tokens: (total as Record<string, unknown>).reasoningOutputTokens,
      },
    })
    if (!usage) return
    this.context.emit({ type: 'context_usage', sessionId: this.context.sessionId, usage })
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    const client = this.client
    if (!client) return
    try {
      const permissionRequest = appServerRequestToPermissionRequest(request)
      if (!permissionRequest) {
        client.respondToRequestError(
          request.id,
          -32601,
          `Unsupported server request: ${request.method}`,
        )
        return
      }
      const decision = await this.context.requestPermission(permissionRequest)
      const response = appServerPermissionDecisionToResponse(
        request.method,
        request.params,
        decision,
      )
      if (response.ok) {
        client.respondToRequest(request.id, response.result)
      } else {
        client.respondToRequestError(
          request.id,
          -32000,
          'message' in response ? response.message : 'Permission request failed',
        )
      }
    } catch (error) {
      client.respondToRequestError(
        request.id,
        -32000,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

function desktopContentToUserInput(content: DesktopUserMessageContent): UserInput[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content.flatMap<UserInput>(block => {
    if (!block || typeof block !== 'object') {
      return []
    }
    const record = block as unknown as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      return [{ type: 'text', text: record.text } satisfies UserInput]
    }
    const source = record.source
    if (
      record.type === 'image' &&
      source &&
      typeof source === 'object' &&
      typeof (source as Record<string, unknown>).path === 'string'
    ) {
      return [
        {
          type: 'local_image',
          path: (source as Record<string, unknown>).path as string,
        } satisfies UserInput,
      ]
    }
    return []
  })
}

function appServerToolName(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case 'commandExecution':
      return 'Command'
    case 'fileEdit':
    case 'fileChange':
    case 'patch':
      return 'File'
    case 'mcpToolCall':
      return typeof item.tool === 'string' ? item.tool : 'MCP'
    case 'webSearch':
      return 'WebSearch'
    case 'reasoning':
      return 'Thinking'
    case 'todoList':
      return 'Todo'
    default:
      return null
  }
}

function mapThreadGoal(goal: {
  threadId: string
  objective: string
  status: DesktopThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}): DesktopThreadGoal {
  return goal
}

function mapBackgroundTerminal(
  terminal: ThreadBackgroundTerminal,
): DesktopBackgroundTerminal {
  return {
    itemId: terminal.itemId,
    processId: terminal.processId,
    command: terminal.command,
    cwd: terminal.cwd,
    osPid: terminal.osPid,
    cpuPercent: terminal.cpuPercent,
    rssKb: terminal.rssKb,
  }
}

function mapThreadStatus(status: unknown): 'running' | 'waiting' | 'idle' | 'closed' {
  if (!status || typeof status !== 'object') return 'idle'
  const type = (status as Record<string, unknown>).type
  if (type === 'active') {
    const flags = (status as Record<string, unknown>).activeFlags
    return Array.isArray(flags) &&
      flags.some(flag => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')
      ? 'waiting'
      : 'running'
  }
  if (type === 'systemError' || type === 'notLoaded') return 'closed'
  return 'idle'
}

function mapAgentPickerEntry(
  thread: Thread,
  rootThreadId: string,
): DesktopAgentPickerEntry {
  const isPrimary = thread.id === rootThreadId
  const preview = thread.preview?.trim()
  return {
    id: thread.id,
    nickname: preview || (isPrimary ? 'Primary' : thread.id),
    role: isPrimary ? 'primary' : 'agent',
    status: mapThreadStatus(thread.status),
    isPrimary,
    ...(thread.forkedFromId ? { sourceThreadId: thread.forkedFromId } : {}),
  }
}

function mapHookEntries(result: HooksListResponse): DesktopHookListEntry[] {
  return result.data.map(entry => ({
    cwd: entry.cwd,
    hooks: entry.hooks.map(hook => ({
      key: hook.key,
      eventName: hook.eventName,
      handlerType: hook.handlerType,
      matcher: hook.matcher,
      command: hook.command,
      timeoutSec: hook.timeoutSec,
      statusMessage: hook.statusMessage,
      sourcePath: hook.sourcePath,
      source: hook.source,
      pluginId: hook.pluginId,
      enabled: hook.enabled,
      isManaged: hook.isManaged,
      currentHash: hook.currentHash,
      trustStatus: hook.trustStatus,
    })),
    warnings: entry.warnings,
    errors: entry.errors.map(error => ({
      path: error.path,
      message: error.message,
    })),
  }))
}

function mapCollaborationModes(
  result: CollaborationModeListResponse,
): DesktopCollaborationModePreset[] {
  return result.data.map(mode => ({
    name: mode.name,
    mode: mode.mode,
    model: mode.model,
    reasoningEffort: mode.reasoning_effort,
  }))
}

function unsupportedRuntimeFeature<T>(feature: string): Promise<T> {
  return Promise.reject(
    new Error(`${feature} 仅在 app-server 运行时可用。`),
  )
}

function appServerRequestToPermissionRequest(
  request: JsonRpcRequest,
): DesktopPermissionRequest | null {
  const params = request.params && typeof request.params === 'object'
    ? (request.params as Record<string, unknown>)
    : {}
  const requestId = String(request.id)
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined
  switch (request.method) {
    case 'item/commandExecution/requestApproval': {
      const command = typeof params.command === 'string' ? params.command : ''
      const reason = typeof params.reason === 'string' ? params.reason : undefined
      const cwd = typeof params.cwd === 'string' ? params.cwd : undefined
      return {
        requestId,
        toolName: 'Command',
        toolUseId: itemId,
        input: { command, cwd, reason },
        description: reason ?? summarizeToolInput('Command', { command }),
        requestKind: 'shell-command',
      }
    }
    case 'item/fileChange/requestApproval': {
      const reason = typeof params.reason === 'string' ? params.reason : undefined
      const grantRoot = typeof params.grantRoot === 'string' ? params.grantRoot : undefined
      return {
        requestId,
        toolName: 'File',
        toolUseId: itemId,
        input: { reason, grantRoot },
        description: reason ?? 'Approve file changes',
        requestKind: 'file-write',
      }
    }
    case 'item/permissions/requestApproval': {
      const reason = typeof params.reason === 'string' ? params.reason : undefined
      return {
        requestId,
        toolName: 'Permissions',
        toolUseId: itemId,
        input: {
          permissions: params.permissions,
          cwd: params.cwd,
          reason,
        },
        description: reason ?? 'Approve additional permissions',
        requestKind: 'sandbox-escalation',
      }
    }
    case 'item/tool/requestUserInput':
      return {
        requestId,
        toolName: 'AskUserQuestion',
        toolUseId: itemId,
        input: {
          questions: params.questions,
          autoResolutionMs: params.autoResolutionMs,
        },
        description: 'Answer questions',
        requestKind: 'tool',
      }
    default:
      return null
  }
}

function appServerPermissionDecisionToResponse(
  method: string,
  params: unknown,
  decision: DesktopPermissionDecision,
):
  | { ok: true; result: unknown }
  | { ok: false; message: string } {
  if (decision.behavior === 'deny') {
    if (method === 'item/commandExecution/requestApproval') {
      return { ok: true, result: { decision: 'decline' } }
    }
    if (method === 'item/fileChange/requestApproval') {
      return { ok: true, result: { decision: 'decline' } }
    }
    return { ok: false, message: decision.message ?? 'Permission denied' }
  }

  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return {
        ok: true,
        result: { decision: decision.alwaysAllow ? 'acceptForSession' : 'accept' },
      }
    case 'item/permissions/requestApproval': {
      const record = params && typeof params === 'object'
        ? (params as Record<string, unknown>)
        : {}
      const updated = decision.updatedInput ?? {}
      return {
        ok: true,
        result: {
          permissions: updated.permissions ?? record.permissions,
          scope: decision.alwaysAllow ? 'session' : 'turn',
        },
      }
    }
    case 'item/tool/requestUserInput':
      return {
        ok: true,
        result: decision.updatedInput ?? { answers: {} },
      }
    default:
      return { ok: false, message: `Unsupported server request: ${method}` }
  }
}

class CliDesktopAgentRuntime implements DesktopAgentRuntime {
  private child: ChildProcessWithoutNullStreams | null = null
  private emittedAssistantText = false
  private hasStartedCliSession = false
  private partialText = ''
  private requestedPlanApprovalText: string | null = null
  private readonly toolNamesByUseId = new Map<string, string>()

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

  setPermissionMode(permissionMode: DesktopPermissionMode): void {
    this.context.permissionMode = permissionMode
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} subprocess_set_permission_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        permissionMode,
      })}`,
    )
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
    if (enabled) {
      desktopDebug('runtime_subprocess_debug_dump_unsupported', {
        sessionId: this.context.sessionId,
      })
    }
  }

  async getThreadGoal(): Promise<DesktopThreadGoal | null> {
    return unsupportedRuntimeFeature('Goal')
  }

  async setThreadGoal(
    _input: {
      objective?: string | null
      status?: DesktopThreadGoalStatus | null
      tokenBudget?: number | null
    },
  ): Promise<DesktopThreadGoal> {
    return unsupportedRuntimeFeature('Goal')
  }

  async clearThreadGoal(): Promise<void> {
    return unsupportedRuntimeFeature('Goal')
  }

  async listBackgroundTerminals(): Promise<DesktopBackgroundTerminal[]> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async terminateBackgroundTerminal(
    _processId: string,
  ): Promise<{ terminated: boolean }> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async cleanBackgroundTerminals(): Promise<void> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async listHooks(): Promise<DesktopHookListEntry[]> {
    return unsupportedRuntimeFeature('Hooks')
  }

  async listCollaborationModes(): Promise<DesktopCollaborationModePreset[]> {
    return unsupportedRuntimeFeature('协作模式')
  }

  async listAgentPickerEntries(): Promise<DesktopAgentPickerEntry[]> {
    return unsupportedRuntimeFeature('Agent picker')
  }

  async readAgentThread(_threadId: string): Promise<ThreadReadResponse> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async sendAgentThreadMessage(
    _threadId: string,
    _content: DesktopUserMessageContent,
  ): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async interruptAgentThread(_threadId: string): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async closeAgentThread(_threadId: string): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async resumeAgentThread(_threadId: string): Promise<ThreadReadResponse> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async forkThread(): Promise<Thread> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async trustHook(_key: string, _currentHash: string): Promise<void> {
    return unsupportedRuntimeFeature('Hooks')
  }

  async readDirectory(_path: string): Promise<FsReadDirectoryResponse> {
    return unsupportedRuntimeFeature('文件读取')
  }

  async readFile(_path: string): Promise<FsReadFileResponse> {
    return unsupportedRuntimeFeature('文件读取')
  }

  async fuzzyFileSearch(
    _params: FuzzyFileSearchParams,
  ): Promise<FuzzyFileSearchResponse> {
    return unsupportedRuntimeFeature('文件搜索')
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('runtime_subprocess_turn_start', {
      sessionId: this.context.sessionId,
      textLength: getDesktopUserMessageContentTextLength(content),
    })
    const executablePath = this.context.agentExecutablePath
    if (!executablePath || !existsSync(executablePath)) {
      throw new Error('Desktop agent executable path is not configured')
    }
    this.emittedAssistantText = false
    this.partialText = ''
    this.requestedPlanApprovalText = null
    this.toolNamesByUseId.clear()
    const permissionConfig = codexPermissionConfigForMode(this.context)

    const child = spawn(
      executablePath,
      [
        '--print',
        '--verbose',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--replay-user-messages',
        ...this.sessionResumeArgs(),
        ...codexPermissionConfigArgs(permissionConfig),
        ...permissionModeArgs(this.context.permissionMode),
        ...permissionPromptToolArgs(),
        ...modelArgs(this.context.model),
        ...sessionNameArgs(this.context.sessionName),
        ...thinkingModeArgs(this.context.thinkingMode),
        ...systemPromptArgs(this.context.systemPrompt),
        ...appendSystemPromptArgs(this.context.appendSystemPrompt),
        ...additionalDirectoryArgs(this.context.additionalDirectories),
      ],
      {
        cwd: this.context.workspacePath,
        windowsHide: true,
        env: {
          ...process.env,
          [CODEPILOTX_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[CODEPILOTX_CONFIG_DIR_ENV],
          [LEGACY_CLAUDE_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV],
          CODEPILOTX_DISABLE_MDM_READ: '1',
          CODEPILOTX_DISABLE_MIN_VERSION_CHECK: '1',
          ...rustSearchAndDiffKernelEnv(this.context),
          ...desktopProposedPlanEnv(this.context),
          CLAUDE_CODE_DISABLE_MDM_READ: '1',
          CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK: '1',
          ...taskModelEnv(this.context),
        },
      },
    )
    this.child = child

    const cleanupAbort = this.attachAbortHandler(child, signal)
    let stderr = ''

    child.stderr.on('data', chunk => {
      const text = String(chunk)
      desktopDebug('runtime_subprocess_stderr', {
        sessionId: this.context.sessionId,
        textLength: text.length,
      })
      stderr = appendCappedText(stderr, text, SUBPROCESS_STDERR_BUFFER_LIMIT)
    })

    const outputDone = this.consumeStdout(child)
    this.writeJsonLine(child, {
      type: 'user',
      session_id: this.context.sessionId,
      message: {
        role: 'user',
        content,
      },
      parent_tool_use_id: null,
    })
    this.hasStartedCliSession = true

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', code => resolve(code))
      })
      await outputDone
      if (signal.aborted) {
        desktopDebug('runtime_subprocess_turn_aborted', {
          sessionId: this.context.sessionId,
          durationMs: Date.now() - startedAt,
        })
        return
      }
      if (exitCode !== 0) {
        throw new Error(
          stderr.trim() ||
            `Desktop agent process exited with code ${exitCode}`,
        )
      }
      desktopDebug('runtime_subprocess_turn_done', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
        exitCode,
      })
    } finally {
      if (this.child === child) {
        this.child = null
      }
      cleanupAbort()
      if (!child.stdin.destroyed) {
        child.stdin.end()
      }
    }
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('runtime_subprocess_control_response_start', {
      sessionId: this.context.sessionId,
    })
    const executablePath = this.context.agentExecutablePath
    if (!executablePath || !existsSync(executablePath)) {
      throw new Error('Desktop agent executable path is not configured')
    }
    this.emittedAssistantText = false
    this.partialText = ''
    this.requestedPlanApprovalText = null
    this.toolNamesByUseId.clear()
    const permissionConfig = codexPermissionConfigForMode(this.context)

    const child = spawn(
      executablePath,
      [
        '--print',
        '--verbose',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--replay-user-messages',
        ...this.sessionResumeArgs(),
        ...codexPermissionConfigArgs(permissionConfig),
        ...permissionModeArgs(this.context.permissionMode),
        ...permissionPromptToolArgs(),
        ...modelArgs(this.context.model),
        ...sessionNameArgs(this.context.sessionName),
        ...thinkingModeArgs(this.context.thinkingMode),
        ...systemPromptArgs(this.context.systemPrompt),
        ...appendSystemPromptArgs(this.context.appendSystemPrompt),
        ...additionalDirectoryArgs(this.context.additionalDirectories),
      ],
      {
        cwd: this.context.workspacePath,
        windowsHide: true,
        env: {
          ...process.env,
          [CODEPILOTX_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[CODEPILOTX_CONFIG_DIR_ENV],
          [LEGACY_CLAUDE_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV],
          CODEPILOTX_DISABLE_MDM_READ: '1',
          CODEPILOTX_DISABLE_MIN_VERSION_CHECK: '1',
          ...rustSearchAndDiffKernelEnv(this.context),
          ...desktopProposedPlanEnv(this.context),
          CLAUDE_CODE_DISABLE_MDM_READ: '1',
          CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK: '1',
          ...taskModelEnv(this.context),
        },
      },
    )
    this.child = child

    const cleanupAbort = this.attachAbortHandler(child, signal)
    let stderr = ''
    child.stderr.on('data', chunk => {
      const text = String(chunk)
      stderr = appendCappedText(stderr, text, SUBPROCESS_STDERR_BUFFER_LIMIT)
    })

    const outputDone = this.consumeStdout(child)
    this.writeJsonLine(child, response)
    this.hasStartedCliSession = true

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', code => resolve(code))
      })
      await outputDone
      if (signal.aborted) return
      if (exitCode !== 0) {
        throw new Error(
          stderr.trim() ||
            `Desktop agent process exited with code ${exitCode}`,
        )
      }
      desktopDebug('runtime_subprocess_control_response_done', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
        exitCode,
      })
    } finally {
      if (this.child === child) {
        this.child = null
      }
      cleanupAbort()
      if (!child.stdin.destroyed) {
        child.stdin.end()
      }
    }
  }

  private sessionResumeArgs(): string[] {
    return this.hasStartedCliSession || this.context.resumeExistingSession
      ? ['--resume', this.context.sessionId]
      : ['--session-id', this.context.sessionId]
  }

  private attachAbortHandler(
    child: ChildProcessWithoutNullStreams,
    signal: AbortSignal,
  ): () => void {
    const onAbort = () => {
      if (!child.killed) {
        child.kill()
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    return () => signal.removeEventListener('abort', onAbort)
  }

  private async consumeStdout(
    child: ChildProcessWithoutNullStreams,
  ): Promise<void> {
    const lines = createInterface({ input: child.stdout })
    for await (const line of lines) {
      if (!line.trim()) {
        continue
      }
      await this.handleStdoutLine(line)
    }
  }

  private async handleStdoutLine(line: string): Promise<void> {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.context.emit({
        type: 'message',
        sessionId: this.context.sessionId,
        role: 'system',
        text: line,
      })
      return
    }
    desktopDebug('runtime_subprocess_stdout_message', {
      sessionId: this.context.sessionId,
      type: message.type,
    })

    switch (message.type) {
      case 'assistant':
        await this.emitAssistantMessage(message)
        return
      case 'system':
        this.emitSystemMessage(message)
        return
      case 'result':
        await this.emitResultMessage(message)
        return
      case 'control_request':
        await this.handleControlRequest(message)
        return
      case 'user':
        this.emitUserMessage(message)
        return
      case 'control_cancel_request':
      case 'keep_alive':
        return
      default:
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'system',
          text: JSON.stringify(message),
        })
    }
  }

  private async emitAssistantMessage(message: Record<string, unknown>): Promise<void> {
    this.emitContextUsage(message)
    const content = getMessageContent(message)
    if (!Array.isArray(content)) {
      return
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const item = block as Record<string, unknown>
      const partialText = extractPartialText(item)
      if (partialText) {
        this.partialText += partialText
        await this.emitAssistantText(this.partialText, true)
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.partialText = ''
        await this.emitAssistantText(item.text, false)
      } else if (item.type === 'tool_use') {
        const toolName = typeof item.name === 'string' ? item.name : 'Tool'
        if (typeof item.id === 'string') {
          this.toolNamesByUseId.set(item.id, toolName)
        }
        this.context.emit({
          type: 'tool_start',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.input),
          toolUseId: getToolUseId(item),
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          toolUseId: getToolUseId(item),
          isError: item.is_error === true,
          metadata: buildToolResultMetadata(item.content),
        })
      }
    }
  }

  setPlanModeActive(active: boolean): void {
    this.context.collaborationMode = resolveCodexCollaborationMode({
      planModeActive: active,
    })
    this.context.planModeActive = active
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} subprocess_set_plan_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        planModeActive: active,
      })}`,
    )
  }

  private async emitAssistantText(text: string, streaming: boolean): Promise<void> {
    if (this.context.planModeActive !== true) {
      this.context.emit(
        streaming
          ? {
              type: 'partial_message',
              sessionId: this.context.sessionId,
              text,
            }
          : {
              type: 'message',
              sessionId: this.context.sessionId,
              role: 'assistant',
              text,
            },
      )
      return
    }

    const parsed = parseProposedPlanText(text)
    if (parsed.visibleText) {
      this.context.emit(
        streaming
          ? {
              type: 'partial_message',
              sessionId: this.context.sessionId,
              text: parsed.visibleText,
            }
          : {
              type: 'message',
              sessionId: this.context.sessionId,
              role: 'assistant',
              text: parsed.visibleText,
            },
      )
    }
    if (!parsed.planText) return

    this.context.emit({
      type: 'proposed_plan',
      sessionId: this.context.sessionId,
      text: parsed.planText,
      streaming: !parsed.isComplete || streaming,
    })
    if (
      parsed.isComplete &&
      !streaming &&
      this.requestedPlanApprovalText !== parsed.planText
    ) {
      this.requestedPlanApprovalText = parsed.planText
      await persistProposedPlan(parsed.planText, this.context)
      await requestProposedPlanApproval(parsed.planText, this.context)
    }
  }

  private emitContextUsage(message: Record<string, unknown>): void {
    const usageRecord = getUsageFromAssistantRecord(message)
    if (!usageRecord) return
    const usage = buildDesktopContextUsage(usageRecord)
    if (!usage) return
    this.context.emit({
      type: 'context_usage',
      sessionId: this.context.sessionId,
      usage,
    })
  }

  private emitUserMessage(message: Record<string, unknown>): void {
    const content = getMessageContent(message)
    if (!Array.isArray(content)) {
      return
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const item = block as Record<string, unknown>
      if (item.type !== 'tool_result') {
        continue
      }
      const toolName = this.toolNameForResult(item)
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName,
        summary: summarizeToolInput(toolName, item.content),
        toolUseId: getToolUseId(item),
        isError: item.is_error === true,
        metadata: buildToolResultMetadata(item.content),
      })
    }
  }

  private toolNameForResult(item: Record<string, unknown>): string {
    return typeof item.tool_use_id === 'string'
      ? (this.toolNamesByUseId.get(item.tool_use_id) ?? 'Tool')
      : 'Tool'
  }

  private emitSystemMessage(message: Record<string, unknown>): void {
    const subtype =
      typeof message.subtype === 'string' ? message.subtype : 'system'
    if (subtype === 'session_state_changed') {
      return
    }
    this.context.emit({
      type: 'message',
      sessionId: this.context.sessionId,
      role: 'system',
      text: subtype,
    })
  }

  private async emitResultMessage(message: Record<string, unknown>): Promise<void> {
    const result = typeof message.result === 'string' ? message.result : ''
    if (
      !this.emittedAssistantText &&
      result.trim()
    ) {
      if (result !== this.partialText) {
        await this.emitAssistantText(result, false)
      }
      this.emittedAssistantText = true
    }
    this.partialText = ''
  }

  private async handleControlRequest(
    message: Record<string, unknown>,
  ): Promise<void> {
    const requestId =
      typeof message.request_id === 'string'
        ? message.request_id
        : randomUUID()
    const request =
      message.request && typeof message.request === 'object'
        ? (message.request as Record<string, unknown>)
        : {}
    if (request.subtype !== 'can_use_tool') {
      this.writeJsonLineToCurrentChild({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: `Unsupported control request: ${String(request.subtype)}`,
        },
      })
      return
    }

    const permissionRequest = buildDesktopPermissionRequestFromControlRequest(
      requestId,
      request,
    )
    const decision = await this.context.requestPermission(permissionRequest)

    if (decision.behavior === 'allow') {
      const response: Record<string, unknown> = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? permissionRequest.input,
        toolUseID: request.tool_use_id,
        decisionClassification: decision.alwaysAllow
          ? 'user_permanent'
          : 'user_temporary',
      }
      const updatedPermissions = getUpdatedPermissions(request, decision)
      if (updatedPermissions.length > 0) {
        response.updatedPermissions = updatedPermissions
      }
      this.writeJsonLineToCurrentChild({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response,
        },
      })
    } else {
      this.writeJsonLineToCurrentChild({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: decision.message ?? 'Permission denied',
        },
      })
    }
  }

  private writeJsonLineToCurrentChild(message: Record<string, unknown>): void {
    if (!this.child) {
      return
    }
    this.writeJsonLine(this.child, message)
  }

  private writeJsonLine(
    child: ChildProcessWithoutNullStreams,
    message: Record<string, unknown>,
  ): void {
    if (child.stdin.destroyed) {
      return
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

class InProcessDesktopAgentRuntime implements DesktopAgentRuntime {
  private emittedAssistantText = false
  private partialText = ''
  private requestedPlanApprovalText: string | null = null
  private resultError: string | null = null
  private currentSignal: AbortSignal | null = null
  private readonly toolNamesByUseId = new Map<string, string>()
  private readonly context: DesktopAgentRuntimeContext
  private readonly runtimePromise: Promise<DesktopHeadlessRuntime>

  constructor(context: DesktopAgentRuntimeContext) {
    this.context = context
    const permissionConfig = codexPermissionConfigForMode(context)
    applyRustSearchAndDiffKernelEnv(process.env, context)
    this.runtimePromise = loadDesktopHeadlessModule().then(
      ({ createDesktopHeadlessRuntime }) =>
        createDesktopHeadlessRuntime({
          sessionId: context.sessionId,
          workspacePath: context.workspacePath,
          configDirectoryPath: context.configDirectoryPath,
          resumeExistingSession: context.resumeExistingSession,
          permissionProfile: permissionConfig.permissionProfile,
          sandboxMode: permissionConfig.sandboxMode,
          approvalPolicy: permissionConfig.approvalPolicy,
          approvalsReviewer: permissionConfig.approvalsReviewer,
          permissionMode: tuiPermissionMode(
            context.permissionMode,
            context.planModeActive,
          ),
          providerID: context.providerID,
          providerBaseURL: context.providerBaseURL,
          codexAppServerThreadId: context.codexAppServerThreadId,
          onCodexAppServerThreadId: context.onCodexAppServerThreadId,
          debugConversationDump: context.debugConversationDump,
          model: context.model,
          reviewModel: context.reviewModel,
          smallFastModel: context.smallFastModel,
          fastModel: context.fastModel,
          defaultModel: context.defaultModel,
          deepModel: context.deepModel,
          sessionName: context.sessionName,
          thinkingMode: context.thinkingMode,
          systemPrompt: context.systemPrompt,
          appendSystemPrompt: context.appendSystemPrompt,
          additionalDirectories: context.additionalDirectories,
          permissionPromptToolName: permissionPromptToolName(),
          onOutput: (message, controls) =>
            this.handleStructuredOutput(message, controls),
        }),
    )
  }

  setModel(model: string | undefined): void {
    this.context.model = model
    void this.runtimePromise.then(runtime => runtime.setModel(model))
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    void this.runtimePromise.then(runtime =>
      runtime.setProvider(providerID, providerBaseURL),
    )
    this.setModel(model)
  }

  setPermissionMode(permissionMode: DesktopPermissionMode): void {
    this.context.permissionMode = permissionMode
    const permissionConfig = codexPermissionConfigForMode(this.context)
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} embedded_set_permission_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        permissionMode,
      })}`,
    )
    void this.runtimePromise.then(runtime => {
      runtime.setPermissionMode(
        tuiPermissionMode(permissionMode, this.context.planModeActive),
      )
      runtime.setCodexPermissionConfig(permissionConfig)
    })
  }

  setPlanModeActive(active: boolean): void {
    this.context.collaborationMode = resolveCodexCollaborationMode({
      planModeActive: active,
    })
    this.context.planModeActive = active
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} embedded_set_plan_mode ${JSON.stringify({
        sessionId: this.context.sessionId,
        planModeActive: active,
      })}`,
    )
    void this.runtimePromise.then(runtime =>
      runtime.setPermissionMode(tuiPermissionMode(this.context.permissionMode, active)),
    )
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
    void this.runtimePromise.then(runtime =>
      runtime.setDebugConversationDump(enabled),
    )
  }

  async getThreadGoal(): Promise<DesktopThreadGoal | null> {
    return unsupportedRuntimeFeature('Goal')
  }

  async setThreadGoal(
    _input: {
      objective?: string | null
      status?: DesktopThreadGoalStatus | null
      tokenBudget?: number | null
    },
  ): Promise<DesktopThreadGoal> {
    return unsupportedRuntimeFeature('Goal')
  }

  async clearThreadGoal(): Promise<void> {
    return unsupportedRuntimeFeature('Goal')
  }

  async listBackgroundTerminals(): Promise<DesktopBackgroundTerminal[]> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async terminateBackgroundTerminal(
    _processId: string,
  ): Promise<{ terminated: boolean }> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async cleanBackgroundTerminals(): Promise<void> {
    return unsupportedRuntimeFeature('后台终端')
  }

  async listHooks(): Promise<DesktopHookListEntry[]> {
    return unsupportedRuntimeFeature('Hooks')
  }

  async listCollaborationModes(): Promise<DesktopCollaborationModePreset[]> {
    return unsupportedRuntimeFeature('协作模式')
  }

  async listAgentPickerEntries(): Promise<DesktopAgentPickerEntry[]> {
    return unsupportedRuntimeFeature('Agent picker')
  }

  async readAgentThread(_threadId: string): Promise<ThreadReadResponse> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async sendAgentThreadMessage(
    _threadId: string,
    _content: DesktopUserMessageContent,
  ): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async interruptAgentThread(_threadId: string): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async closeAgentThread(_threadId: string): Promise<void> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async resumeAgentThread(_threadId: string): Promise<ThreadReadResponse> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async forkThread(): Promise<Thread> {
    return unsupportedRuntimeFeature('Agent thread')
  }

  async trustHook(_key: string, _currentHash: string): Promise<void> {
    return unsupportedRuntimeFeature('Hooks')
  }

  async readDirectory(_path: string): Promise<FsReadDirectoryResponse> {
    return unsupportedRuntimeFeature('文件读取')
  }

  async readFile(_path: string): Promise<FsReadFileResponse> {
    return unsupportedRuntimeFeature('文件读取')
  }

  async fuzzyFileSearch(
    _params: FuzzyFileSearchParams,
  ): Promise<FuzzyFileSearchResponse> {
    return unsupportedRuntimeFeature('文件搜索')
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('runtime_embedded_turn_start', {
      sessionId: this.context.sessionId,
      textLength: getDesktopUserMessageContentTextLength(content),
    })
    this.emittedAssistantText = false
    this.partialText = ''
    this.requestedPlanApprovalText = null
    this.resultError = null
    this.toolNamesByUseId.clear()
    this.currentSignal = signal

    try {
      await runSerialized(() =>
        runWithDesktopProposedPlanEnv(this.context, () =>
          this.runDesktopHeadlessTurn(content, signal),
        ),
      )
    } finally {
      if (this.currentSignal === signal) {
        this.currentSignal = null
      }
    }

    if (signal.aborted) {
      desktopDebug('runtime_embedded_turn_aborted', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
      })
      return
    }
    if (this.resultError) {
      desktopDebug('runtime_embedded_turn_result_error', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
        message: this.resultError,
      })
      throw new Error(this.resultError)
    }
    desktopDebug('runtime_embedded_turn_done', {
      sessionId: this.context.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    desktopDebug('runtime_embedded_control_response_start', {
      sessionId: this.context.sessionId,
    })
    this.emittedAssistantText = false
    this.partialText = ''
    this.requestedPlanApprovalText = null
    this.resultError = null
    this.toolNamesByUseId.clear()
    this.currentSignal = signal

    try {
      await runSerialized(() =>
        runWithDesktopProposedPlanEnv(this.context, () =>
          this.runDesktopHeadlessControlResponse(response, signal),
        ),
      )
    } finally {
      if (this.currentSignal === signal) {
        this.currentSignal = null
      }
    }

    if (signal.aborted) {
      desktopDebug('runtime_embedded_control_response_aborted', {
        sessionId: this.context.sessionId,
        durationMs: Date.now() - startedAt,
      })
      return
    }
    if (this.resultError) {
      throw new Error(this.resultError)
    }
    desktopDebug('runtime_embedded_control_response_done', {
      sessionId: this.context.sessionId,
      durationMs: Date.now() - startedAt,
    })
  }

  private async runDesktopHeadlessTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    const [{ runDesktopHeadlessTurn }, runtime] = await Promise.all([
      loadDesktopHeadlessModule(),
      this.runtimePromise,
    ])
    await runDesktopHeadlessTurn(runtime, content, signal)
  }

  private async runDesktopHeadlessControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const [{ runDesktopHeadlessControlResponse }, runtime] = await Promise.all([
      loadDesktopHeadlessModule(),
      this.runtimePromise,
    ])
    await runDesktopHeadlessControlResponse(runtime, response, signal)
  }

  private async handleStructuredOutput(
    message: StdoutMessage,
    controls: DesktopHeadlessOutputControls,
  ): Promise<void> {
    const signal = this.currentSignal
    if (!signal || signal.aborted) {
      desktopDebug('runtime_embedded_output_ignored_no_signal', {
        sessionId: this.context.sessionId,
        type: message.type,
        aborted: signal?.aborted,
      })
      return
    }
    desktopDebug('runtime_embedded_output', {
      sessionId: this.context.sessionId,
      type: message.type,
      ...(message.type === 'result'
        ? {
            subtype: (message as Record<string, unknown>).subtype,
            isError: (message as Record<string, unknown>).is_error,
            error: firstResultError(message as Record<string, unknown>),
          }
        : {}),
    })
    if (message.type === 'control_request') {
      await this.handleControlRequest(
        message as Record<string, unknown>,
        controls,
      )
      return
    }
    if (
      message.type === 'control_cancel_request' ||
      message.type === 'control_response' ||
      message.type === 'keep_alive'
    ) {
      return
    }
    await this.handleOutputMessage(message as Record<string, unknown>)
  }

  private async handleOutputMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case 'assistant':
        await this.emitAssistantMessage(message)
        return
      case 'system':
        this.emitSystemMessage(message)
        return
      case 'result':
        await this.emitResultMessage(message)
        return
      case 'user':
        this.emitUserMessage(message)
        return
      case 'tool_start':
        this.emitEmbeddedToolStart(message)
        return
      case 'tool_result':
        this.emitEmbeddedToolResult(message)
        return
      case 'thinking':
        this.emitEmbeddedThinking(message)
        return
      case 'usage':
        this.emitEmbeddedContextUsage(message)
        return
      default:
        return
    }
  }

  private emitEmbeddedToolStart(message: Record<string, unknown>): void {
    const toolName = typeof message.tool === 'string' ? message.tool : 'Tool'
    const toolUseId = getToolUseId(message)
    if (toolUseId) {
      this.toolNamesByUseId.set(toolUseId, toolName)
    }
    this.context.emit({
      type: 'tool_start',
      sessionId: this.context.sessionId,
      toolName,
      summary: summarizeToolInput(toolName, message.summary),
      toolUseId,
    })
  }

  private emitEmbeddedToolResult(message: Record<string, unknown>): void {
    const toolUseId = getToolUseId(message)
    const toolName = toolUseId
      ? (this.toolNamesByUseId.get(toolUseId) ?? 'Tool')
      : 'Tool'
    this.context.emit({
      type: 'tool_result',
      sessionId: this.context.sessionId,
      toolName,
      summary: summarizeToolInput(toolName, message.output),
      toolUseId,
      isError: message.is_error === true,
      metadata: buildToolResultMetadata(message.output),
    })
  }

  private emitEmbeddedThinking(message: Record<string, unknown>): void {
    const thinking =
      message.thinking && typeof message.thinking === 'object'
        ? (message.thinking as Record<string, unknown>)
        : {}
    const summary =
      typeof thinking.summary === 'string' && thinking.summary.trim()
        ? thinking.summary
        : typeof thinking.content === 'string'
          ? thinking.content
          : ''
    if (!summary.trim()) return
    const toolUseId = 'thinking'
    this.toolNamesByUseId.set(toolUseId, 'Thinking')
    this.context.emit({
      type: 'tool_result',
      sessionId: this.context.sessionId,
      toolName: 'Thinking',
      summary,
      toolUseId,
      isError: false,
    })
  }

  private emitEmbeddedContextUsage(message: Record<string, unknown>): void {
    const usage =
      message.usage && typeof message.usage === 'object'
        ? (message.usage as Record<string, unknown>)
        : null
    if (!usage) return
    const model = this.context.model?.trim() || 'unknown'
    const mappedUsage = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cached_input_tokens,
      reasoning_tokens: usage.reasoning_output_tokens,
    }
    const contextUsage = buildDesktopContextUsage({
      model,
      usage: mappedUsage,
      provider: this.context.providerID,
    })
    if (!contextUsage) return
    this.context.emit({
      type: 'context_usage',
      sessionId: this.context.sessionId,
      usage: contextUsage,
    })
  }

  private async emitAssistantMessage(message: Record<string, unknown>): Promise<void> {
    this.emitContextUsage(message)
    const content = getMessageContent(message)
    if (!Array.isArray(content)) {
      return
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const item = block as Record<string, unknown>
      const partialText = extractPartialText(item)
      if (partialText) {
        this.partialText += partialText
        await this.emitAssistantText(this.partialText, true)
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.partialText = ''
        await this.emitAssistantText(item.text, false)
      } else if (item.type === 'tool_use') {
        const toolName = typeof item.name === 'string' ? item.name : 'Tool'
        if (typeof item.id === 'string') {
          this.toolNamesByUseId.set(item.id, toolName)
        }
        this.context.emit({
          type: 'tool_start',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.input),
          toolUseId: getToolUseId(item),
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          toolUseId: getToolUseId(item),
          isError: item.is_error === true,
          metadata: buildToolResultMetadata(item.content),
        })
      }
    }
  }

  private async emitAssistantText(text: string, streaming: boolean): Promise<void> {
    if (this.context.planModeActive !== true) {
      this.context.emit(
        streaming
          ? {
              type: 'partial_message',
              sessionId: this.context.sessionId,
              text,
            }
          : {
              type: 'message',
              sessionId: this.context.sessionId,
              role: 'assistant',
              text,
            },
      )
      return
    }

    const parsed = parseProposedPlanText(text)
    if (parsed.visibleText) {
      this.context.emit(
        streaming
          ? {
              type: 'partial_message',
              sessionId: this.context.sessionId,
              text: parsed.visibleText,
            }
          : {
              type: 'message',
              sessionId: this.context.sessionId,
              role: 'assistant',
              text: parsed.visibleText,
            },
      )
    }
    if (!parsed.planText) return

    this.context.emit({
      type: 'proposed_plan',
      sessionId: this.context.sessionId,
      text: parsed.planText,
      streaming: !parsed.isComplete || streaming,
    })
    if (
      parsed.isComplete &&
      !streaming &&
      this.requestedPlanApprovalText !== parsed.planText
    ) {
      this.requestedPlanApprovalText = parsed.planText
      await persistProposedPlan(parsed.planText, this.context)
      await requestProposedPlanApproval(parsed.planText, this.context)
    }
  }

  private emitContextUsage(message: Record<string, unknown>): void {
    const usageRecord = getUsageFromAssistantRecord(message)
    if (!usageRecord) return
    const usage = buildDesktopContextUsage(usageRecord)
    if (!usage) return
    this.context.emit({
      type: 'context_usage',
      sessionId: this.context.sessionId,
      usage,
    })
  }

  private emitUserMessage(message: Record<string, unknown>): void {
    const content = getMessageContent(message)
    if (!Array.isArray(content)) {
      return
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const item = block as Record<string, unknown>
      if (item.type !== 'tool_result') {
        continue
      }
      const toolName = this.toolNameForResult(item)
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName,
        summary: summarizeToolInput(toolName, item.content),
        toolUseId: getToolUseId(item),
        isError: item.is_error === true,
        metadata: buildToolResultMetadata(item.content),
      })
    }
  }

  private toolNameForResult(item: Record<string, unknown>): string {
    return typeof item.tool_use_id === 'string'
      ? (this.toolNamesByUseId.get(item.tool_use_id) ?? 'Tool')
      : 'Tool'
  }

  private emitSystemMessage(message: Record<string, unknown>): void {
    const subtype =
      typeof message.subtype === 'string' ? message.subtype : 'system'
    if (subtype === 'session_state_changed') {
      return
    }
    this.context.emit({
      type: 'message',
      sessionId: this.context.sessionId,
      role: 'system',
      text: subtype,
    })
  }

  private async emitResultMessage(message: Record<string, unknown>): Promise<void> {
    const result = typeof message.result === 'string' ? message.result : ''
    if (
      !this.emittedAssistantText &&
      result.trim()
    ) {
      if (result !== this.partialText) {
        await this.emitAssistantText(result, false)
      }
      this.emittedAssistantText = true
    }
    if (message.is_error === true) {
      this.resultError = getResultErrorMessage(message)
    }
    this.partialText = ''
  }

  private async handleControlRequest(
    message: Record<string, unknown>,
    controls: DesktopHeadlessOutputControls,
  ): Promise<void> {
    const requestId =
      typeof message.request_id === 'string'
        ? message.request_id
        : randomUUID()
    const request =
      message.request && typeof message.request === 'object'
        ? (message.request as Record<string, unknown>)
        : {}
    const subtype = request.subtype
    if (subtype !== 'can_use_tool') {
      this.injectControlResponse(controls, {
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: `Unsupported control request: ${String(subtype)}`,
        },
      })
      return
    }

    const permissionRequest = buildDesktopPermissionRequestFromControlRequest(
      requestId,
      request,
    )
    const decision = await this.context.requestPermission(permissionRequest)
    console.info(
      `[desktop-runtime] ${new Date().toISOString()} embedded_control_decision ${JSON.stringify({
        sessionId: this.context.sessionId,
        permissionMode: this.context.permissionMode,
        toolName: permissionRequest.toolName,
        behavior: decision.behavior,
        requestId,
      })}`,
    )

    if (decision.behavior === 'allow') {
      const response: Record<string, unknown> = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? permissionRequest.input,
        toolUseID: request.tool_use_id,
        decisionClassification: decision.alwaysAllow
          ? 'user_permanent'
          : 'user_temporary',
      }
      const updatedPermissions = getUpdatedPermissions(request, decision)
      if (updatedPermissions.length > 0) {
        response.updatedPermissions = updatedPermissions
      }
      this.injectControlResponse(controls, {
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response,
        },
      })
    } else {
      this.injectControlResponse(controls, {
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: decision.message ?? 'Permission denied',
        },
      })
    }
  }

  private injectControlResponse(
    controls: DesktopHeadlessOutputControls,
    message: Record<string, unknown>,
  ): void {
    controls.injectControlResponse(message)
  }
}

function firstResultError(message: Record<string, unknown>): string | undefined {
  if (!Array.isArray(message.errors)) {
    return undefined
  }
  const first = message.errors.find(item => typeof item === 'string')
  return typeof first === 'string' ? first.slice(0, 500) : undefined
}

export function permissionModeArgs(
  permissionMode: DesktopPermissionMode | undefined,
): string[] {
  if (permissionMode === 'custom') {
    return []
  }
  if (permissionMode === 'full-access') {
    return ['--dangerously-skip-permissions']
  }
  return ['--permission-mode', 'default']
}

export type DesktopCodexPermissionConfigArgs = {
  sandboxMode?: DesktopCodexSandboxMode
  permissionProfile?: string
  approvalPolicy?: DesktopCodexApprovalPolicy
  approvalsReviewer?: DesktopCodexApprovalsReviewer | LegacyDesktopCodexApprovalsReviewer
}

export function codexPermissionConfigArgs(
  config: DesktopCodexPermissionConfigArgs,
): string[] {
  return [
    ...codexConfigOverrideArg('sandbox_mode', config.sandboxMode),
    ...codexConfigOverrideArg('default_permissions', config.permissionProfile),
    ...codexConfigOverrideArg('approval_policy', config.approvalPolicy),
    ...codexConfigOverrideArg(
      'approvals_reviewer',
      normalizeApprovalsReviewer(config.approvalsReviewer),
    ),
  ]
}

export function codexPermissionConfigForMode(
  config: DesktopCodexPermissionConfigArgs & {
    permissionMode?: DesktopPermissionMode
  },
): Omit<DesktopCodexPermissionConfigArgs, 'approvalsReviewer'> & {
  approvalsReviewer?: DesktopCodexApprovalsReviewer
} {
  switch (config.permissionMode) {
    case 'auto-review':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      }
    case 'full-access':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
      }
    case 'custom':
      return {
        sandboxMode: config.sandboxMode,
        permissionProfile: config.permissionProfile,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: normalizeApprovalsReviewer(config.approvalsReviewer) as
          | DesktopCodexApprovalsReviewer
          | undefined,
      }
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      }
  }
}

function desktopProposedPlanEnv(
  context: Pick<DesktopAgentRuntimeContext, 'planModeActive'>,
): Record<string, string> {
  return context.planModeActive === true
    ? { CODEPILOTX_DESKTOP_PROPOSED_PLAN: '1' }
    : {}
}

async function runWithDesktopProposedPlanEnv<T>(
  context: Pick<DesktopAgentRuntimeContext, 'planModeActive'>,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env.CODEPILOTX_DESKTOP_PROPOSED_PLAN
  if (context.planModeActive === true) {
    process.env.CODEPILOTX_DESKTOP_PROPOSED_PLAN = '1'
  } else {
    delete process.env.CODEPILOTX_DESKTOP_PROPOSED_PLAN
  }
  try {
    return await operation()
  } finally {
    if (previous === undefined) {
      delete process.env.CODEPILOTX_DESKTOP_PROPOSED_PLAN
    } else {
      process.env.CODEPILOTX_DESKTOP_PROPOSED_PLAN = previous
    }
  }
}

async function persistProposedPlan(
  planText: string,
  context: Pick<DesktopAgentRuntimeContext, 'sessionId'>,
): Promise<void> {
  try {
    const { getPlanFilePath } = await import('@codepilotx/tui/utils/plans.js')
    await writeFile(getPlanFilePath(), planText, { encoding: 'utf-8' })
  } catch (error) {
    desktopDebug('runtime_proposed_plan_persist_failed', {
      sessionId: context.sessionId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function requestProposedPlanApproval(
  planText: string,
  context: Pick<DesktopAgentRuntimeContext, 'sessionId' | 'requestPermission'>,
): Promise<void> {
  await context.requestPermission({
    requestId: `proposed-plan-${randomUUID()}`,
    toolName: 'ExitPlanMode',
    input: {
      plan: planText,
      source: 'proposed_plan',
    },
    description: '确认计划',
  })
}

function codexConfigOverrideArg(key: string, value: string | undefined): string[] {
  return value ? ['--config', `${key}=${JSON.stringify(value)}`] : []
}

function getDesktopUserMessageContentTextLength(
  content: DesktopUserMessageContent,
): number {
  if (typeof content === 'string') return content.length
  return content.reduce((sum, block) => {
    if (block.type === 'text') return sum + block.text.length
    return sum
  }, 0)
}

export function permissionPromptToolName(): string {
  return 'stdio'
}

export function permissionPromptToolArgs(): string[] {
  return ['--permission-prompt-tool', permissionPromptToolName()]
}

function tuiPermissionMode(
  permissionMode: DesktopPermissionMode | undefined,
  planModeActive = false,
): PermissionMode | undefined {
  if (planModeActive) return 'plan'
  if (permissionMode === 'custom') return undefined
  if (permissionMode === 'full-access') return 'bypassPermissions'
  return 'default'
}

function normalizeApprovalsReviewer(
  value:
    | DesktopCodexApprovalsReviewer
    | LegacyDesktopCodexApprovalsReviewer
    | undefined,
): string | undefined {
  if (value === 'auto') return 'auto_review'
  return value
}

function modelArgs(model: string | undefined): string[] {
  return model ? ['--model', model] : []
}

export function taskModelEnv(
  context: DesktopAgentRuntimeContext,
): Record<string, string> {
  const mainModel = context.model?.trim()
  if (!mainModel) return {}
  return {
    ANTHROPIC_SMALL_FAST_MODEL:
      context.smallFastModel?.trim() || mainModel,
    CODEPILOTX_FAST_MODEL:
      context.fastModel?.trim() || mainModel,
    CODEPILOTX_DEFAULT_MODEL:
      context.defaultModel?.trim() || mainModel,
    CODEPILOTX_DEEP_MODEL:
      context.deepModel?.trim() || mainModel,
  }
}

function sessionNameArgs(sessionName: string | undefined): string[] {
  return sessionName ? ['--name', sessionName] : []
}

function thinkingModeArgs(
  thinkingMode: DesktopThinkingMode | undefined,
): string[] {
  if (thinkingMode === 'enabled') {
    return ['--max-thinking-tokens', String(DESKTOP_ENABLED_THINKING_BUDGET)]
  }
  return thinkingMode && thinkingMode !== 'default'
    ? ['--thinking', thinkingMode]
    : []
}

function systemPromptArgs(systemPrompt: string | undefined): string[] {
  return systemPrompt ? ['--system-prompt', systemPrompt] : []
}

function appendSystemPromptArgs(
  appendSystemPrompt: string | undefined,
): string[] {
  return appendSystemPrompt
    ? ['--append-system-prompt', appendSystemPrompt]
    : []
}

function additionalDirectoryArgs(
  additionalDirectories: string[] | undefined,
): string[] {
  return additionalDirectories && additionalDirectories.length > 0
    ? ['--add-dir', ...additionalDirectories]
    : []
}

export function buildDesktopPermissionRequestFromControlRequest(
  requestId: string,
  request: Record<string, unknown>,
): DesktopPermissionRequest {
  const toolName =
    typeof request.tool_name === 'string' ? request.tool_name : 'Tool'
  const input =
    request.input && typeof request.input === 'object'
      ? (request.input as Record<string, unknown>)
      : {}
  return {
    requestId,
    toolName,
    toolUseId:
      typeof request.tool_use_id === 'string'
        ? request.tool_use_id
        : undefined,
    input,
    description:
      typeof request.description === 'string'
        ? request.description
        : summarizeToolInput(toolName, input),
  }
}

export function buildAskUserQuestionControlResponse({
  requestId,
  toolUseId,
  updatedInput,
}: {
  requestId: string
  toolUseId: string
  updatedInput: Record<string, unknown>
}): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      request_id: requestId,
      subtype: 'success',
      response: {
        behavior: 'allow',
        updatedInput,
        toolUseID: toolUseId,
        decisionClassification: 'user_temporary',
      },
    },
  }
}

export function rustSearchAndDiffKernelEnv(context: {
  rustSearchAndDiffKernels?: boolean
}): Record<string, string> {
  return context.rustSearchAndDiffKernels
    ? {
        CODEPILOTX_RUST_GLOB: '1',
        CODEPILOTX_RUST_GREP: '1',
        CODEPILOTX_RUST_DIFF: '1',
      }
    : {}
}

function applyRustSearchAndDiffKernelEnv(
  env: NodeJS.ProcessEnv,
  context: { rustSearchAndDiffKernels?: boolean },
): void {
  if (context.rustSearchAndDiffKernels) {
    env.CODEPILOTX_RUST_GLOB = '1'
    env.CODEPILOTX_RUST_GREP = '1'
    env.CODEPILOTX_RUST_DIFF = '1'
  } else {
    delete env.CODEPILOTX_RUST_GLOB
    delete env.CODEPILOTX_RUST_GREP
    delete env.CODEPILOTX_RUST_DIFF
  }
}

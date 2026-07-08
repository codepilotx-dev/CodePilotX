import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { getPlanFilePath } from '@codepilotx/tui/utils/plans.js'
import { parseProposedPlanText } from '@codepilotx/core/agent/proposedPlan.js'
import {
  planModeActiveFromCollaborationMode,
  resolveCodexCollaborationMode,
  type CodexCollaborationMode,
} from '@codepilotx/core/agent/codexSessionContract.js'
import {
  createDesktopHeadlessRuntime,
  runDesktopHeadlessControlResponse,
  runDesktopHeadlessTurn,
  type DesktopHeadlessOutputControls,
  type DesktopHeadlessRuntime,
} from '@codepilotx/tui/headless/desktopRuntime.js'
import type { StdoutMessage } from '@codepilotx/tui/entrypoints/sdk/controlTypes.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopThinkingMode,
  DesktopUserMessageContent,
} from '../shared/types.js'
import type { PermissionMode } from '@codepilotx/core/agent/permissionMode.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import { DESKTOP_TOOLCHAIN_ENABLED_ENV } from './desktopRuntimeEnv.js'
import {
  buildDesktopContextUsage,
  getUsageFromAssistantRecord,
} from './desktopContextUsage.js'
import {
  buildPermissionRememberOptions,
  buildToolResultMetadata,
  extractPartialText,
  getMessageContent,
  getResultErrorMessage,
  getToolUseId,
  getUpdatedPermissions,
  summarizeToolInput,
} from './agentRuntimeSupport.js'
import { desktopDebug } from './desktopDebug.js'
import { SidecarDesktopAgentRuntime } from './sidecarAgentRuntime.js'
import { SidecarStartError } from './sidecarManager.js'
import { RustSidecarDesktopAgentRuntime } from './rustSidecarRuntime.js'

export type DesktopAgentRuntimePreference =
  | 'auto'
  | 'sidecar'
  | 'rust-sidecar'
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
  toolchainEnvironment?: Record<string, string | undefined>
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
  debugConversationDump?: boolean
  model?: string
  planExecutionModel?: string
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
  installCodexDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
  serializeHeadlessTurns?: boolean
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
  }
}

let headlessQueue: Promise<void> = Promise.resolve()
const DESKTOP_ENABLED_THINKING_BUDGET = 1_000_000_000
const SUBPROCESS_STDERR_BUFFER_LIMIT = 16 * 1024
const BASE_PROCESS_ENV: NodeJS.ProcessEnv = { ...process.env }

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
  if (preference === 'subprocess') {
    desktopDebug('runtime_create_subprocess', {
      sessionId: context.sessionId,
      preference,
    })
    return new CliDesktopAgentRuntime(context)
  }
  if (preference === 'embedded-headless') {
    desktopDebug('runtime_create_embedded', {
      sessionId: context.sessionId,
      preference,
    })
    return new InProcessDesktopAgentRuntime(context)
  }
  if (preference === 'auto' || preference === 'rust-sidecar') {
    desktopDebug('runtime_create_rust_sidecar', {
      sessionId: context.sessionId,
      preference,
    })
    return new RustFallbackDesktopAgentRuntime(context)
  }
  if (preference === 'sidecar') {
    try {
      desktopDebug('runtime_create_sidecar', {
        sessionId: context.sessionId,
        preference,
      })
      return new SidecarDesktopAgentRuntime(context)
    } catch (error) {
      desktopDebug('runtime_create_sidecar_failed', {
        sessionId: context.sessionId,
        preference,
        message: error instanceof Error ? error.message : String(error),
      })
      throw new SidecarStartError(
        `Sidecar runtime creation failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      )
    }
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

function desktopRuntimeProcessEnv(
  context: Pick<DesktopAgentRuntimeContext, 'toolchainEnvironment'>,
): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    ...context.toolchainEnvironment,
  }
  if (context.toolchainEnvironment?.[DESKTOP_TOOLCHAIN_ENABLED_ENV] === '0') {
    restoreBasePathEnv(env)
  }
  return env
}

function applyDesktopRuntimeProcessEnv(
  context: Pick<DesktopAgentRuntimeContext, 'toolchainEnvironment'>,
): void {
  for (const [key, value] of Object.entries(desktopRuntimeProcessEnv(context))) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function restoreBasePathEnv(env: NodeJS.ProcessEnv): void {
  const currentPathKey =
    Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  const basePathKey =
    Object.keys(BASE_PROCESS_ENV).find(key => key.toLowerCase() === 'path') ??
    currentPathKey
  env[currentPathKey] = BASE_PROCESS_ENV[basePathKey]
  if (currentPathKey !== basePathKey) {
    delete env[basePathKey]
  }
}

class AutoFallbackDesktopAgentRuntime implements DesktopAgentRuntime {
  private readonly sidecar: SidecarDesktopAgentRuntime
  private fallback: InProcessDesktopAgentRuntime | null = null

  constructor(private readonly context: DesktopAgentRuntimeContext) {
    this.sidecar = new SidecarDesktopAgentRuntime(context)
  }

  setModel(model: string | undefined): void {
    this.sidecar.setModel(model)
    this.fallback?.setModel(model)
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.sidecar.setModelProvider(providerID, model, providerBaseURL)
    this.fallback?.setModelProvider(providerID, model, providerBaseURL)
  }

  setPermissionMode(permissionMode: DesktopPermissionMode): void {
    this.sidecar.setPermissionMode(permissionMode)
    this.fallback?.setPermissionMode(permissionMode)
  }

  setPlanModeActive(active: boolean): void {
    this.sidecar.setPlanModeActive(active)
    this.fallback?.setPlanModeActive(active)
  }

  setDebugConversationDump(enabled: boolean): void {
    this.sidecar.setDebugConversationDump(enabled)
    this.fallback?.setDebugConversationDump(enabled)
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.fallback) {
      await this.fallback.runUserTurn(content, signal)
      return
    }
    try {
      await this.sidecar.runUserTurn(content, signal)
    } catch (error) {
      if (!(error instanceof SidecarStartError) || signal.aborted) {
        throw error
      }
      desktopDebug('runtime_auto_sidecar_failed_fallback_embedded', {
        sessionId: this.context.sessionId,
        message: error.message,
      })
      await this.sidecar.dispose()
      this.fallback = new InProcessDesktopAgentRuntime(this.context)
      await this.fallback.runUserTurn(content, signal)
    }
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.fallback) {
      await this.fallback.runControlResponse(response, signal)
      return
    }
    try {
      await this.sidecar.runControlResponse(response, signal)
    } catch (error) {
      if (!(error instanceof SidecarStartError) || signal.aborted) {
        throw error
      }
      desktopDebug('runtime_auto_sidecar_control_failed_fallback_embedded', {
        sessionId: this.context.sessionId,
        message: error.message,
      })
      await this.sidecar.dispose()
      this.fallback = new InProcessDesktopAgentRuntime(this.context)
      await this.fallback.runControlResponse(response, signal)
    }
  }

  getMcpRuntimeStatus() {
    return (this.fallback ?? this.sidecar).getMcpRuntimeStatus()
  }
}

class RustFallbackDesktopAgentRuntime implements DesktopAgentRuntime {
  private readonly rustSidecar: RustSidecarDesktopAgentRuntime
  private fallback: InProcessDesktopAgentRuntime | null = null

  constructor(private readonly context: DesktopAgentRuntimeContext) {
    this.rustSidecar = new RustSidecarDesktopAgentRuntime(context)
  }

  setModel(model: string | undefined): void {
    this.rustSidecar.setModel(model)
    this.fallback?.setModel(model)
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.rustSidecar.setModelProvider(providerID, model, providerBaseURL)
    this.fallback?.setModelProvider(providerID, model, providerBaseURL)
  }

  setPermissionMode(permissionMode: DesktopPermissionMode): void {
    this.rustSidecar.setPermissionMode(permissionMode)
    this.fallback?.setPermissionMode(permissionMode)
  }

  setPlanModeActive(active: boolean): void {
    this.rustSidecar.setPlanModeActive(active)
    this.fallback?.setPlanModeActive(active)
  }

  setDebugConversationDump(enabled: boolean): void {
    this.rustSidecar.setDebugConversationDump(enabled)
    this.fallback?.setDebugConversationDump(enabled)
  }

  async runUserTurn(
    content: DesktopUserMessageContent,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.fallback) {
      await this.fallback.runUserTurn(content, signal)
      return
    }
    try {
      await this.rustSidecar.runUserTurn(content, signal)
    } catch (error) {
      if (!(error instanceof SidecarStartError) || signal.aborted) {
        throw error
      }
      desktopDebug('runtime_rust_sidecar_failed_fallback_embedded', {
        sessionId: this.context.sessionId,
        message: error.message,
      })
      await this.rustSidecar.dispose()
      this.fallback = new InProcessDesktopAgentRuntime(this.context)
      await this.fallback.runUserTurn(content, signal)
    }
  }

  async runControlResponse(
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.fallback) {
      await this.fallback.runControlResponse(response, signal)
      return
    }
    try {
      await this.rustSidecar.runControlResponse(response, signal)
    } catch (error) {
      if (!(error instanceof SidecarStartError) || signal.aborted) {
        throw error
      }
      desktopDebug('runtime_rust_sidecar_control_failed_fallback_embedded', {
        sessionId: this.context.sessionId,
        message: error.message,
      })
      await this.rustSidecar.dispose()
      this.fallback = new InProcessDesktopAgentRuntime(this.context)
      await this.fallback.runControlResponse(response, signal)
    }
  }

  getMcpRuntimeStatus() {
    return (this.fallback ?? this.rustSidecar).getMcpRuntimeStatus()
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
          ...desktopRuntimeProcessEnv(this.context),
          [CODEPILOTX_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[CODEPILOTX_CONFIG_DIR_ENV],
          [LEGACY_CLAUDE_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV],
          CODEPILOTX_DISABLE_MDM_READ: '1',
          CODEPILOTX_DISABLE_MIN_VERSION_CHECK: '1',
          ...rustSearchAndDiffKernelEnv(this.context),
          ...memoryRuntimeEnv(this.context),
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
          ...desktopRuntimeProcessEnv(this.context),
          [CODEPILOTX_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[CODEPILOTX_CONFIG_DIR_ENV],
          [LEGACY_CLAUDE_CONFIG_DIR_ENV]:
            this.context.configDirectoryPath ??
            process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV],
          CODEPILOTX_DISABLE_MDM_READ: '1',
          CODEPILOTX_DISABLE_MIN_VERSION_CHECK: '1',
          ...rustSearchAndDiffKernelEnv(this.context),
          ...memoryRuntimeEnv(this.context),
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
    const usage = buildDesktopContextUsage({
      ...usageRecord,
      provider: this.context.providerID,
    })
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

  getMcpRuntimeStatus() {
    // Subprocess mode does not expose MCP runtime status
    return { servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 }
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
  private readonly runtime: DesktopHeadlessRuntime

  constructor(context: DesktopAgentRuntimeContext) {
    this.context = context
    const permissionConfig = codexPermissionConfigForMode(context)
    applyDesktopRuntimeProcessEnv(context)
    applyRustSearchAndDiffKernelEnv(process.env, context)
    applyMemoryRuntimeEnv(process.env, context)
    this.runtime = createDesktopHeadlessRuntime({
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
      installCodexDependencies: context.installCodexDependencies,
	      enableMemory: context.enableMemory,
	      permissionPromptToolName: permissionPromptToolName(),
	      mcpEnabled: true,
	      onOutput: (message, controls) =>
	        this.handleStructuredOutput(message, controls),
	    })
	  }

  setModel(model: string | undefined): void {
    this.context.model = model
    this.runtime.setModel(model)
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    this.context.providerID = providerID
    this.context.providerBaseURL = providerBaseURL
    this.runtime.setProvider(providerID, providerBaseURL)
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
    this.runtime.setPermissionMode(
      tuiPermissionMode(permissionMode, this.context.planModeActive),
    )
    this.runtime.setCodexPermissionConfig(permissionConfig)
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
    this.runtime.setPermissionMode(
      tuiPermissionMode(this.context.permissionMode, active),
    )
  }

  setDebugConversationDump(enabled: boolean): void {
    this.context.debugConversationDump = enabled
    this.runtime.setDebugConversationDump(enabled)
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
      const turn = () =>
        runWithDesktopProposedPlanEnv(this.context, () =>
          runDesktopHeadlessTurn(this.runtime, content, signal),
        )
      if (this.context.serializeHeadlessTurns !== false) {
        await runSerialized(turn)
      } else {
        await turn()
      }
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
      const turn = () =>
        runWithDesktopProposedPlanEnv(this.context, () =>
          runDesktopHeadlessControlResponse(this.runtime, response, signal),
        )
      if (this.context.serializeHeadlessTurns !== false) {
        await runSerialized(turn)
      } else {
        await turn()
      }
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

  getMcpRuntimeStatus() {
    return (this.runtime as any).getMcpRuntimeStatus()
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
      default:
        return
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
    const usage = buildDesktopContextUsage({
      ...usageRecord,
      provider: this.context.providerID,
    })
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
    ...(context.planExecutionModel?.trim()
      ? { CODEPILOTX_PLAN_EXECUTION_MODEL: context.planExecutionModel.trim() }
      : {}),
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
  const rememberOptions = buildPermissionRememberOptions(request)
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
    ...(rememberOptions.length > 0 ? { rememberOptions } : {}),
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

export function memoryRuntimeEnv(context: {
  enableMemory?: boolean
}): Record<string, string> {
  if (context.enableMemory === true) {
    return { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' }
  }
  if (context.enableMemory === false) {
    return { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }
  }
  return {}
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

function applyMemoryRuntimeEnv(
  env: NodeJS.ProcessEnv,
  context: { enableMemory?: boolean },
): void {
  if (context.enableMemory === true) {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  } else if (context.enableMemory === false) {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  }
}

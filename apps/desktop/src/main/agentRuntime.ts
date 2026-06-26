import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  createDesktopHeadlessRuntime,
  runDesktopHeadlessTurn,
  type DesktopHeadlessOutputControls,
  type DesktopHeadlessRuntime,
} from '@codepilotx/core/agent/desktopRuntime.js'
import type { StdoutMessage } from '@codepilotx/core/agent/controlTypes.js'
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
  | 'embedded-headless'
  | 'subprocess'

export type DesktopCodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'

export type DesktopCodexApprovalsReviewer = 'user' | 'auto'

export type DesktopAgentRuntimeContext = {
  sessionId: string
  workspacePath: string
  agentExecutablePath?: string
  configDirectoryPath?: string
  runtimePreference?: DesktopAgentRuntimePreference
  resumeExistingSession?: boolean
  permissionProfile?: string
  approvalPolicy?: DesktopCodexApprovalPolicy
  approvalsReviewer?: DesktopCodexApprovalsReviewer
  permissionMode?: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  askUserQuestionMaxQuestions?: number
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopAgentRuntime = {
  setModel(model: string | undefined): void
  runUserTurn(content: DesktopUserMessageContent, signal: AbortSignal): Promise<void>
}

let headlessQueue: Promise<void> = Promise.resolve()
const DESKTOP_ENABLED_THINKING_BUDGET = 1_000_000_000

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const run = headlessQueue.then(operation, operation)
  headlessQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function createDesktopAgentRuntime(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntime {
  const preference = context.runtimePreference ?? 'auto'
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
    if (
      preference === 'auto' &&
      context.agentExecutablePath &&
      existsSync(context.agentExecutablePath)
    ) {
      desktopDebug('runtime_create_embedded_failed_fallback_subprocess', {
        sessionId: context.sessionId,
        message: error instanceof Error ? error.message : String(error),
      })
      return new CliDesktopAgentRuntime(context)
    }
    throw error
  }
}

class CliDesktopAgentRuntime implements DesktopAgentRuntime {
  private child: ChildProcessWithoutNullStreams | null = null
  private emittedAssistantText = false
  private hasStartedCliSession = false
  private partialText = ''
  private readonly toolNamesByUseId = new Map<string, string>()

  constructor(private readonly context: DesktopAgentRuntimeContext) {}

  setModel(model: string | undefined): void {
    this.context.model = model
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
    this.toolNamesByUseId.clear()

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
        ...codexPermissionConfigArgs(this.context),
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
          ...askUserQuestionMaxQuestionsEnv(this.context),
          CLAUDE_CODE_DISABLE_MDM_READ: '1',
          CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK: '1',
          ...taskModelEnv(this.context),
        },
      },
    )
    this.child = child

    const cleanupAbort = this.attachAbortHandler(child, signal)
    const stderr: string[] = []

    child.stderr.on('data', chunk => {
      const text = String(chunk)
      desktopDebug('runtime_subprocess_stderr', {
        sessionId: this.context.sessionId,
        textLength: text.length,
      })
      stderr.push(text)
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName: 'Agent stderr',
        summary: text.trim(),
        isError: true,
        metadata: { stderr: text.trim(), content: text.trim(), result: text },
      })
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
          stderr.join('').trim() ||
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
        this.emitAssistantMessage(message)
        return
      case 'system':
        this.emitSystemMessage(message)
        return
      case 'result':
        this.emitResultMessage(message)
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

  private emitAssistantMessage(message: Record<string, unknown>): void {
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
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.partialText,
        })
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.partialText = ''
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'assistant',
          text: item.text,
        })
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

  private emitResultMessage(message: Record<string, unknown>): void {
    if (
      !this.emittedAssistantText &&
      typeof message.result === 'string' &&
      message.result.trim() &&
      message.result !== this.partialText
    ) {
      this.context.emit({
        type: 'message',
        sessionId: this.context.sessionId,
        role: 'assistant',
        text: message.result,
      })
    }
    this.partialText = ''
    if (this.child && !this.child.stdin.destroyed) {
      this.child.stdin.end()
    }
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

    const toolName =
      typeof request.tool_name === 'string' ? request.tool_name : 'Tool'
    const input =
      request.input && typeof request.input === 'object'
        ? (request.input as Record<string, unknown>)
        : {}
    const decision = await this.context.requestPermission({
      requestId,
      toolName,
      input,
      description:
        typeof request.description === 'string'
          ? request.description
          : summarizeToolInput(toolName, input),
    })

    if (decision.behavior === 'allow') {
      const response: Record<string, unknown> = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? input,
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
  private resultError: string | null = null
  private currentSignal: AbortSignal | null = null
  private readonly toolNamesByUseId = new Map<string, string>()
  private readonly context: DesktopAgentRuntimeContext
  private readonly runtime: DesktopHeadlessRuntime

  constructor(context: DesktopAgentRuntimeContext) {
    this.context = context
    this.runtime = createDesktopHeadlessRuntime({
      sessionId: context.sessionId,
      workspacePath: context.workspacePath,
      configDirectoryPath: context.configDirectoryPath,
      resumeExistingSession: context.resumeExistingSession,
      permissionProfile: context.permissionProfile,
      approvalPolicy: context.approvalPolicy,
      approvalsReviewer: context.approvalsReviewer,
      permissionMode: tuiPermissionMode(context.permissionMode),
      model: context.model,
      smallFastModel: context.smallFastModel,
      fastModel: context.fastModel,
      defaultModel: context.defaultModel,
      deepModel: context.deepModel,
      sessionName: context.sessionName,
      thinkingMode: context.thinkingMode,
      systemPrompt: context.systemPrompt,
      appendSystemPrompt: context.appendSystemPrompt,
      additionalDirectories: context.additionalDirectories,
      askUserQuestionMaxQuestions: context.askUserQuestionMaxQuestions,
      permissionPromptToolName: permissionPromptToolName(),
      onOutput: (message, controls) =>
        this.handleStructuredOutput(message, controls),
    })
  }

  setModel(model: string | undefined): void {
    this.context.model = model
    this.runtime.setModel(model)
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
    this.resultError = null
    this.toolNamesByUseId.clear()
    this.currentSignal = signal

    try {
      await runSerialized(() =>
        runDesktopHeadlessTurn(this.runtime, content, signal),
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
    this.handleOutputMessage(message as Record<string, unknown>)
  }

  private handleOutputMessage(message: Record<string, unknown>): void {
    switch (message.type) {
      case 'assistant':
        this.emitAssistantMessage(message)
        return
      case 'system':
        this.emitSystemMessage(message)
        return
      case 'result':
        this.emitResultMessage(message)
        return
      case 'user':
        this.emitUserMessage(message)
        return
      default:
        return
    }
  }

  private emitAssistantMessage(message: Record<string, unknown>): void {
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
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.partialText,
        })
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.partialText = ''
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'assistant',
          text: item.text,
        })
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

  private emitResultMessage(message: Record<string, unknown>): void {
    if (
      !this.emittedAssistantText &&
      typeof message.result === 'string' &&
      message.result.trim() &&
      message.result !== this.partialText
    ) {
      this.context.emit({
        type: 'message',
        sessionId: this.context.sessionId,
        role: 'assistant',
        text: message.result,
      })
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

    const toolName =
      typeof request.tool_name === 'string' ? request.tool_name : 'Tool'
    const input =
      request.input && typeof request.input === 'object'
        ? (request.input as Record<string, unknown>)
        : {}
    const decision = await this.context.requestPermission({
      requestId,
      toolName,
      input,
      description:
        typeof request.description === 'string'
          ? request.description
          : summarizeToolInput(toolName, input),
    })

    if (decision.behavior === 'allow') {
      const response: Record<string, unknown> = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? input,
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
  if (permissionMode === 'customConfig') {
    return []
  }
  if (permissionMode === 'bypassPermissions') {
    return ['--dangerously-skip-permissions']
  }
  return ['--permission-mode', permissionMode ?? 'default']
}

export type DesktopCodexPermissionConfigArgs = {
  permissionProfile?: string
  approvalPolicy?: DesktopCodexApprovalPolicy
  approvalsReviewer?: DesktopCodexApprovalsReviewer
}

export function codexPermissionConfigArgs(
  config: DesktopCodexPermissionConfigArgs,
): string[] {
  return [
    ...codexConfigOverrideArg('default_permissions', config.permissionProfile),
    ...codexConfigOverrideArg('approval_policy', config.approvalPolicy),
    ...codexConfigOverrideArg('approvals_reviewer', config.approvalsReviewer),
  ]
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
): PermissionMode | undefined {
  return permissionMode === 'customConfig' ? undefined : permissionMode
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

export function askUserQuestionMaxQuestionsEnv(context: {
  askUserQuestionMaxQuestions?: number
}): Record<string, string> {
  return context.askUserQuestionMaxQuestions
    ? {
        CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS: String(
          context.askUserQuestionMaxQuestions,
        ),
      }
    : {}
}

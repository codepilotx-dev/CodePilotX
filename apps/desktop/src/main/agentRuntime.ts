import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { runHeadless } from '@claudecode/tui/cli/print.js'
import { StructuredIO } from '@claudecode/tui/cli/structuredIO.js'
import type { StdoutMessage } from '@claudecode/tui/entrypoints/sdk/controlTypes.js'
import {
  setClientType,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  setSessionTrustAccepted,
  switchSession,
} from '@claudecode/tui/bootstrap/state.js'
import { createStore, type Store } from '@claudecode/tui/state/store.js'
import { getDefaultAppState } from '@claudecode/tui/state/AppStateStore.js'
import type { Tool, ToolPermissionContext, Tools } from '@claudecode/tui/Tool.js'
import { AskUserQuestionTool } from '@claudecode/tui/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { BashTool } from '@claudecode/tui/tools/BashTool/BashTool.js'
import { EnterPlanModeTool } from '@claudecode/tui/tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { ExitPlanModeV2Tool } from '@claudecode/tui/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { FileEditTool } from '@claudecode/tui/tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from '@claudecode/tui/tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from '@claudecode/tui/tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from '@claudecode/tui/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claudecode/tui/tools/GrepTool/GrepTool.js'
import { NotebookEditTool } from '@claudecode/tui/tools/NotebookEditTool/NotebookEditTool.js'
import { TaskStopTool } from '@claudecode/tui/tools/TaskStopTool/TaskStopTool.js'
import { TodoWriteTool } from '@claudecode/tui/tools/TodoWriteTool/TodoWriteTool.js'
import { WebFetchTool } from '@claudecode/tui/tools/WebFetchTool/WebFetchTool.js'
import { WebSearchTool } from '@claudecode/tui/tools/WebSearchTool/WebSearchTool.js'
import { runWithCwdOverride } from '@claudecode/tui/utils/cwd.js'
import { getDenyRuleForTool } from '@claudecode/tui/utils/permissions/permissions.js'
import { cacheSessionTitle } from '@claudecode/tui/utils/sessionStorage.js'
import type { ThinkingConfig } from '@claudecode/tui/utils/thinking.js'
import { asSessionId } from '@claudecode/tui/types/ids.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopThinkingMode,
} from '../shared/types.js'
import {
  buildDesktopContextUsage,
  getUsageFromAssistantRecord,
} from './desktopContextUsage.js'

export type DesktopAgentRuntimeContext = {
  sessionId: string
  workspacePath: string
  agentExecutablePath?: string
  configDirectoryPath?: string
  resumeExistingSession?: boolean
  permissionMode?: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopAgentRuntime = {
  setModel(model: string | undefined): void
  runUserTurn(content: string, signal: AbortSignal): Promise<void>
}

let headlessQueue: Promise<void> = Promise.resolve()

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
  if (context.agentExecutablePath) {
    if (!existsSync(context.agentExecutablePath)) {
      throw new Error(
        `Desktop agent executable is missing: ${context.agentExecutablePath}`,
      )
    }
    return new CliDesktopAgentRuntime(context)
  }
  return new InProcessDesktopAgentRuntime(context)
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

  async runUserTurn(content: string, signal: AbortSignal): Promise<void> {
    const executablePath = this.context.agentExecutablePath
    if (!executablePath) {
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
        ...permissionModeArgs(this.context.permissionMode),
        ...modelArgs(this.context.model),
        ...fallbackModelArgs(this.context.fallbackModel),
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
          CLAUDE_CONFIG_DIR:
            this.context.configDirectoryPath ?? process.env.CLAUDE_CONFIG_DIR,
          CLAUDE_CODE_DISABLE_MDM_READ: '1',
          CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK: '1',
        },
      },
    )
    this.child = child

    const cleanupAbort = this.attachAbortHandler(child, signal)
    const stderr: string[] = []

    child.stderr.on('data', chunk => {
      const text = String(chunk)
      stderr.push(text)
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName: 'Agent stderr',
        summary: text.trim(),
        isError: true,
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
        return
      }
      if (exitCode !== 0) {
        throw new Error(
          stderr.join('').trim() ||
            `Desktop agent process exited with code ${exitCode}`,
        )
      }
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
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          isError: item.is_error === true,
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
        isError: item.is_error === true,
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
        updatedInput: input,
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
  private hasStartedHeadlessSession = false
  private partialText = ''
  private resultError: string | null = null
  private currentInput: DesktopHeadlessInput | null = null
  private structuredIO: StructuredIO | null = null
  private readonly toolNamesByUseId = new Map<string, string>()
  private readonly context: DesktopAgentRuntimeContext
  private readonly store: Store<ReturnType<typeof getInitialDesktopAppState>>

  constructor(context: DesktopAgentRuntimeContext) {
    this.context = context
    this.store = createStore(getInitialDesktopAppState(context))
    if (context.configDirectoryPath) {
      process.env.CLAUDE_CONFIG_DIR = context.configDirectoryPath
    }
    process.env.CLAUDE_CODE_DISABLE_MDM_READ = '1'
    process.env.CLAUDE_CODE_DISABLE_MIN_VERSION_CHECK = '1'
    process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
  }

  setModel(model: string | undefined): void {
    this.context.model = model
  }

  async runUserTurn(content: string, signal: AbortSignal): Promise<void> {
    this.emittedAssistantText = false
    this.partialText = ''
    this.resultError = null
    this.toolNamesByUseId.clear()

    await runSerialized(() =>
      runWithCwdOverride(this.context.workspacePath, async () => {
        if (signal.aborted) {
          return
        }
        const input = new DesktopHeadlessInput(
          this.context.sessionId,
          content,
          signal,
        )
        this.currentInput = input
        this.prepareGlobalSessionState()
        try {
          await runHeadless(
            input,
            () => this.store.getState(),
            this.store.setState,
            [],
            this.tools,
            {},
            [],
            {
              continue: undefined,
              resume: this.hasStartedHeadlessSession ||
                this.context.resumeExistingSession
                ? this.context.sessionId
                : undefined,
              resumeSessionAt: undefined,
              verbose: true,
              outputFormat: 'stream-json',
              jsonSchema: undefined,
              permissionPromptToolName: undefined,
              allowedTools: undefined,
              thinkingConfig: thinkingConfigFromDesktopMode(
                this.context.thinkingMode,
              ),
              maxTurns: undefined,
              maxBudgetUsd: undefined,
              taskBudget: undefined,
              systemPrompt: this.context.systemPrompt,
              appendSystemPrompt: this.context.appendSystemPrompt,
              userSpecifiedModel: this.context.model,
              fallbackModel: this.context.fallbackModel,
              teleport: undefined,
              sdkUrl: undefined,
              replayUserMessages: true,
              includePartialMessages: true,
              forkSession: false,
              rewindFiles: undefined,
              enableAuthStatus: false,
              agent: undefined,
              workload: undefined,
              exitOnComplete: false,
              createStructuredIO: inputPrompt =>
                this.createStructuredIO(inputPrompt, signal),
            },
          )
        } finally {
          if (this.currentInput === input) {
            input.close()
            this.currentInput = null
          }
        }
      }),
    )

    this.hasStartedHeadlessSession = true
    if (signal.aborted) {
      return
    }
    if (this.resultError) {
      throw new Error(this.resultError)
    }
  }

  private get tools() {
    return getDesktopHeadlessTools(this.store.getState().toolPermissionContext)
  }

  private prepareGlobalSessionState(): void {
    setClientType('desktop')
    setOriginalCwd(this.context.workspacePath)
    setProjectRoot(this.context.workspacePath)
    setCwdState(this.context.workspacePath)
    setSessionTrustAccepted(true)
    switchSession(asSessionId(this.context.sessionId), null)
    if (this.context.sessionName) {
      cacheSessionTitle(this.context.sessionName)
    }
  }

  private createStructuredIO(
    inputPrompt: string | AsyncIterable<string>,
    signal: AbortSignal,
  ): StructuredIO {
    const structuredIO = new StructuredIO(
      structuredInputFromPrompt(this.context.sessionId, inputPrompt),
      true,
      {
        writeMessage: message => this.handleStructuredOutput(message, signal),
      },
    )
    this.structuredIO = structuredIO
    return structuredIO
  }

  private async handleStructuredOutput(
    message: StdoutMessage,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      return
    }
    if (message.type === 'control_request') {
      await this.handleControlRequest(message as Record<string, unknown>)
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
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          isError: item.is_error === true,
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
        isError: item.is_error === true,
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
    this.currentInput?.close()
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
    const subtype = request.subtype
    if (subtype !== 'can_use_tool') {
      this.injectControlResponse({
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
        updatedInput: input,
        toolUseID: request.tool_use_id,
        decisionClassification: decision.alwaysAllow
          ? 'user_permanent'
          : 'user_temporary',
      }
      const updatedPermissions = getUpdatedPermissions(request, decision)
      if (updatedPermissions.length > 0) {
        response.updatedPermissions = updatedPermissions
      }
      this.injectControlResponse({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response,
        },
      })
    } else {
      this.injectControlResponse({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: decision.message ?? 'Permission denied',
        },
      })
    }
  }

  private injectControlResponse(message: Record<string, unknown>): void {
    this.structuredIO?.injectControlResponse(message as never)
  }
}

class DesktopHeadlessInput implements AsyncIterable<string> {
  private closed = false
  private readonly lines: string[] = []
  private waiter: (() => void) | null = null

  constructor(
    private readonly sessionId: string,
    prompt: string,
    private readonly signal: AbortSignal,
  ) {
    this.enqueueUserPrompt(prompt)
    if (signal.aborted) {
      this.enqueueInterrupt()
      this.close()
    } else {
      signal.addEventListener('abort', this.onAbort, { once: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    try {
      while (this.lines.length > 0 || !this.closed) {
        const line = this.lines.shift()
        if (line) {
          yield line
          continue
        }
        await new Promise<void>(resolve => {
          this.waiter = resolve
        })
      }
    } finally {
      this.close()
    }
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.signal.removeEventListener('abort', this.onAbort)
    this.notify()
  }

  private readonly onAbort = (): void => {
    this.enqueueInterrupt()
    this.close()
  }

  private enqueueUserPrompt(prompt: string): void {
    this.enqueue({
      type: 'user',
      session_id: this.sessionId,
      message: {
        role: 'user',
        content: prompt,
      },
      parent_tool_use_id: null,
    })
  }

  private enqueueInterrupt(): void {
    this.enqueue({
      type: 'control_request',
      request_id: randomUUID(),
      request: {
        subtype: 'interrupt',
      },
    })
  }

  private enqueue(message: Record<string, unknown>): void {
    if (this.closed) {
      return
    }
    this.lines.push(`${JSON.stringify(message)}\n`)
    this.notify()
  }

  private notify(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }
}

function getInitialDesktopAppState(context: DesktopAgentRuntimeContext) {
  const appState = getDefaultAppState()
  const additionalWorkingDirectories = new Map(
    appState.toolPermissionContext.additionalWorkingDirectories,
  )
  for (const directory of context.additionalDirectories ?? []) {
    additionalWorkingDirectories.set(directory, {
      path: directory,
      source: 'session',
    })
  }
  return {
    ...appState,
    verbose: true,
    thinkingEnabled: context.thinkingMode !== 'disabled',
    toolPermissionContext: {
      ...appState.toolPermissionContext,
      mode: context.permissionMode ?? 'default',
      additionalWorkingDirectories,
      isBypassPermissionsModeAvailable:
        context.permissionMode === 'bypassPermissions',
    },
  }
}

function getDesktopHeadlessTools(
  permissionContext: ToolPermissionContext,
): Tools {
  const tools: Tool[] = [
    BashTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
    WebSearchTool,
    TodoWriteTool,
    AskUserQuestionTool,
    EnterPlanModeTool,
    ExitPlanModeV2Tool,
    TaskStopTool,
  ]
  return tools.filter(
    tool => !getDenyRuleForTool(permissionContext, tool) && tool.isEnabled(),
  )
}

async function* structuredInputFromPrompt(
  sessionId: string,
  inputPrompt: string | AsyncIterable<string>,
): AsyncIterable<string> {
  if (typeof inputPrompt !== 'string') {
    yield* inputPrompt
    return
  }
  yield `${JSON.stringify({
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content: inputPrompt,
    },
    parent_tool_use_id: null,
  })}\n`
}

function thinkingConfigFromDesktopMode(
  thinkingMode: DesktopThinkingMode | undefined,
): ThinkingConfig | undefined {
  switch (thinkingMode) {
    case 'enabled':
    case 'adaptive':
      return { type: 'adaptive' }
    case 'disabled':
      return { type: 'disabled' }
    default:
      return undefined
  }
}

function permissionModeArgs(
  permissionMode: DesktopPermissionMode | undefined,
): string[] {
  if (!permissionMode || permissionMode === 'default') {
    return []
  }
  if (permissionMode === 'bypassPermissions') {
    return ['--dangerously-skip-permissions']
  }
  return ['--permission-mode', permissionMode]
}

function modelArgs(model: string | undefined): string[] {
  return model ? ['--model', model] : []
}

function fallbackModelArgs(fallbackModel: string | undefined): string[] {
  return fallbackModel ? ['--fallback-model', fallbackModel] : []
}

function sessionNameArgs(sessionName: string | undefined): string[] {
  return sessionName ? ['--name', sessionName] : []
}

function thinkingModeArgs(
  thinkingMode: DesktopThinkingMode | undefined,
): string[] {
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

function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return toolName
  }
  const record = input as Record<string, unknown>
  const target =
    record.file_path ??
    record.filePath ??
    record.pattern ??
    record.command ??
    record.url ??
    record.query
  return typeof target === 'string' ? `${toolName}: ${target}` : toolName
}

function extractPartialText(item: Record<string, unknown>): string | null {
  if (item.type !== 'content_block_delta') {
    return null
  }
  const delta = item.delta
  if (!delta || typeof delta !== 'object') {
    return null
  }
  const record = delta as Record<string, unknown>
  return record.type === 'text_delta' && typeof record.text === 'string'
    ? record.text
    : null
}

function getMessageContent(message: Record<string, unknown>): unknown {
  const wrappedMessage = message.message
  return wrappedMessage && typeof wrappedMessage === 'object'
    ? (wrappedMessage as Record<string, unknown>).content
    : undefined
}

function getResultErrorMessage(message: Record<string, unknown>): string {
  if (Array.isArray(message.errors) && typeof message.errors[0] === 'string') {
    return message.errors[0]
  }
  if (typeof message.result === 'string' && message.result.trim()) {
    return message.result
  }
  if (typeof message.subtype === 'string') {
    return message.subtype
  }
  return 'Desktop headless session failed'
}

function getUpdatedPermissions(
  request: Record<string, unknown>,
  decision: DesktopPermissionDecision,
): Record<string, unknown>[] {
  if (!decision.alwaysAllow || !Array.isArray(request.permission_suggestions)) {
    return []
  }
  return request.permission_suggestions
    .filter(isPermissionUpdate)
    .map(update =>
      update.destination === 'session'
        ? { ...update, destination: 'localSettings' }
        : update,
    )
}

function isPermissionUpdate(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const update = value as Record<string, unknown>
  if (typeof update.type !== 'string') {
    return false
  }
  if (typeof update.destination !== 'string') {
    return false
  }
  if (
    update.type === 'addRules' ||
    update.type === 'replaceRules' ||
    update.type === 'removeRules'
  ) {
    return Array.isArray(update.rules) && typeof update.behavior === 'string'
  }
  if (update.type === 'setMode') {
    return typeof update.mode === 'string'
  }
  if (update.type === 'addDirectories' || update.type === 'removeDirectories') {
    return Array.isArray(update.directories)
  }
  return false
}

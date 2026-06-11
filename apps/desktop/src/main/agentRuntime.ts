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
import { detectShellCommandRisk } from './permissionRisk.js'

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
  private readonly streamState = createDesktopRuntimeStreamState()

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
    resetDesktopRuntimeStreamState(this.streamState)

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
      case 'stream_request_start':
      case 'stream_event':
        logDesktopStreamDebug('cli-stdout-stream', describeStreamMessage(message))
        emitDesktopStreamEvents(
          message,
          this.context.sessionId,
          this.streamState,
          event => this.context.emit(event),
        )
        return
      case 'assistant':
        logDesktopStreamDebug('cli-stdout-assistant', describeAssistantMessage(message))
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
        logDesktopStreamDebug('cli-stdout-user', describeUserMessage(message))
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
        this.streamState.partialText += partialText
        logDesktopStreamDebug('assistant-partial-text', {
          sessionId: this.context.sessionId,
          deltaLength: partialText.length,
          totalLength: this.streamState.partialText.length,
        })
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.streamState.partialText,
        })
      } else if (item.type === 'thinking' && typeof item.thinking === 'string') {
        this.streamState.thinkingText = item.thinking
        logDesktopStreamDebug('assistant-thinking-block', {
          sessionId: this.context.sessionId,
          length: item.thinking.length,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'thinking',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
        this.context.emit({
          type: 'thinking_delta',
          sessionId: this.context.sessionId,
          text: item.thinking,
          fullText: this.streamState.thinkingText,
        })
      } else if (item.type === 'redacted_thinking') {
        this.streamState.thinkingText = ''
        logDesktopStreamDebug('assistant-thinking-block', {
          sessionId: this.context.sessionId,
          redacted: true,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'thinking',
          thinkingRedacted: true,
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.streamState.partialText = item.text
        logDesktopStreamDebug('assistant-text-block', {
          sessionId: this.context.sessionId,
          length: item.text.length,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'responding',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.streamState.partialText,
        })
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'assistant',
          text: item.text,
        })
        this.streamState.partialText = ''
      } else if (item.type === 'tool_use') {
        const toolName = typeof item.name === 'string' ? item.name : 'Tool'
        if (typeof item.id === 'string') {
          this.streamState.toolNamesByUseId.set(item.id, toolName)
          this.streamState.activeToolUseIds.add(item.id)
        }
        logDesktopStreamDebug('assistant-tool-use-block', {
          sessionId: this.context.sessionId,
          toolUseId: typeof item.id === 'string' ? item.id : undefined,
          toolName,
          hasInput: item.input !== undefined,
        })
        this.context.emit({
          type: 'tool_start',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.input),
          toolUseId: typeof item.id === 'string' ? item.id : undefined,
          input: item.input,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'tool-use',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        if (typeof item.tool_use_id === 'string') {
          this.streamState.activeToolUseIds.delete(item.tool_use_id)
        }
        logDesktopStreamDebug('assistant-tool-result-block', {
          sessionId: this.context.sessionId,
          toolUseId:
            typeof item.tool_use_id === 'string'
              ? item.tool_use_id
              : undefined,
          toolName,
          isError: item.is_error === true,
        })
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          toolUseId:
            typeof item.tool_use_id === 'string'
              ? item.tool_use_id
              : undefined,
          content: item.content,
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
      if (typeof item.tool_use_id === 'string') {
        this.streamState.activeToolUseIds.delete(item.tool_use_id)
      }
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName,
        summary: summarizeToolInput(toolName, item.content),
        toolUseId:
          typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined,
        content: item.content,
        isError: item.is_error === true,
      })
    }
  }

  private toolNameForResult(item: Record<string, unknown>): string {
    return typeof item.tool_use_id === 'string'
      ? (this.streamState.toolNamesByUseId.get(item.tool_use_id) ?? 'Tool')
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
      message.result !== this.streamState.partialText
    ) {
      this.context.emit({
        type: 'message',
        sessionId: this.context.sessionId,
        role: 'assistant',
        text: message.result,
      })
    }
    this.streamState.partialText = ''
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
      ...attachShellCommandRisk(toolName, input),
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
      const errorMessage = decision.feedback
        ? `${decision.message ?? 'Permission denied'}\n\n模型需要这样调整：\n${decision.feedback}`
        : decision.message ?? 'Permission denied'
      this.writeJsonLineToCurrentChild({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: errorMessage,
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
  private resultError: string | null = null
  private currentInput: DesktopHeadlessInput | null = null
  private structuredIO: StructuredIO | null = null
  private readonly streamState = createDesktopRuntimeStreamState()
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
    this.resultError = null
    resetDesktopRuntimeStreamState(this.streamState)

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
      case 'stream_request_start':
      case 'stream_event':
        logDesktopStreamDebug(
          'in-process-stream',
          describeStreamMessage(message),
        )
        emitDesktopStreamEvents(
          message,
          this.context.sessionId,
          this.streamState,
          event => this.context.emit(event),
        )
        return
      case 'assistant':
        logDesktopStreamDebug(
          'in-process-assistant',
          describeAssistantMessage(message),
        )
        this.emitAssistantMessage(message)
        return
      case 'system':
        this.emitSystemMessage(message)
        return
      case 'result':
        this.emitResultMessage(message)
        return
      case 'user':
        logDesktopStreamDebug('in-process-user', describeUserMessage(message))
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
        this.streamState.partialText += partialText
        logDesktopStreamDebug('assistant-partial-text', {
          sessionId: this.context.sessionId,
          deltaLength: partialText.length,
          totalLength: this.streamState.partialText.length,
        })
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.streamState.partialText,
        })
      } else if (item.type === 'thinking' && typeof item.thinking === 'string') {
        this.streamState.thinkingText = item.thinking
        logDesktopStreamDebug('assistant-thinking-block', {
          sessionId: this.context.sessionId,
          length: item.thinking.length,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'thinking',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
        this.context.emit({
          type: 'thinking_delta',
          sessionId: this.context.sessionId,
          text: item.thinking,
          fullText: this.streamState.thinkingText,
        })
      } else if (item.type === 'redacted_thinking') {
        this.streamState.thinkingText = ''
        logDesktopStreamDebug('assistant-thinking-block', {
          sessionId: this.context.sessionId,
          redacted: true,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'thinking',
          thinkingRedacted: true,
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
      } else if (item.type === 'text' && typeof item.text === 'string') {
        this.emittedAssistantText = true
        this.streamState.partialText = item.text
        logDesktopStreamDebug('assistant-text-block', {
          sessionId: this.context.sessionId,
          length: item.text.length,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'responding',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
        this.context.emit({
          type: 'partial_message',
          sessionId: this.context.sessionId,
          text: this.streamState.partialText,
        })
        this.context.emit({
          type: 'message',
          sessionId: this.context.sessionId,
          role: 'assistant',
          text: item.text,
        })
        this.streamState.partialText = ''
      } else if (item.type === 'tool_use') {
        const toolName = typeof item.name === 'string' ? item.name : 'Tool'
        if (typeof item.id === 'string') {
          this.streamState.toolNamesByUseId.set(item.id, toolName)
          this.streamState.activeToolUseIds.add(item.id)
        }
        logDesktopStreamDebug('assistant-tool-use-block', {
          sessionId: this.context.sessionId,
          toolUseId: typeof item.id === 'string' ? item.id : undefined,
          toolName,
          hasInput: item.input !== undefined,
        })
        this.context.emit({
          type: 'tool_start',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.input),
          toolUseId: typeof item.id === 'string' ? item.id : undefined,
          input: item.input,
        })
        this.context.emit({
          type: 'stream_state',
          sessionId: this.context.sessionId,
          mode: 'tool-use',
          activeToolUseIds: [...this.streamState.activeToolUseIds],
        })
      } else if (item.type === 'tool_result') {
        const toolName = this.toolNameForResult(item)
        if (typeof item.tool_use_id === 'string') {
          this.streamState.activeToolUseIds.delete(item.tool_use_id)
        }
        logDesktopStreamDebug('assistant-tool-result-block', {
          sessionId: this.context.sessionId,
          toolUseId:
            typeof item.tool_use_id === 'string'
              ? item.tool_use_id
              : undefined,
          toolName,
          isError: item.is_error === true,
        })
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.content),
          toolUseId:
            typeof item.tool_use_id === 'string'
              ? item.tool_use_id
              : undefined,
          content: item.content,
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
      if (typeof item.tool_use_id === 'string') {
        this.streamState.activeToolUseIds.delete(item.tool_use_id)
      }
      this.context.emit({
        type: 'tool_result',
        sessionId: this.context.sessionId,
        toolName,
        summary: summarizeToolInput(toolName, item.content),
        toolUseId:
          typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined,
        content: item.content,
        isError: item.is_error === true,
      })
    }
  }

  private toolNameForResult(item: Record<string, unknown>): string {
    return typeof item.tool_use_id === 'string'
      ? (this.streamState.toolNamesByUseId.get(item.tool_use_id) ?? 'Tool')
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
      message.result !== this.streamState.partialText
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
    this.streamState.partialText = ''
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
      ...attachShellCommandRisk(toolName, input),
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
      const errorMessage = decision.feedback
        ? `${decision.message ?? 'Permission denied'}\n\n模型需要这样调整：\n${decision.feedback}`
        : decision.message ?? 'Permission denied'
      this.injectControlResponse({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'error',
          error: errorMessage,
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

type DesktopStreamingToolInput = {
  toolUseId: string
  toolName: string
  partialInput: string
}

type DesktopRuntimeStreamState = {
  partialText: string
  thinkingText: string
  toolNamesByUseId: Map<string, string>
  toolInputsByIndex: Map<number, DesktopStreamingToolInput>
  activeToolUseIds: Set<string>
}

function createDesktopRuntimeStreamState(): DesktopRuntimeStreamState {
  return {
    partialText: '',
    thinkingText: '',
    toolNamesByUseId: new Map(),
    toolInputsByIndex: new Map(),
    activeToolUseIds: new Set(),
  }
}

function resetDesktopRuntimeStreamState(
  state: DesktopRuntimeStreamState,
): void {
  state.partialText = ''
  state.thinkingText = ''
  state.toolNamesByUseId.clear()
  state.toolInputsByIndex.clear()
  state.activeToolUseIds.clear()
}

function emitDesktopStreamEvents(
  message: Record<string, unknown>,
  sessionId: string,
  state: DesktopRuntimeStreamState,
  emit: (event: DesktopAgentEvent) => void,
): void {
  if (message.type === 'stream_request_start') {
    logDesktopStreamDebug('emit-stream-state', {
      mode: 'requesting',
      sessionId,
    })
    emit({
      type: 'stream_state',
      sessionId,
      mode: 'requesting',
      activeToolUseIds: [...state.activeToolUseIds],
    })
    return
  }
  if (message.type !== 'stream_event') {
    return
  }

  const event = objectRecord(message.event)
  if (!event) return
  switch (event.type) {
    case 'message_stop':
      logDesktopStreamDebug('emit-stream-state', {
        mode: 'tool-use',
        sessionId,
        activeToolUseCount: state.activeToolUseIds.size,
      })
      emit({
        type: 'stream_state',
        sessionId,
        mode: 'tool-use',
        activeToolUseIds: [...state.activeToolUseIds],
      })
      return
    case 'content_block_start':
      handleStreamContentBlockStart(event, sessionId, state, emit)
      return
    case 'content_block_delta':
      handleStreamContentBlockDelta(event, sessionId, state, emit)
      return
    case 'message_delta':
      emit({
        type: 'stream_state',
        sessionId,
        mode: 'responding',
        activeToolUseIds: [...state.activeToolUseIds],
      })
      return
    default:
      return
  }
}

function handleStreamContentBlockStart(
  event: Record<string, unknown>,
  sessionId: string,
  state: DesktopRuntimeStreamState,
  emit: (event: DesktopAgentEvent) => void,
): void {
  const contentBlock = objectRecord(event.content_block)
  if (!contentBlock) return
  if (contentBlock.type === 'text') {
    logDesktopStreamDebug('stream-block-start', {
      blockType: 'text',
      sessionId,
    })
    emit({
      type: 'stream_state',
      sessionId,
      mode: 'responding',
      activeToolUseIds: [...state.activeToolUseIds],
    })
    return
  }
  if (contentBlock.type === 'thinking' || contentBlock.type === 'redacted_thinking') {
    state.thinkingText = ''
    logDesktopStreamDebug('stream-block-start', {
      blockType: contentBlock.type,
      sessionId,
    })
    emit({
      type: 'stream_state',
      sessionId,
      mode: 'thinking',
      thinkingRedacted: contentBlock.type === 'redacted_thinking',
      activeToolUseIds: [...state.activeToolUseIds],
    })
    return
  }
  if (contentBlock.type === 'tool_use') {
    const toolUseId =
      typeof contentBlock.id === 'string' ? contentBlock.id : randomUUID()
    const toolName =
      typeof contentBlock.name === 'string' ? contentBlock.name : 'Tool'
    const index = typeof event.index === 'number' ? event.index : -1
    state.toolNamesByUseId.set(toolUseId, toolName)
    state.activeToolUseIds.add(toolUseId)
    if (index >= 0) {
      state.toolInputsByIndex.set(index, {
        toolUseId,
        toolName,
        partialInput: '',
      })
    }
    logDesktopStreamDebug('stream-tool-start', {
      sessionId,
      toolUseId,
      toolName,
      index,
      hasInput: contentBlock.input !== undefined,
    })
    emit({
      type: 'tool_start',
      sessionId,
      toolUseId,
      toolName,
      summary: summarizeToolInput(toolName, contentBlock.input),
      input: contentBlock.input,
    })
    emit({
      type: 'stream_state',
      sessionId,
      mode: 'tool-input',
      activeToolUseIds: [...state.activeToolUseIds],
    })
    return
  }
  if (isToolLikeStreamBlock(contentBlock.type)) {
    emit({
      type: 'stream_state',
      sessionId,
      mode: 'tool-input',
      activeToolUseIds: [...state.activeToolUseIds],
    })
  }
}

function handleStreamContentBlockDelta(
  event: Record<string, unknown>,
  sessionId: string,
  state: DesktopRuntimeStreamState,
  emit: (event: DesktopAgentEvent) => void,
): void {
  const delta = objectRecord(event.delta)
  if (!delta) return
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    state.partialText += delta.text
    logDesktopStreamDebug('stream-text-delta', {
      sessionId,
      deltaLength: delta.text.length,
      totalLength: state.partialText.length,
    })
    emit({
      type: 'partial_message',
      sessionId,
      text: state.partialText,
    })
    return
  }
  if (
    delta.type === 'thinking_delta' &&
    typeof delta.thinking === 'string'
  ) {
    state.thinkingText += delta.thinking
    logDesktopStreamDebug('stream-thinking-delta', {
      sessionId,
      deltaLength: delta.thinking.length,
      totalLength: state.thinkingText.length,
    })
    emit({
      type: 'thinking_delta',
      sessionId,
      text: delta.thinking,
      fullText: state.thinkingText,
    })
    return
  }
  if (
    delta.type === 'input_json_delta' &&
    typeof delta.partial_json === 'string'
  ) {
    const index = typeof event.index === 'number' ? event.index : -1
    const current = state.toolInputsByIndex.get(index)
    if (!current) {
      logDesktopStreamDebug('stream-tool-input-delta-missing-start', {
        sessionId,
        index,
        deltaLength: delta.partial_json.length,
      })
      return
    }
    current.partialInput += delta.partial_json
    logDesktopStreamDebug('stream-tool-input-delta', {
      sessionId,
      toolUseId: current.toolUseId,
      toolName: current.toolName,
      index,
      deltaLength: delta.partial_json.length,
      totalLength: current.partialInput.length,
    })
    emit({
      type: 'tool_input_delta',
      sessionId,
      toolUseId: current.toolUseId,
      toolName: current.toolName,
      partialInput: current.partialInput,
      input: parsePartialJson(current.partialInput),
      summary: summarizeToolInput(
        current.toolName,
        parsePartialJson(current.partialInput),
      ),
    })
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function parsePartialJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isToolLikeStreamBlock(type: unknown): boolean {
  return (
    type === 'server_tool_use' ||
    type === 'web_search_tool_result' ||
    type === 'code_execution_tool_result' ||
    type === 'mcp_tool_use' ||
    type === 'mcp_tool_result' ||
    type === 'container_upload' ||
    type === 'web_fetch_tool_result' ||
    type === 'bash_code_execution_tool_result' ||
    type === 'text_editor_code_execution_tool_result' ||
    type === 'tool_search_tool_result' ||
    type === 'compaction'
  )
}

function describeStreamMessage(message: Record<string, unknown>): Record<string, unknown> {
  const event = objectRecord(message.event)
  const contentBlock = objectRecord(event?.content_block)
  const delta = objectRecord(event?.delta)
  return {
    type: message.type,
    eventType: event?.type,
    blockType: contentBlock?.type,
    deltaType: delta?.type,
    index: event?.index,
    textLength:
      typeof delta?.text === 'string'
        ? delta.text.length
        : typeof delta?.thinking === 'string'
          ? delta.thinking.length
          : typeof delta?.partial_json === 'string'
            ? delta.partial_json.length
            : undefined,
  }
}

function describeAssistantMessage(
  message: Record<string, unknown>,
): Record<string, unknown> {
  const content = getMessageContent(message)
  const blocks = Array.isArray(content)
    ? content.flatMap(block => {
        const record = objectRecord(block)
        return record?.type ? [record.type] : []
      })
    : []
  return {
    type: message.type,
    blocks,
  }
}

function describeUserMessage(message: Record<string, unknown>): Record<string, unknown> {
  const content = getMessageContent(message)
  return {
    type: message.type,
    blockCount: Array.isArray(content) ? content.length : undefined,
    hasToolResult:
      Array.isArray(content) &&
      content.some(block => objectRecord(block)?.type === 'tool_result'),
  }
}

function logDesktopStreamDebug(
  label: string,
  data: Record<string, unknown>,
): void {
  if (process.env.DESKTOP_STREAM_DEBUG !== '1') {
    return
  }
  console.info(`[desktop-stream] ${label}`, data)
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
      return {
        type: 'enabled',
        budgetTokens: DESKTOP_ENABLED_THINKING_BUDGET,
      }
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

function attachShellCommandRisk(
  toolName: string,
  input: Record<string, unknown>,
): {
  risk: DesktopPermissionRequest['risk']
  commandPreview: string
  commandPrefix: string
} {
  const detected = detectShellCommandRisk(toolName, input)
  if (!detected) {
    return { risk: 'safe', commandPreview: '', commandPrefix: '' }
  }
  return {
    risk: detected.risk,
    commandPreview: detected.commandPreview,
    commandPrefix: detected.commandPrefix,
  }
}

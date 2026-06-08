import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
} from '../shared/types.js'

export type DesktopAgentRuntimeContext = {
  sessionId: string
  workspacePath: string
  agentExecutablePath?: string
  permissionMode?: DesktopPermissionMode
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopAgentRuntime = {
  runUserTurn(content: string, signal: AbortSignal): Promise<void>
}

export function createDesktopAgentRuntime(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntime {
  if (
    context.agentExecutablePath &&
    existsSync(context.agentExecutablePath)
  ) {
    return new CliDesktopAgentRuntime(context)
  }
  return new DryRunDesktopAgentRuntime(context)
}

class CliDesktopAgentRuntime implements DesktopAgentRuntime {
  private child: ChildProcessWithoutNullStreams | null = null
  private emittedAssistantText = false
  private partialText = ''

  constructor(private readonly context: DesktopAgentRuntimeContext) {}

  async runUserTurn(content: string, signal: AbortSignal): Promise<void> {
    const executablePath = this.context.agentExecutablePath
    if (!executablePath) {
      throw new Error('Desktop agent executable path is not configured')
    }
    this.emittedAssistantText = false
    this.partialText = ''

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
        '--session-id',
        this.context.sessionId,
        ...permissionModeArgs(this.context.permissionMode),
      ],
      {
        cwd: this.context.workspacePath,
        windowsHide: true,
        env: {
          ...process.env,
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
    const assistantMessage = message.message
    if (!assistantMessage || typeof assistantMessage !== 'object') {
      return
    }
    const content = (assistantMessage as Record<string, unknown>).content
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
        this.context.emit({
          type: 'tool_start',
          sessionId: this.context.sessionId,
          toolName,
          summary: summarizeToolInput(toolName, item.input),
        })
      } else if (item.type === 'tool_result') {
        this.context.emit({
          type: 'tool_result',
          sessionId: this.context.sessionId,
          toolName: 'Tool',
          summary: summarizeToolInput('Tool', item.content),
          isError: item.is_error === true,
        })
      }
    }
  }

  private emitSystemMessage(message: Record<string, unknown>): void {
    const subtype =
      typeof message.subtype === 'string' ? message.subtype : 'system'
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
    if (this.child && !this.child.stdin.destroyed) {
      this.child.stdin.end()
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
    const subtype = request.subtype
    if (subtype !== 'can_use_tool') {
      this.writeJsonLineToCurrentChild({
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

class DryRunDesktopAgentRuntime implements DesktopAgentRuntime {
  constructor(private readonly context: DesktopAgentRuntimeContext) {}

  async runUserTurn(content: string, signal: AbortSignal): Promise<void> {
    await this.maybeRequestPermission(content, signal)
    if (signal.aborted) {
      return
    }

    this.context.emit({
      type: 'message',
      sessionId: this.context.sessionId,
      role: 'assistant',
      text: 'Desktop agent runtime is initialized. The next step is wiring this runtime interface to the shared headless agent runner.',
    })
    this.context.emit({
      type: 'tool_start',
      sessionId: this.context.sessionId,
      toolName: 'DesktopRuntime',
      summary: 'Preparing in-process agent bridge',
    })
    this.context.emit({
      type: 'tool_result',
      sessionId: this.context.sessionId,
      toolName: 'DesktopRuntime',
      summary: 'Session API and IPC are connected',
    })
  }

  private async maybeRequestPermission(
    content: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!/\b(write|edit|shell|permission)\b/i.test(content)) {
      return
    }

    const decision = await this.context.requestPermission({
      requestId: randomUUID(),
      toolName: 'DesktopRuntime',
      input: { prompt: content, workspacePath: this.context.workspacePath },
      description: 'Approve this desktop runtime dry-run permission request.',
    })

    if (signal.aborted) {
      return
    }
    if (decision.behavior === 'deny') {
      throw new Error(decision.message ?? 'Permission denied')
    }
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

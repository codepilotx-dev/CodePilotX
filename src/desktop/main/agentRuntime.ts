import { randomUUID } from 'node:crypto'
import type {
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
} from '../shared/types.js'

export type DesktopAgentRuntimeContext = {
  sessionId: string
  workspacePath: string
  emit(event: DesktopAgentEvent): void
  requestPermission(request: DesktopPermissionRequest): Promise<DesktopPermissionDecision>
}

export type DesktopAgentRuntime = {
  runUserTurn(content: string, signal: AbortSignal): Promise<void>
}

export function createDesktopAgentRuntime(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntime {
  return new DryRunDesktopAgentRuntime(context)
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

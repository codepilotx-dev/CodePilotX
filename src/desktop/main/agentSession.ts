import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  CreateDesktopSessionOptions,
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopSessionStatus,
} from '../shared/types.js'

type DesktopAgentSessionEvents = {
  event: [DesktopAgentEvent]
}

type PendingPermission = {
  request: DesktopPermissionRequest
  resolve: (decision: DesktopPermissionDecision) => void
}

export type DesktopAgentSession = {
  sessionId: string
  workspacePath: string
  sendUserMessage(content: string): Promise<void>
  respondToPermission(
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
  on<EventName extends keyof DesktopAgentSessionEvents>(
    eventName: EventName,
    listener: (...args: DesktopAgentSessionEvents[EventName]) => void,
  ): void
  off<EventName extends keyof DesktopAgentSessionEvents>(
    eventName: EventName,
    listener: (...args: DesktopAgentSessionEvents[EventName]) => void,
  ): void
}

class LocalDesktopAgentSession
  extends EventEmitter
  implements DesktopAgentSession
{
  readonly sessionId = randomUUID()
  readonly workspacePath: string
  private disposed = false
  private currentAbortController: AbortController | null = null
  private readonly pendingPermissions = new Map<string, PendingPermission>()

  constructor(options: CreateDesktopSessionOptions) {
    super()
    this.workspacePath = options.workspacePath
    this.emitStatus('idle')
    this.emitMessage('system', `Workspace attached: ${options.workspacePath}`)
  }

  async sendUserMessage(content: string): Promise<void> {
    this.assertActive()
    this.emitMessage('user', content)
    this.emitStatus('running')

    const abortController = new AbortController()
    this.currentAbortController = abortController

    try {
      await this.maybeRequestPermission(content, abortController.signal)
      if (abortController.signal.aborted) {
        return
      }

      this.emitMessage(
        'assistant',
        'Desktop agent runtime is initialized. The next step is wiring this session facade to the shared headless agent runner.',
      )
      this.emit({
        type: 'tool_start',
        sessionId: this.sessionId,
        toolName: 'DesktopRuntime',
        summary: 'Preparing in-process agent bridge',
      })
      this.emit({
        type: 'tool_result',
        sessionId: this.sessionId,
        toolName: 'DesktopRuntime',
        summary: 'Session API and IPC are connected',
      })
      this.emitStatus('done')
      this.emit({ type: 'done', sessionId: this.sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'error', sessionId: this.sessionId, message })
      this.emitStatus('error')
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null
      }
    }
  }

  async respondToPermission(
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void> {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) {
      return
    }
    this.pendingPermissions.delete(requestId)
    pending.resolve(decision)
  }

  async interrupt(): Promise<void> {
    this.currentAbortController?.abort()
    this.emitStatus('done')
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.currentAbortController?.abort()
    for (const [requestId, pending] of this.pendingPermissions) {
      this.pendingPermissions.delete(requestId)
      pending.resolve({
        behavior: 'deny',
        message: 'Session disposed before approval',
      })
    }
    this.emit({ type: 'done', sessionId: this.sessionId })
    this.removeAllListeners()
  }

  private async maybeRequestPermission(
    content: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!/\b(write|edit|shell|permission)\b/i.test(content)) {
      return
    }

    const requestId = randomUUID()
    const request: DesktopPermissionRequest = {
      requestId,
      toolName: 'DesktopRuntime',
      input: { prompt: content },
      description: 'Approve this desktop runtime dry-run permission request.',
    }

    const decision = await new Promise<DesktopPermissionDecision>(resolve => {
      this.pendingPermissions.set(requestId, { request, resolve })
      this.emitStatus('waiting')
      this.emit({
        type: 'permission_request',
        sessionId: this.sessionId,
        request,
      })

      signal.addEventListener(
        'abort',
        () => {
          if (!this.pendingPermissions.has(requestId)) return
          this.pendingPermissions.delete(requestId)
          resolve({
            behavior: 'deny',
            message: 'Interrupted before approval',
          })
        },
        { once: true },
      )
    })

    if (decision.behavior === 'deny') {
      throw new Error(decision.message ?? 'Permission denied')
    }
    this.emitStatus('running')
  }

  private emitMessage(role: 'user' | 'assistant' | 'system', text: string): void {
    this.emit({
      type: 'message',
      sessionId: this.sessionId,
      role,
      text,
    })
  }

  private emitStatus(status: DesktopSessionStatus): void {
    this.emit({
      type: 'status',
      sessionId: this.sessionId,
      status,
    })
  }

  private emit(event: DesktopAgentEvent): boolean {
    return super.emit('event', event)
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Desktop agent session has been disposed')
    }
  }
}

export function createDesktopAgentSession(
  options: CreateDesktopSessionOptions,
): DesktopAgentSession {
  return new LocalDesktopAgentSession(options)
}

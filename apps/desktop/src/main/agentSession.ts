import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  createDesktopAgentRuntime,
  type DesktopAgentRuntime,
  type DesktopAgentRuntimePreference,
} from './agentRuntime.js'
import { desktopDebug } from './desktopDebug.js'
import type {
  CreateDesktopSessionOptions,
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopSessionStatus,
} from '../shared/types.js'
import { desktopPermissionPolicyForMode } from '../shared/settingsSchema.js'

type DesktopAgentSessionEvents = {
  event: [DesktopAgentEvent]
}

type PendingPermission = {
  request: DesktopPermissionRequest
  resolve: (decision: DesktopPermissionDecision) => void
}

type ResolvedDesktopSessionOptions = CreateDesktopSessionOptions & {
  workspacePath: string
  sessionId?: string
  resumeExistingSession?: boolean
  suppressStartupMessage?: boolean
}

export type DesktopAgentSessionRuntimeOptions = {
  agentExecutablePath?: string
  configDirectoryPath?: string
  runtimePreference?: DesktopAgentRuntimePreference
}

export type DesktopAgentSession = {
  sessionId: string
  workspacePath: string
  setModel(model: string | undefined): void
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
  readonly sessionId: string
  readonly workspacePath: string
  private disposed = false
  private currentAbortController: AbortController | null = null
  private readonly pendingPermissions = new Map<string, PendingPermission>()
  private readonly runtime: DesktopAgentRuntime
  private readonly permissionMode: CreateDesktopSessionOptions['permissionMode']

  constructor(
    options: ResolvedDesktopSessionOptions,
    runtimeOptions: DesktopAgentSessionRuntimeOptions,
  ) {
    super()
    this.sessionId = options.sessionId ?? randomUUID()
    this.workspacePath = options.workspacePath
    this.permissionMode = options.permissionMode
    this.runtime = createDesktopAgentRuntime({
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
      agentExecutablePath: runtimeOptions.agentExecutablePath,
      configDirectoryPath: runtimeOptions.configDirectoryPath,
      runtimePreference: runtimeOptions.runtimePreference,
      resumeExistingSession: options.resumeExistingSession,
      permissionMode: options.permissionMode,
      model: options.model,
      fallbackModel: options.fallbackModel,
      sessionName: options.sessionName,
      thinkingMode: options.thinkingMode,
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      additionalDirectories: options.additionalDirectories,
      emit: event => this.emitEvent(event),
      requestPermission: request => this.requestPermission(request),
    })
    queueMicrotask(() => {
      if (this.disposed || options.suppressStartupMessage) {
        return
      }
      this.emitStatus('idle')
      this.emitMessage(
        'system',
        `Workspace attached: ${options.workspacePath} (${options.sessionName ?? 'untitled'} session, ${options.permissionMode ?? 'default'} permissions, ${options.model ?? 'default'} model, ${options.fallbackModel ?? 'none'} fallback, ${options.thinkingMode ?? 'default'} thinking, ${options.systemPrompt ? 'custom' : 'default'} system prompt, ${options.additionalDirectories?.length ?? 0} extra dirs)`,
      )
    })
  }

  setModel(model: string | undefined): void {
    this.runtime.setModel(model)
  }

  async sendUserMessage(content: string): Promise<void> {
    this.assertActive()
    if (this.currentAbortController) {
      desktopDebug('session_send_rejected_already_running', {
        sessionId: this.sessionId,
      })
      throw new Error('Desktop agent session is already running')
    }
    const startedAt = Date.now()
    desktopDebug('session_send_start', {
      sessionId: this.sessionId,
      textLength: content.length,
    })
    this.emitMessage('user', content)
    this.emitStatus('running')

    const abortController = new AbortController()
    this.currentAbortController = abortController

    try {
      await this.runtime.runUserTurn(content, abortController.signal)
      if (abortController.signal.aborted) {
        desktopDebug('session_send_aborted', {
          sessionId: this.sessionId,
          durationMs: Date.now() - startedAt,
        })
        return
      }
      this.emitStatus('done')
      this.emitEvent({ type: 'done', sessionId: this.sessionId })
      desktopDebug('session_send_done', {
        sessionId: this.sessionId,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      desktopDebug('session_send_error', {
        sessionId: this.sessionId,
        durationMs: Date.now() - startedAt,
        message,
      })
      this.emitEvent({ type: 'error', sessionId: this.sessionId, message })
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
    if (!this.currentAbortController) {
      desktopDebug('session_interrupt_ignored_idle', {
        sessionId: this.sessionId,
      })
      return
    }
    desktopDebug('session_interrupt', { sessionId: this.sessionId })
    this.currentAbortController.abort()
    this.emitStatus('done')
    this.emitEvent({ type: 'done', sessionId: this.sessionId })
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
    this.emitEvent({ type: 'done', sessionId: this.sessionId })
    this.removeAllListeners()
  }

  private async requestPermission(
    request: DesktopPermissionRequest,
  ): Promise<DesktopPermissionDecision> {
    const permissionPolicy = desktopPermissionPolicyForMode(
      this.permissionMode,
    )
    const normalizedRequest: DesktopPermissionRequest = {
      ...request,
      profile: request.profile ?? permissionPolicy.profile,
      approvalMode: request.approvalMode ?? permissionPolicy.approvalMode,
    }
    const decision = await new Promise<DesktopPermissionDecision>(resolve => {
      this.pendingPermissions.set(normalizedRequest.requestId, {
        request: normalizedRequest,
        resolve,
      })
      this.emitStatus('waiting')
      this.emitEvent({
        type: 'permission_request',
        sessionId: this.sessionId,
        request: normalizedRequest,
      })

      this.currentAbortController?.signal.addEventListener(
        'abort',
        () => {
          if (!this.pendingPermissions.has(normalizedRequest.requestId)) return
          this.pendingPermissions.delete(normalizedRequest.requestId)
          resolve({
            behavior: 'deny',
            message: 'Interrupted before approval',
          })
        },
        { once: true },
      )
    })
    if (!this.disposed && !this.currentAbortController?.signal.aborted) {
      this.emitStatus('running')
    }
    return decision
  }

  private emitMessage(role: 'user' | 'assistant' | 'system', text: string): void {
    this.emitEvent({
      type: 'message',
      sessionId: this.sessionId,
      role,
      text,
      createdAt: new Date().toISOString(),
    })
  }

  private emitStatus(status: DesktopSessionStatus): void {
    this.emitEvent({
      type: 'status',
      sessionId: this.sessionId,
      status,
    })
  }

  private emitEvent(event: DesktopAgentEvent): boolean {
    return super.emit('event', event)
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Desktop agent session has been disposed')
    }
  }
}

export function createDesktopAgentSession(
  options: ResolvedDesktopSessionOptions,
  runtimeOptions: DesktopAgentSessionRuntimeOptions = {},
): DesktopAgentSession {
  return new LocalDesktopAgentSession(options, runtimeOptions)
}

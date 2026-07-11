import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import {
  createDesktopAgentRuntime,
  buildAskUserQuestionControlResponse,
  type DesktopAgentRuntime,
  type DesktopAgentRuntimeContext,
  type DesktopAgentRuntimePreference,
} from './agentRuntime.js'
import {
  createDesktopAutoReviewService,
  type DesktopAutoReviewService,
} from './autoReviewService.js'
import { desktopDebug } from './desktopDebug.js'
import type {
  CreateDesktopSessionOptions,
  DesktopAgentEvent,
  DesktopApprovalPolicy,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopUserMessageContent,
} from '../shared/types.js'
import type {
  AgentPermissionAction,
  AgentPermissionPolicy,
} from '@codepilotx/core/agent/permissions.js'
import {
  permissionPolicyForDesktopMode,
  resolvePermissionEffect,
} from '@codepilotx/core/agent/permissions.js'
import {
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
  type CodePilotXCollaborationMode,
} from '@codepilotx/core/agent/codepilotxSessionContract.js'
import type { AgentGuardianReviewAction } from '@codepilotx/core/agent/runtime.js'

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
  toolchainEnvironment?: Record<string, string | undefined>
  createRuntime?: (context: DesktopAgentRuntimeContext) => DesktopAgentRuntime
  autoReviewService?: DesktopAutoReviewService
  onAppServerThreadId?: (threadId: string) => void
}

export type DesktopAgentSession = {
  sessionId: string
  workspacePath: string
  setModel(model: string | undefined): void
  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void
  setDebugConversationDump(enabled: boolean): void
  setPermissionProfile(profile: string, approvalPolicy?: DesktopApprovalPolicy): void
  setPermissionMode(permissionMode: NonNullable<CreateDesktopSessionOptions['permissionMode']>): void
  setPlanModeActive(planModeActive: boolean): void
  sendUserMessage(content: DesktopUserMessageContent, previewText: string): Promise<void>
  respondToPermission(
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  respondToRecoveredAskUserQuestion(
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  respondToRecoveredExitPlanMode(
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
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
  refreshMcpConfig(): Promise<'refreshed' | 'not_loaded'>
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
  private disposePromise: Promise<void> | null = null
  private readonly autoReviewService: DesktopAutoReviewService
  private permissionProfile: string
  private approvalPolicy: DesktopApprovalPolicy
  private approvalsReviewer: NonNullable<CreateDesktopSessionOptions['approvalsReviewer']>
  private permissionMode: NonNullable<CreateDesktopSessionOptions['permissionMode']>
  private collaborationMode: CodePilotXCollaborationMode
  private planModeActive: boolean
  private model: string | undefined
  private reviewModel: string | undefined
  private hasConversationStarted: boolean

  constructor(
    options: ResolvedDesktopSessionOptions,
    runtimeOptions: DesktopAgentSessionRuntimeOptions,
  ) {
    super()
    this.sessionId = options.sessionId ?? randomUUID()
    this.workspacePath = options.workspacePath
    this.permissionProfile = options.permissionProfile ?? ':workspace'
    this.approvalPolicy = options.approvalPolicy ?? 'on-request'
    this.approvalsReviewer = options.approvalsReviewer ?? 'user'
    this.permissionMode = options.permissionMode ?? 'default'
    this.collaborationMode = resolveCodePilotXCollaborationMode({
      collaborationMode: options.collaborationMode,
      planModeActive: options.planModeActive,
    })
    this.planModeActive = planModeActiveFromCollaborationMode(
      this.collaborationMode,
    )
    this.model = options.model
    this.reviewModel = options.reviewModel
    this.hasConversationStarted = options.resumeExistingSession === true
    this.autoReviewService =
      runtimeOptions.autoReviewService ?? createDesktopAutoReviewService()
    const createRuntime = runtimeOptions.createRuntime ?? createDesktopAgentRuntime
    this.runtime = createRuntime({
      sessionId: this.sessionId,
      appServerThreadId: options.appServerThreadId,
      workspacePath: this.workspacePath,
      agentExecutablePath: runtimeOptions.agentExecutablePath,
      configDirectoryPath: runtimeOptions.configDirectoryPath,
      runtimePreference: runtimeOptions.runtimePreference,
      toolchainEnvironment: runtimeOptions.toolchainEnvironment,
      resumeExistingSession: options.resumeExistingSession,
      permissionProfile: this.permissionProfile,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: this.approvalsReviewer,
      permissionMode: this.permissionMode,
      collaborationMode: this.collaborationMode,
      planModeActive: this.planModeActive,
      providerID: options.providerID,
      providerBaseURL: options.providerBaseURL,
      debugConversationDump: options.debugConversationDump,
      model: options.model,
      reviewModel: options.reviewModel,
      smallFastModel: options.smallFastModel,
      fastModel: options.fastModel,
      defaultModel: options.defaultModel,
      deepModel: options.deepModel,
      sessionName: options.sessionName,
      thinkingMode: options.thinkingMode,
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      additionalDirectories: options.additionalDirectories,
      installCodePilotXDependencies: options.installCodePilotXDependencies,
      enableMemory: options.enableMemory,
      rustSearchAndDiffKernels: options.rustSearchAndDiffKernels,
      onAppServerThreadId: runtimeOptions.onAppServerThreadId,
      emit: event => this.handleRuntimeEvent(event),
      requestPermission: request => this.requestPermission(request),
    })
    queueMicrotask(() => {
      if (this.disposed || options.suppressStartupMessage) {
        return
      }
      this.emitStatus('idle')
      this.emitMessage(
        'system',
        `Workspace attached: ${options.workspacePath} (${options.sessionName ?? 'untitled'} session, ${this.permissionProfile} permissions, ${options.model ?? 'none'} model, ${options.thinkingMode ?? 'default'} thinking, ${options.systemPrompt ? 'custom' : 'default'} system prompt, ${options.additionalDirectories?.length ?? 0} extra dirs)`,
      )
    })
  }

  setModel(model: string | undefined): void {
    const previousModel = this.model
    this.model = model
    this.runtime.setModel(model)
    this.emitModelSwitchNotice(previousModel, model)
  }

  setModelProvider(
    providerID: string | undefined,
    model: string | undefined,
    providerBaseURL: string | undefined,
  ): void {
    const previousModel = this.model
    this.model = model
    this.runtime.setModelProvider(providerID, model, providerBaseURL)
    this.emitModelSwitchNotice(previousModel, model)
  }

  setDebugConversationDump(enabled: boolean): void {
    this.runtime.setDebugConversationDump(enabled)
  }

  setPermissionProfile(profile: string, approvalPolicy?: DesktopApprovalPolicy): void {
    this.permissionProfile = profile
    if (approvalPolicy) {
      this.approvalPolicy = approvalPolicy
    }
    desktopDebug('session_permission_profile_changed', {
      sessionId: this.sessionId,
      permissionProfile: profile,
      approvalPolicy: this.approvalPolicy,
    })
  }

  setPermissionMode(
    permissionMode: NonNullable<CreateDesktopSessionOptions['permissionMode']>,
  ): void {
    this.permissionMode = permissionMode
    this.runtime.setPermissionMode(permissionMode)
    desktopDebug('session_permission_mode_changed', {
      sessionId: this.sessionId,
      permissionMode,
    })
  }

  setPlanModeActive(planModeActive: boolean): void {
    this.collaborationMode = resolveCodePilotXCollaborationMode({ planModeActive })
    this.planModeActive = planModeActiveFromCollaborationMode(
      this.collaborationMode,
    )
    this.runtime.setPlanModeActive(planModeActive)
    desktopDebug('session_plan_mode_changed', {
      sessionId: this.sessionId,
      planModeActive,
    })
  }

  async sendUserMessage(
    content: DesktopUserMessageContent,
    previewText: string,
  ): Promise<void> {
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
      textLength: previewText.length,
    })
    this.emitMessage('user', previewText)
    this.hasConversationStarted = true
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

  async respondToRecoveredAskUserQuestion(
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): Promise<void> {
    this.assertActive()
    if (this.currentAbortController) {
      throw new Error('Desktop agent session is already running')
    }
    if (
      request.toolName !== 'AskUserQuestion' ||
      typeof request.toolUseId !== 'string' ||
      !request.toolUseId.trim()
    ) {
      throw new Error('AskUserQuestion recovery requires a tool use id.')
    }
    if (decision.behavior !== 'allow' || !decision.updatedInput) {
      throw new Error('AskUserQuestion recovery requires allowed updated input.')
    }

    const abortController = new AbortController()
    this.currentAbortController = abortController
    this.emitStatus('running')
    try {
      await this.runtime.runControlResponse(
        buildAskUserQuestionControlResponse({
          requestId: request.requestId,
          toolUseId: request.toolUseId,
          updatedInput: decision.updatedInput,
        }),
        abortController.signal,
      )
      if (abortController.signal.aborted) return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null
      }
    }
  }

  async respondToRecoveredExitPlanMode(
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): Promise<void> {
    this.assertActive()
    if (this.currentAbortController) {
      throw new Error('Desktop agent session is already running')
    }
    if (request.toolName !== 'ExitPlanMode') {
      throw new Error('ExitPlanMode recovery requires an ExitPlanMode request.')
    }
    if (decision.behavior !== 'allow') {
      throw new Error('ExitPlanMode recovery requires approval.')
    }
    const plan = getExitPlanModePlan(request)
    if (!plan) {
      throw new Error('ExitPlanMode recovery requires a plan.')
    }

    this.setPlanModeActive(false)
    if (decision.planExecutionProviderID) {
      this.setModelProvider(
        decision.planExecutionProviderID,
        decision.planExecutionModel,
        decision.planExecutionProviderBaseURL,
      )
    } else if (decision.planExecutionModel) {
      this.setModel(decision.planExecutionModel)
    }
    await this.sendUserMessage(
      buildRecoveredExitPlanModePrompt(plan),
      '用户已批准计划，继续实施',
    )
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
  }

  async dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposePromise = this.disposeOnce()
    }
    await this.disposePromise
  }

  private async disposeOnce(): Promise<void> {
    this.disposed = true
    for (const [requestId, pending] of this.pendingPermissions) {
      this.pendingPermissions.delete(requestId)
      pending.resolve({
        behavior: 'deny',
        message: 'Session disposed before approval',
      })
    }
    this.currentAbortController?.abort()
    this.removeAllListeners()
    await this.runtime.dispose()
  }

  getMcpRuntimeStatus() {
    return this.runtime.getMcpRuntimeStatus()
  }

  async refreshMcpConfig(): Promise<'refreshed' | 'not_loaded'> {
    return this.runtime.refreshMcpConfig()
  }

  private handleRuntimeEvent(event: DesktopAgentEvent): void {
    this.emitEvent(event)
    if (event.type === 'done') {
      this.emitStatus('done')
    } else if (event.type === 'error') {
      this.emitStatus('error')
    }
  }

  private async requestPermission(
    request: DesktopPermissionRequest,
  ): Promise<DesktopPermissionDecision> {
    const modePolicy = permissionPolicyForDesktopMode(this.permissionMode)
    const normalizedRequest: DesktopPermissionRequest = {
      ...request,
      profile: (request.profile ??
        (this.permissionMode === 'custom'
          ? this.permissionProfile
          : modePolicy.profile)) as DesktopPermissionRequest['profile'],
      approvalMode: (request.approvalMode ??
        (this.permissionMode === 'custom'
          ? this.approvalPolicy
          : modePolicy.approvalMode)) as DesktopPermissionRequest['approvalMode'],
      approvalsReviewer:
        request.approvalsReviewer ??
        (this.permissionMode === 'custom'
          ? this.approvalsReviewer
          : modePolicy.approvalsReviewer),
    }
    console.info(
      `[desktop-permission] ${new Date().toISOString()} request ${JSON.stringify({
        sessionId: this.sessionId,
        permissionMode: this.permissionMode,
        toolName: normalizedRequest.toolName,
        profile: normalizedRequest.profile,
        approvalMode: normalizedRequest.approvalMode,
        approvalsReviewer: normalizedRequest.approvalsReviewer,
      })}`,
    )
    const normalizedPolicy: AgentPermissionPolicy = {
      ...modePolicy,
      profile: normalizedRequest.profile,
      approvalMode: normalizedRequest.approvalMode,
      approvalsReviewer: normalizedRequest.approvalsReviewer,
    }
    const policyDecision = resolveDesktopPermissionPolicyDecision(
      normalizedPolicy,
      normalizedRequest,
      this.workspacePath,
    )
    if (policyDecision) {
      console.info(
        `[desktop-permission] ${new Date().toISOString()} policy_decision ${JSON.stringify({
          sessionId: this.sessionId,
          permissionMode: this.permissionMode,
          toolName: normalizedRequest.toolName,
          behavior: policyDecision.behavior,
          alwaysAllow: policyDecision.alwaysAllow === true,
        })}`,
      )
      return policyDecision
    }
    if (shouldRouteToAutoReview(normalizedPolicy, normalizedRequest)) {
      const autoReviewToolUseId = `auto-review:${normalizedRequest.requestId}`
      const guardianReviewId = `guardian-review:${normalizedRequest.requestId}`
      const guardianAction = guardianActionForPermissionRequest(normalizedRequest)
      this.emitEvent({
        type: 'tool_start',
        sessionId: this.sessionId,
        toolName: 'AutoReview',
        summary: '自动审查中',
        toolUseId: autoReviewToolUseId,
      })
      this.emitEvent({
        type: 'guardian_review',
        sessionId: this.sessionId,
        reviewId: guardianReviewId,
        targetRequestId: normalizedRequest.requestId,
        status: 'in_progress',
        action: guardianAction,
      })
      const autoReview = await this.autoReviewService.review({
        sessionId: this.sessionId,
        workspacePath: this.workspacePath,
        model: this.model,
        reviewModel: this.reviewModel,
        request: normalizedRequest,
        policy: normalizedPolicy,
      })
      this.emitEvent({
        type: 'tool_result',
        sessionId: this.sessionId,
        toolName: 'AutoReview',
        summary:
          autoReview.decision.behavior === 'allow'
            ? '自动审查允许'
            : '自动审查拒绝',
        toolUseId: autoReviewToolUseId,
        isError: autoReview.decision.behavior === 'deny',
      })
      this.emitEvent({
        type: 'guardian_review',
        sessionId: this.sessionId,
        reviewId: guardianReviewId,
        targetRequestId: normalizedRequest.requestId,
        status:
          autoReview.decision.behavior === 'allow' ? 'approved' : 'denied',
        riskLevel: autoReview.assessment.riskLevel,
        userAuthorization: autoReview.assessment.userAuthorization,
        rationale: autoReview.assessment.rationale,
        action: guardianAction,
        guardianRolloutPath: autoReview.guardianRolloutPath,
      })
      return autoReview.decision
    }
    if (
      isAskUserQuestionRequest(normalizedRequest) &&
      hasPendingAskUserQuestion(this.pendingPermissions)
    ) {
      return {
        behavior: 'deny',
        message:
          'AskUserQuestion is already waiting for a user answer. Wait for that answer before asking another dependent question, or combine independent questions into one questions array.',
      }
    }
    const requestAbortSignal = this.currentAbortController?.signal
    const inactiveDecision = this.inactivePermissionDecision(requestAbortSignal)
    if (inactiveDecision) {
      return inactiveDecision
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

      requestAbortSignal?.addEventListener(
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
      const lateInactiveDecision =
        this.inactivePermissionDecision(requestAbortSignal)
      if (
        lateInactiveDecision &&
        this.pendingPermissions.has(normalizedRequest.requestId)
      ) {
        this.pendingPermissions.delete(normalizedRequest.requestId)
        resolve(lateInactiveDecision)
      }
    })
    if (!this.disposed && !requestAbortSignal?.aborted) {
      this.emitStatus('running')
    }
    console.info(
      `[desktop-permission] ${new Date().toISOString()} decision ${JSON.stringify({
        sessionId: this.sessionId,
        permissionMode: this.permissionMode,
        toolName: normalizedRequest.toolName,
        behavior: decision.behavior,
        alwaysAllow: decision.alwaysAllow === true,
      })}`,
    )
    return decision
  }

  private inactivePermissionDecision(
    signal: AbortSignal | undefined,
  ): DesktopPermissionDecision | null {
    if (this.disposed) {
      return {
        behavior: 'deny',
        message: 'Session disposed before approval',
      }
    }
    if (signal?.aborted) {
      return {
        behavior: 'deny',
        message: 'Interrupted before approval',
      }
    }
    return null
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

  private emitModelSwitchNotice(
    previousModel: string | undefined,
    nextModel: string | undefined,
  ): void {
    const fromModel = previousModel?.trim()
    const toModel = nextModel?.trim()
    if (!this.hasConversationStarted || !fromModel || !toModel) return
    if (fromModel === toModel) return
    this.emitMessage('system', `模型已从 ${fromModel} 更改为 ${toModel}`)
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

export function resolveDesktopPermissionPolicyDecision(
  policy: AgentPermissionPolicy,
  request: DesktopPermissionRequest,
  workspacePath?: string,
): DesktopPermissionDecision | null {
  if (requiresDesktopUserInteraction(request.toolName)) {
    return null
  }
  const action = permissionActionForDesktopTool(request.toolName)
  const effect = resolvePermissionEffect(policy, action, request.toolName)
  if (effect === 'allow') {
    return {
      behavior: 'allow',
      alwaysAllow: true,
    }
  }
  if (effect === 'deny') {
    return {
      behavior: 'deny',
      message: `Permission denied by ${policy.profile} permission profile`,
    }
  }
  if (shouldAllowWorkspaceWrite(policy, action, request, workspacePath)) {
    return {
      behavior: 'allow',
      alwaysAllow: true,
    }
  }

  return null
}

function shouldRouteToAutoReview(
  policy: AgentPermissionPolicy,
  request: DesktopPermissionRequest,
): boolean {
  if (requiresDesktopUserInteraction(request.toolName)) return false
  if (policy.approvalsReviewer !== 'auto_review') return false
  if (policy.approvalMode === 'never') return false
  return true
}

function guardianActionForPermissionRequest(
  request: DesktopPermissionRequest,
): AgentGuardianReviewAction {
  const input = request.input
  const command = stringFromInput(input, 'command')
  if (command) {
    return {
      type: 'command',
      source: request.toolName,
      command,
      cwd: stringFromInput(input, 'cwd'),
    }
  }
  if (request.toolName.startsWith('mcp__')) {
    const [, server = '', toolName = request.toolName] = request.toolName.split('__')
    return {
      type: 'mcp_tool_call',
      server,
      toolName,
      arguments: input,
    }
  }
  if (request.toolName === 'RequestPermissions') {
    return {
      type: 'request_permissions',
      permissions: input.permissions ?? input,
      reason: stringFromInput(input, 'reason'),
    }
  }
  if (request.toolName === 'ApplyPatch') {
    const file = stringFromInput(input, 'file_path') ?? stringFromInput(input, 'path')
    return {
      type: 'apply_patch',
      cwd: stringFromInput(input, 'cwd'),
      files: file ? [file] : [],
    }
  }
  return {
    type: 'toolCall',
    toolName: request.toolName,
    input,
  }
}

function stringFromInput(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

const DESKTOP_USER_INTERACTION_TOOLS = new Set([
  'askuserquestion',
  'exitplanmode',
])

function isAskUserQuestionRequest(request: DesktopPermissionRequest): boolean {
  return request.toolName.toLowerCase() === 'askuserquestion'
}

function hasPendingAskUserQuestion(
  pendingPermissions: ReadonlyMap<string, PendingPermission>,
): boolean {
  for (const pending of pendingPermissions.values()) {
    if (isAskUserQuestionRequest(pending.request)) return true
  }
  return false
}

const SENSITIVE_WORKSPACE_DIRECTORIES = new Set([
  '.git',
  '.claude',
  '.vscode',
  '.idea',
])

const SENSITIVE_WORKSPACE_FILES = new Set([
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
])

function shouldAllowWorkspaceWrite(
  policy: AgentPermissionPolicy,
  action: AgentPermissionAction,
  request: DesktopPermissionRequest,
  workspacePath: string | undefined,
): boolean {
  if (action !== 'write') return false
  if (!workspacePath) return false
  if (policy.sandboxMode !== 'workspace-write') return false

  const filePath = desktopRequestFilePath(request)
  if (!filePath) return false
  if (isNetworkPath(filePath)) return false

  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedFilePath = resolve(resolvedWorkspacePath, filePath)
  if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedFilePath)) {
    return false
  }
  return !isSensitiveWorkspacePath(resolvedFilePath, resolvedWorkspacePath)
}

function desktopRequestFilePath(
  request: DesktopPermissionRequest,
): string | null {
  const filePath = request.input.file_path ?? request.input.filePath
  return typeof filePath === 'string' && filePath.trim() ? filePath : null
}

function getExitPlanModePlan(request: DesktopPermissionRequest): string | null {
  const plan = request.input.plan
  return typeof plan === 'string' && plan.trim() ? plan.trim() : null
}

function buildRecoveredExitPlanModePrompt(plan: string): string {
  return `用户已批准以下计划。请退出计划模式并继续实施该计划。\n\n${plan}`
}

function isPathInsideWorkspace(
  workspacePath: string,
  filePath: string,
): boolean {
  const normalizedWorkspace = normalizePathForPolicy(workspacePath)
  const normalizedFile = normalizePathForPolicy(filePath)
  const relativePath = relative(normalizedWorkspace, normalizedFile)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function isSensitiveWorkspacePath(
  filePath: string,
  workspacePath: string,
): boolean {
  const relativePath = relative(workspacePath, filePath)
  const segments = relativePath
    .split(/[\\/]+/)
    .map(segment => segment.toLowerCase())
  if (segments.some(segment => SENSITIVE_WORKSPACE_DIRECTORIES.has(segment))) {
    return true
  }
  return SENSITIVE_WORKSPACE_FILES.has(basename(filePath).toLowerCase())
}

function isNetworkPath(filePath: string): boolean {
  return filePath.startsWith('\\\\') || filePath.startsWith('//')
}

function normalizePathForPolicy(filePath: string): string {
  const resolvedPath = resolve(filePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function requiresDesktopUserInteraction(toolName: string): boolean {
  return DESKTOP_USER_INTERACTION_TOOLS.has(toolName.toLowerCase())
}

export function permissionActionForDesktopTool(
  toolName: string,
): AgentPermissionAction {
  const normalized = toolName.toLowerCase()
  if (
    normalized === 'read' ||
    normalized === 'ls' ||
    normalized === 'glob' ||
    normalized === 'grep'
  ) {
    return 'read'
  }
  if (
    normalized === 'edit' ||
    normalized === 'multiedit' ||
    normalized === 'write' ||
    normalized === 'notebookedit'
  ) {
    return 'write'
  }
  if (normalized === 'webfetch' || normalized === 'websearch') {
    return 'network'
  }
  if (normalized.startsWith('mcp__') || normalized.includes('mcp')) {
    return 'mcp'
  }
  return 'shell'
}

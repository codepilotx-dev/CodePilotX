import {
  planModeActiveFromCollaborationMode,
  resolveCodexCollaborationMode,
  type CodexCollaborationMode,
} from '@codepilotx/core/agent/codexSessionContract.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopThinkingMode,
  DesktopUserMessageContent,
} from '../shared/types.js'
import { desktopDebug } from './desktopDebug.js'
import {
  buildPermissionRememberOptions,
  summarizeToolInput,
} from './agentRuntimeSupport.js'
import { RustSidecarDesktopAgentRuntime } from './rustSidecarRuntime.js'

export type DesktopAgentRuntimePreference =
  | 'auto'
  | 'rust-sidecar'

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

export function createDesktopAgentRuntime(
  context: DesktopAgentRuntimeContext,
): DesktopAgentRuntime {
  context = normalizeDesktopAgentRuntimeContext(context)
  const preference = context.runtimePreference ?? 'auto'
  if (preference === 'auto' || preference === 'rust-sidecar') {
    desktopDebug('runtime_create_rust_sidecar', {
      sessionId: context.sessionId,
      preference,
    })
    return new RustSidecarDesktopAgentRuntime(context)
  }
  // All preferences now route to the Rust sidecar runtime.
  desktopDebug('runtime_create_rust_sidecar', {
    sessionId: context.sessionId,
    preference,
  })
  return new RustSidecarDesktopAgentRuntime(context)
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

function codexConfigOverrideArg(key: string, value: string | undefined): string[] {
  return value ? ['--config', `${key}=${JSON.stringify(value)}`] : []
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

export function permissionPromptToolName(): string {
  return 'stdio'
}

export function permissionPromptToolArgs(): string[] {
  return ['--permission-prompt-tool', permissionPromptToolName()]
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

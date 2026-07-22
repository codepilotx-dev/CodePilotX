export type CodePilotXApprovalsReviewer = 'user' | 'auto_review'
export type CodePilotXSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type AgentPermissionProfile =
  | ':read-only'
  | ':workspace'
  | ':danger-full-access'
  | string

export type AgentApprovalMode = 'on-request' | 'on-failure' | 'never' | 'untrusted'

export type AgentPermissionAction = 'read' | 'write' | 'shell' | 'network' | 'mcp'
export type AgentPermissionEffect = 'allow' | 'ask' | 'deny'
export type AgentPermissionActionScopes = Partial<
  Record<AgentPermissionAction, AgentPermissionEffect>
>

export type AgentPermissionPolicy = {
  profile: AgentPermissionProfile
  approvalMode: AgentApprovalMode
  approvalsReviewer?: CodePilotXApprovalsReviewer
  sandboxMode?: CodePilotXSandboxMode
  sandboxPolicy?: AgentPermissionProfile
  actionScopes?: AgentPermissionActionScopes
  toolOverrides?: Record<string, AgentPermissionActionScopes>
}

export type AgentPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  alwaysAllow?: boolean
  updatedInput?: Record<string, unknown>
}

export type AgentPermissionRequest = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description: string
  profile?: AgentPermissionProfile
  approvalMode?: AgentApprovalMode
  approvalsReviewer?: CodePilotXApprovalsReviewer
  requestKind?:
    | 'shell-command'
    | 'file-write'
    | 'network'
    | 'sandbox-escalation'
    | 'full-access'
    | 'tool'
  autoReviewFallbackReason?: string
}

export type DesktopAgentPermissionMode =
  | 'default'
  | 'auto-review'
  | 'full-access'
  | 'custom'

export const DESKTOP_AGENT_PERMISSION_MODES = [
  'default',
  'auto-review',
  'full-access',
  'custom',
] as const satisfies readonly DesktopAgentPermissionMode[]

export function normalizeDesktopAgentPermissionMode(
  mode: unknown,
): DesktopAgentPermissionMode {
  switch (mode) {
    case 'auto':
    case 'acceptEdits':
      return 'auto-review'
    case 'bypassPermissions':
      return 'full-access'
    case 'customConfig':
    case 'dontAsk':
      return 'custom'
    case 'auto-review':
    case 'full-access':
    case 'custom':
    case 'default':
      return mode
    default:
      return 'default'
  }
}

export function isDesktopAgentPermissionMode(
  value: unknown,
): value is DesktopAgentPermissionMode {
  return (
    typeof value === 'string' &&
    (DESKTOP_AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

export function permissionPolicyForDesktopMode(
  mode: DesktopAgentPermissionMode | string | undefined,
): AgentPermissionPolicy {
  switch (normalizeDesktopAgentPermissionMode(mode)) {
    case 'auto-review':
      return {
        profile: ':danger-full-access',
        approvalMode: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'danger-full-access',
        sandboxPolicy: ':danger-full-access',
      }
    case 'full-access':
      return {
        profile: ':danger-full-access',
        approvalMode: 'never',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'danger-full-access',
        sandboxPolicy: ':danger-full-access',
      }
    default:
      return {
        profile: ':danger-full-access',
        approvalMode: 'on-request',
        approvalsReviewer: 'user',
        sandboxMode: 'danger-full-access',
        sandboxPolicy: ':danger-full-access',
      }
  }
}

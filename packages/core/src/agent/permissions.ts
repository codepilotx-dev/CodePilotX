export const AGENT_PERMISSION_PROFILES = [
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const

export type AgentPermissionProfile =
  (typeof AGENT_PERMISSION_PROFILES)[number]

export const AGENT_APPROVAL_MODES = [
  'prompt',
  'auto-review',
  'auto-approve-edits',
  'bypass',
  'config',
] as const

export type AgentApprovalMode = (typeof AGENT_APPROVAL_MODES)[number]

export type AgentPermissionPolicy = {
  profile: AgentPermissionProfile
  approvalMode: AgentApprovalMode
}

export const DEFAULT_AGENT_PERMISSION_POLICY: AgentPermissionPolicy = {
  profile: 'workspace-write',
  approvalMode: 'prompt',
}

export type AgentPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  alwaysAllow?: boolean
}

export type AgentPermissionRequest = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  description: string
  profile?: AgentPermissionProfile
  approvalMode?: AgentApprovalMode
}

export type DesktopAgentPermissionMode =
  | 'auto'
  | 'bypassPermissions'
  | 'customConfig'
  | 'default'

export type LegacyAgentPermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'

export const DESKTOP_AGENT_PERMISSION_MODES = [
  'auto',
  'bypassPermissions',
  'customConfig',
  'default',
] as const satisfies readonly DesktopAgentPermissionMode[]

export const LEGACY_AGENT_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
] as const satisfies readonly LegacyAgentPermissionMode[]

export function isAgentPermissionProfile(
  value: unknown,
): value is AgentPermissionProfile {
  return (
    typeof value === 'string' &&
    (AGENT_PERMISSION_PROFILES as readonly string[]).includes(value)
  )
}

export function isAgentApprovalMode(value: unknown): value is AgentApprovalMode {
  return (
    typeof value === 'string' &&
    (AGENT_APPROVAL_MODES as readonly string[]).includes(value)
  )
}

export function isDesktopAgentPermissionMode(
  value: unknown,
): value is DesktopAgentPermissionMode {
  return (
    typeof value === 'string' &&
    (DESKTOP_AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

export function isLegacyAgentPermissionMode(
  value: unknown,
): value is LegacyAgentPermissionMode {
  return (
    typeof value === 'string' &&
    (LEGACY_AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

export function normalizeDesktopAgentPermissionMode(
  mode: unknown,
): DesktopAgentPermissionMode {
  switch (mode) {
    case 'acceptEdits':
      return 'auto'
    case 'dontAsk':
      return 'customConfig'
    case 'auto':
    case 'bypassPermissions':
    case 'customConfig':
    case 'default':
      return mode
    case undefined:
      return 'default'
  }
}

export function permissionPolicyForDesktopMode(
  mode:
    | DesktopAgentPermissionMode
    | LegacyAgentPermissionMode
    | undefined,
): AgentPermissionPolicy {
  switch (normalizeDesktopAgentPermissionMode(mode)) {
    case 'auto':
      return {
        profile: 'workspace-write',
        approvalMode: 'auto-review',
      }
    case 'bypassPermissions':
      return {
        profile: 'danger-full-access',
        approvalMode: 'bypass',
      }
    case 'customConfig':
      return {
        profile: 'workspace-write',
        approvalMode: 'config',
      }
    case 'default':
      return DEFAULT_AGENT_PERMISSION_POLICY
  }
}

export const permissionPolicyForLegacyMode = permissionPolicyForDesktopMode

export function shouldPromptForPermission(
  policy: AgentPermissionPolicy,
  action: 'read' | 'write' | 'shell' | 'network' | 'mcp',
): boolean {
  if (policy.approvalMode === 'bypass') return false
  if (policy.profile === 'read-only') return action !== 'read'
  if (policy.approvalMode === 'auto-approve-edits' && action === 'write') {
    return false
  }
  return action !== 'read'
}

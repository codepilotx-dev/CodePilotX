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
  'plan',
] as const

export type AgentApprovalMode = (typeof AGENT_APPROVAL_MODES)[number]

export type AgentPermissionAction = 'read' | 'write' | 'shell' | 'network' | 'mcp'

export type AgentPermissionEffect = 'allow' | 'ask' | 'deny'

export type AgentSandboxPolicy = AgentPermissionProfile

export type AgentPermissionActionScopes = Partial<
  Record<AgentPermissionAction, AgentPermissionEffect>
>

export type AgentToolPermissionOverrides = Record<
  string,
  AgentPermissionActionScopes
>

export type AgentPermissionPolicy = {
  profile: AgentPermissionProfile
  approvalMode: AgentApprovalMode
  sandboxPolicy?: AgentSandboxPolicy
  actionScopes?: AgentPermissionActionScopes
  toolOverrides?: AgentToolPermissionOverrides
}

export const DEFAULT_AGENT_PERMISSION_POLICY: AgentPermissionPolicy = {
  profile: 'workspace-write',
  approvalMode: 'prompt',
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
  | 'plan'

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
  'plan',
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
    case 'plan':
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
      return normalizeAgentPermissionPolicy({
        profile: 'workspace-write',
        approvalMode: 'auto-review',
      })
    case 'bypassPermissions':
      return normalizeAgentPermissionPolicy({
        profile: 'danger-full-access',
        approvalMode: 'bypass',
      })
    case 'customConfig':
      return normalizeAgentPermissionPolicy({
        profile: 'workspace-write',
        approvalMode: 'config',
      })
    case 'plan':
      return normalizeAgentPermissionPolicy({
        profile: 'read-only',
        approvalMode: 'plan',
      })
    case 'default':
      return normalizeAgentPermissionPolicy(DEFAULT_AGENT_PERMISSION_POLICY)
  }
}

export const permissionPolicyForLegacyMode = permissionPolicyForDesktopMode

export function normalizeAgentPermissionPolicy(
  policy: Partial<AgentPermissionPolicy> | undefined,
): AgentPermissionPolicy {
  const profile = isAgentPermissionProfile(policy?.profile)
    ? policy.profile
    : DEFAULT_AGENT_PERMISSION_POLICY.profile
  const approvalMode = isAgentApprovalMode(policy?.approvalMode)
    ? policy.approvalMode
    : DEFAULT_AGENT_PERMISSION_POLICY.approvalMode

  return {
    profile,
    approvalMode,
    sandboxPolicy: isAgentPermissionProfile(policy?.sandboxPolicy)
      ? policy.sandboxPolicy
      : profile,
    ...(policy?.actionScopes ? { actionScopes: policy.actionScopes } : {}),
    ...(policy?.toolOverrides ? { toolOverrides: policy.toolOverrides } : {}),
  }
}

export function resolvePermissionEffect(
  policy: AgentPermissionPolicy,
  action: AgentPermissionAction,
  toolName?: string,
): AgentPermissionEffect {
  const normalized = normalizeAgentPermissionPolicy(policy)
  if (normalized.approvalMode === 'bypass') return 'allow'

  const toolOverride = toolName
    ? normalized.toolOverrides?.[toolName]?.[action]
    : undefined
  if (toolOverride) return toolOverride

  const actionScope = normalized.actionScopes?.[action]
  if (actionScope) return actionScope

  if (normalized.profile === 'read-only') {
    return action === 'read' ? 'allow' : 'ask'
  }
  if (
    normalized.approvalMode === 'auto-approve-edits' &&
    action === 'write'
  ) {
    return 'allow'
  }
  return action === 'read' ? 'allow' : 'ask'
}

export function shouldPromptForPermission(
  policy: AgentPermissionPolicy,
  action: AgentPermissionAction,
  toolName?: string,
): boolean {
  return resolvePermissionEffect(policy, action, toolName) !== 'allow'
}

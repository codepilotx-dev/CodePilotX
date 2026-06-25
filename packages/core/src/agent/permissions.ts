import picomatch from 'picomatch'

export const BUILTIN_CODEX_PERMISSION_PROFILES = [
  ':read-only',
  ':workspace',
  ':danger-full-access',
] as const

export type BuiltinCodexPermissionProfile =
  (typeof BUILTIN_CODEX_PERMISSION_PROFILES)[number]

export type CodexFilesystemAccess = 'read' | 'write' | 'deny'
export type CodexNetworkAccess = 'allow' | 'deny'
export type CodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'
export type CodexApprovalsReviewer = 'user' | 'auto'

export type CodexFilesystemRules = Record<
  string,
  CodexFilesystemAccess | CodexFilesystemAccess[]
>

export type CodexNetworkConfig = {
  enabled?: boolean
  domains?: Record<string, CodexNetworkAccess>
  allowLocalNetwork?: boolean
  allowPrivateNetwork?: boolean
  allowUnixSockets?: string[]
  denyUnixSockets?: string[]
  httpProxyPort?: number
  socksProxyPort?: number
}

export type CodexPermissionProfileConfig = {
  description?: string
  extends?: string
  workspaceRoots?: string[]
  filesystem?: CodexFilesystemRules
  network?: CodexNetworkConfig
}

export type CodexPermissionsConfig = {
  defaultPermissions?: string
  approvalPolicy?: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer
  permissions?: Record<string, CodexPermissionProfileConfig>
}

export type CodexRequirementsPolicy = {
  defaultPermissions?: string
  allowedPermissionProfiles?: string[]
  allowedApprovalPolicies?: CodexApprovalPolicy[]
  allowedApprovalsReviewers?: CodexApprovalsReviewer[]
  permissions?: Record<string, CodexPermissionProfileConfig>
  filesystem?: {
    denyRead?: string[]
  }
  experimentalNetwork?: CodexNetworkConfig & {
    allowedDomains?: string[]
    deniedDomains?: string[]
    managedAllowedDomainsOnly?: boolean
  }
}

export type ResolvedFilesystemRule = {
  path: string
  access: CodexFilesystemAccess
  source?: 'builtin' | 'config' | 'requirements'
}

export type ResolvedCodexPermissionProfile = {
  name: string
  description?: string
  dangerFullAccess: boolean
  workspaceRoots: string[]
  filesystem: ResolvedFilesystemRule[]
  network: Required<Pick<CodexNetworkConfig, 'enabled'>> &
    Omit<CodexNetworkConfig, 'enabled'>
}

export type ResolvedCodexPermissions = {
  defaultPermissions: string
  approvalPolicy: CodexApprovalPolicy
  approvalsReviewer: CodexApprovalsReviewer
  activeProfile: ResolvedCodexPermissionProfile
  profiles: Record<string, ResolvedCodexPermissionProfile>
  diagnostics: string[]
}

const ACCESS_RANK: Record<CodexFilesystemAccess, number> = {
  read: 1,
  write: 2,
  deny: 3,
}

export function resolveCodexPermissions({
  config = {},
  requirements,
  workspaceRoots,
}: {
  config?: CodexPermissionsConfig
  requirements?: CodexRequirementsPolicy
  workspaceRoots: string[]
}): ResolvedCodexPermissions {
  const diagnostics: string[] = []
  const configProfiles = config.permissions ?? {}
  const requirementProfiles = requirements?.permissions ?? {}
  for (const name of Object.keys(requirementProfiles)) {
    if (configProfiles[name]) {
      throw new Error(`Permission profile ${name} is already defined by config`)
    }
  }

  const rawProfiles: Record<string, CodexPermissionProfileConfig> = {
    ':read-only': {
      filesystem: { ':workspace_roots': 'read' },
      network: { enabled: false },
    },
    ':workspace': {
      filesystem: { ':workspace_roots': 'write' },
      network: { enabled: true },
    },
    ':danger-full-access': {
      filesystem: { '/': 'write' },
      network: { enabled: true, domains: { '*': 'allow' } },
    },
    ...configProfiles,
    ...requirementProfiles,
  }

  const defaultPermissions =
    requirements?.defaultPermissions ??
    config.defaultPermissions ??
    ':workspace'
  assertRequirementsAllowProfile(defaultPermissions, requirements)

  const approvalPolicy = config.approvalPolicy ?? 'on-request'
  const approvalsReviewer = config.approvalsReviewer ?? 'user'
  assertRequirementsAllowApproval(approvalPolicy, approvalsReviewer, requirements)

  const profiles: Record<string, ResolvedCodexPermissionProfile> = {}
  const resolving = new Set<string>()
  for (const name of Object.keys(rawProfiles)) {
    profiles[name] = resolveProfile(
      name,
      rawProfiles,
      resolving,
      normalizeWorkspaceRoots(workspaceRoots),
    )
  }

  const activeProfile = profiles[defaultPermissions]
  if (!activeProfile) {
    throw new Error(`Unknown permission profile: ${defaultPermissions}`)
  }

  if (requirements?.filesystem?.denyRead) {
    for (const path of requirements.filesystem.denyRead) {
      activeProfile.filesystem.push({
        path,
        access: 'deny',
        source: 'requirements',
      })
    }
  }

  if (requirements?.experimentalNetwork) {
    applyRequirementsNetwork(activeProfile, requirements.experimentalNetwork)
  }

  return {
    defaultPermissions,
    approvalPolicy,
    approvalsReviewer,
    activeProfile,
    profiles,
    diagnostics,
  }
}

function resolveProfile(
  name: string,
  rawProfiles: Record<string, CodexPermissionProfileConfig>,
  resolving: Set<string>,
  runtimeWorkspaceRoots: string[],
): ResolvedCodexPermissionProfile {
  const raw = rawProfiles[name]
  if (!raw) {
    throw new Error(`Unknown permission profile: ${name}`)
  }
  if (resolving.has(name)) {
    throw new Error(`Permission profile inheritance cycle: ${name}`)
  }
  resolving.add(name)
  const parentName = raw.extends
  if (parentName === ':danger-full-access' && !isBuiltinProfileName(name)) {
    throw new Error('Custom permission profile cannot extend :danger-full-access')
  }
  const parent = parentName
    ? resolveProfile(parentName, rawProfiles, resolving, runtimeWorkspaceRoots)
    : null
  resolving.delete(name)

  const workspaceRoots = [
    ...(parent?.workspaceRoots ?? []),
    ...normalizeWorkspaceRoots(raw.workspaceRoots ?? []),
    ...runtimeWorkspaceRoots,
  ].filter((root, index, roots) => roots.indexOf(root) === index)
  const filesystem = [
    ...(parent?.filesystem ?? []),
    ...filesystemRulesFromConfig(raw.filesystem ?? {}, workspaceRoots),
  ]
  const network = {
    enabled: raw.network?.enabled ?? parent?.network.enabled ?? false,
    ...(parent?.network ?? {}),
    ...(raw.network ?? {}),
    domains: {
      ...(parent?.network.domains ?? {}),
      ...(raw.network?.domains ?? {}),
    },
  }

  return {
    name,
    ...(raw.description ? { description: raw.description } : {}),
    dangerFullAccess: name === ':danger-full-access',
    workspaceRoots,
    filesystem,
    network,
  }
}

function filesystemRulesFromConfig(
  rules: CodexFilesystemRules,
  workspaceRoots: string[],
): ResolvedFilesystemRule[] {
  return Object.entries(rules).flatMap(([path, access]) => {
    const accesses = Array.isArray(access) ? access : [access]
    return accesses.map(item => ({
      path,
      access: item,
      source: 'config' as const,
    }))
  })
}

export function evaluateFilesystemAccess(
  profile: ResolvedCodexPermissionProfile,
  inputPath: string,
): CodexFilesystemAccess | 'none' {
  if (profile.dangerFullAccess) return 'write'
  const path = normalizePath(inputPath)
  const expandedRules = profile.filesystem.flatMap(rule => {
    if (rule.path !== ':workspace_roots') return [rule]
    return profile.workspaceRoots.map(root => ({ ...rule, path: root }))
  })
  const matches = expandedRules
    .filter(rule => filesystemRuleMatches(rule.path, path))
    .map(rule => ({
      rule,
      specificity: filesystemRuleSpecificity(rule.path),
    }))
  if (matches.length === 0) return 'none'
  matches.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity
    return ACCESS_RANK[b.rule.access] - ACCESS_RANK[a.rule.access]
  })
  return matches[0]!.rule.access
}

export function evaluateNetworkDomainAccess(
  profile: ResolvedCodexPermissionProfile,
  domain: string,
): CodexNetworkAccess {
  if (profile.dangerFullAccess) return 'allow'
  if (!profile.network.enabled) return 'deny'
  const normalized = domain.toLowerCase()
  const rules = Object.entries(profile.network.domains ?? {})
    .filter(([pattern]) => domainRuleMatches(pattern, normalized))
    .map(([pattern, access]) => ({
      access,
      specificity: domainRuleSpecificity(pattern),
    }))
  if (rules.length === 0) return 'deny'
  rules.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity
    if (a.access === b.access) return 0
    return a.access === 'deny' ? -1 : 1
  })
  return rules[0]!.access
}

function filesystemRuleMatches(rulePath: string, inputPath: string): boolean {
  if (rulePath === ':workspace_roots') return false
  const normalizedRule = normalizePath(rulePath)
  if (normalizedRule.includes('*')) {
    return picomatch.isMatch(inputPath, normalizedRule, { dot: true })
  }
  return inputPath === normalizedRule || inputPath.startsWith(`${normalizedRule}/`)
}

function filesystemRuleSpecificity(rulePath: string): number {
  return normalizePath(rulePath).replace(/\*/g, '').length
}

function domainRuleMatches(pattern: string, domain: string): boolean {
  const normalizedPattern = pattern.toLowerCase()
  if (normalizedPattern === '*') return true
  if (normalizedPattern.startsWith('**.')) {
    const suffix = normalizedPattern.slice(3)
    return domain === suffix || domain.endsWith(`.${suffix}`)
  }
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2)
    if (!domain.endsWith(`.${suffix}`)) return false
    const prefix = domain.slice(0, -suffix.length - 1)
    return !prefix.includes('.')
  }
  return domain === normalizedPattern
}

function domainRuleSpecificity(pattern: string): number {
  return pattern.replace(/\*/g, '').length
}

function applyRequirementsNetwork(
  profile: ResolvedCodexPermissionProfile,
  network: NonNullable<CodexRequirementsPolicy['experimentalNetwork']>,
): void {
  if (network.enabled !== undefined) profile.network.enabled = network.enabled
  profile.network.domains = profile.network.domains ?? {}
  if (network.managedAllowedDomainsOnly) {
    profile.network.domains = {}
  }
  for (const domain of network.allowedDomains ?? []) {
    profile.network.domains[domain] = 'allow'
  }
  for (const domain of network.deniedDomains ?? []) {
    profile.network.domains[domain] = 'deny'
  }
  if (network.domains) {
    Object.assign(profile.network.domains, network.domains)
  }
  if (network.allowLocalNetwork !== undefined) {
    profile.network.allowLocalNetwork = network.allowLocalNetwork
  }
  if (network.allowPrivateNetwork !== undefined) {
    profile.network.allowPrivateNetwork = network.allowPrivateNetwork
  }
  if (network.allowUnixSockets) {
    profile.network.allowUnixSockets = network.allowUnixSockets
  }
  if (network.denyUnixSockets) {
    profile.network.denyUnixSockets = network.denyUnixSockets
  }
  if (network.httpProxyPort !== undefined) {
    profile.network.httpProxyPort = network.httpProxyPort
  }
  if (network.socksProxyPort !== undefined) {
    profile.network.socksProxyPort = network.socksProxyPort
  }
}

function assertRequirementsAllowProfile(
  profile: string,
  requirements: CodexRequirementsPolicy | undefined,
): void {
  const allowed = requirements?.allowedPermissionProfiles
  if (allowed && !allowed.includes(profile)) {
    throw new Error(`Permission profile ${profile} is not allowed by requirements`)
  }
}

function assertRequirementsAllowApproval(
  approvalPolicy: CodexApprovalPolicy,
  approvalsReviewer: CodexApprovalsReviewer,
  requirements: CodexRequirementsPolicy | undefined,
): void {
  if (
    requirements?.allowedApprovalPolicies &&
    !requirements.allowedApprovalPolicies.includes(approvalPolicy)
  ) {
    throw new Error(`Approval policy ${approvalPolicy} is not allowed by requirements`)
  }
  if (
    requirements?.allowedApprovalsReviewers &&
    !requirements.allowedApprovalsReviewers.includes(approvalsReviewer)
  ) {
    throw new Error(
      `Approvals reviewer ${approvalsReviewer} is not allowed by requirements`,
    )
  }
}

function isBuiltinProfileName(name: string): name is BuiltinCodexPermissionProfile {
  return (BUILTIN_CODEX_PERMISSION_PROFILES as readonly string[]).includes(name)
}

function normalizeWorkspaceRoots(roots: string[]): string[] {
  return roots.map(normalizePath).filter((root, index, all) => all.indexOf(root) === index)
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  return normalized || '/'
}

// Transitional aliases kept while Desktop/TUI call sites move to the official model.
export type AgentPermissionProfile = BuiltinCodexPermissionProfile | string
export type AgentApprovalMode =
  | CodexApprovalPolicy
  | 'prompt'
  | 'auto-review'
  | 'auto-approve-edits'
  | 'bypass'
  | 'config'
  | 'plan'
const AGENT_APPROVAL_MODES = [
  'untrusted',
  'on-request',
  'on-failure',
  'never',
  'prompt',
  'auto-review',
  'auto-approve-edits',
  'bypass',
  'config',
  'plan',
] as const satisfies readonly AgentApprovalMode[]
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

export function isAgentPermissionProfile(
  value: unknown,
): value is AgentPermissionProfile {
  return typeof value === 'string' && value.trim().length > 0
}

export function isAgentApprovalMode(value: unknown): value is AgentApprovalMode {
  return (
    typeof value === 'string' &&
    (AGENT_APPROVAL_MODES as readonly string[]).includes(value)
  )
}

export const DESKTOP_AGENT_PERMISSION_MODES = [
  'auto',
  'bypassPermissions',
  'customConfig',
  'default',
  'plan',
] as const satisfies readonly DesktopAgentPermissionMode[]

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
  mode: DesktopAgentPermissionMode | LegacyAgentPermissionMode | undefined,
): AgentPermissionPolicy {
  switch (normalizeDesktopAgentPermissionMode(mode)) {
    case 'auto':
      return { profile: ':workspace', approvalMode: 'auto-review', sandboxPolicy: ':workspace' }
    case 'bypassPermissions':
      return {
        profile: ':danger-full-access',
        approvalMode: 'bypass',
        sandboxPolicy: ':danger-full-access',
      }
    case 'plan':
      return { profile: ':read-only', approvalMode: 'plan', sandboxPolicy: ':read-only' }
    case 'customConfig':
      return { profile: ':workspace', approvalMode: 'config', sandboxPolicy: ':workspace' }
    case 'default':
      return { profile: ':workspace', approvalMode: 'prompt', sandboxPolicy: ':workspace' }
  }
}

export function normalizeAgentPermissionPolicy(
  policy: Partial<AgentPermissionPolicy> | undefined,
): AgentPermissionPolicy {
  return {
    profile: policy?.profile ?? ':workspace',
    approvalMode: policy?.approvalMode ?? 'prompt',
    sandboxPolicy: policy?.sandboxPolicy ?? policy?.profile ?? ':workspace',
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
  const override = toolName ? normalized.toolOverrides?.[toolName]?.[action] : undefined
  if (override) return override
  const actionScope = normalized.actionScopes?.[action]
  if (actionScope) return actionScope
  if (normalized.profile === ':read-only' || normalized.profile === 'read-only') {
    return action === 'read' ? 'allow' : 'ask'
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

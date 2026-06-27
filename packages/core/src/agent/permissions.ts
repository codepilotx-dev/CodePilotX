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
export type CodexApprovalsReviewer = 'user' | 'auto_review'
export type LegacyCodexApprovalsReviewer = 'auto' | 'guardian_subagent'
export type CodexSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

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

export type CodexSandboxWorkspaceWriteConfig = {
  writableRoots?: string[]
  networkAccess?: boolean
}

export type CodexPermissionsConfig = {
  sandboxMode?: CodexSandboxMode
  sandboxWorkspaceWrite?: CodexSandboxWorkspaceWriteConfig
  defaultPermissions?: string
  approvalPolicy?: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer | LegacyCodexApprovalsReviewer
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
      network: { enabled: false },
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
    permissionProfileForSandboxMode(config.sandboxMode) ??
    ':workspace'
  assertRequirementsAllowProfile(defaultPermissions, requirements)

  const approvalPolicy = config.approvalPolicy ?? 'on-request'
  const approvalsReviewer = normalizeCodexApprovalsReviewer(
    config.approvalsReviewer,
  )
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

  applySandboxWorkspaceWriteConfig(activeProfile, config)

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

export function normalizeCodexApprovalsReviewer(
  value: CodexApprovalsReviewer | LegacyCodexApprovalsReviewer | undefined,
): CodexApprovalsReviewer {
  return value === 'auto' || value === 'guardian_subagent'
    ? 'auto_review'
    : value ?? 'user'
}

export function permissionProfileForSandboxMode(
  sandboxMode: CodexSandboxMode | undefined,
): BuiltinCodexPermissionProfile | undefined {
  switch (sandboxMode) {
    case 'read-only':
      return ':read-only'
    case 'workspace-write':
      return ':workspace'
    case 'danger-full-access':
      return ':danger-full-access'
    default:
      return undefined
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

function applySandboxWorkspaceWriteConfig(
  profile: ResolvedCodexPermissionProfile,
  config: CodexPermissionsConfig,
): void {
  if (config.sandboxMode !== 'workspace-write') return
  const workspaceWrite = config.sandboxWorkspaceWrite
  if (!workspaceWrite) return
  for (const path of workspaceWrite.writableRoots ?? []) {
    profile.filesystem.push({
      path,
      access: 'write',
      source: 'config',
    })
  }
  if (workspaceWrite.networkAccess !== undefined) {
    profile.network.enabled = workspaceWrite.networkAccess
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

export type CodexRuntimePermissionState = {
  resolved: ResolvedCodexPermissions
  derivedPolicy: AgentPermissionPolicy
  sandboxOverlay: CodexPermissionSandboxOverlay
}

export type CodexPermissionSandboxOverlay = {
  filesystem: {
    allowWrite: string[]
    denyWrite: string[]
    denyRead: string[]
    allowRead: string[]
  }
  network: {
    allowedDomains: string[]
    deniedDomains: string[]
  }
}

export function createCodexRuntimePermissionState({
  projectConfig,
  overrides = {},
  requirements,
  workspaceRoots,
}: {
  projectConfig?: CodexPermissionsConfig
  overrides?: {
    sandboxMode?: CodexSandboxMode
    defaultPermissions?: string
    approvalPolicy?: CodexApprovalPolicy
    approvalsReviewer?: CodexApprovalsReviewer | LegacyCodexApprovalsReviewer
  }
  requirements?: CodexRequirementsPolicy
  workspaceRoots: string[]
}): CodexRuntimePermissionState {
  const config: CodexPermissionsConfig = {
    ...projectConfig,
    sandboxMode: overrides.sandboxMode ?? projectConfig?.sandboxMode,
    defaultPermissions:
      overrides.defaultPermissions ??
      projectConfig?.defaultPermissions,
    approvalPolicy:
      overrides.approvalPolicy ?? projectConfig?.approvalPolicy,
    approvalsReviewer:
      overrides.approvalsReviewer ?? projectConfig?.approvalsReviewer,
  }

  const resolved = resolveCodexPermissions({ config, requirements, workspaceRoots })
  const derivedPolicy = convertResolvedPermissionsToPolicy(resolved)
  const sandboxOverlay = buildSandboxOverlayFromResolved(resolved)

  return { resolved, derivedPolicy, sandboxOverlay }
}

function convertResolvedPermissionsToPolicy(
  resolved: ResolvedCodexPermissions,
): AgentPermissionPolicy {
  const profile = resolved.defaultPermissions
  const approvalMode = resolved.approvalPolicy
  const sandboxPolicy = resolved.activeProfile.dangerFullAccess
    ? ':danger-full-access'
    : resolved.defaultPermissions
  const sandboxMode = sandboxModeForResolvedProfile(resolved.activeProfile)

  const actionScopes: AgentPermissionActionScopes = {}
  if (resolved.activeProfile.dangerFullAccess) {
    actionScopes.read = 'allow'
    actionScopes.write = 'allow'
    actionScopes.shell = 'allow'
    actionScopes.network = 'allow'
    actionScopes.mcp = 'allow'
  } else if (resolved.defaultPermissions === ':read-only') {
    actionScopes.read = 'allow'
    actionScopes.write = 'ask'
    actionScopes.shell = 'ask'
    actionScopes.network = 'ask'
    actionScopes.mcp = 'ask'
  }

  return {
    profile,
    approvalMode,
    approvalsReviewer: resolved.approvalsReviewer,
    sandboxMode,
    sandboxPolicy,
    ...(Object.keys(actionScopes).length > 0 ? { actionScopes } : {}),
  }
}

function sandboxModeForResolvedProfile(
  profile: ResolvedCodexPermissionProfile,
): CodexSandboxMode {
  if (profile.dangerFullAccess) return 'danger-full-access'
  const workspaceAccesses = profile.workspaceRoots.map(root =>
    evaluateFilesystemAccess(profile, root),
  )
  return workspaceAccesses.some(access => access === 'write')
    ? 'workspace-write'
    : 'read-only'
}

function buildSandboxOverlayFromResolved(
  resolved: ResolvedCodexPermissions,
): CodexPermissionSandboxOverlay {
  const profile = resolved.activeProfile
  const allowWrite: string[] = []
  const denyWrite: string[] = []
  const denyRead: string[] = []
  const allowRead: string[] = []

  if (!profile.dangerFullAccess) {
    for (const rule of profile.filesystem) {
      if (rule.path === ':workspace_roots') continue
      switch (rule.access) {
        case 'write':
          allowWrite.push(rule.path)
          break
        case 'read':
          allowRead.push(rule.path)
          break
        case 'deny':
          denyWrite.push(rule.path)
          denyRead.push(rule.path)
          break
      }
    }

    // If the active profile has write access to workspace roots, add them
    // to allowWrite. Otherwise add to allowRead.
    for (const root of profile.workspaceRoots) {
      const access = evaluateFilesystemAccess(profile, root)
      if (access === 'write') {
        allowWrite.push(root)
      } else if (access === 'read') {
        allowRead.push(root)
      }
    }
  }

  const allowedDomains: string[] = []
  const deniedDomains: string[] = []
  if (profile.network.enabled && profile.network.domains) {
    for (const [domain, access] of Object.entries(profile.network.domains)) {
      if (access === 'allow') allowedDomains.push(domain)
      else if (access === 'deny') deniedDomains.push(domain)
    }
  }

  return {
    filesystem: { allowWrite, denyWrite, denyRead, allowRead },
    network: { allowedDomains, deniedDomains },
  }
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
  approvalsReviewer?: CodexApprovalsReviewer
  sandboxMode?: CodexSandboxMode
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
  approvalsReviewer?: CodexApprovalsReviewer
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
  | 'plan'
  | 'auto-review'
  | 'full-access'
  | 'custom'
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
  'default',
  'plan',
  'auto-review',
  'full-access',
  'custom',
] as const satisfies readonly DesktopAgentPermissionMode[]

export function normalizeDesktopAgentPermissionMode(
  mode: unknown,
): DesktopAgentPermissionMode {
  switch (mode) {
    case 'acceptEdits':
    case 'auto':
      return 'auto-review'
    case 'dontAsk':
    case 'customConfig':
      return 'custom'
    case 'bypassPermissions':
      return 'full-access'
    case 'default':
    case 'plan':
    case 'auto-review':
    case 'full-access':
    case 'custom':
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
    case 'auto-review':
      return {
        profile: ':workspace',
        approvalMode: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxMode: 'workspace-write',
        sandboxPolicy: ':workspace',
      }
    case 'full-access':
      return {
        profile: ':danger-full-access',
        approvalMode: 'never',
        approvalsReviewer: 'user',
        sandboxMode: 'danger-full-access',
        sandboxPolicy: ':danger-full-access',
      }
    case 'custom':
      return {
        profile: ':workspace',
        approvalMode: 'on-request',
        approvalsReviewer: 'user',
        sandboxMode: 'workspace-write',
        sandboxPolicy: ':workspace',
      }
    case 'default':
    case 'plan':
      return {
        profile: ':workspace',
        approvalMode: 'on-request',
        approvalsReviewer: 'user',
        sandboxMode: 'workspace-write',
        sandboxPolicy: ':workspace',
      }
  }
}

export function normalizeAgentPermissionPolicy(
  policy: Partial<AgentPermissionPolicy> | undefined,
): AgentPermissionPolicy {
  return {
    profile: policy?.profile ?? ':workspace',
    approvalMode: policy?.approvalMode ?? 'on-request',
    ...(policy?.approvalsReviewer
      ? { approvalsReviewer: policy.approvalsReviewer }
      : {}),
    ...(policy?.sandboxMode ? { sandboxMode: policy.sandboxMode } : {}),
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

import { parse as parseToml } from 'smol-toml'
import type {
  CodexPermissionProfileConfig,
  CodexRequirementsPolicy,
} from './permissions.js'
import { normalizeCodexApprovalsReviewer } from './permissions.js'
import type { CodexFilesystemRules, CodexNetworkConfig } from './permissions.js'

type TomlRecord = Record<string, unknown>

export function parseCodexRequirements(content: string): CodexRequirementsPolicy {
  const parsed = parseToml(content) as TomlRecord
  const policy: CodexRequirementsPolicy = {}

  if (isStringArray(parsed.allowed_permission_profiles)) {
    policy.allowedPermissionProfiles = parsed.allowed_permission_profiles
  }
  if (typeof parsed.default_permissions === 'string') {
    policy.defaultPermissions = parsed.default_permissions
  }
  if (isStringArray(parsed.allowed_approval_policies)) {
    policy.allowedApprovalPolicies = parsed.allowed_approval_policies.filter(
      isApprovalPolicy,
    )
  }
  if (isStringArray(parsed.allowed_approvals_reviewers)) {
    policy.allowedApprovalsReviewers =
      parsed.allowed_approvals_reviewers
        .filter(isApprovalsReviewer)
        .map(normalizeCodexApprovalsReviewer)
  }

  const permissions = parseManagedPermissions(parsed.permissions)
  if (permissions) {
    policy.permissions = permissions
  }

  const filesystem = isRecord(parsed.filesystem)
    ? parsed.filesystem
    : isRecord(parsed.permissions) && isRecord(parsed.permissions.filesystem)
      ? parsed.permissions.filesystem
      : undefined
  if (filesystem && isStringArray(filesystem.deny_read)) {
    policy.filesystem = { denyRead: filesystem.deny_read }
  }

  const experimentalNetwork = parseExperimentalNetwork(
    parsed.experimental_network,
  )
  if (experimentalNetwork) {
    policy.experimentalNetwork = experimentalNetwork
  }

  return policy
}

function parseManagedPermissions(
  value: unknown,
): Record<string, CodexPermissionProfileConfig> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, CodexPermissionProfileConfig> = {}
  for (const [name, rawProfile] of Object.entries(value)) {
    if (!isRecord(rawProfile)) continue
    if (name === 'filesystem') continue
    const profile: CodexPermissionProfileConfig = {}
    if (typeof rawProfile.description === 'string') {
      profile.description = rawProfile.description
    }
    if (typeof rawProfile.extends === 'string') {
      profile.extends = rawProfile.extends
    }
    if (isStringArray(rawProfile.workspace_roots)) {
      profile.workspaceRoots = rawProfile.workspace_roots
    }
    const filesystem = parseFilesystem(rawProfile.filesystem)
    if (filesystem) profile.filesystem = filesystem
    const network = parseNetwork(rawProfile.network)
    if (network) profile.network = network
    result[name] = profile
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseExperimentalNetwork(
  value: unknown,
): CodexRequirementsPolicy['experimentalNetwork'] | undefined {
  if (!isRecord(value)) return undefined
  const network: NonNullable<CodexRequirementsPolicy['experimentalNetwork']> = {}
  if (typeof value.enabled === 'boolean') network.enabled = value.enabled
  if (isStringArray(value.domains)) network.domains = value.domains
  if (isStringArray(value.allowed_domains)) {
    network.allowedDomains = value.allowed_domains
  }
  if (isStringArray(value.denied_domains)) {
    network.deniedDomains = value.denied_domains
  }
  if (typeof value.managed_allowed_domains_only === 'boolean') {
    network.managedAllowedDomainsOnly = value.managed_allowed_domains_only
  }
  if (typeof value.http_proxy_port === 'number') {
    network.httpProxyPort = value.http_proxy_port
  }
  if (typeof value.socks_proxy_port === 'number') {
    network.socksProxyPort = value.socks_proxy_port
  }
  if (isStringArray(value.allow_unix_sockets)) {
    network.allowUnixSockets = value.allow_unix_sockets
  }
  if (isStringArray(value.deny_unix_sockets)) {
    network.denyUnixSockets = value.deny_unix_sockets
  }
  if (typeof value.allow_local_network === 'boolean') {
    network.allowLocalNetwork = value.allow_local_network
  }
  if (typeof value.allow_private_network === 'boolean') {
    network.allowPrivateNetwork = value.allow_private_network
  }
  return Object.keys(network).length > 0 ? network : undefined
}

function parseFilesystem(value: unknown): CodexFilesystemRules | undefined {
  if (!isRecord(value)) return undefined
  const filesystem: CodexFilesystemRules = {}
  for (const [path, access] of Object.entries(value)) {
    if (access === 'read' || access === 'write' || access === 'deny') {
      filesystem[path] = access
    }
  }
  return filesystem
}

function parseNetwork(value: unknown): CodexNetworkConfig | undefined {
  if (!isRecord(value)) return undefined
  const network: CodexNetworkConfig = {}
  if (typeof value.enabled === 'boolean') network.enabled = value.enabled
  if (isRecord(value.domains)) {
    network.domains = {}
    for (const [domain, access] of Object.entries(value.domains)) {
      if (access === 'allow' || access === 'deny') {
        network.domains[domain] = access
      }
    }
  }
  return network
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isApprovalPolicy(
  value: string,
): value is 'untrusted' | 'on-request' | 'on-failure' | 'never' {
  return (
    value === 'untrusted' ||
    value === 'on-request' ||
    value === 'on-failure' ||
    value === 'never'
  )
}

function isApprovalsReviewer(
  value: string,
): value is 'user' | 'auto' | 'auto_review' | 'guardian_subagent' {
  return (
    value === 'user' ||
    value === 'auto' ||
    value === 'auto_review' ||
    value === 'guardian_subagent'
  )
}

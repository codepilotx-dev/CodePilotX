import { parse as parseToml } from 'smol-toml'
import type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexFilesystemRules,
  CodexNetworkConfig,
  CodexPermissionProfileConfig,
  CodexSandboxMode,
  CodexSandboxWorkspaceWriteConfig,
} from './permissions.js'
import { normalizeCodexApprovalsReviewer } from './permissions.js'

export type CodexMcpServerDiagnostic = {
  name: string
  source: string
  command?: string
  args?: string[]
  url?: string
}

export type CodexHookDiagnostic = {
  event: string
  matcher?: string
  commands: string[]
  source: string
}

export type CodexProjectConfig = {
  approval?: string
  sandbox?: string
  sandboxMode?: CodexSandboxMode
  sandboxWorkspaceWrite?: CodexSandboxWorkspaceWriteConfig
  approvalPolicy?: CodexApprovalPolicy
  approvalsReviewer?: CodexApprovalsReviewer
  defaultPermissions?: string
  projectRootMarkers?: string[]
  permissions?: Record<string, CodexPermissionProfileConfig>
  mcpServers?: CodexMcpServerDiagnostic[]
  hooks?: CodexHookDiagnostic[]
}

export type CodexProjectConfigDiagnosticsData = {
  config: CodexProjectConfig
  ignoredProjectKeys: string[]
  diagnostics: string[]
}

export const CODEX_PROJECT_CONFIG_SOURCE = '.codex/config.toml'

const PROJECT_IGNORED_KEYS = new Set([
  'openai_base_url',
  'chatgpt_base_url',
  'apps_mcp_product_sku',
  'model_provider',
  'model_providers',
  'notify',
  'profile',
  'profiles',
  'experimental_realtime_ws_base_url',
  'otel',
])

export function parseCodexProjectConfig(
  content: string,
): CodexProjectConfigDiagnosticsData {
  const parsed = parseToml(content) as Record<string, unknown>
  const config: CodexProjectConfig = {}
  const ignoredProjectKeys: string[] = []
  const diagnostics: string[] = []

  for (const key of Object.keys(parsed).sort()) {
    if (PROJECT_IGNORED_KEYS.has(key)) {
      ignoredProjectKeys.push(key)
    }
  }

  if (typeof parsed.approval === 'string') config.approval = parsed.approval
  if (typeof parsed.sandbox === 'string') config.sandbox = parsed.sandbox
  if (isSandboxMode(parsed.sandbox_mode)) {
    config.sandboxMode = parsed.sandbox_mode
  }
  const sandboxWorkspaceWrite = parseSandboxWorkspaceWrite(
    parsed.sandbox_workspace_write,
  )
  if (sandboxWorkspaceWrite) {
    config.sandboxWorkspaceWrite = sandboxWorkspaceWrite
  }
  if (isApprovalPolicy(parsed.approval_policy)) {
    config.approvalPolicy = parsed.approval_policy
  }
  if (isApprovalsReviewer(parsed.approvals_reviewer)) {
    config.approvalsReviewer = normalizeCodexApprovalsReviewer(
      parsed.approvals_reviewer,
    )
  }
  if (typeof parsed.default_permissions === 'string') {
    config.defaultPermissions = parsed.default_permissions
  }
  if (isStringArray(parsed.project_root_markers)) {
    config.projectRootMarkers = parsed.project_root_markers
  }

  const permissions = parsePermissions(parsed.permissions)
  if (permissions) config.permissions = permissions

  const mcpServers = parseMcpServers(parsed.mcp_servers)
  if (mcpServers.length > 0) config.mcpServers = mcpServers

  const hooks = parseHooks(parsed.hooks)
  if (hooks.length > 0) config.hooks = hooks

  return {
    config,
    ignoredProjectKeys,
    diagnostics,
  }
}

function parseSandboxWorkspaceWrite(
  value: unknown,
): CodexSandboxWorkspaceWriteConfig | undefined {
  if (!isRecord(value)) return undefined
  const config: CodexSandboxWorkspaceWriteConfig = {}
  if (isStringArray(value.writable_roots)) {
    config.writableRoots = value.writable_roots
  }
  if (typeof value.network_access === 'boolean') {
    config.networkAccess = value.network_access
  }
  return Object.keys(config).length > 0 ? config : undefined
}

function parsePermissions(
  value: unknown,
): Record<string, CodexPermissionProfileConfig> | undefined {
  if (!isRecord(value)) return undefined
  const permissions: Record<string, CodexPermissionProfileConfig> = {}
  for (const [name, rawProfile] of Object.entries(value)) {
    if (!isRecord(rawProfile)) continue
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
    permissions[name] = profile
  }
  return permissions
}

function parseFilesystem(value: unknown): CodexFilesystemRules | undefined {
  if (!isRecord(value)) return undefined
  const filesystem: CodexFilesystemRules = {}
  for (const [path, access] of Object.entries(value)) {
    if (isFilesystemAccess(access)) {
      filesystem[path] = access
    } else if (Array.isArray(access) && access.every(isFilesystemAccess)) {
      filesystem[path] = access
    }
  }
  return filesystem
}

function parseNetwork(value: unknown): CodexNetworkConfig | undefined {
  if (!isRecord(value)) return undefined
  const network: CodexNetworkConfig = {}
  if (typeof value.enabled === 'boolean') network.enabled = value.enabled
  if (typeof value.allow_local_network === 'boolean') {
    network.allowLocalNetwork = value.allow_local_network
  }
  if (typeof value.allow_private_network === 'boolean') {
    network.allowPrivateNetwork = value.allow_private_network
  }
  if (isStringArray(value.allow_unix_sockets)) {
    network.allowUnixSockets = value.allow_unix_sockets
  }
  if (isStringArray(value.deny_unix_sockets)) {
    network.denyUnixSockets = value.deny_unix_sockets
  }
  if (typeof value.http_proxy_port === 'number') {
    network.httpProxyPort = value.http_proxy_port
  }
  if (typeof value.socks_proxy_port === 'number') {
    network.socksProxyPort = value.socks_proxy_port
  }
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

function parseMcpServers(value: unknown): CodexMcpServerDiagnostic[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, rawServer]) => {
    if (!isRecord(rawServer)) return []
    return [
      {
        name,
        source: CODEX_PROJECT_CONFIG_SOURCE,
        command:
          typeof rawServer.command === 'string' ? rawServer.command : undefined,
        args: isStringArray(rawServer.args) ? rawServer.args : undefined,
        url: typeof rawServer.url === 'string' ? rawServer.url : undefined,
      },
    ]
  })
}

function parseHooks(value: unknown): CodexHookDiagnostic[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([event, rawHooks]) => {
    if (!Array.isArray(rawHooks)) return []
    return rawHooks.flatMap(rawHook => {
      if (!isRecord(rawHook)) return []
      const commands = Array.isArray(rawHook.hooks)
        ? rawHook.hooks.flatMap(item =>
            isRecord(item) && typeof item.command === 'string'
              ? [item.command]
              : [],
          )
        : []
      return [
        {
          event,
          matcher:
            typeof rawHook.matcher === 'string' ? rawHook.matcher : undefined,
          commands,
          source: CODEX_PROJECT_CONFIG_SOURCE,
        },
      ]
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isFilesystemAccess(value: unknown): value is 'read' | 'write' | 'deny' {
  return value === 'read' || value === 'write' || value === 'deny'
}

function isApprovalPolicy(value: unknown): value is CodexApprovalPolicy {
  return (
    value === 'untrusted' ||
    value === 'on-request' ||
    value === 'on-failure' ||
    value === 'never'
  )
}

function isApprovalsReviewer(
  value: unknown,
): value is CodexApprovalsReviewer | 'auto' | 'guardian_subagent' {
  return (
    value === 'user' ||
    value === 'auto_review' ||
    value === 'auto' ||
    value === 'guardian_subagent'
  )
}

function isSandboxMode(value: unknown): value is CodexSandboxMode {
  return (
    value === 'read-only' ||
    value === 'workspace-write' ||
    value === 'danger-full-access'
  )
}

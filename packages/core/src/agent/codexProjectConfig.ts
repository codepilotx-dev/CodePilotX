import { parse as parseToml } from 'smol-toml'
import type {
  CodexFilesystemRules,
  CodexNetworkConfig,
  CodexPermissionProfileConfig,
} from './permissions.js'

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
  approvalPolicy?: string
  approvalsReviewer?: string
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

const LEGACY_DISABLED_DIAGNOSTICS = {
  sandboxMode:
    '旧 sandbox_mode 已禁用，请改用 default_permissions 和 [permissions.<name>]',
  sandboxWorkspaceWrite:
    '旧 [sandbox_workspace_write] 已禁用，请改用 [permissions.<name>]',
}

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
  if (typeof parsed.approval_policy === 'string') {
    config.approvalPolicy = parsed.approval_policy
  }
  if (typeof parsed.approvals_reviewer === 'string') {
    config.approvalsReviewer = parsed.approvals_reviewer
  }
  if (typeof parsed.default_permissions === 'string') {
    config.defaultPermissions = parsed.default_permissions
  }
  if (isStringArray(parsed.project_root_markers)) {
    config.projectRootMarkers = parsed.project_root_markers
  }

  if (typeof parsed.sandbox_mode === 'string') {
    diagnostics.push(LEGACY_DISABLED_DIAGNOSTICS.sandboxMode)
  }
  if (isRecord(parsed.sandbox_workspace_write)) {
    diagnostics.push(LEGACY_DISABLED_DIAGNOSTICS.sandboxWorkspaceWrite)
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

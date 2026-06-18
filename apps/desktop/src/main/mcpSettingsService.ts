import {
  addMcpConfig,
  getAllMcpConfigs,
  isMcpServerDisabled,
  removeMcpConfig,
  setMcpServerEnabled as setTuiMcpServerEnabled,
} from '@codepilotx/tui/services/mcp/config.js'
import type {
  ConfigScope,
  McpServerConfig,
  ScopedMcpServerConfig,
} from '@codepilotx/tui/services/mcp/types.js'
import { McpServerConfigSchema } from '@codepilotx/tui/services/mcp/types.js'
import type {
  DesktopEditableMcpScope,
  DesktopMcpServerListItem,
  SaveDesktopMcpServerOptions,
} from '../shared/types.js'

const EDITABLE_SCOPES = new Set<ConfigScope>(['local', 'user', 'project'])

export async function listDesktopMcpServers(): Promise<
  DesktopMcpServerListItem[]
> {
  const { servers } = await getAllMcpConfigs()
  return Object.entries(servers)
    .map(([name, config]) => toDesktopMcpServerListItem(name, config))
    .sort((left, right) => {
      const scopeOrder = scopeSortIndex(left.scope) - scopeSortIndex(right.scope)
      if (scopeOrder !== 0) return scopeOrder
      return left.name.localeCompare(right.name)
    })
}

export async function saveDesktopMcpServer(
  options: SaveDesktopMcpServerOptions,
): Promise<DesktopMcpServerListItem[]> {
  const name = requireMcpServerName(options.name)
  const scope = requireEditableScope(options.scope)
  const parsed = McpServerConfigSchema().safeParse(options.config)
  if (!parsed.success) {
    const failed = parsed as {
      success: false
      error: { issues: Array<{ path: Array<string | number>; message: string }> }
    }
    const details = failed.error.issues
      .map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ')
    throw new Error(`MCP 配置无效：${details}`)
  }

  const originalName = options.originalName?.trim()
  let originalConfig:
    | { name: string; scope: ConfigScope; config: Record<string, unknown> }
    | null = null
  if (originalName) {
    const current = await getAllMcpConfigs()
    const original = current.servers[originalName]
    if (!original) {
      throw new Error(`找不到 MCP server：${originalName}`)
    }
    if (!EDITABLE_SCOPES.has(original.scope)) {
      throw new Error(`不能编辑 ${original.scope} scope 的 MCP server。`)
    }
    const { scope: originalScope, pluginSource: _pluginSource, ...rest } = original
    originalConfig = {
      name: originalName,
      scope: originalScope,
      config: rest as Record<string, unknown>,
    }
    await removeMcpConfig(originalName, original.scope)
  }

  try {
    await addMcpConfig(name, parsed.data, scope)
  } catch (error) {
    if (originalConfig) {
      try {
        await addMcpConfig(
          originalConfig.name,
          originalConfig.config,
          originalConfig.scope,
        )
      } catch {
        // Keep the original error; the UI can ask the user to reload if restore fails.
      }
    }
    throw error
  }

  return listDesktopMcpServers()
}

export async function removeDesktopMcpServer(
  name: string,
  scope: DesktopEditableMcpScope,
): Promise<DesktopMcpServerListItem[]> {
  await removeMcpConfig(requireMcpServerName(name), requireEditableScope(scope))
  return listDesktopMcpServers()
}

export async function setDesktopMcpServerEnabled(
  name: string,
  enabled: boolean,
): Promise<DesktopMcpServerListItem[]> {
  setTuiMcpServerEnabled(requireMcpServerName(name), enabled)
  return listDesktopMcpServers()
}

function toDesktopMcpServerListItem(
  name: string,
  config: ScopedMcpServerConfig,
): DesktopMcpServerListItem {
  const { scope, pluginSource: _pluginSource, ...configWithoutScope } = config
  const editable = EDITABLE_SCOPES.has(scope)
  return {
    name,
    scope,
    type: mcpTransportType(config),
    summary: mcpSummary(config),
    enabled: !isMcpServerDisabled(name),
    editable,
    removable: editable,
    config: configWithoutScope as Record<string, unknown>,
  }
}

function mcpTransportType(config: McpServerConfig): string {
  if ('type' in config && typeof config.type === 'string') {
    return config.type
  }
  return 'stdio'
}

function mcpSummary(config: McpServerConfig): string {
  if ('url' in config && typeof config.url === 'string') {
    return config.url
  }
  if ('command' in config && typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.join(' ') : ''
    return [config.command, args].filter(Boolean).join(' ')
  }
  if ('name' in config && typeof config.name === 'string') {
    return config.name
  }
  return mcpTransportType(config)
}

function requireMcpServerName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('MCP server name cannot be empty.')
  }
  return trimmed
}

function requireEditableScope(value: string): DesktopEditableMcpScope {
  if (value === 'local' || value === 'user' || value === 'project') {
    return value
  }
  throw new Error(`Unsupported editable MCP scope: ${value}`)
}

function scopeSortIndex(scope: string): number {
  switch (scope) {
    case 'user':
      return 0
    case 'project':
      return 1
    case 'local':
      return 2
    case 'enterprise':
      return 3
    case 'managed':
      return 4
    case 'claudeai':
      return 5
    case 'dynamic':
      return 6
    default:
      return 7
  }
}

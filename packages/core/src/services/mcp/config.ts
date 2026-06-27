import { unsupportedCoreFeature } from '../../errors/unsupported.js'
import type {
  ConfigScope,
  McpServerConfig,
  ScopedMcpServerConfig,
} from './types.js'

export type AllMcpConfigs = {
  servers: Record<string, ScopedMcpServerConfig>
}

export async function getAllMcpConfigs(): Promise<AllMcpConfigs> {
  unsupportedCoreFeature(
    'mcp config',
    'MCP config storage still depends on TUI settings and plugin state.',
  )
}

export async function addMcpConfig(
  _name: string,
  _config: McpServerConfig | Record<string, unknown>,
  _scope: ConfigScope,
): Promise<void> {
  unsupportedCoreFeature(
    'mcp config',
    'MCP config storage still depends on TUI settings and plugin state.',
  )
}

export async function removeMcpConfig(
  _name: string,
  _scope: ConfigScope,
): Promise<void> {
  unsupportedCoreFeature(
    'mcp config',
    'MCP config storage still depends on TUI settings and plugin state.',
  )
}

export function setMcpServerEnabled(_name: string, _enabled: boolean): void {
  unsupportedCoreFeature(
    'mcp config',
    'MCP config storage still depends on TUI settings and plugin state.',
  )
}

export function isMcpServerDisabled(_name: string): boolean {
  unsupportedCoreFeature(
    'mcp config',
    'MCP config storage still depends on TUI settings and plugin state.',
  )
}

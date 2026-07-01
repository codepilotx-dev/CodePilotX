/**
 * Desktop adapter for the core MCP config runtime.
 *
 * Configures @codepilotx/core/services/mcp/configRuntime with Desktop-native
 * implementations. Desktop does not use plugins or Claude.ai connectors,
 * so those providers are omitted.
 */
import { configureMcpConfigRuntime } from '@codepilotx/core/services/mcp/configRuntime.js'
import type {
  McpServerConfigStore,
  McpServerSettingsProvider,
} from '@codepilotx/core/services/mcp/configRuntime.js'
import type { McpJsonConfig, McpServerConfig } from '@codepilotx/core/services/mcp/types.js'
import { McpJsonConfigSchema } from '@codepilotx/core/services/mcp/types.js'
import { chmod, mkdir, open, rename, stat, writeFile, unlink } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
} from '@codepilotx/core/config/env.js'
import type { getStandaloneWorkspaceMetadata } from './standaloneWorkspace.js'
import type { DesktopWorkspace } from '../shared/types.js'

// ─── Module-level workspace reference ───────────────────────────────────────

type WorkspaceAccessor = typeof getStandaloneWorkspaceMetadata
let workspaceAccessor: WorkspaceAccessor | null = null

/**
 * Register the workspace accessor so the adapter can resolve getCwd().
 * Must be called after configureWorkspaceService().
 */
export function registerMcpConfigWorkspaceAccessor(
  getWorkspace: WorkspaceAccessor,
): void {
  workspaceAccessor = getWorkspace
}

/**
 * Configure the MCP config runtime with Desktop-native implementations.
 * Call once during app startup.
 */
export function configureDesktopMcpConfigRuntime(): void {
  configureMcpConfigRuntime({
    configStore: createConfigStore(),
    settings: createSettingsProvider(),
    getCwd: () => getDesktopCwd(),
    logDebug: (msg, opts) => {
      console.log(`[mcp-config] ${msg}`, opts ?? '')
    },
    logError: (error) => {
      console.error(`[mcp-config] ${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

function getDesktopCwd(): string | undefined {
  if (!workspaceAccessor) return undefined
  try {
    const workspace: DesktopWorkspace = workspaceAccessor()
    return workspace.path
  } catch {
    return undefined
  }
}

// ─── Config Store ───────────────────────────────────────────────────────────

/**
 * Path to ~/.codepilotx/.config.json (the global config).
 */
function getGlobalConfigPath(): string {
  const configDir =
    process.env[CODEPILOTX_CONFIG_DIR_ENV] ??
    process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] ??
    join(homedir(), CODEPILOTX_CONFIG_DIR_NAME)
  return join(configDir, '.config.json')
}

interface GlobalConfig {
  mcpServers?: Record<string, McpServerConfig>
  projects?: Record<string, { mcpServers?: Record<string, McpServerConfig>; disabledMcpServers?: string[]; enabledMcpServers?: string[] }>
}

function readGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath()
  try {
    if (!existsSync(configPath)) return {}
    const content = readFileSync(configPath, 'utf8')
    return JSON.parse(content) as GlobalConfig
  } catch {
    return {}
  }
}

async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const configPath = getGlobalConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

function getProjectKey(): string | undefined {
  const cwd = getDesktopCwd()
  if (!cwd) return undefined
  // Sanitize path to use as a project key (same as TUI's sanitizePath)
  return cwd.replace(/[/\\:]/g, '-')
}

function createConfigStore(): McpServerConfigStore {
  return {
    getUserMcpServers() {
      return readGlobalConfig().mcpServers
    },

    async saveUserMcpServers(servers: Record<string, McpServerConfig>) {
      const config = readGlobalConfig()
      config.mcpServers = servers
      await writeGlobalConfig(config)
    },

    getLocalMcpServers() {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      if (!projectKey) return undefined
      return config.projects?.[projectKey]?.mcpServers
    },

    async saveLocalMcpServers(servers: Record<string, McpServerConfig>) {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      if (!projectKey) return
      if (!config.projects) config.projects = {}
      config.projects[projectKey] = {
        ...config.projects[projectKey],
        mcpServers: servers,
      }
      await writeGlobalConfig(config)
    },

    readMcpJsonFile(filePath: string): McpJsonConfig | null {
      try {
        if (!existsSync(filePath)) return null
        const content = readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(content) as Record<string, unknown>
        const result = McpJsonConfigSchema().safeParse(parsed)
        return result.success ? result.data : null
      } catch {
        return null
      }
    },

    async writeMcpJsonFile(config: McpJsonConfig, cwd: string): Promise<void> {
      const mcpJsonPath = join(cwd, '.mcp.json')

      let existingMode: number | undefined
      try {
        const stats = await stat(mcpJsonPath)
        existingMode = stats.mode
      } catch {
        // File doesn't exist yet
      }

      const tempPath = `${mcpJsonPath}.tmp.${process.pid}.${Date.now()}`
      const handle = await open(tempPath, 'w', existingMode ?? 0o644)
      try {
        await handle.writeFile(JSON.stringify(config, null, 2), { encoding: 'utf8' })
        await handle.datasync()
      } finally {
        await handle.close()
      }

      try {
        if (existingMode !== undefined) {
          await chmod(tempPath, existingMode)
        }
        await rename(tempPath, mcpJsonPath)
      } catch (e: unknown) {
        try {
          await unlink(tempPath)
        } catch {
          // Best-effort cleanup
        }
        throw e
      }
    },

    getEnterpriseMcpFilePath() {
      // Desktop uses the same managed path convention as TUI
      const managedDir = process.platform === 'win32'
          ? join(process.env.ProgramFiles || 'C:\\Program Files', 'CodePilotX')
        : process.platform === 'darwin'
          ? '/Library/Application Support/CodePilotX'
          : '/etc/claude-code'
      return join(managedDir, 'managed-mcp.json')
    },

    getDisabledMcpServers() {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      return config.projects?.[projectKey]?.disabledMcpServers ?? []
    },

    getEnabledMcpServers() {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      return config.projects?.[projectKey]?.enabledMcpServers ?? []
    },

    async saveDisabledMcpServers(disabled: string[]) {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      if (!projectKey) return
      if (!config.projects) config.projects = {}
      config.projects[projectKey] = {
        ...config.projects[projectKey],
        disabledMcpServers: disabled,
      }
      await writeGlobalConfig(config)
    },

    async saveEnabledMcpServers(enabled: string[]) {
      const config = readGlobalConfig()
      const projectKey = getProjectKey()
      if (!projectKey) return
      if (!config.projects) config.projects = {}
      config.projects[projectKey] = {
        ...config.projects[projectKey],
        enabledMcpServers: enabled,
      }
      await writeGlobalConfig(config)
    },
  }
}

// ─── Settings Provider ──────────────────────────────────────────────────────

interface McpPolicyEntry {
  serverName?: string
  serverCommand?: string[]
  serverUrl?: string
}

function createSettingsProvider(): McpServerSettingsProvider {
  return {
    getAllowlist() {
      // Read from the TUI settings file for allowlist policy
      const settingsFile = readTuiSettingsFile()
      return settingsFile?.allowedMcpServers as McpPolicyEntry[] | undefined
    },

    getDenylist() {
      const settingsFile = readTuiSettingsFile()
      return settingsFile?.deniedMcpServers as McpPolicyEntry[] | undefined
    },

    isManagedOnly() {
      const settingsFile = readTuiSettingsFile()
      return (settingsFile as Record<string, unknown>)?.allowManagedMcpServersOnly === true
    },

    isPluginOnlyLocked() {
      // Desktop has no plugin system for MCP
      return false
    },

    isSourceEnabled() {
      // Desktop treats all sources as enabled
      return true
    },

    getProjectApprovalStatus() {
      // Desktop does not yet implement the project .mcp.json trust flow.
      return 'pending'
    },
  }
}

/**
 * Read the TUI settings file (~/.codepilotx/settings.json) for MCP policy.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function readTuiSettingsFile(): Record<string, unknown> | null {
  const configDir =
    process.env[CODEPILOTX_CONFIG_DIR_ENV] ??
    process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] ??
    join(homedir(), CODEPILOTX_CONFIG_DIR_NAME)
  const settingsPath = join(configDir, 'settings.json')
  try {
    if (!existsSync(settingsPath)) return null
    const content = readFileSync(settingsPath, 'utf8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

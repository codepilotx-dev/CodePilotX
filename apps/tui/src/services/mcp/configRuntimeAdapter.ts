/**
 * TUI adapter for the core MCP config runtime.
 *
 * Configures @codepilotx/core/services/mcp/configRuntime with TUI-specific
 * implementations for settings, plugins, claude.ai, and file I/O.
 */
import { configureMcpConfigRuntime } from '@codepilotx/core/services/mcp/configRuntime.js'
import type {
  McpClaudeAiServerProvider,
  McpPluginServerProvider,
  McpServerConfigStore,
  McpServerSettingsProvider,
} from '@codepilotx/core/services/mcp/configRuntime.js'
import type { McpJsonConfig, McpServerConfig } from '@codepilotx/core/services/mcp/types.js'
import { McpJsonConfigSchema } from '@codepilotx/core/services/mcp/types.js'
import { chmod, open, rename, stat, unlink } from 'fs/promises'
import { join, parse } from 'path'
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig, saveGlobalConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { getPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { getManagedFilePath } from '../../utils/settings/managedPath.js'
import { isRestrictedToPluginOnly } from '../../utils/settings/pluginOnlyPolicy.js'
import { getInitialSettings, getSettingsForSource } from '../../utils/settings/settings.js'
import {
  isMcpServerCommandEntry,
  isMcpServerNameEntry,
  isMcpServerUrlEntry,
} from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { feature } from 'bun:bundle'
import { fetchClaudeAIMcpConfigsIfEligible } from './claudeai.js'
import { getProjectMcpServerStatus } from './utils.js'

/**
 * Configure the MCP config runtime with TUI-native implementations.
 * Call once during app startup (e.g., inside the init() function).
 */
export function configureTuiMcpConfigRuntime(): void {
  configureMcpConfigRuntime({
    configStore: createConfigStore(),
    settings: createSettingsProvider(),
    plugins: createPluginProvider(),
    claudeAi: createClaudeAiProvider(),
    getCwd,
    logDebug: (msg, opts) => logForDebugging(msg, opts),
    logError: (error) => {
      if (error instanceof Error) {
        logError(error)
      } else {
        logError(new Error(String(error)))
      }
    },
  })
}

// ─── Config Store ───────────────────────────────────────────────────────────

function createConfigStore(): McpServerConfigStore {
  return {
    getUserMcpServers() {
      return getGlobalConfig().mcpServers
    },

    saveUserMcpServers(servers: Record<string, McpServerConfig>) {
      saveGlobalConfig(current => ({
        ...current,
        mcpServers: servers,
      }))
    },

    getLocalMcpServers() {
      return getCurrentProjectConfig().mcpServers
    },

    saveLocalMcpServers(servers: Record<string, McpServerConfig>) {
      saveCurrentProjectConfig(current => ({
        ...current,
        mcpServers: servers,
      }))
    },

    readMcpJsonFile(filePath: string): McpJsonConfig | null {
      const fs = getFsImplementation()
      try {
        const content = fs.readFileSync(filePath, { encoding: 'utf8' })
        const parsed = safeParseJSON(content)
        if (!parsed) return null

        const result = McpJsonConfigSchema().safeParse(parsed)
        return result.success ? result.data : null
      } catch (error: unknown) {
        const code = getErrnoCode(error)
        if (code === 'ENOENT') return null
        logForDebugging(
          `MCP config read error for ${filePath}: ${error}`,
          { level: 'error' },
        )
        return null
      }
    },

    async writeMcpJsonFile(config: McpJsonConfig, cwd: string): Promise<void> {
      const mcpJsonPath = join(cwd, '.mcp.json')

      let existingMode: number | undefined
      try {
        const stats = await stat(mcpJsonPath)
        existingMode = stats.mode
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'ENOENT') throw e
      }

      const tempPath = `${mcpJsonPath}.tmp.${process.pid}.${Date.now()}`
      const handle = await open(tempPath, 'w', existingMode ?? 0o644)
      try {
        await handle.writeFile(jsonStringify(config, null, 2), {
          encoding: 'utf8',
        })
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
      return join(getManagedFilePath(), 'managed-mcp.json')
    },

    getDisabledMcpServers() {
      return getCurrentProjectConfig().disabledMcpServers ?? []
    },

    getEnabledMcpServers() {
      return getCurrentProjectConfig().enabledMcpServers ?? []
    },

    saveDisabledMcpServers(disabled: string[]) {
      saveCurrentProjectConfig(current => ({
        ...current,
        disabledMcpServers: disabled,
      }))
    },

    saveEnabledMcpServers(enabled: string[]) {
      saveCurrentProjectConfig(current => ({
        ...current,
        enabledMcpServers: enabled,
      }))
    },

    isDefaultDisabledBuiltin(name: string): boolean {
      return feature('CHICAGO_MCP') ? name === feature('CHICAGO_MCP') : false
    },
  }
}

// ─── Settings Provider ──────────────────────────────────────────────────────

function createSettingsProvider(): McpServerSettingsProvider {
  return {
    getAllowlist() {
      const settings = this.isManagedOnly()
        ? (getSettingsForSource('policySettings') ?? {})
        : getInitialSettings()
      return settings.allowedMcpServers as McpServerPolicyEntryCompat[] | undefined
    },

    getDenylist() {
      return getInitialSettings().deniedMcpServers as McpServerPolicyEntryCompat[] | undefined
    },

    isManagedOnly() {
      const policySettings = getSettingsForSource('policySettings')
      return policySettings?.allowManagedMcpServersOnly === true
    },

    isPluginOnlyLocked() {
      return isRestrictedToPluginOnly('mcp')
    },

    isSourceEnabled(source: string) {
      return isSettingSourceEnabled(source as Parameters<typeof isSettingSourceEnabled>[0])
    },

    getProjectApprovalStatus(serverName: string): 'approved' | 'rejected' | 'pending' {
      return getProjectMcpServerStatus(serverName)
    },
  }
}

// ─── Plugin Provider ────────────────────────────────────────────────────────

function createPluginProvider(): McpPluginServerProvider {
  return {
    async loadPluginMcpServers() {
      const result = await loadAllPluginsCacheOnly()
      const servers: Record<string, ScopedMcpServerConfig> = {}
      const mcpErrors: PluginErrorType[] = []

      for (const plugin of result.enabled) {
        const pluginServers = await getPluginMcpServers(plugin, mcpErrors)
        if (pluginServers) {
          Object.assign(servers, pluginServers)
        }
      }

      return { servers, suppressed: [] }
    },
  }
}

// ─── Claude.ai Provider ─────────────────────────────────────────────────────

function createClaudeAiProvider(): McpClaudeAiServerProvider {
  return {
    isEligible() {
      return true // fetchClaudeAIMcpConfigsIfEligible handles env gating internally
    },

    async fetchConfigs() {
      const servers = await fetchClaudeAIMcpConfigsIfEligible()
      return servers ?? {}
    },
  }
}

// ─── Type compatibility helpers ─────────────────────────────────────────────

import type { ScopedMcpServerConfig } from '@codepilotx/core/services/mcp/types.js'
import type { McpServerPolicyEntry } from '@codepilotx/core/services/mcp/configRuntime.js'

// Bridge type: the TUI's settings types have the same shape but use a different import path.
// We widen through unknown to avoid requiring a shared schema dependency.
type McpServerPolicyEntryCompat = McpServerPolicyEntry & Record<string, unknown>

// PluginError from TUI's plugin system — kept as a local type to avoid
// importing the full TUI plugin types into the core boundary.
type PluginErrorType = {
  type: string
  source: string
  plugin: string
  serverName: string
  duplicateOf: string
  [key: string]: unknown
}

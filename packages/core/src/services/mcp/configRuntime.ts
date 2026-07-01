import type {
  McpJsonConfig,
  McpServerConfig,
  ScopedMcpServerConfig,
} from './types.js'

/**
 * Policy entry for MCP server allowlist/denylist.
 * Exactly one of serverName / serverCommand / serverUrl should be set.
 */
export type McpServerPolicyEntry = {
  serverName?: string
  serverCommand?: string[]
  serverUrl?: string
}

/**
 * Storage abstraction for reading/writing MCP server configurations.
 *
 * Both TUI and Desktop implement this against their own config file paths.
 * TUI's implementation wraps getGlobalConfig/saveGlobalConfig and friends;
 * Desktop's implementation reads the same ~/.codepilotx/.config.json file directly.
 */
export type McpServerConfigStore = {
  /* ── user scope (~/.codepilotx/.config.json) ── */
  getUserMcpServers(): Record<string, McpServerConfig> | undefined
  saveUserMcpServers(servers: Record<string, McpServerConfig>): void | Promise<void>

  /* ── local (project) scope ── */
  getLocalMcpServers(): Record<string, McpServerConfig> | undefined
  saveLocalMcpServers(servers: Record<string, McpServerConfig>): void | Promise<void>

  /* ── project scope (.mcp.json files) ── */
  /** Read .mcp.json from an absolute path; returns null if file is missing. */
  readMcpJsonFile(filePath: string): McpJsonConfig | null
  /** Atomically write .mcp.json in the given working directory. */
  writeMcpJsonFile(config: McpJsonConfig, cwd: string): Promise<void>

  /* ── enterprise ── */
  getEnterpriseMcpFilePath(): string

  /* ── enabled/disabled toggle state ── */
  getDisabledMcpServers(): string[]
  getEnabledMcpServers(): string[]
  saveDisabledMcpServers(disabled: string[]): void | Promise<void>
  saveEnabledMcpServers(enabled: string[]): void | Promise<void>

  /**
   * Optional: checks whether a server name is a builtin that is disabled by
   * default (e.g., CHICAGO_MCP feature-gated server). TUI implements this via
   * bun:bundle feature flags; Desktop can omit (returns false).
   */
  isDefaultDisabledBuiltin?(name: string): boolean
}

/**
 * Settings/policy abstraction for MCP allowlist/denylist rules.
 * Returns settings data from the appropriate source(s) depending on
 * whether allowManagedMcpServersOnly is in effect.
 */
export type McpServerSettingsProvider = {
  /** Allowed servers list (from managed or merged settings). */
  getAllowlist(): McpServerPolicyEntry[] | undefined
  /** Denied servers list (always from merged settings). */
  getDenylist(): McpServerPolicyEntry[] | undefined
  /** True when allowManagedMcpServersOnly is set in policy settings. */
  isManagedOnly(): boolean
  /** True when MCP customization is restricted to plugins only. */
  isPluginOnlyLocked(): boolean
  /** True when a given setting source (userSettings/projectSettings/localSettings) is enabled. */
  isSourceEnabled(source: string): boolean
  /** Get the approval status of a project .mcp.json server. */
  getProjectApprovalStatus(serverName: string): 'approved' | 'rejected' | 'pending'
}

/**
 * Optional provider for plugin MCP servers (TUI only; Desktop omits this).
 */
export type McpPluginServerProvider = {
  loadPluginMcpServers(): Promise<{
    servers: Record<string, ScopedMcpServerConfig>
    suppressed: Array<{ name: string; duplicateOf: string }>
  }>
}

/**
 * Optional provider for Claude.ai MCP connectors (TUI only; Desktop omits this).
 */
export type McpClaudeAiServerProvider = {
  isEligible(): boolean
  fetchConfigs(): Promise<Record<string, ScopedMcpServerConfig>>
}

/**
 * Combined runtime dependencies for core MCP config functions.
 *
 * configStore is required; all other fields are optional. When a field is
 * omitted, the corresponding feature is unavailable (e.g., Desktop omits
 * plugins/claudeAi, and the core functions will skip those scopes).
 */
export type McpConfigRuntime = {
  configStore: McpServerConfigStore
  settings?: McpServerSettingsProvider
  plugins?: McpPluginServerProvider
  claudeAi?: McpClaudeAiServerProvider
  getCwd?: () => string
  logDebug?: (message: string, opts?: { level?: string }) => void
  logError?: (error: unknown) => void
}

// ─── Module-level runtime state (following ProviderConfigRuntime pattern) ───

let runtime: McpConfigRuntime | null = null

/**
 * Configure the MCP config runtime. Must be called once during app startup
 * before any core MCP config functions are used.
 */
export function configureMcpConfigRuntime(
  nextRuntime: McpConfigRuntime,
): void {
  runtime = { ...nextRuntime }
  clearRuntimeCacheForTests()
}

/**
 * Temporarily override the runtime for the duration of `run()`.
 * Handles both sync and async callbacks, restoring the previous runtime
 * afterwards.
 */
export function withMcpConfigRuntime<T>(
  nextRuntime: McpConfigRuntime,
  run: () => T,
): T {
  const previousRuntime = runtime
  runtime = { ...nextRuntime }
  try {
    const result = run()
    if (isPromiseLike(result)) {
      return (result as unknown as Promise<unknown>).finally(() => {
        runtime = previousRuntime
      }) as T
    }
    runtime = previousRuntime
    return result
  } catch (error) {
    runtime = previousRuntime
    throw error
  }
}

/** Get the current runtime (for use by core config functions). */
export function getMcpConfigRuntime(): McpConfigRuntime | null {
  return runtime
}

/**
 * Require the runtime to be configured; throws a descriptive error if not.
 */
export function requireMcpConfigRuntime(): McpConfigRuntime {
  if (!runtime) {
    throw new Error(
      'MCP config runtime is not configured. Call configureMcpConfigRuntime() during app startup.',
    )
  }
  return runtime
}

// ─── Internal helpers ───

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}

/** Clear caches in tests after changing runtime. */
function clearRuntimeCacheForTests(): void {
  // Placeholder — policy functions that memoize on the runtime can be cleared here.
}

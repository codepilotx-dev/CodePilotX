import {
  dedupClaudeAiMcpServers,
  dedupPluginMcpServers,
  filterMcpServersByPolicy,
  isMcpServerAllowedByPolicy,
  isMcpServerDenied,
} from './policy.js'
import type { McpServerPolicyEntry } from './configRuntime.js'
import { requireMcpConfigRuntime } from './configRuntime.js'
import type {
  ConfigScope,
  McpJsonConfig,
  McpServerConfig,
  ScopedMcpServerConfig,
} from './types.js'
import { McpJsonConfigSchema, McpServerConfigSchema } from './types.js'
import { expandEnvVars } from './envExpansion.js'

// ─── Public types ───────────────────────────────────────────────────────────

export type AllMcpConfigs = {
  servers: Record<string, ScopedMcpServerConfig>
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function addScopeToServers(
  servers: Record<string, McpServerConfig> | undefined,
  scope: ConfigScope,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) return {}
  const scoped: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    scoped[name] = { ...config, scope }
  }
  return scoped
}

// ─── Enterprise config ──────────────────────────────────────────────────────

/**
 * Get the path to the managed MCP configuration file.
 */
export function getEnterpriseMcpFilePath(): string {
  return requireMcpConfigRuntime().configStore.getEnterpriseMcpFilePath()
}

// ─── Parsing ────────────────────────────────────────────────────────────────

export type McpConfigParseResult = {
  config: McpJsonConfig | null
  errors: string[]
}

/**
 * Parse and validate an MCP configuration object.
 */
export function parseMcpConfig(params: {
  configObject: unknown
  expandVars: boolean
  scope: ConfigScope
  filePath?: string
}): McpConfigParseResult {
  const { configObject, expandVars, scope, filePath } = params
  const errors: string[] = []

  const schemaResult = McpJsonConfigSchema().safeParse(configObject)
  if (!schemaResult.success) {
    const fileInfo = filePath ? ` (${filePath})` : ''
    errors.push(
      `Invalid MCP server configuration${fileInfo}: ${schemaResult.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join(', ')}`,
    )
    return { config: null, errors }
  }

  const validatedServers: Record<string, McpServerConfig> = {}
  for (const [name, config] of Object.entries(schemaResult.data.mcpServers)) {
    let configToCheck = config

    if (expandVars) {
      const { expanded, missingVars } = expandEnvVars(config as Record<string, unknown>)
      if (missingVars.length > 0 && missingVars.length > 0) {
        errors.push(
          `Server "${name}" references missing environment variables: ${missingVars.join(', ')}`,
        )
      }
      configToCheck = expanded as McpServerConfig
    }

    validatedServers[name] = configToCheck
  }

  return { config: { mcpServers: validatedServers }, errors }
}

/**
 * Parse and validate an MCP configuration from a file path.
 */
export function parseMcpConfigFromFilePath(params: {
  filePath: string
  expandVars: boolean
  scope: ConfigScope
}): McpConfigParseResult {
  const { filePath, expandVars, scope } = params
  const store = requireMcpConfigRuntime().configStore

  const mcpJson = store.readMcpJsonFile(filePath)
  if (!mcpJson) {
    return { config: null, errors: [`MCP config file not found: ${filePath}`] }
  }

  return parseMcpConfig({
    configObject: mcpJson,
    expandVars,
    scope,
    filePath,
  })
}

/**
 * Check whether an enterprise MCP config file exists and is valid.
 */
let enterpriseConfigExistsMemo: boolean | undefined

export function doesEnterpriseMcpConfigExist(): boolean {
  if (enterpriseConfigExistsMemo !== undefined) {
    return enterpriseConfigExistsMemo
  }
  const runtime = requireMcpConfigRuntime()
  const filePath = runtime.configStore.getEnterpriseMcpFilePath()
  const { config } = parseMcpConfigFromFilePath({
    filePath,
    expandVars: true,
    scope: 'enterprise',
  })
  enterpriseConfigExistsMemo = config !== null
  return enterpriseConfigExistsMemo
}

/** Clear the memoized enterprise config check (useful in tests). */
export function clearEnterpriseConfigCache(): void {
  enterpriseConfigExistsMemo = undefined
}

// ─── Scope-based config loading ─────────────────────────────────────────────

/**
 * Get MCP configs from current directory only (no parent traversal).
 */
export function getProjectMcpConfigsFromCwd(): {
  servers: Record<string, ScopedMcpServerConfig>
} {
  const runtime = requireMcpConfigRuntime()

  if (runtime.settings && !runtime.settings.isSourceEnabled('projectSettings')) {
    return { servers: {} }
  }

  const cwd = runtime.getCwd?.()
  if (!cwd) {
    return { servers: {} }
  }

  const mcpJsonPath = joinPaths(cwd, '.mcp.json')
  const { config, errors } = parseMcpConfigFromFilePath({
    filePath: mcpJsonPath,
    expandVars: true,
    scope: 'project',
  })

  if (!config) {
    const nonMissing = errors.filter(
      e => !e.startsWith('MCP config file not found'),
    )
    if (nonMissing.length > 0) {
      runtime.logDebug?.(
        `MCP config errors for ${mcpJsonPath}: ${JSON.stringify(nonMissing)}`,
        { level: 'error' },
      )
    }
    return { servers: {} }
  }

  return {
    servers: config.mcpServers
      ? addScopeToServers(config.mcpServers, 'project')
      : {},
  }
}

/**
 * Get all MCP configurations from a specific scope.
 */
export function getMcpConfigsByScope(
  scope: 'project' | 'user' | 'local' | 'enterprise',
): {
  servers: Record<string, ScopedMcpServerConfig>
} {
  const runtime = requireMcpConfigRuntime()
  const store = runtime.configStore

  if (runtime.settings) {
    const sourceMap: Record<string, string> = {
      project: 'projectSettings',
      user: 'userSettings',
      local: 'localSettings',
    }
    if (scope in sourceMap && !runtime.settings.isSourceEnabled(sourceMap[scope]!)) {
      return { servers: {} }
    }
  }

  switch (scope) {
    case 'project': {
      const allServers: Record<string, ScopedMcpServerConfig> = {}
      const cwd = runtime.getCwd?.()
      if (!cwd) return { servers: {} }

      // Traverse up from CWD to root, collecting .mcp.json files
      const dirs: string[] = []
      let currentDir = cwd
      const root = parseRoot(currentDir)
      while (currentDir !== root) {
        dirs.push(currentDir)
        currentDir = dirname(currentDir)
      }

      // Process from root downward to CWD (files closer to CWD override parents)
      for (const dir of dirs.reverse()) {
        const mcpJsonPath = joinPaths(dir, '.mcp.json')
        const { config: mcpJson } = parseMcpConfigFromFilePath({
          filePath: mcpJsonPath,
          expandVars: true,
          scope: 'project',
        })
        if (!mcpJson?.mcpServers) continue
        Object.assign(
          allServers,
          addScopeToServers(mcpJson.mcpServers, 'project'),
        )
      }

      return { servers: allServers }
    }

    case 'user': {
      const { config } = parseMcpConfig({
        configObject: { mcpServers: store.getUserMcpServers() ?? {} },
        expandVars: true,
        scope: 'user',
      })
      const mcpServers = config?.mcpServers
      if (!mcpServers) return { servers: {} }
      return { servers: addScopeToServers(mcpServers, 'user') }
    }

    case 'local': {
      const { config } = parseMcpConfig({
        configObject: { mcpServers: store.getLocalMcpServers() ?? {} },
        expandVars: true,
        scope: 'local',
      })
      const mcpServers = config?.mcpServers
      if (!mcpServers) return { servers: {} }
      return { servers: addScopeToServers(mcpServers, 'local') }
    }

    case 'enterprise': {
      const filePath = store.getEnterpriseMcpFilePath()
      const { config } = parseMcpConfigFromFilePath({
        filePath,
        expandVars: true,
        scope: 'enterprise',
      })
      if (!config) return { servers: {} }
      return {
        servers: config.mcpServers
          ? addScopeToServers(config.mcpServers, 'enterprise')
          : {},
      }
    }

    default:
      return { servers: {} }
  }
}

/**
 * Get an MCP server configuration by name, checking all scopes.
 */
export function getMcpConfigByName(
  name: string,
): ScopedMcpServerConfig | null {
  const runtime = requireMcpConfigRuntime()

  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  // When MCP is locked to plugin-only, only enterprise servers are reachable by name
  if (runtime.settings?.isPluginOnlyLocked()) {
    return enterpriseServers[name] ?? null
  }

  const { servers: userServers } = getMcpConfigsByScope('user')
  const { servers: projectServers } = getMcpConfigsByScope('project')
  const { servers: localServers } = getMcpConfigsByScope('local')

  return (
    enterpriseServers[name] ??
    localServers[name] ??
    projectServers[name] ??
    userServers[name] ??
    null
  )
}

// ─── CodePilotX / Claude Code configs ───────────────────────────────────────

/**
 * Get CodePilotX MCP configurations (excludes claude.ai servers).
 * Priority (lowest → highest): plugin < user < project < local
 */
export async function getCodePilotXMcpConfigs(
  dynamicServers: Record<string, ScopedMcpServerConfig> = {},
): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
}> {
  const runtime = requireMcpConfigRuntime()
  const store = runtime.configStore
  const settings = runtime.settings

  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  // Enterprise mode: only enterprise servers, filtered by policy
  if (doesEnterpriseMcpConfigExist()) {
    const deniedEntries = settings?.getDenylist()
    const allowedEntries = settings?.getAllowlist()

    const filtered: Record<string, ScopedMcpServerConfig> = {}
    for (const [name, serverConfig] of Object.entries(enterpriseServers)) {
      if (
        isMcpServerAllowedByPolicy(
          name,
          allowedEntries,
          deniedEntries,
          serverConfig,
        )
      ) {
        filtered[name] = serverConfig
      }
    }
    return { servers: filtered }
  }

  // Check if MCP is locked to plugin-only
  const mcpLocked = settings?.isPluginOnlyLocked() ?? false
  const noServers: { servers: Record<string, ScopedMcpServerConfig> } = {
    servers: {},
  }

  const { servers: userServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('user')
  const { servers: projectServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('project')
  const { servers: localServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('local')

  // Load plugin MCP servers (if provider is configured)
  const pluginMcpServers: Record<string, ScopedMcpServerConfig> = {}
  if (runtime.plugins) {
    const { servers } = await runtime.plugins.loadPluginMcpServers()
    Object.assign(pluginMcpServers, servers)
  }

  // Filter project servers to only include approved ones
  const approvalStatus = settings?.getProjectApprovalStatus.bind(settings)
  const approvedProjectServers: Record<string, ScopedMcpServerConfig> = {}
  if (approvalStatus) {
    for (const [name, config] of Object.entries(projectServers)) {
      if (approvalStatus(name) === 'approved') {
        approvedProjectServers[name] = config
      }
    }
  } else {
    // No approval system available — include all project servers
    Object.assign(approvedProjectServers, projectServers)
  }

  // Enablement check helper
  const isDisabled = (name: string) => isMcpServerDisabled(name)

  // Split enabled vs disabled plugin servers for dedup
  const deniedEntries = settings?.getDenylist()
  const allowedEntries = settings?.getAllowlist()

  const enabledManualServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries({
    ...userServers,
    ...approvedProjectServers,
    ...localServers,
    ...dynamicServers,
  })) {
    if (
      !isDisabled(name) &&
      isMcpServerAllowedByPolicy(name, allowedEntries, deniedEntries, config)
    ) {
      enabledManualServers[name] = config
    }
  }

  const enabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  const disabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(pluginMcpServers)) {
    if (
      isDisabled(name) ||
      !isMcpServerAllowedByPolicy(name, allowedEntries, deniedEntries, config)
    ) {
      disabledPluginServers[name] = config
    } else {
      enabledPluginServers[name] = config
    }
  }

  const { servers: dedupedPluginServers } = dedupPluginMcpServers(
    enabledPluginServers,
    enabledManualServers,
  )
  Object.assign(dedupedPluginServers, disabledPluginServers)

  // Merge in order of precedence: plugin < user < project < local
  const configs = Object.assign(
    {},
    dedupedPluginServers,
    userServers,
    approvedProjectServers,
    localServers,
    dynamicServers,
  )

  // Apply policy filtering
  const filtered: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, serverConfig] of Object.entries(configs)) {
    if (
      isMcpServerAllowedByPolicy(
        name,
        allowedEntries,
        deniedEntries,
        serverConfig as McpServerConfig,
      )
    ) {
      filtered[name] = serverConfig as ScopedMcpServerConfig
    }
  }

  return { servers: filtered }
}

// ─── All configs (including claude.ai) ──────────────────────────────────────

/**
 * Get all MCP configurations across all scopes, including claude.ai servers.
 */
export async function getAllMcpConfigs(): Promise<AllMcpConfigs> {
  const runtime = requireMcpConfigRuntime()

  // In enterprise mode, don't load claude.ai servers
  if (doesEnterpriseMcpConfigExist()) {
    const { servers } = await getCodePilotXMcpConfigs()
    return { servers }
  }

  // Try to fetch claude.ai connectors if provider is available
  let claudeAiServers: Record<string, ScopedMcpServerConfig> = {}
  if (runtime.claudeAi && runtime.claudeAi.isEligible()) {
    try {
      claudeAiServers = await runtime.claudeAi.fetchConfigs()
    } catch {
      // Claude.ai fetch failure is non-fatal
    }
  }

  const { servers: claudeCodeServers } = await getCodePilotXMcpConfigs()

  // Apply policy and dedup to claude.ai servers
  const deniedEntries = runtime.settings?.getDenylist()
  const allowedEntries = runtime.settings?.getAllowlist()
  const { allowed: filteredClaudeAi } = filterMcpServersByPolicy(
    claudeAiServers,
    allowedEntries,
    deniedEntries,
  )

  const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
    filteredClaudeAi,
    claudeCodeServers,
    (name) => isMcpServerDisabled(name),
  )

  // Merge with claude.ai having lowest precedence
  const servers = Object.assign({}, dedupedClaudeAi, claudeCodeServers)

  return { servers }
}

// ─── Add / Remove ───────────────────────────────────────────────────────────

/**
 * Add an MCP server configuration.
 */
export async function addMcpConfig(
  name: string,
  config: unknown,
  scope: ConfigScope,
): Promise<void> {
  if (name.match(/[^a-zA-Z0-9_-]/)) {
    throw new Error(
      `Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }

  const runtime = requireMcpConfigRuntime()
  const store = runtime.configStore

  // Block reserved server name "claude-in-chrome"
  if (name === 'claude-in-chrome') {
    throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
  }

  // Check if default-disabled builtin exists
  if (store.isDefaultDisabledBuiltin?.(name)) {
    throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
  }

  // Block adding servers when enterprise MCP config exists
  if (doesEnterpriseMcpConfigExist()) {
    throw new Error(
      `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`,
    )
  }

  // Validate config
  const result = McpServerConfigSchema().safeParse(config)
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join(', ')
    throw new Error(`Invalid configuration: ${formattedErrors}`)
  }
  const validatedConfig = result.data

  // Check denylist
  const deniedEntries = runtime.settings?.getDenylist()
  if (isMcpServerDenied(name, deniedEntries, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": server is explicitly blocked by enterprise policy`,
    )
  }

  // Check allowlist
  const allowedEntries = runtime.settings?.getAllowlist()
  if (
    !isMcpServerAllowedByPolicy(
      name,
      allowedEntries,
      deniedEntries,
      validatedConfig,
    )
  ) {
    throw new Error(
      `Cannot add MCP server "${name}": not allowed by enterprise policy`,
    )
  }

  // Check if server already exists in the target scope
  switch (scope) {
    case 'project': {
      const { servers } = getProjectMcpConfigsFromCwd()
      if (servers[name]) {
        throw new Error(`MCP server ${name} already exists in .mcp.json`)
      }
      break
    }
    case 'user': {
      const userServers = store.getUserMcpServers()
      if (userServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in user config`)
      }
      break
    }
    case 'local': {
      const localServers = store.getLocalMcpServers()
      if (localServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in local config`)
      }
      break
    }
    case 'dynamic':
      throw new Error('Cannot add MCP server to scope: dynamic')
    case 'enterprise':
      throw new Error('Cannot add MCP server to scope: enterprise')
    case 'claudeai':
      throw new Error('Cannot add MCP server to scope: claudeai')
  }

  // Write based on scope
  switch (scope) {
    case 'project': {
      const cwd = runtime.getCwd?.()
      if (!cwd) {
        throw new Error('Cannot add project-scoped MCP server: no working directory')
      }
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()
      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        const { scope: _, ...configWithoutScope } = serverConfig
        mcpServers[serverName] = configWithoutScope
      }
      mcpServers[name] = validatedConfig
      await store.writeMcpJsonFile({ mcpServers }, cwd)
      break
    }

    case 'user': {
      const userServers = store.getUserMcpServers() ?? {}
      await store.saveUserMcpServers({
        ...userServers,
        [name]: validatedConfig,
      })
      break
    }

    case 'local': {
      const localServers = store.getLocalMcpServers() ?? {}
      await store.saveLocalMcpServers({
        ...localServers,
        [name]: validatedConfig,
      })
      break
    }

    default:
      throw new Error(`Cannot add MCP server to scope: ${scope}`)
  }
}

/**
 * Remove an MCP server configuration.
 */
export async function removeMcpConfig(
  name: string,
  scope: ConfigScope,
): Promise<void> {
  const runtime = requireMcpConfigRuntime()
  const store = runtime.configStore

  switch (scope) {
    case 'project': {
      const cwd = runtime.getCwd?.()
      if (!cwd) {
        throw new Error('Cannot remove project-scoped MCP server: no working directory')
      }
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()
      if (!existingServers[name]) {
        throw new Error(`No MCP server found with name: ${name} in .mcp.json`)
      }
      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        if (serverName !== name) {
          const { scope: _, ...configWithoutScope } = serverConfig
          mcpServers[serverName] = configWithoutScope
        }
      }
      await store.writeMcpJsonFile({ mcpServers }, cwd)
      break
    }

    case 'user': {
      const userServers = store.getUserMcpServers()
      if (!userServers?.[name]) {
        throw new Error(`No user-scoped MCP server found with name: ${name}`)
      }
      const { [name]: _, ...rest } = userServers
      await store.saveUserMcpServers(rest)
      break
    }

    case 'local': {
      const localServers = store.getLocalMcpServers()
      if (!localServers?.[name]) {
        throw new Error(`No project-local MCP server found with name: ${name}`)
      }
      const { [name]: _, ...rest } = localServers
      await store.saveLocalMcpServers(rest)
      break
    }

    default:
      throw new Error(`Cannot remove MCP server from scope: ${scope}`)
  }
}

// ─── Enable / Disable ───────────────────────────────────────────────────────

/**
 * Check if an MCP server is disabled.
 */
export function isMcpServerDisabled(name: string): boolean {
  const store = requireMcpConfigRuntime().configStore

  if (store.isDefaultDisabledBuiltin?.(name)) {
    const enabledServers = store.getEnabledMcpServers()
    return !enabledServers.includes(name)
  }

  const disabledServers = store.getDisabledMcpServers()
  return disabledServers.includes(name)
}

/**
 * Enable or disable an MCP server.
 */
export async function setMcpServerEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  const store = requireMcpConfigRuntime().configStore

  const isBuiltinStateChange =
    store.isDefaultDisabledBuiltin?.(name) &&
    isMcpServerDisabled(name) === enabled

  if (store.isDefaultDisabledBuiltin?.(name)) {
    const prev = store.getEnabledMcpServers()
    const next = toggleMembership(prev, name, enabled)
    if (next !== prev) {
      await store.saveEnabledMcpServers(next)
    }
  } else {
    const prev = store.getDisabledMcpServers()
    const next = toggleMembership(prev, name, !enabled)
    if (next !== prev) {
      await store.saveDisabledMcpServers(next)
    }
  }

  if (isBuiltinStateChange) {
    runtimeLogger?.(
      `Builtin MCP server "${name}" ${enabled ? 'enabled' : 'disabled'}`,
    )
  }
}

// ─── Internal utilities ─────────────────────────────────────────────────────

let runtimeLogger: ((msg: string) => void) | undefined

/** Set a logger for runtime events (used by adapters). */
export function setMcpConfigLogger(logger: (msg: string) => void): void {
  runtimeLogger = logger
}

function toggleMembership(
  list: string[],
  name: string,
  shouldContain: boolean,
): string[] {
  const contains = list.includes(name)
  if (contains === shouldContain) return list
  return shouldContain ? [...list, name] : list.filter(s => s !== name)
}

// ─── Path utilities (portable alternative to node:path) ─────────────────────

function joinPaths(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  if (/^[a-zA-Z]:$/.test(normalized)) return `${normalized}/`
  const lastSlash = normalized.lastIndexOf('/')
  if (/^[a-zA-Z]:\//.test(normalized) && lastSlash <= 2) {
    return `${normalized.slice(0, 2)}/`
  }
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash) || '/'
}

function parseRoot(path: string): string {
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    // Windows: C:/
    return `${path.charAt(0)}:/`
  }
  return '/'
}

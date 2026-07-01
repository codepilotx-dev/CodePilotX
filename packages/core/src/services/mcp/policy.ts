import type {
  McpServerConfig,
  McpStdioServerConfig,
  ScopedMcpServerConfig,
} from './types.js'
import type { McpServerPolicyEntry } from './configRuntime.js'

// ─── Extracting server identity ─────────────────────────────────────────────

/**
 * Extract command array from server config (stdio servers only).
 * Returns null for non-stdio servers.
 */
export function getServerCommandArray(
  config: McpServerConfig,
): string[] | null {
  if (config.type !== undefined && config.type !== 'stdio') {
    return null
  }
  const stdioConfig = config as McpStdioServerConfig
  return [stdioConfig.command, ...(stdioConfig.args ?? [])]
}

/**
 * Check if two command arrays match exactly.
 */
export function commandArraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * Extract URL from server config (remote servers only).
 * Returns null for stdio/sdk servers.
 */
export function getServerUrl(config: McpServerConfig): string | null {
  return 'url' in config ? config.url : null
}

// ─── URL pattern matching ───────────────────────────────────────────────────

/**
 * Convert a URL pattern with wildcards to a RegExp.
 * Supports * as wildcard matching any characters.
 */
export function urlPatternToRegex(pattern: string): RegExp {
  // Escape regex special characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  // Replace * with regex equivalent (match any characters)
  const regexStr = escaped.replace(/\*/g, '.*')
  return new RegExp(`^${regexStr}$`)
}

/**
 * Check if a URL matches a pattern with wildcard support.
 */
export function urlMatchesPattern(url: string, pattern: string): boolean {
  const regex = urlPatternToRegex(pattern)
  return regex.test(url)
}

// ─── CCR proxy URL unwrapping ───────────────────────────────────────────────

const CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/ccr-sessions/',
]

/**
 * If the URL is a CCR proxy URL, extract the original vendor URL from the
 * mcp_url query parameter. Otherwise return the URL unchanged.
 */
export function unwrapCcrProxyUrl(url: string): string {
  if (!CCR_PROXY_PATH_MARKERS.some(m => url.includes(m))) {
    return url
  }
  try {
    const parsed = new URL(url)
    const original = parsed.searchParams.get('mcp_url')
    return original || url
  } catch {
    return url
  }
}

// ─── Dedup signature ────────────────────────────────────────────────────────

/**
 * Compute a dedup signature for an MCP server config.
 * Two configs with the same signature are considered "the same server" for
 * deduplication purposes.
 * Returns null for configs with neither command nor url (sdk type, etc.).
 */
export function getMcpServerSignature(config: McpServerConfig): string | null {
  const cmd = getServerCommandArray(config)
  if (cmd) {
    return `stdio:${JSON.stringify(cmd)}`
  }
  const url = getServerUrl(config)
  if (url) {
    return `url:${unwrapCcrProxyUrl(url)}`
  }
  return null
}

// ─── Type guards for policy entries ────────────────────────────────────────

function isNameEntry(
  entry: McpServerPolicyEntry,
): entry is { serverName: string } {
  return 'serverName' in entry && typeof entry.serverName === 'string'
}

function isCommandEntry(
  entry: McpServerPolicyEntry,
): entry is { serverCommand: string[] } {
  return 'serverCommand' in entry && Array.isArray(entry.serverCommand)
}

function isUrlEntry(
  entry: McpServerPolicyEntry,
): entry is { serverUrl: string } {
  return 'serverUrl' in entry && typeof entry.serverUrl === 'string'
}

// ─── Policy checks ──────────────────────────────────────────────────────────

/**
 * Check if an MCP server is denied by enterprise policy.
 * Checks name-based, command-based, and URL-based restrictions.
 */
export function isMcpServerDenied(
  serverName: string,
  deniedMcpServers: McpServerPolicyEntry[] | undefined,
  config?: McpServerConfig,
): boolean {
  if (!deniedMcpServers) {
    return false
  }

  // Check name-based denial
  for (const entry of deniedMcpServers) {
    if (isNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }

  if (config) {
    const serverCommand = getServerCommandArray(config)
    if (serverCommand) {
      for (const entry of deniedMcpServers) {
        if (
          isCommandEntry(entry) &&
          commandArraysMatch(entry.serverCommand, serverCommand)
        ) {
          return true
        }
      }
    }

    const serverUrl = getServerUrl(config)
    if (serverUrl) {
      for (const entry of deniedMcpServers) {
        if (
          isUrlEntry(entry) &&
          urlMatchesPattern(serverUrl, entry.serverUrl)
        ) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Check if an MCP server is allowed by enterprise policy.
 * Denylist takes absolute precedence over allowlist.
 * @returns true if allowed, false if blocked by policy
 */
export function isMcpServerAllowedByPolicy(
  serverName: string,
  allowedMcpServers: McpServerPolicyEntry[] | undefined,
  deniedMcpServers: McpServerPolicyEntry[] | undefined,
  config?: McpServerConfig,
): boolean {
  // Denylist takes absolute precedence
  if (isMcpServerDenied(serverName, deniedMcpServers, config)) {
    return false
  }

  if (!allowedMcpServers) {
    return true // No allowlist restrictions
  }

  // Empty allowlist means block all servers
  if (allowedMcpServers.length === 0) {
    return false
  }

  // Check if allowlist contains any command-based or URL-based entries
  const hasCommandEntries = allowedMcpServers.some(isCommandEntry)
  const hasUrlEntries = allowedMcpServers.some(isUrlEntry)

  if (config) {
    const serverCommand = getServerCommandArray(config)
    const serverUrl = getServerUrl(config)

    if (serverCommand) {
      // This is a stdio server
      if (hasCommandEntries) {
        // If any serverCommand entries exist, stdio servers MUST match one
        for (const entry of allowedMcpServers) {
          if (
            isCommandEntry(entry) &&
            commandArraysMatch(entry.serverCommand, serverCommand)
          ) {
            return true
          }
        }
        return false
      } else {
        // No command entries, check name-based allowance
        for (const entry of allowedMcpServers) {
          if (isNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else if (serverUrl) {
      // This is a remote server (sse, http, ws, etc.)
      if (hasUrlEntries) {
        // If any serverUrl entries exist, remote servers MUST match one
        for (const entry of allowedMcpServers) {
          if (
            isUrlEntry(entry) &&
            urlMatchesPattern(serverUrl, entry.serverUrl)
          ) {
            return true
          }
        }
        return false
      } else {
        // No URL entries, check name-based allowance
        for (const entry of allowedMcpServers) {
          if (isNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else {
      // Unknown server type - check name-based allowance only
      for (const entry of allowedMcpServers) {
        if (isNameEntry(entry) && entry.serverName === serverName) {
          return true
        }
      }
      return false
    }
  }

  // No config provided - check name-based allowance only
  for (const entry of allowedMcpServers) {
    if (isNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }
  return false
}

/**
 * Filter a record of MCP server configs by managed policy.
 * SDK-type servers are exempt — they are SDK-managed transport placeholders.
 * Returns allowed servers and a list of blocked server names.
 */
export function filterMcpServersByPolicy<T>(
  configs: Record<string, T>,
  allowedMcpServers: McpServerPolicyEntry[] | undefined,
  deniedMcpServers: McpServerPolicyEntry[] | undefined,
): {
  allowed: Record<string, T>
  blocked: string[]
} {
  const allowed: Record<string, T> = {}
  const blocked: string[] = []
  for (const [name, config] of Object.entries(configs)) {
    const c = config as McpServerConfig
    if (
      c.type === 'sdk' ||
      isMcpServerAllowedByPolicy(name, allowedMcpServers, deniedMcpServers, c)
    ) {
      allowed[name] = config
    } else {
      blocked.push(name)
    }
  }
  return { allowed, blocked }
}

// ─── Server deduplication ───────────────────────────────────────────────────

/**
 * Dedup plugin MCP servers: drop any whose signature matches a manually
 * configured server or an earlier-loaded plugin server.
 * Manual wins over plugin; between plugins, first-loaded wins.
 */
export function dedupPluginMcpServers(
  pluginServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  const seenPluginSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(pluginServers)) {
    const sig = getMcpServerSignature(config)
    if (sig === null) {
      servers[name] = config
      continue
    }
    const manualDup = manualSigs.get(sig)
    if (manualDup !== undefined) {
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    const pluginDup = seenPluginSigs.get(sig)
    if (pluginDup !== undefined) {
      suppressed.push({ name, duplicateOf: pluginDup })
      continue
    }
    seenPluginSigs.set(sig, name)
    servers[name] = config
  }
  return { servers, suppressed }
}

/**
 * Dedup Claude.ai connectors: drop any whose signature matches an enabled
 * manually-configured server. Manual wins over connectors.
 */
export function dedupClaudeAiMcpServers(
  claudeAiServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
  isDisabled: (name: string) => boolean,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    if (isDisabled(name)) continue
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  for (const [name, config] of Object.entries(claudeAiServers)) {
    const sig = getMcpServerSignature(config)
    const manualDup = sig !== null ? manualSigs.get(sig) : undefined
    if (manualDup !== undefined) {
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    servers[name] = config
  }
  return { servers, suppressed }
}

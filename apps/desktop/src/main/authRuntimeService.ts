import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
} from '@codepilotx/core/utils/auth.js'
import type {
  DesktopAuthStatus,
  DesktopRuntimeStatus,
  DesktopToolchainDiagnosticReport,
} from '../shared/types.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'

/**
 * Read the shared credentials file path (same path the TUI SecureStorage uses).
 */
function sharedCredentialsPath(): string {
  const configDir =
    process.env.CODEPILOTX_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), '.codepilotx')
  return join(configDir.normalize('NFC'), '.credentials.json')
}

/**
 * Check if a GitHub-exchanged app token exists in the shared credentials.
 */
async function hasGithubExchangedToken(): Promise<boolean> {
  try {
    const credPath = sharedCredentialsPath()
    const raw = await readFile(credPath, 'utf8')
    const data = JSON.parse(raw) as Record<string, unknown>
    const oauth = data.claudeAiOauth as
      | { accessToken?: string; source?: string }
      | undefined
    return !!oauth?.accessToken && oauth?.source === 'github_exchange'
  } catch {
    return false
  }
}

/**
 * Get the GitHub-exchanged token info from shared credentials.
 */
async function getGithubExchangedAuthInfo(): Promise<{
  email?: string | null
  organizationName?: string | null
} | null> {
  try {
    const credPath = sharedCredentialsPath()
    const raw = await readFile(credPath, 'utf8')
    const data = JSON.parse(raw) as Record<string, unknown>
    const oauth = data.claudeAiOauth as
      | { accessToken?: string; source?: string }
      | undefined
    if (!oauth?.accessToken || oauth?.source !== 'github_exchange') {
      return null
    }
    // Try to read account info from global config (same path TUI uses)
    const configDir =
      process.env.CODEPILOTX_CONFIG_DIR ??
      process.env.CLAUDE_CONFIG_DIR ??
      join(homedir(), '.codepilotx')
    const configPath = join(configDir.normalize('NFC'), 'config.json')
    try {
      const configRaw = await readFile(configPath, 'utf8')
      const config = JSON.parse(configRaw) as {
        oauthAccount?: {
          emailAddress?: string
          organizationName?: string
        }
      }
      return config.oauthAccount
        ? {
            email: config.oauthAccount.emailAddress,
            organizationName: config.oauthAccount.organizationName,
          }
        : { email: null, organizationName: null }
    } catch {
      return { email: null, organizationName: null }
    }
  } catch {
    return null
  }
}

export async function getAuthStatus(): Promise<DesktopAuthStatus> {
  // First try: existing Anthropic auth (Claude OAuth or API key)
  const tokenSource = getAuthTokenSource()
  const account = getOauthAccountInfo()
  const hasAnthropicAuth = tokenSource.hasToken || hasAnthropicApiKeyAuth()

  if (hasAnthropicAuth) {
    return {
      authenticated: true,
      method: tokenSource.source,
      email: account?.emailAddress ?? null,
      organizationName: account?.organizationName ?? null,
    }
  }

  // Second try: GitHub-exchanged app token
  const hasGithubAuth = await hasGithubExchangedToken()
  if (hasGithubAuth) {
    const info = await getGithubExchangedAuthInfo()
    return {
      authenticated: true,
      method: 'github_exchange',
      email: info?.email ?? null,
      organizationName: info?.organizationName ?? null,
    }
  }

  return {
    authenticated: false,
    method: 'none',
    email: null,
    organizationName: null,
  }
}

export async function getRuntimeStatus(options: {
  agentExecutablePath: string
  configDirectoryPath: string
  runtimePreference: DesktopAgentRuntimePreference
  runtimeSelectionSource: 'default' | 'env'
  toolchainStatus: DesktopToolchainDiagnosticReport
}): Promise<DesktopRuntimeStatus> {
  const runtimeKind = runtimeKindForPreference(options.runtimePreference)
  try {
    const fileStat = await stat(options.agentExecutablePath)
    return {
      runtimeKind,
      runtimePreference: options.runtimePreference,
      runtimeSelectionSource: options.runtimeSelectionSource,
      agentExecutablePath: options.agentExecutablePath,
      agentExecutableExists: fileStat.isFile(),
      subprocessFallbackAvailable: fileStat.isFile(),
      configDirectoryPath: options.configDirectoryPath,
      toolchainEnabled: options.toolchainStatus.enabled,
      toolchainRoot: options.toolchainStatus.root,
      managedToolchainRoot: options.toolchainStatus.managedRoot,
      packagedToolchainRoot: options.toolchainStatus.packagedRoot,
      toolchainPathEntries: options.toolchainStatus.pathEntries,
      toolchainBinaries: options.toolchainStatus.binaries,
    }
  } catch {
    return {
      runtimeKind,
      runtimePreference: options.runtimePreference,
      runtimeSelectionSource: options.runtimeSelectionSource,
      agentExecutablePath: options.agentExecutablePath,
      agentExecutableExists: false,
      subprocessFallbackAvailable: false,
      configDirectoryPath: options.configDirectoryPath,
      toolchainEnabled: options.toolchainStatus.enabled,
      toolchainRoot: options.toolchainStatus.root,
      managedToolchainRoot: options.toolchainStatus.managedRoot,
      packagedToolchainRoot: options.toolchainStatus.packagedRoot,
      toolchainPathEntries: options.toolchainStatus.pathEntries,
      toolchainBinaries: options.toolchainStatus.binaries,
    }
  }
}

function runtimeKindForPreference(
  preference: DesktopAgentRuntimePreference,
): DesktopRuntimeStatus['runtimeKind'] {
  if (preference === 'subprocess') return 'subprocess'
  if (preference === 'embedded-headless') return 'embedded-headless'
  if (preference === 'rust-sidecar') return 'rust-sidecar'
  return 'sidecar'
}

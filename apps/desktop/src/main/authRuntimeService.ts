import { stat } from 'node:fs/promises'
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
import { RustAppServerAuthService } from './rustAppServerAuthService.js'

let readGithubAppTokenStatus = () =>
  new RustAppServerAuthService().readAppTokenStatus('github-repositories')

export function setGithubAppTokenStatusReaderForTesting(
  reader: typeof readGithubAppTokenStatus,
): void {
  readGithubAppTokenStatus = reader
}

export function runtimePreferenceForAuth(
  preference: DesktopAgentRuntimePreference,
  authMethod: string,
): DesktopAgentRuntimePreference {
  return authMethod === 'github_exchange' ? 'rust-sidecar' : preference
}

export async function getAuthStatus(): Promise<DesktopAuthStatus> {
  // GitHub app auth owns the Rust session boundary when present.
  const githubAuth = await readGithubAppTokenStatus().catch(() => null)
  if (githubAuth?.authenticated) {
    return {
      authenticated: true,
      method: 'github_exchange',
      email: githubAuth.account?.emailAddress ?? null,
      organizationName: null,
    }
  }

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
  _preference: DesktopAgentRuntimePreference,
): DesktopRuntimeStatus['runtimeKind'] {
  return 'rust-sidecar'
}

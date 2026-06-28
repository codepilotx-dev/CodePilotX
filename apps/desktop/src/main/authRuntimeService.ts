import { stat } from 'node:fs/promises'
import {
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
} from '@codepilotx/core/utils/auth.js'
import type {
  DesktopAuthStatus,
  DesktopRuntimeStatus,
} from '../shared/types.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'

export function getAuthStatus(): DesktopAuthStatus {
  const tokenSource = getAuthTokenSource()
  const account = getOauthAccountInfo()
  const authenticated = tokenSource.hasToken || hasAnthropicApiKeyAuth()

  return {
    authenticated,
    method: authenticated ? tokenSource.source : 'none',
    email: account?.emailAddress ?? null,
    organizationName: account?.organizationName ?? null,
  }
}

export async function getRuntimeStatus(options: {
  agentExecutablePath: string
  configDirectoryPath: string
  runtimePreference: DesktopAgentRuntimePreference
  runtimeSelectionSource: 'default' | 'env'
}): Promise<DesktopRuntimeStatus> {
  const runtimeKind =
    options.runtimePreference === 'subprocess'
      ? 'subprocess'
      : options.runtimePreference === 'app-server'
        ? 'app-server'
        : 'embedded-headless'
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
    }
  }
}

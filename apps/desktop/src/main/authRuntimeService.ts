import { stat } from 'node:fs/promises'
import {
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
} from '@claudecode/core/utils/auth.js'
import type {
  DesktopAuthStatus,
  DesktopRuntimeStatus,
} from '../shared/types.js'

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
}): Promise<DesktopRuntimeStatus> {
  try {
    const fileStat = await stat(options.agentExecutablePath)
    return {
      runtimeKind: 'subprocess',
      agentExecutablePath: options.agentExecutablePath,
      agentExecutableExists: fileStat.isFile(),
      configDirectoryPath: options.configDirectoryPath,
    }
  } catch {
    return {
      runtimeKind: 'subprocess',
      agentExecutablePath: options.agentExecutablePath,
      agentExecutableExists: false,
      configDirectoryPath: options.configDirectoryPath,
    }
  }
}

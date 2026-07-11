import type {
  InitializeParams,
  InitializeResponse,
} from './rustAppServerProtocol/index.js'
import {
  RUST_APP_SERVER_BINARY_ENV,
  buildRustInitializeParams,
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import { desktopDebug } from './desktopDebug.js'
import { sanitizeChildEnvironment } from './sidecarManager.js'
import {
  listProviderConfigs,
  type ProviderConfig,
} from '@codepilotx/core/models/providerConfig.js'
import { spawn } from 'node:child_process'
import type {
  DesktopProviderBalanceResult,
  DesktopProviderModelListResult,
  McpReloadResult,
} from '../shared/types.js'
import type {
  ProviderAuthAppTokenStatusResponse,
  ProviderAuthAppTokenExchangeResponse,
  ProviderAuthAppTokenRefreshResponse,
  ProviderAuthPollLoginResponse,
  ProviderAuthProfileReadResponse,
  ProviderAuthReadStatusResponse,
  ProviderAuthStartLoginResponse,
  ProviderAuthStatusClearResponse,
  ProviderAuthStatusSetResponse,
  ProviderRepoInfo,
} from './rustAppServerProtocol/generated/v2/index.js'

export type { ProviderRepoInfo }
export type ProviderAuthStatus = ProviderAuthReadStatusResponse
export type ProviderAppTokenStatus = ProviderAuthAppTokenStatusResponse

// ── Auth service ────────────────────────────────────────────

const AUTH_TIMEOUT_MS = 30_000

/**
 * Short-lived control-channel client for provider authentication
 * and GitHub operations. Each method opens a fresh stdio connection
 * to the app-server binary, sends one RPC, and closes.
 *
 * This service is used when no session sidecar is running. Active
 * sessions that already have an app-server connection can use the
 * runtime's client directly for providerAuth RPCs.
 */
export class RustAppServerAuthService {
  private readonly executablePath: string

  constructor() {
    this.executablePath = resolveRustAppServerExecutableInfo().path
  }

  // ── Internal connection helper ────────────────────────────

private async openConnection(): Promise<{
  transport: RustLineJsonRpcClient
  dispose: () => Promise<void>
}> {
  const options = createAuthSidecarOptions(
    this.executablePath,
    await listProviderConfigs(),
  )
  const child = spawn(options.command, options.args, options.options)

  const transport = new RustLineJsonRpcClient({
    input: child.stdout!,
    output: child.stdin!,
  })

  // Wait for initialize handshake
  const initResult = await withTimeout(
    transport.sendRequest('initialize', buildRustInitializeParams()),
    AUTH_TIMEOUT_MS,
    'app-server initialize',
  )
  transport.sendNotification('initialized')

  return {
    transport,
    dispose: async () => {
      try {
        transport.close()
      } catch { /* ignore */ }
      if (!child.killed) {
        child.kill()
      }
    },
  }
}

// ── Common RPC call pattern ─────────────────────────────

private async rpc<T>(method: string, params: unknown): Promise<T> {
  const conn = await this.openConnection()
  try {
    return await withTimeout(
      conn.transport.sendRequest(method, params) as Promise<T>,
      AUTH_TIMEOUT_MS,
      method,
    )
  } finally {
    await conn.dispose()
  }
}

// ── Public API methods ────────────────────────────────────

async readStatus(providerID: string): Promise<ProviderAuthReadStatusResponse> {
  return this.rpc('providerAuth/readStatus', {
    provider_id: providerID,
  })
}

async startLogin(
  providerID: string,
  clientId?: string,
): Promise<ProviderAuthStartLoginResponse> {
  return this.rpc('providerAuth/startLogin', {
    provider_id: providerID,
    client_id: clientId ?? null,
  })
}

async pollLogin(providerID: string): Promise<ProviderAuthPollLoginResponse> {
  return this.rpc('providerAuth/pollLogin', {
    provider_id: providerID,
  })
}

async cancelLogin(providerID: string): Promise<void> {
  await this.rpc('providerAuth/cancelLogin', {
    provider_id: providerID,
  })
}

async logout(providerID: string): Promise<void> {
  await this.rpc('providerAuth/logout', {
    provider_id: providerID,
  })
}

async readConfiguredProviderApiKeyIDs(providerIDs: string[]): Promise<string[]> {
  const result = await this.rpc<{ configured_provider_ids: string[] }>(
    'providerCredential/read',
    { provider_ids: providerIDs },
  )
  return result.configured_provider_ids
}

async saveProviderApiKey(providerID: string, apiKey: string): Promise<void> {
  await this.rpc('providerCredential/save', {
    provider_id: providerID,
    api_key: apiKey,
  })
}

async deleteProviderApiKey(providerID: string): Promise<void> {
  await this.rpc('providerCredential/delete', {
    provider_id: providerID,
  })
}

async fetchProviderModels(options: {
  providerID: string
  baseURL?: string
  apiKey?: string
  defaultModels: string[]
}): Promise<DesktopProviderModelListResult> {
  return this.rpc('providerCredential/models', {
    provider_id: options.providerID,
    base_url: options.baseURL ?? null,
    api_key: options.apiKey ?? null,
    default_models: options.defaultModels,
  })
}

async fetchProviderBalance(options: {
  providerID: string
  baseURL?: string
  apiKey?: string
}): Promise<DesktopProviderBalanceResult> {
  const result = await this.rpc<{
    is_available: boolean
    balances: Array<{
      currency: string
      total_balance: string
      granted_balance: string
      topped_up_balance: string
    }>
    error?: string | null
  }>('providerCredential/balance', {
    provider_id: options.providerID,
    base_url: options.baseURL ?? null,
    api_key: options.apiKey ?? null,
  })
  return {
    isAvailable: result.is_available,
    balances: result.balances.map(balance => ({
      currency: balance.currency,
      totalBalance: balance.total_balance,
      grantedBalance: balance.granted_balance,
      toppedUpBalance: balance.topped_up_balance,
    })),
    ...(result.error ? { error: result.error } : {}),
  }
}

async listRepositories(providerID: string): Promise<ProviderRepoInfo[]> {
  const result = await this.rpc<{ repos: ProviderRepoInfo[] }>(
    'providerAuth/repoList',
    { provider_id: providerID },
  )
  return result.repos
}

async cloneRepository(
  providerID: string,
  repoUrl: string,
  localPath: string,
): Promise<string> {
  const result = await this.rpc<{ local_path: string }>(
    'providerAuth/repoClone',
    {
      provider_id: providerID,
      repo_url: repoUrl,
      local_path: localPath,
    },
  )
  return result.local_path
}

async exchangeAppToken(providerID: string): Promise<ProviderAuthAppTokenExchangeResponse> {
  return this.rpc('providerAuth/appTokenExchange', { providerId: providerID })
}

async refreshAppToken(providerID: string): Promise<ProviderAuthAppTokenRefreshResponse> {
  return this.rpc('providerAuth/appTokenRefresh', { providerId: providerID })
}

async readAppTokenStatus(providerID: string): Promise<ProviderAppTokenStatus> {
  return this.rpc('providerAuth/appTokenStatus', { providerId: providerID })
}

async logoutAppToken(providerID: string): Promise<void> {
  await this.rpc('providerAuth/appTokenLogout', { providerId: providerID })
}

async readProfile(providerID: string): Promise<ProviderAuthProfileReadResponse['overview']> {
  const result = await this.rpc<ProviderAuthProfileReadResponse>('providerAuth/profileRead', {
    providerId: providerID,
  })
  return result.overview
}

async setStatus(providerID: string, input: {
  emoji: string
  message: string
  limitedAvailability: boolean
  expiresAt?: string | null
}): Promise<ProviderAuthStatusSetResponse['status']> {
  const result = await this.rpc<ProviderAuthStatusSetResponse>('providerAuth/statusSet', {
    providerId: providerID,
    ...input,
    expiresAt: input.expiresAt ?? null,
  })
  return result.status
}

async clearStatus(providerID: string): Promise<ProviderAuthStatusClearResponse['status']> {
  const result = await this.rpc<ProviderAuthStatusClearResponse>('providerAuth/statusClear', {
    providerId: providerID,
  })
  return result.status
}
}

// ── Helpers ─────────────────────────────────────────────────

export function createAuthSidecarOptions(
  executablePath: string,
  trustedProviders: ProviderConfig[] = [],
) {
  const command = executablePath
  const args: string[] = [
    '--listen',
    'stdio://',
    ...trustedProviders.flatMap(createTrustedProviderArgs),
  ]
  const options: import('node:child_process').SpawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...sanitizeChildEnvironment(process.env),
      RUST_LOG: process.env.RUST_LOG ?? 'error',
    },
  }
  return { command, args, options }
}

function createTrustedProviderArgs(provider: ProviderConfig): string[] {
  const providerID = provider.providerID.trim()
  const baseURL = provider.baseURL?.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(providerID) || !baseURL) return []
  let endpoint: URL
  try {
    endpoint = new URL(baseURL)
  } catch {
    return []
  }
  if (endpoint.protocol !== 'https:') return []
  const override = (key: string, value: string | boolean): string[] => [
    '-c',
    `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`,
  ]
  return [
    ...override(`model_providers.${providerID}.name`, provider.displayName || providerID),
    ...override(
      `model_providers.${providerID}.wire_api`,
      provider.wireApi ?? 'chat_completions',
    ),
    ...override(`model_providers.${providerID}.requires_openai_auth`, false),
    ...override(`model_providers.${providerID}.supports_websockets`, false),
    ...override(`model_providers.${providerID}.base_url`, endpoint.toString()),
    ...override(`model_providers.${providerID}.env_key`, `keyring:${providerID}`),
  ]
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

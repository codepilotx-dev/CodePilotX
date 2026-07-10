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
import { spawn } from 'node:child_process'
import type {
  DesktopProviderBalanceResult,
  DesktopProviderModelListResult,
  McpReloadResult,
} from '../shared/types.js'

// ── Types matching the Rust protocol responses ───────────────

export type ProviderAuthStatus = {
  authenticated: boolean
  user: { login: string; name?: string; avatar_url?: string } | null
  error: string | null
}

export type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export type ProviderAuthPollResponse = {
  status: 'pending' | 'completed' | 'expired' | 'denied'
  auth: ProviderAuthStatus | null
}

export type ProviderRepoInfo = {
  name: string
  full_name: string
  description: string | null
  private: boolean
  html_url: string
  clone_url: string
  default_branch: string
}

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
  const options = createAuthSidecarOptions(this.executablePath)
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

async readStatus(providerID: string): Promise<ProviderAuthStatus> {
  return this.rpc('providerAuth/readStatus', {
    provider_id: providerID,
  })
}

async startLogin(
  providerID: string,
  clientId?: string,
): Promise<DeviceCodeResponse> {
  return this.rpc('providerAuth/startLogin', {
    provider_id: providerID,
    client_id: clientId ?? null,
  })
}

async pollLogin(providerID: string): Promise<ProviderAuthPollResponse> {
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
}

// ── Helpers ─────────────────────────────────────────────────

export function createAuthSidecarOptions(executablePath: string) {
  const command = executablePath
  const args: string[] = ['--listen', 'stdio://']
  const options: import('node:child_process').SpawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...sanitizeChildEnvironment(process.env),
      RUST_LOG: process.env.RUST_LOG ?? 'error',
    },
  }
  return { command, args, options }
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

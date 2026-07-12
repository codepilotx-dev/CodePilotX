import type {
  InitializeParams,
  InitializeResponse,
} from './rustAppServerProtocol/index.js'
import {
  RUST_APP_SERVER_BINARY_ENV,
  buildRustInitializeParams,
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'
import {
  RustJsonRpcError,
  RustLineJsonRpcClient,
} from './rustLineJsonRpcClient.js'
import { desktopDebug } from './desktopDebug.js'
import { sanitizeChildEnvironment } from './sidecarManager.js'
import { terminateChildProcess } from './childProcessTermination.js'
import { redactRustAppServerControlDiagnostic } from './rustAppServerControlService.js'
import {
  getProviderConfig,
  type ProviderConfig,
} from '@codepilotx/core/models/providerConfig.js'
import { spawn, type ChildProcess } from 'node:child_process'
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
const MAX_PROVIDER_CONNECTIONS = 4

export type AuthSidecarConnection = {
  transport: Pick<RustLineJsonRpcClient, 'sendRequest'>
  closed: Promise<void>
  dispose: () => Promise<void>
}

export type AuthSidecarConnectionFactory = (
  provider?: ProviderConfig,
) => Promise<AuthSidecarConnection>

type AuthServiceOptions = {
  connectionFactory?: AuthSidecarConnectionFactory
  timeoutMs?: number
}

type ProductionConnectionFactoryDependencies = {
  spawnChild?: (
    command: string,
    args: string[],
    options: import('node:child_process').SpawnOptions,
  ) => ChildProcess
  terminateChild?: (child: ChildProcess) => Promise<void>
  debug?: typeof desktopDebug
}

type ConnectionRecord = {
  key: string
  provider: boolean
  connection: AuthSidecarConnection
  inFlight: number
  lastUsed: number
  invalidated: boolean
}

/**
 * Pooled control-channel client for provider authentication, credentials,
 * and GitHub operations. Core RPCs share one connection while provider
 * catalog RPCs use a small provider-specific pool.
 *
 * This service is used when no session sidecar is running. Active
 * sessions that already have an app-server connection can use the
 * runtime's client directly for providerAuth RPCs.
 */
export class RustAppServerAuthService {
  private readonly connectionFactory: AuthSidecarConnectionFactory
  private readonly timeoutMs: number
  private readonly records = new Map<string, ConnectionRecord>()
  private readonly opening = new Map<string, Promise<ConnectionRecord>>()
  private readonly pendingAcquires = new Map<string, number>()
  private useOrder = 0
  private disposed = false
  private disposePromise?: Promise<void>

  constructor(options: AuthServiceOptions = {}) {
    this.connectionFactory =
      options.connectionFactory ??
      createProductionConnectionFactory(resolveRustAppServerExecutableInfo().path)
    this.timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT_MS
  }

  // ── Internal connection helper ────────────────────────────

  private async openRecord(
    key: string,
    provider?: ProviderConfig,
  ): Promise<ConnectionRecord> {
    if (this.disposed) {
      throw new Error('Rust app-server auth service is disposed')
    }
    const current = this.records.get(key)
    if (current && !current.invalidated) return current

    const pending = this.opening.get(key)
    if (pending) return pending

    const opening = (async () => {
      const connection = await this.connectionFactory(provider)
      if (this.disposed) {
        await connection.dispose()
        throw new Error('Rust app-server auth service is disposed')
      }
      const record: ConnectionRecord = {
        key,
        provider: provider !== undefined,
        connection,
        inFlight: 0,
        lastUsed: ++this.useOrder,
        invalidated: false,
      }
      this.records.set(key, record)
      void connection.closed.then(
        () => this.invalidate(record),
        () => this.invalidate(record),
      )
      return record
    })()
    this.opening.set(key, opening)
    try {
      return await opening
    } finally {
      if (this.opening.get(key) === opening) this.opening.delete(key)
    }
  }

  private async acquire(
    key: string,
    provider?: ProviderConfig,
  ): Promise<ConnectionRecord> {
    this.pendingAcquires.set(key, (this.pendingAcquires.get(key) ?? 0) + 1)
    try {
      const record = await this.openRecord(key, provider)
      if (record.invalidated) return this.acquire(key, provider)
      record.inFlight += 1
      record.lastUsed = ++this.useOrder
      return record
    } finally {
      const remaining = (this.pendingAcquires.get(key) ?? 1) - 1
      if (remaining > 0) this.pendingAcquires.set(key, remaining)
      else this.pendingAcquires.delete(key)
      this.evictIdleProviders()
    }
  }

  private release(record: ConnectionRecord): void {
    record.inFlight = Math.max(0, record.inFlight - 1)
    record.lastUsed = ++this.useOrder
    this.evictIdleProviders()
  }

  private invalidate(record: ConnectionRecord): void {
    if (record.invalidated) return
    record.invalidated = true
    if (this.records.get(record.key) === record) this.records.delete(record.key)
    void record.connection.dispose().catch(() => {})
  }

  private evictIdleProviders(): void {
    while (
      [...this.records.values()].filter(record => record.provider).length >
      MAX_PROVIDER_CONNECTIONS
    ) {
      const candidate = [...this.records.values()]
        .filter(record =>
          record.provider &&
          record.inFlight === 0 &&
          !this.pendingAcquires.has(record.key),
        )
        .sort((left, right) => left.lastUsed - right.lastUsed)[0]
      if (!candidate) return
      this.invalidate(candidate)
    }
  }

// ── Common RPC call pattern ─────────────────────────────

  private async rpc<T>(
    method: string,
    params: unknown,
    provider?: ProviderConfig,
  ): Promise<T> {
    const key = provider ? createProviderConnectionKey(provider) : 'core'
    const record = await this.acquire(key, provider)
    try {
      return await withTimeout(
        record.connection.transport.sendRequest(method, params) as Promise<T>,
        this.timeoutMs,
        method,
      )
    } catch (error) {
      if (!(error instanceof RustJsonRpcError)) this.invalidate(record)
      throw error
    } finally {
      this.release(record)
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
  const safeProviderIDs = providerIDs.filter(isSecureStorageProviderID)
  if (safeProviderIDs.length === 0) return []
  const result = await this.rpc<{ configured_provider_ids: string[] }>(
    'providerCredential/read',
    { provider_ids: safeProviderIDs },
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
  const provider = await getProviderConfig(options.providerID)
  return this.rpc('providerCredential/models', {
    provider_id: options.providerID,
    base_url: options.baseURL ?? null,
    api_key: options.apiKey ?? null,
    default_models: options.defaultModels,
  }, provider)
}

async fetchProviderBalance(options: {
  providerID: string
  baseURL?: string
  apiKey?: string
}): Promise<DesktopProviderBalanceResult> {
  const provider = await getProviderConfig(options.providerID)
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
  }, provider)
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

async dispose(): Promise<void> {
  if (this.disposePromise) return this.disposePromise
  this.disposed = true
  this.disposePromise = (async () => {
    const records = [...this.records.values()]
    this.records.clear()
    for (const record of records) {
      record.invalidated = true
    }
    await Promise.allSettled(records.map(record => record.connection.dispose()))
    await Promise.allSettled([...this.opening.values()])
    const lateRecords = [...this.records.values()]
    this.records.clear()
    await Promise.allSettled(lateRecords.map(record => record.connection.dispose()))
    this.opening.clear()
    this.pendingAcquires.clear()
  })()
  return this.disposePromise
}
}

let sharedAuthService: RustAppServerAuthService | undefined
let sharedAuthServiceDisposePromise: Promise<void> | undefined

export function getRustAppServerAuthService(): RustAppServerAuthService {
  sharedAuthService ??= new RustAppServerAuthService()
  return sharedAuthService
}

export function disposeRustAppServerAuthService(): Promise<void> {
  if (sharedAuthServiceDisposePromise) return sharedAuthServiceDisposePromise
  const service = sharedAuthService
  if (!service) return Promise.resolve()
  sharedAuthServiceDisposePromise = service.dispose().finally(() => {
    if (sharedAuthService === service) sharedAuthService = undefined
    sharedAuthServiceDisposePromise = undefined
  })
  return sharedAuthServiceDisposePromise
}

// ── Helpers ─────────────────────────────────────────────────

export function createAuthSidecarOptions(
  executablePath: string,
  trustedProvider?: ProviderConfig,
) {
  const command = executablePath
  const args: string[] = [
    '--listen',
    'stdio://',
    ...(trustedProvider ? createTrustedProviderArgs(trustedProvider) : []),
  ]
  const options: import('node:child_process').SpawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...sanitizeChildEnvironment(process.env),
      RUST_LOG: process.env.RUST_LOG ?? 'error',
    },
    windowsHide: true,
  }
  return { command, args, options }
}

export function createProductionConnectionFactory(
  executablePath: string,
  dependencies: ProductionConnectionFactoryDependencies = {},
): AuthSidecarConnectionFactory {
  return async provider => {
    const options = createAuthSidecarOptions(executablePath, provider)
    const child = (dependencies.spawnChild ?? spawn)(
      options.command,
      options.args,
      options.options,
    )
    const debug = dependencies.debug ?? desktopDebug
    const terminateChild = dependencies.terminateChild ?? terminateChildProcess
    const onStderr = (chunk: Buffer | string) => {
      debug('rust_app_server_auth_stderr', {
        text: redactRustAppServerControlDiagnostic(
          chunk.toString(),
        ).slice(0, 2_000),
      })
    }
    child.stderr?.on('data', onStderr)
    const transport = new RustLineJsonRpcClient({
      input: child.stdout!,
      output: child.stdin!,
    })
    let resolveClosed!: () => void
    const closed = new Promise<void>(resolve => {
      resolveClosed = resolve
    })
    child.once('error', resolveClosed)
    child.once('exit', resolveClosed)
    child.once('close', resolveClosed)
    const removeFatalListener = transport.onFatalError(resolveClosed)
    let disposePromise: Promise<void> | undefined
    const dispose = () => {
      disposePromise ??= (async () => {
        try {
          transport.close()
        } catch { /* ignore */ }
        try {
          await terminateChild(child)
        } finally {
          child.stderr?.off('data', onStderr)
          removeFatalListener()
          resolveClosed()
        }
      })()
      return disposePromise
    }

    try {
      await withTimeout(
        transport.sendRequest('initialize', buildRustInitializeParams()),
        AUTH_TIMEOUT_MS,
        'app-server initialize',
      )
      transport.sendNotification('initialized')
      return { transport, closed, dispose }
    } catch (error) {
      await dispose()
      throw error
    }
  }
}

function createProviderConnectionKey(provider: ProviderConfig): string {
  const launchArgs = createAuthSidecarOptions('', provider).args
  return `provider:${provider.providerID}:${JSON.stringify(launchArgs)}`
}

function createTrustedProviderArgs(provider: ProviderConfig): string[] {
  const providerID = provider.providerID.trim()
  const baseURL = provider.baseURL?.trim()
  if (!isSecureStorageProviderID(providerID) || !baseURL) return []
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

function isSecureStorageProviderID(providerID: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(providerID)
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

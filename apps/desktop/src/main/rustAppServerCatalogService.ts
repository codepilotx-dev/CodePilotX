import { desktopDebug } from './desktopDebug.js'
import { RustAppServerClient } from './rustAppServerClient.js'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolveRustAppServerExecutableInfo, buildRustInitializeParams, createRustSidecarOptions } from './rustSidecarRuntime.js'
import { existsSync } from 'node:fs'
import { SidecarStartError } from './sidecarManager.js'
import type { SidecarManagerOptions } from './sidecarManager.js'

export type DesktopCatalogResult<T> =
  | {
      state: 'ready'
      data: T
      updatedAt: string
    }
  | {
      state: 'stale'
      data: T
      updatedAt: string
      error: string
    }
  | {
      state: 'unavailable'
      data: null
      error: string
    }

type ConnectionContext = {
  providerID: string
  providerBaseURL: string | undefined
  selectedModel: string | undefined
  configDirectoryPath: string
  apiKeyRevision: number
}

function stableCatalogConnectionKey(context: ConnectionContext): string {
  // Use a hash/version tuple instead of raw API key
  return `${context.providerID}|${context.providerBaseURL ?? ''}|${context.selectedModel ?? ''}|${context.configDirectoryPath}|${context.apiKeyRevision}`
}

/**
 * Long-lived app-server connection for catalog operations.
 * Shares the app-server process across multiple catalog reads.
 */
export class RustAppServerCatalogService {
  private child: ChildProcess | null = null
  private rpcClient: RustLineJsonRpcClient | null = null
  private appServerClient: RustAppServerClient | null = null
  private connectionKey: string | null = null
  private connectionPromise: Promise<void> | null = null
  /** Cache key → snapshot */
  private cache = new Map<string, { data: unknown; updatedAt: string }>()
  private changeListeners = new Map<string, Set<() => void>>()

  private async ensureConnection(
    context: ConnectionContext,
  ): Promise<RustAppServerClient> {
    const nextKey = stableCatalogConnectionKey(context)

    if (this.appServerClient && this.connectionKey === nextKey) {
      return this.appServerClient
    }

    await this.disposeConnection()

    const executableInfo = resolveRustAppServerExecutableInfo()
    const executablePath = executableInfo.path

    if (!existsSync(executablePath)) {
      throw new SidecarStartError(
        `Rust app-server binary not found at: ${executablePath}`,
      )
    }

    const child = spawn(executablePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    child.stderr?.on('data', (chunk: Buffer) => {
      desktopDebug('catalog_sidecar_stderr', {
        text: chunk.toString('utf8').slice(0, 500),
      })
    })

    this.rpcClient = new RustLineJsonRpcClient({
      input: child.stdout!,
      output: child.stdin!,
    })
    this.appServerClient = new RustAppServerClient(this.rpcClient)

    // Listen for skills/changed notifications
    this.appServerClient.onNotification('skills/changed', () => {
      this.invalidatePrefix('skills:')
      this.emitChange('skills')
    })

    await this.appServerClient.initialize(buildRustInitializeParams())
    this.appServerClient.notifyInitialized()
    this.connectionKey = nextKey

    desktopDebug('catalog_connection_established', {
      connectionKey: nextKey,
    })

    return this.appServerClient
  }

  /**
   * Read from cache or fetch fresh data.
   */
  async read<T>(
    cacheKey: string,
    fetcher: (client: RustAppServerClient) => Promise<T>,
    context: ConnectionContext,
  ): Promise<DesktopCatalogResult<T>> {
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return {
        state: 'ready',
        data: cached.data as T,
        updatedAt: cached.updatedAt,
      }
    }

    try {
      const client = await this.ensureConnection(context)
      const data = await fetcher(client)
      const updatedAt = new Date().toISOString()
      this.cache.set(cacheKey, { data, updatedAt })
      return { state: 'ready', data, updatedAt }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // If stale cache exists, return it
      const stale = this.cache.get(cacheKey)
      if (stale) {
        return {
          state: 'stale',
          data: stale.data as T,
          updatedAt: stale.updatedAt,
          error: message,
        }
      }
      return { state: 'unavailable', data: null, error: message }
    }
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  onChange(topic: string, listener: () => void): () => void {
    if (!this.changeListeners.has(topic)) {
      this.changeListeners.set(topic, new Set())
    }
    this.changeListeners.get(topic)!.add(listener)
    return () => {
      this.changeListeners.get(topic)?.delete(listener)
    }
  }

  private emitChange(topic: string): void {
    const listeners = this.changeListeners.get(topic)
    if (listeners) {
      for (const listener of listeners) {
        try { listener() } catch { /* ignore */ }
      }
    }
  }

  async disposeConnection(): Promise<void> {
    this.appServerClient?.close()
    this.appServerClient = null
    this.rpcClient = null
    this.child?.kill()
    this.child = null
    this.connectionKey = null
  }

  dispose(): void {
    this.disposeConnection().catch(() => {})
    this.cache.clear()
    this.changeListeners.clear()
  }
}

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { DesktopAgentRuntimeContext } from './agentRuntime.js'
import { desktopDebug } from './desktopDebug.js'
import { RustAppServerClient } from './rustAppServerClient.js'
import type {
  InitializeParams,
  InitializeResponse,
  Thread,
  ThreadArchiveResponse,
  ThreadDeleteResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadSetNameResponse,
  ThreadUnarchiveResponse,
} from './rustAppServerProtocol/index.js'
import { RustLineJsonRpcClient } from './rustLineJsonRpcClient.js'
import {
  RUST_APP_SERVER_BINARY_ENV,
  buildRustInitializeParams,
  createRustSidecarOptions,
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'

/** The app-server calls that are safe to make from a short-lived control connection. */
export type RustAppServerControlClient = {
  initialize(params: InitializeParams): Promise<InitializeResponse>
  notifyInitialized(): void
  listThreads(params?: ThreadListParams): Promise<ThreadListResponse>
  archiveThread(params: { threadId: string }): Promise<ThreadArchiveResponse>
  unarchiveThread(params: { threadId: string }): Promise<ThreadUnarchiveResponse>
  deleteThread(params: { threadId: string }): Promise<ThreadDeleteResponse>
  setThreadName(params: { threadId: string; name: string }): Promise<ThreadSetNameResponse>
}

export type RustAppServerControlConnection = {
  client: RustAppServerControlClient
  dispose(): Promise<void>
}

export type RustAppServerControlConnectionFactory = (
  context: DesktopAgentRuntimeContext,
) => Promise<RustAppServerControlConnection>

export type RustAppServerControlServiceOptions = {
  context: DesktopAgentRuntimeContext
  openConnection?: RustAppServerControlConnectionFactory
  /** Per-stage deadline for a short-lived control connection. */
  timeoutMs?: number
}

const DEFAULT_CONTROL_TIMEOUT_MS = 15_000
export const RUST_APP_SERVER_CONTROL_ERROR_MESSAGE =
  'The app-server is unavailable. Please try again.'

/**
 * An error the session catalog can use to distinguish an unavailable app-server
 * from an empty thread list.
 */
export class RustAppServerControlError extends Error {
  readonly code = 'app-server-control-failed'

  constructor(
    readonly operation: string,
    _cause: unknown,
  ) {
    super(RUST_APP_SERVER_CONTROL_ERROR_MESSAGE)
    this.name = 'RustAppServerControlError'
  }
}

/**
 * Creates a new stdio app-server connection for every catalog mutation or
 * listing. It deliberately never starts/resumes a thread; its only purpose is
 * to manage the app-server's persisted thread catalog.
 */
export class RustAppServerControlService {
  private readonly openConnection: RustAppServerControlConnectionFactory

  constructor(private readonly options: RustAppServerControlServiceOptions) {
    this.openConnection = options.openConnection ?? openRustAppServerControlConnection
  }

  async listAllThreads({ archived }: { archived: boolean }): Promise<Thread[]> {
    return this.withControlConnection('thread/list', async client => {
      const threads: Thread[] = []
      let cursor: string | null = null
      const seenCursors = new Set<string>()
      do {
        const page = await client.listThreads({ archived, cursor })
        threads.push(...page.data)
        cursor = page.nextCursor
        if (cursor && seenCursors.has(cursor)) {
          throw new Error('Thread list returned a repeated cursor')
        }
        if (cursor) seenCursors.add(cursor)
      } while (cursor)
      return threads
    })
  }

  async archiveThread(threadId: string): Promise<ThreadArchiveResponse> {
    return this.withControlConnection('thread/archive', client =>
      client.archiveThread({ threadId }),
    )
  }

  async unarchiveThread(threadId: string): Promise<ThreadUnarchiveResponse> {
    return this.withControlConnection('thread/unarchive', client =>
      client.unarchiveThread({ threadId }),
    )
  }

  async deleteThread(threadId: string): Promise<ThreadDeleteResponse> {
    return this.withControlConnection('thread/delete', client =>
      client.deleteThread({ threadId }),
    )
  }

  async setThreadName(
    threadId: string,
    name: string,
  ): Promise<ThreadSetNameResponse> {
    return this.withControlConnection('thread/name/set', client =>
      client.setThreadName({ threadId, name }),
    )
  }

  private async withControlConnection<T>(
    operation: string,
    callback: (client: RustAppServerControlClient) => Promise<T>,
  ): Promise<T> {
    let connection: RustAppServerControlConnection | null = null
    let operationError: RustAppServerControlError | null = null
    try {
      connection = await this.openTimedConnection(operation)
      await this.withTimeout(
        operation,
        'initialize',
        connection.client.initialize(buildRustInitializeParams()),
      )
      connection.client.notifyInitialized()
      return await this.withTimeout(operation, 'request', callback(connection.client))
    } catch (error) {
      operationError = asControlError(operation, error)
      desktopDebug('rust_app_server_control_request_failed', {
        operation,
        message: redactRustAppServerControlDiagnostic(errorMessage(error)),
      })
      throw operationError
    } finally {
      if (connection) {
        try {
          await connection.dispose()
        } catch (error) {
          if (!operationError) {
            throw asControlError(operation, error)
          }
          desktopDebug('rust_app_server_control_dispose_failed', {
            operation,
            message: redactRustAppServerControlDiagnostic(errorMessage(error)),
          })
        }
      }
    }
  }

  private async openTimedConnection(
    operation: string,
  ): Promise<RustAppServerControlConnection> {
    const opening = this.openConnection(this.options.context)
    let timedOut = false
    try {
      return await this.withTimeout(operation, 'startup', opening, () => {
        timedOut = true
      })
    } finally {
      if (timedOut) {
        void opening.then(
          connection => connection.dispose().catch(error => {
            desktopDebug('rust_app_server_control_late_dispose_failed', {
              operation,
              message: redactRustAppServerControlDiagnostic(errorMessage(error)),
            })
          }),
          () => undefined,
        )
      }
    }
  }

  private async withTimeout<T>(
    operation: string,
    stage: 'startup' | 'initialize' | 'request',
    promise: Promise<T>,
    onTimeout?: () => void,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            onTimeout?.()
            reject(new Error(`Rust app-server control ${stage} timed out`))
          }, this.timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private get timeoutMs(): number {
    const configured = this.options.timeoutMs
    return typeof configured === 'number' && Number.isFinite(configured)
      ? Math.max(1, configured)
      : DEFAULT_CONTROL_TIMEOUT_MS
  }
}

/** Default process-backed connection factory used by the desktop main process. */
export async function openRustAppServerControlConnection(
  context: DesktopAgentRuntimeContext,
): Promise<RustAppServerControlConnection> {
  const executableInfo = resolveRustAppServerExecutableInfo()
  if (!existsSync(executableInfo.path)) {
    throw new Error(
      `Rust app-server binary not found at: ${executableInfo.path}. ` +
        `Build it with "cargo build -p codepilotx-app-server" in rust/codex-rs, ` +
        `or set ${RUST_APP_SERVER_BINARY_ENV} to a codepilotx-app-server binary.`,
    )
  }

  const options = await createRustSidecarOptions(context)
  desktopDebug('rust_app_server_control_start', {
    executable: options.command,
    executableSource: executableInfo.source,
    cwd: options.cwd,
  })
  const child = spawn(options.command!, options.args, {
    cwd: options.cwd,
    windowsHide: true,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  await waitForChildSpawn(child)

  child.stderr?.on('data', (chunk: Buffer) => {
    desktopDebug('rust_app_server_control_stderr', {
      text: redactRustAppServerControlDiagnostic(
        chunk.toString('utf8').slice(0, 2000),
      ),
    })
  })
  child.on('error', error => {
    desktopDebug('rust_app_server_control_error', {
      message: redactRustAppServerControlDiagnostic(error.message),
    })
  })

  const transport = new RustLineJsonRpcClient({
    input: child.stdout!,
    output: child.stdin!,
  })
  const client = new RustAppServerClient(transport)
  let disposed = false
  return {
    client,
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      client.close()
      if (!child.killed) child.kill()
    },
  }
}

function waitForChildSpawn(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

function asControlError(
  operation: string,
  error: unknown,
): RustAppServerControlError {
  return error instanceof RustAppServerControlError
    ? error
    : new RustAppServerControlError(operation, error)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Removes common credential formats before an app-server diagnostic is logged. */
export function redactRustAppServerControlDiagnostic(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/g, '[REDACTED]')
    .replace(
      /("?(?:api[-_ ]?key|token|access[_-]?token|authorization)"?\s*:\s*")[^"]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(
      /(\b(?:api[-_ ]?key|token|access[_-]?token|authorization)\b\s*(?:[:=]\s*|\s+))[^\s,;"'\\}\]]+/gi,
      '$1[REDACTED]',
    )
}

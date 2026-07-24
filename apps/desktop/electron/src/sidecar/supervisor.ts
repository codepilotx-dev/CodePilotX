import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join, resolve } from "node:path"
import { app } from "electron"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import { normalizeOrigin } from "../security/navigation.js"
import {
  missingPackagedSidecarError,
  resolveSidecarCommand,
  SidecarInstallationError,
} from "./command.js"
import {
  formatError,
  probeReady,
  sleep,
  waitForReady,
  waitForReadyMessage,
} from "./readiness.js"

const SHUTDOWN_TIMEOUT_MS = 4_000
const WATCHDOG_INTERVAL_MS = 2_000
const WATCHDOG_FAILURE_LIMIT = 3

export type AgentConnectionState = "connected" | "disconnected" | "unknown"

export interface ConnectionStatus {
  state: AgentConnectionState
  phase: "starting" | "connecting" | "authenticating" | "loading" | "reconnecting"
  attempt: number
  message?: string
}

export interface SidecarConnection {
  readonly origin: string
  readonly managed: boolean
  readonly port: number
}

export class SidecarSupervisor {
  readonly #token: string
  readonly #logger: DesktopLogger
  readonly #moduleDirectory: string
  #child: ChildProcessWithoutNullStreams | undefined
  #connection: SidecarConnection | undefined
  #preferredPort: number | undefined
  #stopping = false
  #watchdog: NodeJS.Timeout | undefined
  #watchdogBusy = false
  #onStateChange: ((status: ConnectionStatus) => void) | undefined
  #onConnectionLost: (() => void) | undefined

  constructor(
    token: string,
    logger: DesktopLogger,
    moduleDirectory: string,
  ) {
    this.#token = token
    this.#logger = logger
    this.#moduleDirectory = moduleDirectory
  }

  onStateChange(listener: (status: ConnectionStatus) => void): void {
    this.#onStateChange = listener
  }

  async connect(
    validate: (connection: SidecarConnection) => Promise<void>,
  ): Promise<SidecarConnection> {
    let attempt = 0
    let delay = 0
    while (!this.#stopping) {
      attempt += 1
      this.#onStateChange?.({
        state: "disconnected",
        phase: attempt === 1 ? "connecting" : "reconnecting",
        attempt,
      })
      try {
        const connection = await this.#connectOnce(attempt)
        this.#connection = connection
        this.#onStateChange?.({
          state: "disconnected",
          phase: "authenticating",
          attempt,
        })
        await validate(connection)
        this.#logger.info("sidecar.connected", {
          origin: connection.origin,
          managed: connection.managed,
          port: connection.port,
          attempt,
        })
        return connection
      } catch (error) {
        this.#connection = undefined
        await this.#disposeChild()
        if (error instanceof SidecarInstallationError) throw error
        const message = formatError(error)
        this.#logger.warn("sidecar.connect-failed", { attempt, message })
        if (this.#stopping) break
        delay = delay === 0 ? 500 : Math.min(10_000, delay * 2)
        await sleep(
          delay + Math.round(Math.random() * Math.min(500, delay * 0.2)),
        )
      }
    }
    throw new Error("Agent 连接已停止")
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    if (this.#connection && !this.#connection.managed) {
      try {
        this.#logger.info("sidecar.shutdown-request", {
          origin: this.#connection.origin,
        })
        await fetch(`${this.#connection.origin}/api/shutdown`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#token}` },
          signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS),
        })
      } catch {
        // The process signal below remains the fallback.
      }
    }
    this.#connection = undefined
    await this.#disposeChild()
  }

  invalidate(): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    this.#connection = undefined
    void this.#disposeChild()
  }

  watch(connection: SidecarConnection, onLost: () => void): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#onConnectionLost = onLost
    let failures = 0
    this.#watchdog = setInterval(() => {
      if (this.#watchdogBusy || this.#stopping) return
      this.#watchdogBusy = true
      void probeReady(connection.origin, fetch, this.#token, 1_000)
        .then(() => {
          failures = 0
        })
        .catch((error) => {
          failures += 1
          this.#logger.warn("sidecar.watchdog-error", {
            origin: connection.origin,
            failures,
            message: formatError(error),
          })
        })
        .finally(() => {
          this.#watchdogBusy = false
          if (failures >= WATCHDOG_FAILURE_LIMIT) {
            if (this.#watchdog) clearInterval(this.#watchdog)
            this.#watchdog = undefined
            this.#onConnectionLost?.()
          }
        })
    }, WATCHDOG_INTERVAL_MS)
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const connection = this.#connection
    if (!connection) throw new Error("Agent 尚未连接")
    const headers = new Headers(init.headers)
    headers.set("Authorization", `Bearer ${this.#token}`)
    const response = await fetch(`${connection.origin}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: { message?: string }
      } | null
      throw new Error(
        body?.error?.message ?? `Agent 请求失败（HTTP ${response.status}）`,
      )
    }
    return response
  }

  async #connectOnce(attempt: number): Promise<SidecarConnection> {
    const managedOrigin = process.env.CODEPILOTX_AGENT_URL
    if (managedOrigin) {
      const origin = normalizeOrigin(managedOrigin)
      await waitForReady(origin, this.#token, this.#logger, attempt)
      return { origin, managed: true, port: Number(new URL(origin).port) }
    }
    return this.#spawnOwnedSidecar(attempt)
  }

  async #spawnOwnedSidecar(attempt: number): Promise<SidecarConnection> {
    const command = resolveSidecarCommand({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDirectory: this.#moduleDirectory,
    })
    const dataDirectory = resolve(
      process.env.CODEPILOTX_DATA_DIR?.trim()
        || join(app.getPath("home"), ".codepilotx"),
    )
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEPILOTX_HOST: "127.0.0.1",
        CODEPILOTX_PORT: String(this.#preferredPort ?? 0),
        CODEPILOTX_AUTH_TOKEN: this.#token,
        CODEPILOTX_DESKTOP_MANAGED: "1",
        CODEPILOTX_DATA_DIR: dataDirectory,
        CODEPILOTX_PETS_DIR: join(dataDirectory, "pets"),
        CODEPILOTX_LEGACY_DATA_DIR: join(app.getPath("userData"), "agent"),
        CODEPILOTX_DOCUMENTS_DIR: app.getPath("documents"),
        CODEPILOTX_LOG_DIR: join(dataDirectory, "logs"),
        CODEPILOTX_MODEL_SNAPSHOT: app.isPackaged
          ? join(process.resourcesPath, "agent", "models.snapshot.json")
          : process.env.CODEPILOTX_MODEL_SNAPSHOT,
        CODEPILOTX_STATIC_DIR: app.isPackaged
          ? join(process.resourcesPath, "renderer")
          : process.env.CODEPILOTX_STATIC_DIR,
        ...(app.isPackaged
          ? {
              CODEPILOTX_SRT_WIN_PATH: join(
                process.resourcesPath,
                "srt-win",
                process.arch,
                "srt-win.exe",
              ),
            }
          : process.env.CODEPILOTX_SRT_WIN_PATH
            ? { CODEPILOTX_SRT_WIN_PATH: process.env.CODEPILOTX_SRT_WIN_PATH }
            : {}),
      },
    })
    this.#child = child
    child.stdin.end()

    this.#logger.info("sidecar.spawned", {
      executable: command.executable,
      cwd: command.cwd,
      pid: child.pid,
      attempt,
      preferredPort: this.#preferredPort ?? null,
    })
    child.stderr.on("data", (chunk: Buffer) => {
      this.#logger.error("sidecar.stderr", {
        pid: child.pid,
        text: chunk.toString("utf8"),
      })
    })

    let origin: string
    try {
      const ready = await waitForReadyMessage(child, this.#logger)
      const host = ready.host === "localhost" ? "localhost" : "127.0.0.1"
      origin = `http://${host}:${ready.port}`
      this.#preferredPort = ready.port
      await waitForReady(origin, this.#token, this.#logger, attempt)
    } catch (error) {
      await this.#disposeChild()
      const missingSidecar = app.isPackaged
        ? missingPackagedSidecarError(error, command.executable)
        : undefined
      if (missingSidecar) throw missingSidecar
      throw error
    }

    child.once("exit", (code, signal) => {
      this.#logger.warn("sidecar.exit", { pid: child.pid, code, signal })
      if (!this.#stopping && this.#connection?.origin === origin) {
        this.#onConnectionLost?.()
      }
    })

    return {
      origin,
      managed: false,
      port: Number(new URL(origin).port),
    }
  }

  async #disposeChild(): Promise<void> {
    const child = this.#child
    this.#child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
  }
}

import { randomBytes } from "node:crypto"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
  type OpenDialogOptions,
} from "electron"
import { missingPackagedSidecarError, resolveSidecarCommand as resolveConfiguredSidecarCommand, SidecarInstallationError } from "./sidecar-command.js"
import { createDesktopLogger, type DesktopLogger } from "./desktop-logger.js"
import { AppearanceSettingsStore } from "./appearance-settings-store.js"
import { ExternalOpenTargetService } from "./external-open-targets.js"
import {
  AgentDiagnosticLineDecoder,
  publishAgentDiagnostic,
  type AgentDiagnostic,
} from "./desktop-diagnostics.js"
import {
  ConnectionWatchdogState,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_PROBE_TIMEOUT_MS,
  shouldDisposeOwnedSidecar,
  shouldLoadApplication,
  watchdogDiagnosticFields,
  type ConnectionLossTrigger,
  type WatchdogOutage,
} from "./connection-watchdog.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const READY_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 20_000
const SHUTDOWN_TIMEOUT_MS = 4_000
const APPLICATION_LOAD_TIMEOUT_MS = 20_000
const AUTH_COOKIE = "codepilotx_session"
type AgentConnectionState = "connected" | "disconnected" | "unknown"

interface ConnectionStatus {
  state: AgentConnectionState
  phase: "starting" | "connecting" | "authenticating" | "loading" | "reconnecting"
  attempt: number
  message?: string
}

interface ReadyMessage {
  readonly type: "ready"
  readonly port: number
  readonly host?: string
}

interface SidecarConnection {
  readonly origin: string
  readonly managed: boolean
  readonly port: number
}

interface ConnectionLostDetails extends WatchdogOutage {
  readonly origin: string
  readonly managed: boolean
}

class SidecarSupervisor {
  readonly #token: string
  readonly #logger: DesktopLogger
  #child: ChildProcessWithoutNullStreams | undefined
  #connection: SidecarConnection | undefined
  #preferredPort: number | undefined
  #stopping = false
  #watchdog: NodeJS.Timeout | undefined
  #watchdogBusy = false
  #watchdogState: ConnectionWatchdogState | undefined
  #lossNotified = false
  #onStateChange: ((status: ConnectionStatus) => void) | undefined
  #onConnectionLost: ((details: ConnectionLostDetails) => void) | undefined
  readonly #publishDiagnostic: (diagnostic: AgentDiagnostic) => void

  constructor(token: string, logger: DesktopLogger, publishDiagnostic: (diagnostic: AgentDiagnostic) => void = () => undefined) {
    this.#token = token
    this.#logger = logger
    this.#publishDiagnostic = publishDiagnostic
  }

  onStateChange(listener: (status: ConnectionStatus) => void): void {
    this.#onStateChange = listener
  }

  async connect(validate: (connection: SidecarConnection) => Promise<void>): Promise<SidecarConnection> {
    let attempt = 0
    let delay = 0
    while (!this.#stopping) {
      attempt += 1
      this.#onStateChange?.({ state: "disconnected", phase: attempt === 1 ? "connecting" : "reconnecting", attempt })
      try {
        const connection = await this.#connectOnce(attempt)
        this.#connection = connection
        this.#onStateChange?.({ state: "disconnected", phase: "authenticating", attempt })
        await validate(connection)
        if (!connection.managed && (!this.#child || this.#child.exitCode !== null || this.#child.signalCode !== null)) {
          throw new Error("Agent 在连接验证期间退出")
        }
        this.#logger.info("sidecar.connected", { origin: connection.origin, managed: connection.managed, port: connection.port, attempt })
        return connection
      } catch (error) {
        this.#connection = undefined
        await this.#disposeChild()
        if (error instanceof SidecarInstallationError) throw error
        const message = formatError(error)
        this.#logger.warn("sidecar.connect-failed", { attempt, message })
        if (this.#stopping) break
        delay = delay === 0 ? 500 : Math.min(10_000, delay * 2)
        await sleep(delay + Math.round(Math.random() * Math.min(500, delay * 0.2)))
      }
    }
    throw new Error("Agent 连接已停止")
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    this.#watchdogState = undefined
    if (this.#connection && !this.#connection.managed) {
      try {
        this.#logger.info("sidecar.shutdown-request", { origin: this.#connection.origin })
        await fetch(`${this.#connection.origin}/api/shutdown`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#token}` },
          signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS),
        })
      } catch { /* process signal below is the fallback */ }
    }
    this.#connection = undefined
    await this.#disposeChild()
  }

  invalidate(trigger: ConnectionLossTrigger): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    this.#watchdogState = undefined
    this.#lossNotified = true
    const connection = this.#connection
    this.#connection = undefined
    this.#logger.info("sidecar.invalidated", {
      origin: connection?.origin,
      managed: connection?.managed,
      trigger,
      disposingOwned: connection?.managed === false,
    })
    if (connection && shouldDisposeOwnedSidecar(connection.managed)) void this.#disposeChild()
  }

  watch(connection: SidecarConnection, onLost: (details: ConnectionLostDetails) => void): void {
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#onConnectionLost = onLost
    this.#lossNotified = false
    const state = new ConnectionWatchdogState()
    this.#watchdogState = state
    this.#watchdog = setInterval(() => {
      if (this.#watchdogBusy || this.#stopping) return
      this.#watchdogBusy = true
      const startedAt = Date.now()
      void probeReady(connection.origin, fetch, this.#token, WATCHDOG_PROBE_TIMEOUT_MS).then(() => {
        if (this.#watchdogState !== state || this.#lossNotified) return
        const completedAt = Date.now()
        const transition = state.success(completedAt)
        if (transition.type === "recovered") {
          this.#logger.info("sidecar.watchdog-recovered", {
            ...watchdogDiagnosticFields(connection, transition.outage),
            probeLatencyMs: completedAt - startedAt,
            recoveredAt: new Date(transition.recoveredAt).toISOString(),
            recoveryDurationMs: transition.recoveryDurationMs,
          })
          this.#publishDiagnostic({
            at: new Date(completedAt).toISOString(), level: "info", source: "desktop",
            code: "sidecar.watchdog-recovered", message: "Agent 健康探测已恢复",
            details: { durationMs: transition.recoveryDurationMs, failureCount: transition.outage.failureCount },
          })
        }
      }).catch((error) => {
        if (this.#watchdogState !== state || this.#lossNotified) return
        const completedAt = Date.now()
        const transition = state.failure(completedAt, isProbeTimeout(error) ? "probe-timeout" : "request-failure")
        const fields = {
          ...watchdogDiagnosticFields(connection, transition.outage),
          probeLatencyMs: completedAt - startedAt,
          message: formatError(error),
        }
        if (transition.type === "lost") this.#notifyConnectionLost(connection, transition.outage, fields)
        else {
          const event = transition.outage.failureCount === 1 ? "sidecar.watchdog-degraded" : "sidecar.watchdog-error"
          this.#logger.warn(event, fields)
          this.#publishDiagnostic({
            at: new Date(completedAt).toISOString(), level: "warn", source: "desktop",
            code: event, message: "Agent 健康探测暂时失败，桌面将保持当前页面",
            details: { durationMs: transition.outage.elapsedMs, failureCount: transition.outage.failureCount },
          })
        }
      }).finally(() => {
        this.#watchdogBusy = false
      })
    }, WATCHDOG_INTERVAL_MS)
  }

  #notifyConnectionLost(connection: SidecarConnection, outage: WatchdogOutage, logFields?: Record<string, unknown>): void {
    if (this.#lossNotified || this.#connection?.origin !== connection.origin) return
    this.#lossNotified = true
    if (this.#watchdog) clearInterval(this.#watchdog)
    this.#watchdog = undefined
    const details: ConnectionLostDetails = { ...outage, origin: connection.origin, managed: connection.managed }
    this.#logger.warn("sidecar.watchdog-lost", logFields ?? watchdogDiagnosticFields(connection, outage))
    this.#publishDiagnostic({
      at: new Date().toISOString(), level: "error", source: "desktop",
      code: "sidecar.watchdog-lost", message: "Agent 持续不可用，正在原地重连",
      details: { durationMs: outage.elapsedMs, failureCount: outage.failureCount },
    })
    this.#onConnectionLost?.(details)
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
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
      throw new Error(body?.error?.message ?? `Agent 请求失败（HTTP ${response.status}）`)
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
    const command = resolveSidecarCommand()
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
        CODEPILOTX_DATA_DIR: join(app.getPath("userData"), "agent"),
        CODEPILOTX_LOG_DIR: this.#logger.directory,
        CODEPILOTX_MODEL_SNAPSHOT: app.isPackaged
          ? join(process.resourcesPath, "agent", "models.snapshot.json")
          : process.env.CODEPILOTX_MODEL_SNAPSHOT,
        CODEPILOTX_STATIC_DIR: app.isPackaged
          ? join(process.resourcesPath, "renderer")
          : process.env.CODEPILOTX_STATIC_DIR,
        ...(app.isPackaged
          ? { CODEPILOTX_SRT_WIN_PATH: join(process.resourcesPath, "srt-win", process.arch, "srt-win.exe") }
          : process.env.CODEPILOTX_SRT_WIN_PATH
            ? { CODEPILOTX_SRT_WIN_PATH: process.env.CODEPILOTX_SRT_WIN_PATH }
            : {}),
      },
    })
    this.#child = child
    child.stdin.end()

    this.#logger.info("sidecar.spawned", { executable: command.executable, cwd: command.cwd, pid: child.pid, attempt, preferredPort: this.#preferredPort ?? null })
    const diagnosticDecoder = new AgentDiagnosticLineDecoder()
    child.stderr.on("data", (chunk: Buffer) => {
      this.#logger.error("sidecar.stderr", { pid: child.pid, text: chunk.toString("utf8") })
      for (const diagnostic of diagnosticDecoder.push(chunk)) this.#publishDiagnostic(diagnostic)
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
      const missingSidecar = app.isPackaged ? missingPackagedSidecarError(error, command.executable) : undefined
      if (missingSidecar) throw missingSidecar
      throw error
    }

    child.once("exit", (code, signal) => {
      this.#logger.warn("sidecar.exit", { pid: child.pid, code, signal })
      if (!this.#stopping && this.#connection?.origin === origin) {
        const state = this.#watchdogState ?? new ConnectionWatchdogState()
        this.#watchdogState = state
        const transition = state.childExited()
        if (transition.type === "lost") {
          this.#notifyConnectionLost({ origin, managed: false, port: readyPort(origin) }, transition.outage)
        }
      }
    })

    return { origin, managed: false, port: readyPort(origin) }
  }

  async #disposeChild(): Promise<void> {
    const child = this.#child
    this.#child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  }
}

function readyPort(origin: string): number {
  return Number(new URL(origin).port)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

let mainWindow: BrowserWindow | undefined
let startupWindow: BrowserWindow | undefined
let supervisor: SidecarSupervisor | undefined
let logger: DesktopLogger | undefined
let quitting = false
let allowedApplicationOrigin: string | undefined
let connectionStatus: ConnectionStatus = { state: "unknown", phase: "starting", attempt: 0 }
let connectionTask: Promise<void> | undefined
let applicationLoaded = false
let lastConnectionLoss: ConnectionLostDetails | undefined
let appearanceSettingsStore: AppearanceSettingsStore | undefined
let externalOpenTargetService: ExternalOpenTargetService | undefined

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow && connectionStatus.state === "connected") {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else startupWindow?.show()
  })

  app.whenReady().then(startDesktop).catch((error: unknown) => {
    logger?.error("desktop.startup-failed", { error })
    showStartupStatus("启动流程异常，正在继续重试", formatError(error))
  })
}

async function startDesktop(): Promise<void> {
  appearanceSettingsStore = new AppearanceSettingsStore(app.getPath("userData"))
  externalOpenTargetService = new ExternalOpenTargetService({
    platform: process.platform,
    env: process.env,
    getFileIconDataUrl: async path => (await app.getFileIcon(path, { size: "normal" })).toDataURL(),
    openPath: path => shell.openPath(path),
    revealPath: path => shell.showItemInFolder(path),
    spawnProcess: (executablePath, args, options) => spawn(executablePath, [...args], options),
  })
  registerWindowIpc()
  registerAppearanceIpc()
  logger = createDesktopLogger(resolve(process.env.CODEPILOTX_LOG_DIR ?? join(app.getPath("logs"), "codepilotx")))
  logger.info("desktop.starting", { version: app.getVersion(), packaged: app.isPackaged, pid: process.pid })
  createStartupWindow()

  const token = process.env.CODEPILOTX_AUTH_TOKEN ?? randomBytes(32).toString("base64url")
  supervisor = new SidecarSupervisor(token, logger, (diagnostic) => {
    publishAgentDiagnostic(mainWindow?.webContents, diagnostic)
  })
  supervisor.onStateChange((status) => {
    connectionStatus = status
    logger?.info("desktop.connection-state", { ...status })
    mainWindow?.webContents.send("agent:connection-changed", status.state)
    showStartupStatus(status.phase === "reconnecting" ? "Agent 连接中断，正在重试" : "正在连接 Agent", status.message ?? `第 ${status.attempt} 次尝试`)
  })
  await connectAndLoad(token)
}

async function connectAndLoad(token: string): Promise<void> {
  if (connectionTask) return connectionTask
  connectionTask = (async () => {
    while (!quitting && supervisor) {
      try {
        const connection = await supervisor.connect(async (candidate) => {
          showStartupStatus("正在验证 Agent 认证", candidate.origin)
          await configureAuthCookie(candidate.origin, token)
          await verifyCookie(candidate.origin)
          const candidateOrigin = normalizeOrigin(candidate.origin)
          const hasUsableApplication = applicationLoaded && Boolean(mainWindow && !mainWindow.isDestroyed())
          if (shouldLoadApplication(allowedApplicationOrigin, candidateOrigin, hasUsableApplication)) {
            connectionStatus = { state: "disconnected", phase: "loading", attempt: connectionStatus.attempt }
            showStartupStatus("正在加载桌面界面", candidate.origin)
            await loadApplication(candidate.origin)
          } else {
            logger?.info("desktop.renderer-reused", { origin: candidateOrigin, attempt: connectionStatus.attempt })
          }
        })
        connectionStatus = { state: "connected", phase: "loading", attempt: connectionStatus.attempt }
        if (lastConnectionLoss) {
          logger?.info("desktop.connection-recovered", {
            ...watchdogDiagnosticFields(lastConnectionLoss, lastConnectionLoss),
            recoveredOrigin: connection.origin,
            recoveredManaged: connection.managed,
            attempt: connectionStatus.attempt,
            recoveryDurationMs: Math.max(0, Date.now() - lastConnectionLoss.firstFailureAt),
          })
          lastConnectionLoss = undefined
        }
        logger?.info("desktop.ready", { origin: connection.origin, port: connection.port, managed: connection.managed })
        mainWindow?.webContents.send("agent:connection-changed", "connected")
        mainWindow?.show()
        startupWindow?.destroy()
        supervisor.watch(connection, (details) => {
          if (quitting || connectionStatus.state !== "connected") return
          lastConnectionLoss = details
          logger?.warn("desktop.connection-lost", {
            ...watchdogDiagnosticFields(connection, details),
            attempt: connectionStatus.attempt,
            mainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
          })
          connectionStatus = { state: "disconnected", phase: "reconnecting", attempt: 0 }
          mainWindow?.webContents.send("agent:connection-changed", "disconnected")
          supervisor?.invalidate(details.trigger)
          void connectAndLoad(token)
        })
        return
      } catch (error) {
        if (error instanceof SidecarInstallationError) {
          logger?.error("desktop.startup-failed", { code: error.code, message: error.message, executable: error.executable })
          showStartupStatus("安装不完整，请重新安装", "CodePilotX Agent 文件缺失")
          return
        }
        logger?.error("desktop.connection-cycle-failed", { error })
        showStartupStatus("连接失败，正在继续重试", formatError(error))
        if (quitting) return
        await sleep(1_000)
      }
    }
  })()
  try { await connectionTask } finally { connectionTask = undefined }
}

function resolveWindowIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.ico")
    : resolve(__dirname, "../../build/icon.ico")
}

function createStartupWindow(): BrowserWindow {
  if (startupWindow && !startupWindow.isDestroyed()) return startupWindow
  startupWindow = new BrowserWindow({
    width: 560,
    height: 360,
    minWidth: 560,
    minHeight: 360,
    show: false,
    resizable: false,
    autoHideMenuBar: true,
    title: "CodePilotX 正在连接",
    icon: resolveWindowIconPath(),
    backgroundColor: "#f8f8f6",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  startupWindow.once("ready-to-show", () => startupWindow?.show())
  registerDevToolsShortcut(startupWindow)
  startupWindow.on("closed", () => { startupWindow = undefined })
  const page = `data:text/html;charset=utf-8,${encodeURIComponent(startupPage())}`
  void startupWindow.loadURL(page).catch((error) => {
    logger?.error("desktop.startup-page-load-failed", { error })
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.show()
  })
  return startupWindow
}

function startupPage(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="color-scheme" content="light"><title>CodePilotX 正在连接</title><style>body{margin:0;background:#f8f8f6;color:#272724;font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif}.card{box-sizing:border-box;width:100%;height:100%;padding:56px 54px;background:#fff}.mark{width:42px;height:42px;border:4px solid #e7e7e2;border-top-color:#3f806a;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:22px;margin:22px 0 6px}p{margin:5px 0;color:#686862;word-break:break-word}.status{min-height:28px}.actions{margin-top:30px;display:flex;gap:10px}.actions button{border:1px solid #deded8;border-radius:9px;padding:9px 14px;background:#fff;color:#383834;cursor:pointer}.actions button.primary{background:#272724;color:#fff;border-color:#272724}</style><main class="card"><div class="mark"></div><h1>正在连接 CodePilotX Agent</h1><p id="status" class="status">正在启动…</p><p id="detail"></p><div class="actions"><button id="logs">打开日志目录</button><button id="quit" class="primary">退出</button></div></main><script>window.updateStartupStatus=(status,detail)=>{document.getElementById('status').textContent=status;document.getElementById('detail').textContent=detail||''};document.getElementById('logs').onclick=()=>window.codePilotXDesktop?.openLogDirectory().catch((error)=>window.updateStartupStatus('无法打开日志目录',String(error)));document.getElementById('quit').onclick=()=>window.codePilotXDesktop?.quitDuringStartup();</script></html>`
}

function showStartupStatus(status: string, detail?: string): void {
  if (!startupWindow || startupWindow.isDestroyed()) return
  const script = `window.updateStartupStatus?.(${JSON.stringify(status)}, ${JSON.stringify(detail ?? "")})`
  void startupWindow.webContents.executeJavaScript(script).catch((error) => {
    logger?.warn("desktop.startup-status-update-failed", { error, status })
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#f8f8f6",
    autoHideMenuBar: true,
    title: "CodePilotX",
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: true,
    },
  })

  registerDevToolsShortcut(window)
  window.webContents.on("render-process-gone", (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
    applicationLoaded = false
    logger?.error("desktop.render-process-gone", { reason: details.reason, exitCode: details.exitCode })
  })
  window.on("unresponsive", () => logger?.warn("desktop.renderer-unresponsive"))
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => logger?.info("desktop.renderer-console", { level, message, line, sourceId }))
  window.on("maximize", () => window.webContents.send("window:maximized-changed", true))
  window.on("unmaximize", () => window.webContents.send("window:maximized-changed", false))
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined
      applicationLoaded = false
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedApplicationUrl(url) && isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedApplicationUrl(url)) event.preventDefault()
  })

  mainWindow = window
  return window
}

function registerDevToolsShortcut(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F12") return
    event.preventDefault()
    window.webContents.toggleDevTools()
  })
  window.webContents.on("devtools-opened", () => logger?.info("desktop.devtools-opened"))
  window.webContents.on("devtools-closed", () => logger?.info("desktop.devtools-closed"))
}

function registerWindowIpc(): void {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize())
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle("window:close", () => mainWindow?.close())
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle("agent:connection-state", () => connectionStatus.state)
  ipcMain.handle("desktop-settings:get", async () => {
    if (!supervisor) throw new Error("Agent 尚未初始化")
    return supervisor.request("/api/desktop-settings").then(response => response.json())
  })
  ipcMain.handle("desktop-settings:save", async (_event, settings: unknown) => {
    if (!supervisor) throw new Error("Agent 尚未初始化")
    if (!isPlainObject(settings)) throw new Error("桌面设置参数无效")
    return supervisor.request("/api/desktop-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }).then(response => response.json())
  })
  ipcMain.handle("shell:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw new Error("拒绝打开不安全的外部链接")
    }
    await shell.openExternal(url)
  })
  ipcMain.handle("shell:list-external-open-targets", async (
    _event,
    targetPath: unknown,
  ) => {
    if (!externalOpenTargetService) throw new Error("外部打开服务尚未初始化")
    if (typeof targetPath !== "string") throw new Error("路径参数无效")
    return externalOpenTargetService.listTargets(targetPath)
  })
  ipcMain.handle("shell:open-path-with-target", async (
    _event,
    targetPath: unknown,
    targetId: unknown,
  ) => {
    if (!externalOpenTargetService) throw new Error("外部打开服务尚未初始化")
    if (typeof targetPath !== "string" || typeof targetId !== "string") {
      throw new Error("外部打开参数无效")
    }
    await externalOpenTargetService.openPathWithTarget(targetPath, targetId)
  })
  ipcMain.handle("shell:reveal-path-in-folder", (
    _event,
    targetPath: unknown,
  ) => {
    if (!externalOpenTargetService) throw new Error("外部打开服务尚未初始化")
    if (typeof targetPath !== "string") throw new Error("路径参数无效")
    externalOpenTargetService.revealPathInFolder(targetPath)
  })
  ipcMain.handle("startup:open-logs", async () => {
    const directory = logger?.directory ?? join(app.getPath("logs"), "codepilotx")
    const openError = await shell.openPath(directory)
    if (openError) {
      logger?.error("desktop.open-log-directory-failed", { directory, message: openError })
      throw new Error(`无法打开日志目录：${openError}`)
    }
    logger?.info("desktop.log-directory-opened", { directory })
    return directory
  })
  ipcMain.handle("startup:quit", () => { quitting = true; app.quit() })
  ipcMain.handle("workspace:pick-directory", async () => {
    const options: OpenDialogOptions = {
      title: "选择项目目录",
      properties: ["openDirectory", "createDirectory"],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

function registerAppearanceIpc(): void {
  const settingsStore = appearanceSettingsStore
  if (!settingsStore) throw new Error("外观设置存储尚未初始化")

  ipcMain.handle("appearance:settings:get", () => settingsStore.load())
  ipcMain.handle("appearance:settings:save", async (_event, settings: unknown) => {
    await settingsStore.save(settings)
  })
  ipcMain.handle("appearance:system-theme:get", () => systemThemeVariant())
  ipcMain.handle("appearance:backdrop:get-capability", () => ({
    supported: supportsWindowBackdrop(),
    platform: process.platform,
  }))
  ipcMain.handle("appearance:backdrop:apply", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("窗口背景材质参数无效")
    return applyWindowBackdrop(enabled)
  })

  nativeTheme.on("updated", broadcastSystemTheme)
  app.once("will-quit", () => nativeTheme.removeListener("updated", broadcastSystemTheme))
}

function systemThemeVariant(): "light" | "dark" {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function broadcastSystemTheme(): void {
  const variant = systemThemeVariant()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("appearance:system-theme:changed", variant)
  }
}

function supportsWindowBackdrop(): boolean {
  return process.platform === "win32"
    && Boolean(mainWindow)
    && typeof mainWindow?.setBackgroundMaterial === "function"
}

function applyWindowBackdrop(enabled: boolean): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || !supportsWindowBackdrop()) return false
  try {
    mainWindow.setBackgroundMaterial(enabled ? "acrylic" : "none")
    return true
  } catch (error) {
    logger?.warn("desktop.window-backdrop-failed", { enabled, error: formatError(error) })
    return false
  }
}

async function configureAuthCookie(origin: string, token: string): Promise<void> {
  await session.defaultSession.cookies.set({
    url: origin,
    name: AUTH_COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "strict",
  })
  logger?.info("desktop.auth-cookie-set", { origin })
}

async function verifyCookie(origin: string): Promise<void> {
  await probeReady(origin, (input, init) => session.defaultSession.fetch(input, init), undefined, 2_000)
  logger?.info("desktop.auth-cookie-verified", { origin })
}

async function loadApplication(agentOrigin: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  applicationLoaded = false
  allowedApplicationOrigin = normalizeOrigin(agentOrigin)
  const window = mainWindow
  if (!window) throw new Error("主窗口创建失败")
  await new Promise<void>((resolveLoad, rejectLoad) => {
    const timer = setTimeout(() => {
      cleanup()
      window.webContents.stop()
      logger?.error("desktop.page-load-timeout", { origin: allowedApplicationOrigin, timeoutMs: APPLICATION_LOAD_TIMEOUT_MS })
      rejectLoad(new Error(`Renderer 页面加载超时（${APPLICATION_LOAD_TIMEOUT_MS / 1_000}s）`))
    }, APPLICATION_LOAD_TIMEOUT_MS)
    const onFinished = () => { cleanup(); resolveLoad() }
    const onFailed = (_event: Electron.Event, errorCode: number, errorDescription: string, validatedURL: string) => {
      cleanup()
      logger?.error("desktop.page-load-failed", { errorCode, errorDescription, validatedURL })
      rejectLoad(new Error(`Renderer 页面加载失败：${errorDescription} (${errorCode})`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      window.webContents.removeListener("did-finish-load", onFinished)
      window.webContents.removeListener("did-fail-load", onFailed)
    }
    window.webContents.once("did-finish-load", onFinished)
    window.webContents.once("did-fail-load", onFailed)
    void window.loadURL(allowedApplicationOrigin ?? agentOrigin).catch((error) => { cleanup(); rejectLoad(error) })
  })
  applicationLoaded = true
}

function resolveSidecarCommand(): { executable: string; args: string[]; cwd: string } {
  return resolveConfiguredSidecarCommand({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDirectory: __dirname,
  })
}

function waitForReadyMessage(child: ChildProcessWithoutNullStreams, log: DesktopLogger): Promise<ReadyMessage> {
  return new Promise((resolveReady, rejectReady) => {
    let buffer = ""
    const timer = setTimeout(() => finish(new Error("等待 Agent ready 消息超时")), READY_TIMEOUT_MS)

    const finish = (result: ReadyMessage | Error): void => {
      clearTimeout(timer)
      child.stdout.removeListener("data", onData)
      child.removeListener("error", onError)
      child.removeListener("exit", onEarlyExit)
      if (result instanceof Error) rejectReady(result)
      else resolveReady(result)
    }
    const onError = (error: Error): void => finish(error)
    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void => finish(new Error(`Agent 在 ready 前退出（code=${String(code)}, signal=${String(signal)}）`))
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8")
      for (;;) {
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as Partial<ReadyMessage>
          if (parsed.type === "ready" && Number.isInteger(parsed.port) && Number(parsed.port) > 0) {
            finish({ type: "ready", port: Number(parsed.port), host: parsed.host })
            return
          }
          log.info("sidecar.stdout-json", { line })
        } catch {
          log.info("sidecar.stdout", { line })
        }
      }
    }

    child.stdout.on("data", onData)
    child.once("error", onError)
    child.once("exit", onEarlyExit)
  })
}

async function waitForReady(origin: string, token: string, log: DesktopLogger, attempt: number): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastError: unknown
  let probeCount = 0
  while (Date.now() < deadline) {
    probeCount += 1
    try {
      await probeReady(origin, fetch, token, 1_500)
      log.info("sidecar.ready-probe-ok", { origin, attempt })
      return
    } catch (error) {
      lastError = error
      if (probeCount === 1 || probeCount % 10 === 0) log.warn("sidecar.ready-probe-error", { origin, attempt, probeCount, message: formatError(error) })
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  throw new Error(`Agent 就绪检查超时：${formatError(lastError)}`)
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

async function probeReady(origin: string, fetcher: FetchLike, token: string | undefined, timeoutMs: number): Promise<void> {
  const response = await fetcher(`${origin}/api/ready`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { ok?: boolean }
  if (body.ok !== true) throw new Error("Agent ready 返回无效")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  return url.origin
}

function isAllowedApplicationUrl(value: string): boolean {
  if (value.startsWith("data:text/html")) return true
  try {
    const target = new URL(value)
    return allowedApplicationOrigin !== undefined && target.origin === allowedApplicationOrigin
  } catch {
    return false
  }
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误")
}

function isProbeTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

app.on("before-quit", (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void Promise.resolve(supervisor?.stop()).finally(() => app.exit(0))
})

app.on("window-all-closed", () => app.quit())

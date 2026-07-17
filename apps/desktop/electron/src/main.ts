import { randomBytes } from "node:crypto"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, dialog, ipcMain, session, shell, type OpenDialogOptions } from "electron"
import { resolveBunExecutable } from "./sidecar-command.js"
import { createDesktopLogger, type DesktopLogger } from "./desktop-logger.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const READY_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 20_000
const SHUTDOWN_TIMEOUT_MS = 4_000
const APPLICATION_LOAD_TIMEOUT_MS = 20_000
const WATCHDOG_INTERVAL_MS = 2_000
const WATCHDOG_FAILURE_LIMIT = 3
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

class SidecarSupervisor {
  readonly #token: string
  readonly #logger: DesktopLogger
  #child: ChildProcessWithoutNullStreams | undefined
  #connection: SidecarConnection | undefined
  #preferredPort: number | undefined
  #stopping = false
  #watchdog: NodeJS.Timeout | undefined
  #watchdogBusy = false
  #onStateChange: ((status: ConnectionStatus) => void) | undefined
  #onConnectionLost: (() => void) | undefined

  constructor(token: string, logger: DesktopLogger) {
    this.#token = token
    this.#logger = logger
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
        this.#onStateChange?.({ state: "disconnected", phase: "authenticating", attempt })
        await validate(connection)
        this.#connection = connection
        this.#logger.info("sidecar.connected", { origin: connection.origin, managed: connection.managed, port: connection.port, attempt })
        return connection
      } catch (error) {
        const message = formatError(error)
        this.#logger.warn("sidecar.connect-failed", { attempt, message })
        await this.#disposeChild()
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
    if (this.#connection && !this.#connection.managed) {
      try {
        this.#logger.info("sidecar.shutdown-request", { origin: this.#connection.origin })
        await fetch(`${this.#connection.origin}/rpc`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "desktop-shutdown", method: "shutdown", params: {} }),
          signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS),
        })
      } catch { /* process signal below is the fallback */ }
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
      void probeInitialize(connection.origin, fetch, this.#token, 1_000).then(() => {
        failures = 0
      }).catch((error) => {
        failures += 1
        this.#logger.warn("sidecar.watchdog-error", { origin: connection.origin, failures, message: formatError(error) })
      }).finally(() => {
        this.#watchdogBusy = false
        if (failures >= WATCHDOG_FAILURE_LIMIT) {
          if (this.#watchdog) clearInterval(this.#watchdog)
          this.#watchdog = undefined
          this.#onConnectionLost?.()
        }
      })
    }, WATCHDOG_INTERVAL_MS)
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
    child.stderr.on("data", (chunk: Buffer) => this.#logger.error("sidecar.stderr", { pid: child.pid, text: chunk.toString("utf8") }))

    let origin: string
    try {
      const ready = await waitForReadyMessage(child, this.#logger)
      const host = ready.host === "localhost" ? "localhost" : "127.0.0.1"
      origin = `http://${host}:${ready.port}`
      this.#preferredPort = ready.port
      await waitForReady(origin, this.#token, this.#logger, attempt)
    } catch (error) {
      await this.#disposeChild()
      throw error
    }

    child.once("exit", (code, signal) => {
      this.#logger.warn("sidecar.exit", { pid: child.pid, code, signal })
      if (!this.#stopping && this.#connection?.origin === origin) this.#onConnectionLost?.()
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
  registerWindowIpc()
  logger = createDesktopLogger(resolve(process.env.CODEPILOTX_LOG_DIR ?? join(app.getPath("logs"), "codepilotx")))
  logger.info("desktop.starting", { version: app.getVersion(), packaged: app.isPackaged, pid: process.pid })
  createStartupWindow()

  const token = process.env.CODEPILOTX_AUTH_TOKEN ?? randomBytes(32).toString("base64url")
  supervisor = new SidecarSupervisor(token, logger)
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
          connectionStatus = { state: "disconnected", phase: "loading", attempt: connectionStatus.attempt }
          showStartupStatus("正在加载桌面界面", candidate.origin)
          await loadApplication(candidate.origin)
        })
        connectionStatus = { state: "connected", phase: "loading", attempt: connectionStatus.attempt }
        logger?.info("desktop.ready", { origin: connection.origin, port: connection.port })
        mainWindow?.webContents.send("agent:connection-changed", "connected")
        startupWindow?.hide()
        mainWindow?.show()
        supervisor.watch(connection, () => {
          if (quitting || connectionStatus.state !== "connected") return
          logger?.warn("desktop.connection-lost", { origin: connection.origin })
          connectionStatus = { state: "disconnected", phase: "reconnecting", attempt: 0 }
          mainWindow?.hide()
          startupWindow?.show()
          mainWindow?.webContents.send("agent:connection-changed", "disconnected")
          supervisor?.invalidate()
          void connectAndLoad(token)
        })
        return
      } catch (error) {
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
  window.webContents.on("render-process-gone", (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => logger?.error("desktop.render-process-gone", { reason: details.reason, exitCode: details.exitCode }))
  window.on("unresponsive", () => logger?.warn("desktop.renderer-unresponsive"))
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => logger?.info("desktop.renderer-console", { level, message, line, sourceId }))
  window.on("maximize", () => window.webContents.send("window:maximized-changed", true))
  window.on("unmaximize", () => window.webContents.send("window:maximized-changed", false))
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined
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
  ipcMain.handle("shell:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw new Error("拒绝打开不安全的外部链接")
    }
    await shell.openExternal(url)
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
  await probeInitialize(origin, (input, init) => session.defaultSession.fetch(input, init), undefined, 2_000)
  logger?.info("desktop.auth-cookie-verified", { origin })
}

async function loadApplication(agentOrigin: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
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
}

function resolveSidecarCommand(): { executable: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    return {
      executable: join(process.resourcesPath, "agent", "codepilotx-agent.exe"),
      args: [],
      cwd: process.resourcesPath,
    }
  }

  const workspaceRoot = resolve(__dirname, "../../../../")
  return {
    executable: resolveBunExecutable(),
    args: ["run", process.env.CODEPILOTX_AGENT_ENTRY ?? "apps/agent/src/main.ts"],
    cwd: workspaceRoot,
  }
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
      await probeInitialize(origin, fetch, token, 1_500)
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

async function probeInitialize(origin: string, fetcher: FetchLike, token: string | undefined, timeoutMs: number): Promise<void> {
  const response = await fetcher(`${origin}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "desktop-initialize", method: "initialize", params: {} }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json() as { result?: { ok?: boolean }; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? "Agent initialize 失败")
  if (body.result?.ok !== true) throw new Error("Agent initialize 返回无效")
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

app.on("before-quit", (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void Promise.resolve(supervisor?.stop()).finally(() => app.exit(0))
})

app.on("window-all-closed", () => app.quit())

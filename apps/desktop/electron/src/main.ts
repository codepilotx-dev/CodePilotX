import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { app, shell } from "electron"
import { registerAppearanceIpc } from "./ipc/register-appearance-ipc.js"
import { registerDesktopIpc } from "./ipc/register-desktop-ipc.js"
import { ExternalOpenTargetService } from "./ipc/external-open-targets.js"
import {
  createDesktopLogger,
  type DesktopLogger,
} from "./logging/desktop-logger.js"
import {
  configureAuthCookie,
  verifyAuthCookie,
} from "./security/auth-session.js"
import { AppearanceSettingsStore } from "./settings/appearance-settings-store.js"
import { formatError, sleep } from "./sidecar/readiness.js"
import {
  type ConnectionStatus,
  SidecarSupervisor,
} from "./sidecar/supervisor.js"
import { SidecarInstallationError } from "./sidecar/command.js"
import { WindowAppearanceController } from "./windows/appearance.js"
import { WindowManager } from "./windows/window-manager.js"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

let supervisor: SidecarSupervisor | undefined
let logger: DesktopLogger | undefined
let windows: WindowManager | undefined
let quitting = false
let connectionStatus: ConnectionStatus = {
  state: "unknown",
  phase: "starting",
  attempt: 0,
}
let connectionTask: Promise<void> | undefined

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    windows?.focus(connectionStatus.state === "connected")
  })
  app.whenReady().then(startDesktop).catch((error: unknown) => {
    logger?.error("desktop.startup-failed", { error })
    windows?.showStartupStatus(
      "启动流程异常",
      formatError(error),
      "terminal-error",
    )
  })
}

async function startDesktop(): Promise<void> {
  const logDirectory = resolve(
    process.env.CODEPILOTX_LOG_DIR
      ?? join(app.getPath("logs"), "codepilotx"),
  )
  logger = createDesktopLogger(logDirectory)
  logger.info("desktop.starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    pid: process.pid,
  })

  windows = new WindowManager(logger, moduleDirectory)
  const appearanceSettings = new AppearanceSettingsStore(
    app.getPath("userData"),
    logger,
  )
  const appearance = new WindowAppearanceController(windows, logger)
  const externalOpenTargets = new ExternalOpenTargetService({
    platform: process.platform,
    env: process.env,
    getFileIconDataUrl: async path =>
      (await app.getFileIcon(path, { size: "normal" })).toDataURL(),
    openPath: path => shell.openPath(path),
    revealPath: path => shell.showItemInFolder(path),
    spawnProcess: (executablePath, args, options) =>
      spawn(executablePath, [...args], options),
  })

  registerDesktopIpc({
    windows,
    logger,
    externalOpenTargets,
    getSupervisor: () => supervisor,
    getConnectionState: () => connectionStatus.state,
    getLogDirectory: () => logger?.directory ?? logDirectory,
    quitDuringStartup: () => app.quit(),
  })
  registerAppearanceIpc(appearanceSettings, appearance)
  windows.createStartupWindow()

  const token = process.env.CODEPILOTX_AUTH_TOKEN
    ?? randomBytes(32).toString("base64url")
  supervisor = new SidecarSupervisor(token, logger, moduleDirectory)
  supervisor.onStateChange((status) => {
    connectionStatus = status
    logger?.info("desktop.connection-state", { ...status })
    windows?.send("agent:connection-changed", status.state)
    windows?.showStartupStatus(
      status.phase === "reconnecting"
        ? "Agent 连接中断，正在重试"
        : "正在连接 Agent",
      status.message ?? `第 ${status.attempt} 次尝试`,
    )
  })
  await connectAndLoad(token)
}

async function connectAndLoad(token: string): Promise<void> {
  if (connectionTask) return connectionTask
  connectionTask = runConnectionCycle(token)
  try {
    await connectionTask
  } finally {
    connectionTask = undefined
  }
}

async function runConnectionCycle(token: string): Promise<void> {
  while (!quitting && supervisor && windows && logger) {
    try {
      const connection = await supervisor.connect(async (candidate) => {
        windows?.showStartupStatus(
          "正在验证 Agent 认证",
          candidate.origin,
        )
        if (!logger || !windows) throw new Error("桌面服务尚未初始化")
        await configureAuthCookie(candidate.origin, token, logger)
        await verifyAuthCookie(candidate.origin, logger)
        connectionStatus = {
          state: "disconnected",
          phase: "loading",
          attempt: connectionStatus.attempt,
        }
        windows.showStartupStatus("正在加载桌面界面", candidate.origin)
        await windows.loadApplication(candidate.origin)
      })
      connectionStatus = {
        state: "connected",
        phase: "loading",
        attempt: connectionStatus.attempt,
      }
      logger.info("desktop.ready", {
        origin: connection.origin,
        port: connection.port,
      })
      windows.send("agent:connection-changed", "connected")
      windows.showApplication()
      supervisor.watch(connection, () => {
        if (quitting || connectionStatus.state !== "connected") return
        logger?.warn("desktop.connection-lost", {
          origin: connection.origin,
        })
        connectionStatus = {
          state: "disconnected",
          phase: "reconnecting",
          attempt: 0,
        }
        windows?.showReconnectWindow()
        windows?.send("agent:connection-changed", "disconnected")
        supervisor?.invalidate()
        void connectAndLoad(token)
      })
      return
    } catch (error) {
      if (error instanceof SidecarInstallationError) {
        logger.error("desktop.startup-failed", {
          code: error.code,
          message: error.message,
          executable: error.executable,
        })
        windows.showStartupStatus(
          "安装不完整，请重新安装",
          "CodePilotX Agent 文件缺失",
          "terminal-error",
        )
        return
      }
      logger.error("desktop.connection-cycle-failed", { error })
      windows.showStartupStatus(
        "连接失败，正在继续重试",
        formatError(error),
      )
      if (quitting) return
      await sleep(1_000)
    }
  }
}

app.on("before-quit", (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void Promise.resolve(supervisor?.stop()).finally(() => app.exit(0))
})

app.on("window-all-closed", () => app.quit())

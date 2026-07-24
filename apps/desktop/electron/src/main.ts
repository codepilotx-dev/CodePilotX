import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { app, nativeTheme, screen, shell } from "electron"
import type { DesktopThemeSettingsV5 } from "@codepilotx/shared/desktop-theme"
import {
  DESKTOP_SETTINGS_IPC_CHANNELS,
  type DesktopSettingsPayload,
} from "@codepilotx/shared/desktop-settings-ipc"
import { registerAppearanceIpc } from "./ipc/register-appearance-ipc.js"
import { registerDataLocationIpc } from "./ipc/register-data-location-ipc.js"
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
import {
  AppearanceSettingsStore,
  DEFAULT_APPEARANCE_SETTINGS,
} from "./settings/appearance-settings-store.js"
import {
  DataLocationStore,
  type DataLocationLaunch,
} from "./settings/data-location-store.js"
import { formatError, sleep } from "./sidecar/readiness.js"
import {
  type ConnectionStatus,
  SidecarSupervisor,
} from "./sidecar/supervisor.js"
import { SidecarInstallationError } from "./sidecar/command.js"
import { WindowAppearanceController } from "./windows/appearance.js"
import { WindowManager } from "./windows/window-manager.js"
import { registerPetOverlayIpc } from "./ipc/register-pet-overlay-ipc.js"
import { PetOverlayWindowController } from "./windows/pet-overlay-window.js"
import { PetOverlayWindowStateStore } from "./windows/pet-overlay-window-state.js"
import { resolveStartupPageTheme } from "./windows/startup-page.js"
import {
  type DesktopDisplayWorkArea,
  WindowStateStore,
} from "./windows/window-state.js"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const configuredUserDataDirectory =
  process.env.CODEPILOTX_USER_DATA_DIR?.trim()
if (configuredUserDataDirectory) {
  app.setPath("userData", resolve(configuredUserDataDirectory))
}

let supervisor: SidecarSupervisor | undefined
let logger: DesktopLogger | undefined
let windows: WindowManager | undefined
let petOverlay: PetOverlayWindowController | undefined
let quitting = false
let connectionStatus: ConnectionStatus = {
  state: "unknown",
  phase: "starting",
  attempt: 0,
}
let connectionTask: Promise<void> | undefined
let dataLocationStore: DataLocationStore | undefined
let dataLocationLaunch: DataLocationLaunch | undefined

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

  const appearanceSettings = new AppearanceSettingsStore(
    app.getPath("userData"),
    logger,
  )
  dataLocationStore = new DataLocationStore(
    app.getPath("userData"),
    join(app.getPath("home"), ".codepilotx"),
    process.env.CODEPILOTX_DATA_DIR?.trim() || null,
  )
  dataLocationLaunch = await dataLocationStore.launch()
  const startupTheme = await resolveStartupTheme(appearanceSettings, logger)
  const windowStateStore = new WindowStateStore(app.getPath("userData"), logger)
  const displayWorkAreas = screen.getAllDisplays().map(
    display => display.workArea as DesktopDisplayWorkArea,
  )
  const primaryWorkArea =
    screen.getPrimaryDisplay().workArea as DesktopDisplayWorkArea
  const initialWindowState = await windowStateStore.load(
    displayWorkAreas,
    primaryWorkArea,
  )
  windows = new WindowManager(logger, moduleDirectory, {
    initialWindowState,
    startupTheme,
    windowStateStore,
  })
  const petOverlayStateStore = new PetOverlayWindowStateStore(
    app.getPath("userData"),
    logger,
  )
  const initialPetOverlayState = await petOverlayStateStore.load(
    displayWorkAreas,
    primaryWorkArea,
  )
  petOverlay = new PetOverlayWindowController(
    logger,
    moduleDirectory,
    petOverlayStateStore,
    initialPetOverlayState,
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
    isDesktopRendererSender: sender =>
      windows?.isMainSender(sender) === true
      || petOverlay?.isOverlaySender(sender) === true,
    broadcastDesktopSettingsChanged: settings => {
      broadcastDesktopSettingsChanged(settings)
    },
  })
  registerAppearanceIpc(appearanceSettings, appearance)
  registerDataLocationIpc({
    store: dataLocationStore,
    windows,
    installDirectory: app.isPackaged
      ? dirname(app.getPath("exe"))
      : app.getAppPath(),
    relaunch: relaunchApplication,
  })
  registerPetOverlayIpc(windows, petOverlay)
  windows.createStartupWindow()

  const token = process.env.CODEPILOTX_AUTH_TOKEN
    ?? randomBytes(32).toString("base64url")
  supervisor = new SidecarSupervisor(
    token,
    logger,
    moduleDirectory,
    dataLocationLaunch,
  )
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
        petOverlay?.setApplicationOrigin(candidate.origin)
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
      if (dataLocationLaunch?.relocation) {
        await dataLocationStore?.promotePending()
        dataLocationLaunch = {
          dataDir: dataLocationLaunch.dataDir,
          relocation: null,
        }
      }
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
      if (dataLocationLaunch?.relocation) {
        logger.error("desktop.data-location-relocation-failed", {
          reason: "agent-startup-failed",
        })
        windows.showStartupStatus(
          "用户数据迁移失败",
          "可以重试迁移，或恢复原数据位置后重新启动。",
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
  void Promise.allSettled([
    Promise.resolve(supervisor?.stop()),
    windows?.flushWindowState() ?? Promise.resolve(),
    petOverlay?.flushState() ?? Promise.resolve(),
  ]).finally(() => app.exit(0))
})

function broadcastDesktopSettingsChanged(
  settings: DesktopSettingsPayload,
): void {
  windows?.send(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
  petOverlay?.send(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
}

app.on("window-all-closed", () => app.quit())

function relaunchApplication(): void {
  app.relaunch()
  app.quit()
}

async function resolveStartupTheme(
  settingsStore: AppearanceSettingsStore,
  desktopLogger: DesktopLogger,
) {
  let settings: DesktopThemeSettingsV5
  try {
    settings = await settingsStore.load()
  } catch (error) {
    desktopLogger.warn("appearance-settings.startup-fallback", { error })
    settings = DEFAULT_APPEARANCE_SETTINGS
  }
  return resolveStartupPageTheme(
    settings,
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  )
}

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { app, clipboard, ipcMain, nativeTheme, screen, session, shell } from "electron"
import electronUpdater from "electron-updater"
import {
  DESKTOP_SETTINGS_IPC_CHANNELS,
  type DesktopSettingsPayload,
} from "@codepilotx/shared/desktop-settings-ipc"
import {
  DESKTOP_UPDATE_IPC_CHANNELS,
} from "@codepilotx/shared/desktop-update-ipc"
import { registerAppearanceIpc } from "./ipc/register-appearance-ipc.js"
import { registerDataLocationIpc } from "./ipc/register-data-location-ipc.js"
import { registerDesktopIpc } from "./ipc/register-desktop-ipc.js"
import { registerTerminalIpc } from "./ipc/register-terminal-ipc.js"
import { registerBrowserIpc } from "./ipc/register-browser-ipc.js"
import { ExternalOpenTargetService } from "./ipc/external-open-targets.js"
import { AttachmentDownloadService } from "./ipc/attachment-download-service.js"
import { ComposerPathGrantService } from "./ipc/composer-path-grant-service.js"
import {
  createDesktopClipboardService,
  createDesktopClipboardTimer,
} from "./clipboard/desktop-clipboard-service.js"
import {
  createDesktopLogger,
  resolveDesktopLogDirectory,
  type DesktopLogger,
} from "./logging/desktop-logger.js"
import {
  configureAuthCookie,
  verifyAuthCookie,
} from "./security/auth-session.js"
import { readStartupAppearanceConfig } from "./settings/startup-appearance-config.js"
import { AppearanceSettingsStore } from "./settings/appearance-settings-store.js"
import {
  DataLocationStore,
  type DataLocationLaunch,
} from "./settings/data-location-store.js"
import { formatError } from "./sidecar/readiness.js"
import { SidecarSupervisor } from "./sidecar/supervisor.js"
import { DesktopAgentConnectionCoordinator } from "./sidecar/connection-coordinator.js"
import { orchestrateDesktopQuit } from "./sidecar/desktop-quit-orchestrator.js"
import { WindowAppearanceController } from "./windows/appearance.js"
import { WindowManager } from "./windows/window-manager.js"
import { registerPetOverlayIpc } from "./ipc/register-pet-overlay-ipc.js"
import {
  createElectronNotificationFactory,
  publishNotificationActivation,
  registerNotificationIpc,
  resolveNotificationIconPath,
} from "./ipc/register-notification-ipc.js"
import { DesktopNotificationService } from "./notifications/desktop-notification-service.js"
import { PetOverlayWindowController } from "./windows/pet-overlay-window.js"
import { PetOverlayWindowStateStore } from "./windows/pet-overlay-window-state.js"
import {
  DesktopAutoUpdater,
  type ElectronAutoUpdaterLike,
} from "./update/desktop-auto-updater.js"
import { resolveStartupPageTheme } from "./windows/startup-page.js"
import {
  type DesktopDisplayWorkArea,
  WindowStateStore,
} from "./windows/window-state.js"
import {
  TerminalManager,
} from "./terminal/terminal-manager.js"
import { TerminalHostRpcClient } from "./terminal/terminal-host-rpc-client.js"
import { stopTerminalsBeforeSupervisor } from "./terminal/terminal-shutdown.js"
import { runPackagedTerminalSmoke } from "./terminal/packaged-terminal-smoke.js"
import { DESKTOP_TERMINAL_IPC_CHANNELS } from "@codepilotx/shared/desktop-terminal-ipc"
import { DESKTOP_BROWSER_IPC_CHANNELS } from "@codepilotx/shared/desktop-browser-ipc"
import {
  DESKTOP_DEEP_LINK_IPC_CHANNELS,
  normalizeDesktopThreadDeepLinkPayload,
} from "@codepilotx/shared/desktop-deep-link-ipc"
import { DesktopBrowserController } from "./browser/browser-controller.js"
import {
  registerMicrophoneIpc,
  WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL,
} from "./ipc/register-microphone-ipc.js"
import {
  registerMicrophoneMediaPermissions,
} from "./security/microphone-media-permission.js"
import {
  createThreadDeepLinkController,
  type ThreadDeepLinkController,
} from "./deep-link/thread-deep-link-controller.js"

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const configuredUserDataDirectory =
  process.env.CODEPILOTX_USER_DATA_DIR?.trim()
if (configuredUserDataDirectory) {
  app.setPath("userData", resolve(configuredUserDataDirectory))
}

// Windows toast 归属依赖 AppUserModelID；packaged 使用与 electron-builder
// appId 一致的稳定 ID，开发态只能用进程路径做功能调试。
if (process.platform === "win32") {
  app.setAppUserModelId(
    app.isPackaged
      ? "com.codepilotx.desktop"
      : process.execPath,
  )
}

// Windows codepilotx:// 默认协议客户端注册保持最小：packaged 安装由
// electron-builder protocols 注册，这里只补充运行时默认客户端注册，
// 不改变开发/打包启动路径。
if (process.platform === "win32") {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(
      "codepilotx",
      process.execPath,
      [resolve(process.argv[1])],
    )
  } else {
    app.setAsDefaultProtocolClient("codepilotx")
  }
}

let supervisor: SidecarSupervisor | undefined
let logger: DesktopLogger | undefined
let windows: WindowManager | undefined
let petOverlay: PetOverlayWindowController | undefined
let quitting = false
let connectionCoordinator: DesktopAgentConnectionCoordinator | undefined
let dataLocationStore: DataLocationStore | undefined
let dataLocationLaunch: DataLocationLaunch | undefined
let terminalManager: TerminalManager | undefined
let terminalHost: TerminalHostRpcClient | undefined
let browserController: DesktopBrowserController | undefined
let deepLinkController: ThreadDeepLinkController | undefined
let rendererDeepLinkReady = false

const packagedTerminalSmokeResult = process.env.CODEPILOTX_PACKAGED_TERMINAL_SMOKE_RESULT?.trim()
const packagedTerminalSmokeRequested = process.argv.includes("--codepilotx-packaged-terminal-smoke")
if (
  app.isPackaged
  && process.platform === "win32"
  && packagedTerminalSmokeRequested
  && packagedTerminalSmokeResult
) {
  app.whenReady()
    .then(() => runPackagedTerminalSmoke(packagedTerminalSmokeResult))
    .then(() => app.exit(0), () => app.exit(1))
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
  } else {
    // 唯一深链 controller 在生命周期监听注册前创建，从一开始接收
    // process.argv、second-instance 与 open-url；依赖闭包在 windows /
    // rendererDeepLinkReady 建立后自然生效。冷启动 pending 只保存
    // 解析后的 threadId，并由 Renderer 主动 consume。
    deepLinkController = createThreadDeepLinkController({
      getInitialArgv: () => process.argv,
      subscribeRendererReady: () => () => {},
      isRendererReady: () => rendererDeepLinkReady,
      focusMainWindow: () => windows?.focus(true),
      notify: payload => {
        const normalized = normalizeDesktopThreadDeepLinkPayload(payload)
        if (normalized !== null) {
          windows?.send(DESKTOP_DEEP_LINK_IPC_CHANNELS.activated, normalized)
        }
      },
    })
    app.on("second-instance", (_event, argv) => {
      const handled = deepLinkController?.pushRuntimeActivation(argv) === true
      if (!handled) {
        windows?.focus(
          connectionCoordinator?.status.connectionState === "connected",
        )
      }
    })
    app.on("open-url", (event, url) => {
      if (deepLinkController?.pushRuntimeActivation([url]) === true) {
        event.preventDefault()
      }
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
}

async function startDesktop(): Promise<void> {
  dataLocationStore = new DataLocationStore(
    app.getPath("userData"),
    join(app.getPath("home"), ".codepilotx"),
    process.env.CODEPILOTX_DATA_DIR?.trim() || null,
  )
  dataLocationLaunch = await dataLocationStore.launch()
  const logDirectory = resolveDesktopLogDirectory(
    dataLocationLaunch,
    process.env.CODEPILOTX_LOG_DIR,
  )
  logger = createDesktopLogger(logDirectory)
  logger.info("desktop.starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    pid: process.pid,
  })
  const appearanceSettings = await readStartupAppearanceConfig(
    join(dataLocationLaunch.dataDir, "config.json"),
    join(dataLocationLaunch.dataDir, "config.toml"),
    join(app.getPath("userData"), "appearance-settings.json"),
  )
  const startupTheme = resolveStartupPageTheme(
    appearanceSettings,
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  )
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
  registerMicrophoneMediaPermissions({
    session: session.defaultSession,
    getAllowedApplicationOrigin: () => windows?.applicationOrigin,
    isMainWindowSender: sender => windows?.isMainSender(sender) === true,
  })
  registerMicrophoneIpc({
    ipc: ipcMain,
    isMainWindowSender: sender => windows?.isMainSender(sender) === true,
    openMicrophonePrivacySettings: async () => {
      await shell.openExternal(WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL)
    },
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
  const appearance = new WindowAppearanceController(appearanceSettings)
  appearance.onThemeChange(theme => {
    windows?.updateTitleBarOverlayTheme(theme)
  })
  const externalOpenTargets = new ExternalOpenTargetService({
    platform: process.platform,
    env: process.env,
    openPath: path => shell.openPath(path),
    revealPath: path => shell.showItemInFolder(path),
    spawnProcess: (executablePath, args, options) =>
      spawn(executablePath, [...args], options),
  })
  const updater = new DesktopAutoUpdater({
    packaged: app.isPackaged,
    version: app.getVersion(),
    logger,
    updater: electronUpdater.autoUpdater as ElectronAutoUpdaterLike,
    onStatusChange: status => {
      windows?.send(DESKTOP_UPDATE_IPC_CHANNELS.status, status)
    },
  })
  const attachmentDownloads = new AttachmentDownloadService({
    getDownloadsDirectory: () => app.getPath("downloads"),
  })
  const composerPathGrants = new ComposerPathGrantService()
  browserController = new DesktopBrowserController({
    getMainWindow: () => windows?.mainWindow,
    publish: state => windows?.send(
      DESKTOP_BROWSER_IPC_CHANNELS.stateChanged,
      state,
    ),
    logger,
  })

  const clipboardService = createDesktopClipboardService({
    adapter: {
      writeText: text => clipboard.writeText(text),
      writeRichText: ({ text, html }) => clipboard.write({ text, html }),
      readText: () => clipboard.readText(),
      clear: () => clipboard.clear(),
    },
    timer: createDesktopClipboardTimer(),
  })

  registerDesktopIpc({
    windows,
    logger,
    externalOpenTargets,
    updater,
    attachmentDownloads,
    composerPathGrants,
    clipboardService,
    getSupervisor: () => supervisor,
    getLogDirectory: () => logger?.directory ?? logDirectory,
    quitDuringStartup: () => app.quit(),
    isDesktopRendererSender: sender =>
      windows?.isMainSender(sender) === true
      || petOverlay?.isOverlaySender(sender) === true,
    broadcastDesktopSettingsChanged: settings => {
      broadcastDesktopSettingsChanged(settings)
    },
  })
  terminalHost = new TerminalHostRpcClient(() => supervisor, logger)
  terminalManager = new TerminalManager({
    contextResolver: terminalHost,
    actionResolver: terminalHost,
    mirrorSink: terminalHost,
    onEvent: event => {
      windows?.send(DESKTOP_TERMINAL_IPC_CHANNELS.event, event)
    },
  })
  registerTerminalIpc({
    manager: terminalManager,
    isMainWindowSender: sender => windows?.isMainSender(sender) === true,
  })
  registerBrowserIpc({
    controller: browserController,
    isMainWindowSender: sender => windows?.isMainSender(sender) === true,
  })
  registerAppearanceIpc(
    appearanceSettings,
    appearance,
    new AppearanceSettingsStore(app.getPath("userData"), logger),
    windows,
  )
  registerDataLocationIpc({
    store: dataLocationStore,
    windows,
    installDirectory: app.isPackaged
      ? dirname(app.getPath("exe"))
      : app.getAppPath(),
    relaunch: relaunchApplication,
  })
  registerPetOverlayIpc(windows, petOverlay)
  const notificationService = new DesktopNotificationService({
    logger,
    factory: createElectronNotificationFactory(),
    resolveIconPath: resolveNotificationIconPath,
    isMainWindowFocused: () => windows?.mainWindow?.isFocused() === true,
    focusMainWindow: () => windows?.focus(true),
    publishActivation: activation =>
      publishNotificationActivation(windows, activation),
  })
  registerNotificationIpc(windows, notificationService)
  ipcMain.handle(DESKTOP_DEEP_LINK_IPC_CHANNELS.consumePending, (event) => {
    if (windows?.isMainSender(event.sender) !== true) return null
    // 11B 保证 Renderer 先注册 activated listener 再调用 consume，因此
    // 经过主窗口 sender 校验的该 invoke 是可靠的 ready 握手。
    rendererDeepLinkReady = true
    return deepLinkController?.consumePendingThreadDeepLink() ?? null
  })
  windows.createStartupWindow()
  attachDeepLinkReadyLifecycle()

  const token = process.env.CODEPILOTX_AUTH_TOKEN
    ?? randomBytes(32).toString("base64url")
  supervisor = new SidecarSupervisor(
    token,
    logger,
    moduleDirectory,
    dataLocationLaunch,
    {
      appRuntime: {
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        getPath: name => app.getPath(name),
      },
    },
  )
  const activeLogger = logger
  const activeWindows = windows
  connectionCoordinator = new DesktopAgentConnectionCoordinator({
    supervisor,
    logger: activeLogger,
    loadConnection: async (candidate, guard) => {
      guard.assertCurrent()
      activeWindows.showStartupStatus(
        "正在验证 Agent 认证",
        candidate.origin,
      )
      await configureAuthCookie(candidate.origin, token, activeLogger)
      guard.assertCurrent()
      await verifyAuthCookie(candidate.origin, activeLogger)
      guard.assertCurrent()
      petOverlay?.setApplicationOrigin(candidate.origin)
      guard.assertCurrent()
      activeWindows.showStartupStatus("正在加载桌面界面", candidate.origin)
      guard.assertCurrent()
      await activeWindows.loadApplication(candidate.origin)
      guard.assertCurrent()
    },
    onConnected: async (connection, guard) => {
      guard.assertCurrent()
      activeLogger.info("desktop.ready", {
        origin: connection.origin,
        port: connection.port,
        generation: connection.generation,
      })
      if (dataLocationLaunch?.relocation) {
        await dataLocationStore?.promotePending()
        guard.assertCurrent()
        dataLocationLaunch = {
          dataDir: dataLocationLaunch.dataDir,
          relocation: null,
        }
      }
      guard.assertCurrent()
      activeWindows.showApplication()
    },
    onReconnecting: () => {
      rendererDeepLinkReady = false
      browserController?.suspendAll()
      windows?.showReconnectWindow()
    },
    onBeforeReconnect: () => terminalHost?.invalidate(),
    isRelocating: () => Boolean(dataLocationLaunch?.relocation),
    onTerminalFailure: (error, kind) => {
      if (kind === "installation") {
        activeLogger.error("desktop.startup-failed", {
          code: "SIDECAR_INSTALLATION_INCOMPLETE",
        })
        activeWindows.showStartupStatus(
          "安装不完整，请重新安装",
          "CodePilotX Agent 文件缺失",
          "terminal-error",
        )
        return
      }
      if (kind === "relocation") {
        activeLogger.error("desktop.data-location-relocation-failed", {
          reason: "agent-startup-failed",
        })
        activeWindows.showStartupStatus(
          "用户数据迁移失败",
          "可以重试迁移，或恢复原数据位置后重新启动。",
          "terminal-error",
        )
        return
      }
      if (kind === "termination") {
        activeLogger.error("desktop.sidecar-termination-unconfirmed", {
          code: "SIDECAR_TERMINATION_UNCONFIRMED",
        })
        activeWindows.showStartupStatus(
          "残留 Agent 未退出",
          "请结束残留 Agent 进程后重新启动 CodePilotX。",
          "terminal-error",
        )
        return
      }
      activeLogger.error("desktop.connection-cycle-failed", { error })
      activeWindows.showStartupStatus("Agent 连接失败", formatError(error), "terminal-error")
    },
  })
  connectionCoordinator.onStateChange(status => {
    logger?.info("desktop.connection-state", {
      state: status.connectionState,
      phase: status.phase,
      lifecycle: status.lifecycle,
      attempt: status.attempt,
    })
    if (
      status.lifecycle === "idle"
      || status.lifecycle === "failed"
      || status.lifecycle === "connected"
    ) return
    windows?.showStartupStatus(
      status.phase === "reconnecting"
        ? "Agent 连接中断，正在重试"
        : "正在连接 Agent",
      status.message ?? `第 ${status.attempt} 次尝试`,
    )
  })
  await connectionCoordinator.start()
}

app.on("before-quit", (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  void orchestrateDesktopQuit({
    stopRuntime: () => {
      browserController?.dispose()
      disposeDeepLinkController()
      return stopTerminalsBeforeSupervisor({
        manager: terminalManager,
        stopSupervisor: async () => {
          terminalHost?.invalidate()
          if (connectionCoordinator) await connectionCoordinator.stop()
          else await supervisor?.stop()
        },
      })
    },
    flushState: [
      () => windows?.flushWindowState() ?? Promise.resolve(),
      () => petOverlay?.flushState() ?? Promise.resolve(),
    ],
    exit: () => app.exit(0),
    onBlocked: () => {
      quitting = false
      logger?.error("desktop.quit-blocked", {
        code: "SIDECAR_TERMINATION_UNCONFIRMED",
      })
      windows?.showReconnectWindow()
      windows?.showStartupStatus(
        "残留 Agent 未退出",
        "请在任务管理器中结束残留 Agent 进程，然后再次退出以重新检查。",
        "terminal-error",
      )
    },
  })
})

function broadcastDesktopSettingsChanged(
  settings: DesktopSettingsPayload,
): void {
  windows?.send(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
  petOverlay?.send(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
}

function disposeDeepLinkController(): void {
  deepLinkController?.dispose()
  deepLinkController = undefined
  ipcMain.removeHandler(DESKTOP_DEEP_LINK_IPC_CHANNELS.consumePending)
}

// 主窗口主框架重新导航或销毁时重置 ready，避免 reload 后沿用旧 ready；
// 同文档导航（SPA pushState 等）不重置。窗口/WebContents 在重连与导航间
// 复用，仅在窗口销毁时更换，因此一次装配覆盖整个生命周期。
function attachDeepLinkReadyLifecycle(): void {
  const mainWindow = windows?.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  const webContents = mainWindow.webContents
  webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      rendererDeepLinkReady = false
    }
  })
  webContents.on("destroyed", () => {
    rendererDeepLinkReady = false
  })
}

app.on("window-all-closed", () => app.quit())

function relaunchApplication(): void {
  app.relaunch()
  app.quit()
}

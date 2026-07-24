import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  app,
  BrowserWindow,
  nativeImage,
  shell,
  type WebContents,
} from "electron"
import type { DesktopChromeTheme } from "@codepilotx/shared/desktop-theme"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import {
  isAllowedApplicationUrl,
  isSafeExternalUrl,
  normalizeOrigin,
} from "../security/navigation.js"
import {
  renderStartupPage,
  type StartupStatusKind,
} from "./startup-page.js"
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  type DesktopWindowBounds,
  type DesktopWindowStateV1,
  WindowStateStore,
} from "./window-state.js"

const APPLICATION_LOAD_TIMEOUT_MS = 20_000

export interface WindowManagerOptions {
  initialWindowState: DesktopWindowStateV1
  startupTheme: {
    variant: "light" | "dark"
    theme: Pick<DesktopChromeTheme, "surface" | "ink" | "accent">
  }
  windowStateStore: WindowStateStore
}

export class WindowManager {
  readonly #logger: DesktopLogger
  readonly #moduleDirectory: string
  readonly #options: WindowManagerOptions
  #mainWindow: BrowserWindow | undefined
  #normalWindowBounds: DesktopWindowBounds
  #allowedApplicationOrigin: string | undefined
  #navigationGeneration = 0
  #startupPageActive = false
  #startupStatus: {
    status: string
    detail: string
    kind: StartupStatusKind
  } = {
    status: "正在启动…",
    detail: "",
    kind: "progress",
  }

  constructor(
    logger: DesktopLogger,
    moduleDirectory: string,
    options: WindowManagerOptions,
  ) {
    this.#logger = logger
    this.#moduleDirectory = moduleDirectory
    this.#options = options
    this.#normalWindowBounds = options.initialWindowState.bounds
  }

  get mainWindow(): BrowserWindow | undefined {
    return this.#mainWindow
  }

  isMainSender(sender: WebContents): boolean {
    return this.#mainWindow?.webContents === sender
  }

  flushWindowState(): Promise<void> {
    return this.#options.windowStateStore.flush()
  }

  restoreBackgroundColor(): void {
    const mainWindow = this.#mainWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(this.#options.startupTheme.theme.surface)
    }
  }

  focus(_connectionIsReady: boolean): void {
    const mainWindow = this.#mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  createStartupWindow(): BrowserWindow {
    const mainWindow = this.#ensureMainWindow()
    this.#loadStartupPage(mainWindow)
    return mainWindow
  }

  showStartupStatus(
    status: string,
    detail = "",
    kind: StartupStatusKind = "progress",
  ): void {
    this.#startupStatus = { status, detail, kind }
    this.#sendStartupStatus()
  }

  async loadApplication(agentOrigin: string): Promise<void> {
    const navigationGeneration = ++this.#navigationGeneration
    this.#startupPageActive = false
    const mainWindow = this.#ensureMainWindow()
    this.#allowedApplicationOrigin = normalizeOrigin(agentOrigin)
    this.#setThemeBackground(mainWindow)
    try {
      await new Promise<void>((resolveLoad, rejectLoad) => {
        const timer = setTimeout(() => {
          cleanup()
          mainWindow.webContents.stop()
          this.#logger.error("desktop.page-load-timeout", {
            origin: this.#allowedApplicationOrigin,
            timeoutMs: APPLICATION_LOAD_TIMEOUT_MS,
          })
          rejectLoad(
            new Error(
              `Renderer 页面加载超时（${APPLICATION_LOAD_TIMEOUT_MS / 1_000}s）`,
            ),
          )
        }, APPLICATION_LOAD_TIMEOUT_MS)
        const onFinished = () => {
          cleanup()
          resolveLoad()
        }
        const onFailed = (
          _event: Electron.Event,
          errorCode: number,
          errorDescription: string,
          validatedURL: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame) return
          cleanup()
          this.#logger.error("desktop.page-load-failed", {
            errorCode,
            errorDescription,
            validatedURL,
          })
          rejectLoad(
            new Error(
              `Renderer 页面加载失败：${errorDescription} (${errorCode})`,
            ),
          )
        }
        const cleanup = () => {
          clearTimeout(timer)
          mainWindow.webContents.removeListener("did-finish-load", onFinished)
          mainWindow.webContents.removeListener("did-fail-load", onFailed)
        }
        mainWindow.webContents.once("did-finish-load", onFinished)
        mainWindow.webContents.on("did-fail-load", onFailed)
        void mainWindow
          .loadURL(this.#allowedApplicationOrigin ?? agentOrigin)
          .catch((error) => {
            cleanup()
            rejectLoad(error)
          })
      })
      if (navigationGeneration !== this.#navigationGeneration) {
        throw new Error("Renderer 页面加载已被新的导航替代")
      }
    } catch (error) {
      if (
        navigationGeneration === this.#navigationGeneration
        && !mainWindow.isDestroyed()
      ) {
        this.#loadStartupPage(mainWindow)
      }
      throw error
    }
  }

  showApplication(): void {
    const mainWindow = this.#mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  showReconnectWindow(): void {
    this.createStartupWindow()
  }

  send(channel: string, ...args: unknown[]): void {
    const mainWindow = this.#mainWindow
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args)
    }
  }

  #ensureMainWindow(): BrowserWindow {
    const existingWindow = this.#mainWindow
    if (existingWindow && !existingWindow.isDestroyed()) return existingWindow

    const mainWindow = new BrowserWindow({
      ...this.#options.initialWindowState.bounds,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      show: false,
      frame: false,
      backgroundColor: this.#options.startupTheme.theme.surface,
      autoHideMenuBar: true,
      title: "CodePilotX",
      icon: this.#resolveWindowIconPath(),
      webPreferences: {
        preload: join(this.#moduleDirectory, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: true,
      },
    })
    this.#mainWindow = mainWindow
    this.#registerDevToolsShortcut(mainWindow)
    mainWindow.webContents.on(
      "render-process-gone",
      (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        this.#logger.error("desktop.render-process-gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        })
      },
    )
    mainWindow.on("unresponsive", () => {
      this.#logger.warn("desktop.renderer-unresponsive")
    })
    mainWindow.webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        this.#logger.info("desktop.renderer-console", {
          level,
          message,
          line,
          sourceId,
        })
      },
    )
    mainWindow.on("maximize", () => {
      mainWindow.webContents.send("window:maximized-changed", true)
      this.#scheduleWindowState(true)
    })
    mainWindow.on("unmaximize", () => {
      mainWindow.webContents.send("window:maximized-changed", false)
      this.#scheduleWindowState(false)
    })
    const rememberNormalBounds = () => {
      if (
        mainWindow.isDestroyed()
        || mainWindow.isMaximized()
        || mainWindow.isMinimized()
        || mainWindow.isFullScreen()
      ) {
        return
      }
      this.#normalWindowBounds = mainWindow.getBounds()
      this.#scheduleWindowState(false)
    }
    mainWindow.on("resize", rememberNormalBounds)
    mainWindow.on("move", rememberNormalBounds)
    mainWindow.on("closed", () => {
      if (this.#mainWindow === mainWindow) this.#mainWindow = undefined
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (
        !isAllowedApplicationUrl(url, this.#allowedApplicationOrigin)
        && isSafeExternalUrl(url)
      ) {
        void shell.openExternal(url)
      }
      return { action: "deny" }
    })
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedApplicationUrl(url, this.#allowedApplicationOrigin)) {
        event.preventDefault()
      }
    })
    if (this.#options.initialWindowState.maximized) {
      mainWindow.maximize()
    }
    return mainWindow
  }

  #loadStartupPage(mainWindow: BrowserWindow): void {
    const navigationGeneration = ++this.#navigationGeneration
    this.#startupPageActive = false
    this.#setStartupBackground(mainWindow)
    const page = `data:text/html;charset=utf-8,${encodeURIComponent(
      renderStartupPage({
        logoDataUrl: this.#resolveStartupLogoDataUrl(),
        ...this.#options.startupTheme,
      }),
    )}`

    if (!mainWindow.isVisible()) {
      mainWindow.once("ready-to-show", () => {
        if (!mainWindow.isDestroyed()) mainWindow.show()
      })
    } else {
      mainWindow.show()
    }

    void mainWindow.loadURL(page).then(() => {
      if (
        mainWindow.isDestroyed()
        || navigationGeneration !== this.#navigationGeneration
      ) {
        return
      }
      this.#startupPageActive = true
      mainWindow.show()
      this.#sendStartupStatus()
    }).catch((error) => {
      if (navigationGeneration !== this.#navigationGeneration) return
      this.#logger.error("desktop.startup-page-load-failed", { error })
      if (!mainWindow.isDestroyed()) mainWindow.show()
    })
  }

  #sendStartupStatus(): void {
    const mainWindow = this.#mainWindow
    if (
      !this.#startupPageActive
      || !mainWindow
      || mainWindow.isDestroyed()
    ) {
      return
    }
    const { status, detail, kind } = this.#startupStatus
    const script = `window.updateStartupStatus?.(${JSON.stringify(status)}, ${JSON.stringify(detail)}, ${JSON.stringify(kind)})`
    void mainWindow.webContents.executeJavaScript(script).catch((error) => {
      this.#logger.warn("desktop.startup-status-update-failed", {
        error,
        status,
      })
    })
  }

  #resolveStartupLogoDataUrl(): string {
    try {
      const svgPath = this.#resolveWhaleIconSvgPath()
      const svg = readFileSync(svgPath, "utf-8")
      const encoded = encodeURIComponent(svg)
      return `data:image/svg+xml;charset=utf-8,${encoded}`
    } catch (error) {
      this.#logger.warn("desktop.startup-svg-load-failed", {
        error,
      })
      const icon = nativeImage.createFromPath(this.#resolveWindowIconPath())
      if (icon.isEmpty()) {
        this.#logger.warn("desktop.startup-ico-fallback-failed", {
          path: this.#resolveWindowIconPath(),
        })
        return ""
      }
      return icon.resize({
        width: 112,
        height: 112,
        quality: "best",
      }).toDataURL()
    }
  }

  #resolveWhaleIconSvgPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "whale-icon.svg")
      : resolve(this.#moduleDirectory, "../../build/whale-icon.svg")
  }

  #setStartupBackground(mainWindow: BrowserWindow): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(this.#options.startupTheme.theme.surface)
    }
  }

  #setThemeBackground(mainWindow: BrowserWindow): void {
    if (mainWindow.isDestroyed()) return
    mainWindow.setBackgroundColor(this.#options.startupTheme.theme.surface)
  }

  #scheduleWindowState(maximized: boolean): void {
    this.#options.windowStateStore.scheduleSave({
      version: 1,
      bounds: this.#normalWindowBounds,
      maximized,
    })
  }

  #registerDevToolsShortcut(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.key !== "F12") return
      event.preventDefault()
      window.webContents.toggleDevTools()
    })
    window.webContents.on("devtools-opened", () => {
      this.#logger.info("desktop.devtools-opened")
    })
    window.webContents.on("devtools-closed", () => {
      this.#logger.info("desktop.devtools-closed")
    })
  }

  #resolveWindowIconPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "icon.ico")
      : resolve(this.#moduleDirectory, "../../build/icon.ico")
  }
}

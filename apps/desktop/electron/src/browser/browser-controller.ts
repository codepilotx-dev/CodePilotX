import {
  WebContentsView,
  type BrowserWindow,
} from "electron"
import type {
  DesktopBrowserBounds,
  DesktopBrowserSnapshot,
} from "@codepilotx/shared/desktop-browser-ipc"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import {
  isAllowedDesktopBrowserNavigation,
  normalizeDesktopBrowserUrl,
} from "./browser-url.js"

type BrowserEntry = {
  tabId: string
  view: WebContentsView
  parent: BrowserWindow
  open: boolean
  requestedVisible: boolean
  bounds: DesktopBrowserBounds
  url: string
  title: string
  loading: boolean
  error: string | null
}

export interface DesktopBrowserControllerOptions {
  getMainWindow(): BrowserWindow | undefined
  publish(state: DesktopBrowserSnapshot): void
  logger: DesktopLogger
}

const EMPTY_BOUNDS: DesktopBrowserBounds = { x: 0, y: 0, width: 0, height: 0 }

export class DesktopBrowserController {
  readonly #options: DesktopBrowserControllerOptions
  readonly #entries = new Map<string, BrowserEntry>()

  constructor(options: DesktopBrowserControllerOptions) {
    this.#options = options
  }

  getState(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#entries.get(tabId)
    if (
      entry
      && (entry.parent.isDestroyed() || entry.view.webContents.isDestroyed())
    ) {
      this.#entries.delete(tabId)
      return emptyBrowserSnapshot(tabId)
    }
    return entry ? this.#snapshot(entry) : emptyBrowserSnapshot(tabId)
  }

  createOrRestore(tabId: string, url?: string): DesktopBrowserSnapshot {
    const entry = this.#ensureEntry(tabId)
    entry.open = true
    if (url !== undefined && url.trim() && url !== entry.url) {
      void this.#navigate(entry, url)
    } else {
      this.#applyVisibility(entry)
      this.#publish(entry)
    }
    return this.#snapshot(entry)
  }

  async navigate(tabId: string, url: string): Promise<DesktopBrowserSnapshot> {
    const entry = this.#ensureEntry(tabId)
    entry.open = true
    await this.#navigate(entry, url)
    return this.#snapshot(entry)
  }

  reload(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    entry.error = null
    entry.view.webContents.reload()
    return this.#snapshot(entry)
  }

  stop(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    entry.view.webContents.stop()
    entry.loading = false
    this.#publish(entry)
    return this.#snapshot(entry)
  }

  goBack(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    if (entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack()
    }
    return this.#snapshot(entry)
  }

  goForward(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    if (entry.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward()
    }
    return this.#snapshot(entry)
  }

  setBounds(
    tabId: string,
    bounds: DesktopBrowserBounds,
  ): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    entry.bounds = normalizeBounds(bounds)
    entry.view.setBounds(entry.bounds)
    this.#applyVisibility(entry)
    return this.#snapshot(entry)
  }

  setVisible(tabId: string, visible: boolean): DesktopBrowserSnapshot {
    const entry = this.#requireEntry(tabId)
    entry.requestedVisible = visible
    this.#applyVisibility(entry)
    return this.#snapshot(entry)
  }

  focus(tabId: string): void {
    const entry = this.#requireEntry(tabId)
    if (entry.open && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.focus()
    }
  }

  close(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#entries.get(tabId)
    if (!entry) return emptyBrowserSnapshot(tabId)
    const finalState = emptyBrowserSnapshot(tabId)
    this.#entries.delete(tabId)
    try {
      if (!entry.parent.isDestroyed()) {
        entry.parent.contentView.removeChildView(entry.view)
      }
    } catch {
      // The parent can disappear before its child view during application quit.
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.#options.publish(finalState)
    return finalState
  }

  clearAllowedSites(tabId: string): DesktopBrowserSnapshot {
    const entry = this.#entries.get(tabId)
    return entry ? this.#snapshot(entry) : emptyBrowserSnapshot(tabId)
  }

  dispose(): void {
    for (const tabId of [...this.#entries.keys()]) this.close(tabId)
  }

  suspendAll(): void {
    for (const entry of this.#entries.values()) {
      if (!entry.view.webContents.isDestroyed()) entry.view.setVisible(false)
    }
  }

  #ensureEntry(tabId: string): BrowserEntry {
    const existing = this.#entries.get(tabId)
    if (
      existing
      && !existing.parent.isDestroyed()
      && !existing.view.webContents.isDestroyed()
    ) return existing

    if (existing) this.#entries.delete(tabId)
    const parent = this.#options.getMainWindow()
    if (!parent || parent.isDestroyed()) {
      throw new Error("桌面窗口尚未就绪")
    }
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        partition: "persist:codepilotx-browser",
        devTools: false,
      },
    })
    const entry: BrowserEntry = {
      tabId,
      view,
      parent,
      open: true,
      requestedVisible: true,
      bounds: { ...EMPTY_BOUNDS },
      url: "",
      title: "",
      loading: false,
      error: null,
    }
    this.#entries.set(tabId, entry)
    parent.contentView.addChildView(view)
    view.setBounds(entry.bounds)
    view.setVisible(false)
    this.#configureSecurity(entry)
    this.#bindEvents(entry)
    return entry
  }

  #configureSecurity(entry: BrowserEntry): void {
    const contents = entry.view.webContents
    contents.session.setPermissionCheckHandler(() => false)
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false)
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedDesktopBrowserNavigation(url)) {
        void this.#navigate(entry, url)
      }
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => {
      if (isAllowedDesktopBrowserNavigation(url)) return
      event.preventDefault()
      entry.loading = false
      entry.error = "已阻止不受支持的页面跳转"
      this.#publish(entry)
    })
  }

  #bindEvents(entry: BrowserEntry): void {
    const contents = entry.view.webContents
    contents.on("did-start-loading", () => {
      entry.loading = true
      entry.error = null
      this.#publish(entry)
    })
    contents.on("did-stop-loading", () => {
      entry.loading = false
      this.#syncNavigationState(entry)
      this.#publish(entry)
    })
    contents.on("did-navigate", (_event, url) => {
      entry.url = url === "about:blank" ? "" : url
      entry.error = null
      this.#syncNavigationState(entry)
      this.#publish(entry)
    })
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      entry.url = url === "about:blank" ? "" : url
      this.#syncNavigationState(entry)
      this.#publish(entry)
    })
    contents.on("page-title-updated", (_event, title) => {
      entry.title = title.slice(0, 500)
      this.#publish(entry)
    })
    contents.on(
      "did-fail-load",
      (_event, errorCode, _description, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return
        entry.loading = false
        entry.error = browserLoadError(errorCode)
        this.#options.logger.warn("desktop.browser-load-failed", { errorCode })
        this.#publish(entry)
      },
    )
    contents.on("render-process-gone", (_event, details) => {
      entry.loading = false
      entry.error = "浏览器页面进程已退出，请重新加载"
      this.#options.logger.warn("desktop.browser-render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode,
      })
      this.#publish(entry)
    })
  }

  async #navigate(entry: BrowserEntry, value: string): Promise<void> {
    const target = normalizeDesktopBrowserUrl(value)
    entry.error = null
    entry.loading = true
    this.#publish(entry)
    try {
      await entry.view.webContents.loadURL(target.url)
    } catch (error) {
      if (entry.view.webContents.isDestroyed()) return
      entry.loading = false
      entry.error = error instanceof Error && error.message.includes("ERR_ABORTED")
        ? null
        : "无法加载该页面，请检查网址或网络连接"
      if (entry.error) {
        this.#options.logger.warn("desktop.browser-navigation-failed", {
          code: "BROWSER_NAVIGATION_FAILED",
        })
      }
      this.#publish(entry)
    }
  }

  #requireEntry(tabId: string): BrowserEntry {
    const entry = this.#entries.get(tabId)
    if (!entry || entry.view.webContents.isDestroyed()) {
      throw new Error("浏览器标签页尚未打开")
    }
    return entry
  }

  #applyVisibility(entry: BrowserEntry): void {
    const hasArea = entry.bounds.width > 0 && entry.bounds.height > 0
    entry.view.setVisible(entry.open && entry.requestedVisible && hasArea)
  }

  #syncNavigationState(entry: BrowserEntry): void {
    const url = entry.view.webContents.getURL()
    entry.url = url === "about:blank" ? "" : url
    entry.title = entry.view.webContents.getTitle().slice(0, 500)
  }

  #snapshot(entry: BrowserEntry): DesktopBrowserSnapshot {
    const history = entry.view.webContents.navigationHistory
    return {
      tabId: entry.tabId,
      open: entry.open,
      url: entry.url,
      title: entry.title,
      loading: entry.loading,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      error: entry.error,
      allowedSites: [],
      sitePermissions: [],
    }
  }

  #publish(entry: BrowserEntry): void {
    if (!entry.view.webContents.isDestroyed()) {
      this.#options.publish(this.#snapshot(entry))
    }
  }
}

export function emptyBrowserSnapshot(tabId: string): DesktopBrowserSnapshot {
  return {
    tabId,
    open: false,
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    allowedSites: [],
    sitePermissions: [],
  }
}

function normalizeBounds(bounds: DesktopBrowserBounds): DesktopBrowserBounds {
  const coordinate = (value: number): number =>
    Math.max(-32_768, Math.min(32_768, Math.round(value)))
  const dimension = (value: number): number =>
    Math.max(0, Math.min(32_768, Math.round(value)))
  return {
    x: coordinate(bounds.x),
    y: coordinate(bounds.y),
    width: dimension(bounds.width),
    height: dimension(bounds.height),
  }
}

function browserLoadError(errorCode: number): string {
  if (errorCode === -105) return "找不到该网站的地址"
  if (errorCode === -106) return "无法连接到网络"
  if (errorCode === -118) return "页面加载超时"
  if (errorCode === -202) return "网站证书无效"
  return "无法加载该页面，请检查网址或网络连接"
}

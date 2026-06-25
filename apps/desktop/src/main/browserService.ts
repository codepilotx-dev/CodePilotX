import { randomUUID } from 'node:crypto'
import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import {
  browserSiteKeyForURL,
  isAllowedBrowserURL,
  normalizeBrowserURL,
} from './browserUrlPolicy.js'
import type { DesktopBrowserState } from '../shared/types.js'

type BrowserViewState = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

export type DesktopBrowserService = {
  getState(): Promise<DesktopBrowserState>
  open(url?: string): Promise<DesktopBrowserState>
  navigate(url: string): Promise<DesktopBrowserState>
  reload(): Promise<DesktopBrowserState>
  goBack(): Promise<DesktopBrowserState>
  goForward(): Promise<DesktopBrowserState>
  close(): Promise<DesktopBrowserState>
  setBounds(bounds: Rectangle): Promise<DesktopBrowserState>
  clearAllowedSites(): Promise<DesktopBrowserState>
}

export function createDesktopBrowserService(options: {
  getWindow: () => BrowserWindow | null
}): DesktopBrowserService {
  let view: WebContentsView | null = null
  let bounds: Rectangle | null = null
  let viewState: BrowserViewState = emptyViewState()

  function ensureView(): WebContentsView {
    const window = options.getWindow()
    if (!window) {
      throw new Error('Browser window is not available.')
    }
    if (view && !view.webContents.isDestroyed()) {
      attachView(window, view)
      return view
    }
    view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `browser-preview-${randomUUID()}`,
      },
    })
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    view.webContents.session.on('will-download', event => {
      event.preventDefault()
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event, nextURL) => {
      if (!isAllowedBrowserURL(nextURL)) {
        event.preventDefault()
        setError('Only http, https, and file URLs can be opened.')
      }
    })
    view.webContents.on('did-start-loading', () => updateViewState({ error: null }))
    view.webContents.on('did-stop-loading', () => updateViewState())
    view.webContents.on('did-navigate', () => updateViewState())
    view.webContents.on('did-navigate-in-page', () => updateViewState())
    view.webContents.on('page-title-updated', () => updateViewState())
    view.webContents.on('did-fail-load', (_event, _code, description) => {
      setError(description)
    })
    attachView(window, view)
    applyBounds()
    return view
  }

  function attachView(window: BrowserWindow, nextView: WebContentsView): void {
    if (window.contentView.children.includes(nextView)) return
    window.contentView.addChildView(nextView)
  }

  function applyBounds(): void {
    if (!view || !bounds) return
    view.setBounds(bounds)
  }

  function updateViewState(patch: { error?: string | null } = {}): void {
    if (!view || view.webContents.isDestroyed()) {
      viewState = emptyViewState()
      return
    }
    viewState = {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      loading: view.webContents.isLoading(),
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      error: 'error' in patch ? patch.error ?? null : viewState.error,
    }
  }

  function setError(message: string): void {
    updateViewState({ error: message })
  }

  async function state(): Promise<DesktopBrowserState> {
    if (view && !view.webContents.isDestroyed()) {
      updateViewState()
    }
    const settings = await readDesktopStoredSettings()
    return {
      open: Boolean(view && !view.webContents.isDestroyed()),
      ...viewState,
      allowedSites: settings.browserAllowedSites,
    }
  }

  async function navigateTo(rawURL: string): Promise<DesktopBrowserState> {
    const normalizedURL = normalizeBrowserURL(rawURL)
    const browserView = ensureView()
    await rememberAllowedSite(normalizedURL)
    await browserView.webContents.loadURL(normalizedURL)
    updateViewState({ error: null })
    return state()
  }

  return {
    getState: state,
    async open(url = 'about:blank') {
      ensureView()
      if (url === 'about:blank') {
        viewState = emptyViewState()
        return state()
      }
      return navigateTo(url)
    },
    navigate: navigateTo,
    async reload() {
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.reload()
      }
      return state()
    },
    async goBack() {
      if (view && !view.webContents.isDestroyed() && view.webContents.canGoBack()) {
        view.webContents.goBack()
      }
      return state()
    },
    async goForward() {
      if (
        view &&
        !view.webContents.isDestroyed() &&
        view.webContents.canGoForward()
      ) {
        view.webContents.goForward()
      }
      return state()
    },
    async close() {
      if (view && !view.webContents.isDestroyed()) {
        options.getWindow()?.contentView.removeChildView(view)
        view.webContents.close()
      }
      view = null
      viewState = emptyViewState()
      return state()
    },
    async setBounds(nextBounds) {
      bounds = normalizeBounds(nextBounds)
      applyBounds()
      return state()
    },
    async clearAllowedSites() {
      const settings = await readDesktopStoredSettings()
      await saveDesktopStoredSettings({
        ...settings,
        browserAllowedSites: [],
      })
      return state()
    },
  }
}

async function rememberAllowedSite(rawURL: string): Promise<void> {
  const siteKey = browserSiteKeyForURL(rawURL)
  const settings = await readDesktopStoredSettings()
  if (settings.browserAllowedSites.includes(siteKey)) return
  await saveDesktopStoredSettings({
    ...settings,
    browserAllowedSites: [...settings.browserAllowedSites, siteKey],
  })
}

function normalizeBounds(bounds: Rectangle): Rectangle {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

function emptyViewState(): BrowserViewState {
  return {
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  }
}

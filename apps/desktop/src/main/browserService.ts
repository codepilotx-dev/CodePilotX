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
import type { DesktopBrowserAutomationAction } from './desktopBrowserAutomationBridge.js'
import {
  browserSitePermissionForURL,
  upsertBrowserSitePermission,
} from './browserSitePermissions.js'

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
  handleAutomationAction(input: DesktopBrowserAutomationAction): Promise<unknown>
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
      sitePermissions: settings.browserSitePermissions,
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
        browserSitePermissions: [],
      })
      return state()
    },
    async handleAutomationAction(input) {
      return handleAutomationAction(input)
    },
  }

  async function handleAutomationAction(
    input: DesktopBrowserAutomationAction,
  ): Promise<unknown> {
    await ensureAutomationSiteAllowed(input)
    switch (input.action) {
      case 'open_url': {
        const url = requireString(input.url, 'url')
        const nextState = await navigateTo(url)
        return summarizeState(nextState)
      }
      case 'snapshot':
        return snapshotPage()
      case 'screenshot':
        return captureScreenshot()
      case 'click':
        await dispatchSelectorMouseEvent(requireString(input.selector, 'selector'))
        return summarizeState(await state())
      case 'type':
        await typeIntoSelector(
          requireString(input.selector, 'selector'),
          requireString(input.text, 'text'),
        )
        return summarizeState(await state())
      case 'press':
        await pressKey(requireString(input.key, 'key'))
        return summarizeState(await state())
      case 'wait_for':
        await waitForSelector(
          requireString(input.selector, 'selector'),
          optionalNumber(input.timeoutMs) ?? 5_000,
        )
        return summarizeState(await state())
      case 'evaluate_readonly':
        return evaluateReadonly(requireString(input.script, 'script'))
      case 'get_resource':
        return getResource(requireString(input.resourceUrl, 'resourceUrl'))
      default:
        throw new Error(`Unsupported browser action: ${input.action}`)
    }
  }

  async function snapshotPage(): Promise<unknown> {
    const browserView = ensureView()
    const result = await browserView.webContents.executeJavaScript(
      `({
        title: document.title,
        url: location.href,
        text: document.body ? document.body.innerText.slice(0, 12000) : '',
        links: Array.from(document.links).slice(0, 100).map(link => ({
          text: link.innerText.trim().slice(0, 200),
          href: link.href
        }))
      })`,
      true,
    )
    return result
  }

  async function captureScreenshot(): Promise<unknown> {
    const browserView = ensureView()
    const image = await browserView.webContents.capturePage()
    return {
      mimeType: 'image/png',
      base64: image.toPNG().toString('base64'),
    }
  }

  async function dispatchSelectorMouseEvent(selector: string): Promise<void> {
    const browserView = ensureView()
    await browserView.webContents.executeJavaScript(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Element not found: ${selector.replaceAll("'", "\\'")}');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      })()`,
      true,
    )
  }

  async function typeIntoSelector(selector: string, text: string): Promise<void> {
    const browserView = ensureView()
    await browserView.webContents.executeJavaScript(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Element not found');
        element.scrollIntoView({ block: 'center', inline: 'center' });
        element.focus();
      })()`,
      true,
    )
    await browserView.webContents.insertText(text)
  }

  async function pressKey(key: string): Promise<void> {
    const browserView = ensureView()
    browserView.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    browserView.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
  }

  async function waitForSelector(
    selector: string,
    timeoutMs: number,
  ): Promise<void> {
    const browserView = ensureView()
    await browserView.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const selector = ${JSON.stringify(selector)};
        const deadline = Date.now() + ${Math.max(0, Math.round(timeoutMs))};
        const tick = () => {
          if (document.querySelector(selector)) {
            resolve(true);
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error('Timed out waiting for selector: ' + selector));
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      })`,
      true,
    )
  }

  async function evaluateReadonly(script: string): Promise<unknown> {
    const browserView = ensureView()
    return browserView.webContents.executeJavaScript(
      `(() => {
        const fn = Function('document', 'window', ${JSON.stringify(script)});
        return fn(document, window);
      })()`,
      true,
    )
  }

  async function getResource(resourceUrl: string): Promise<unknown> {
    const normalized = normalizeBrowserURL(resourceUrl)
    const browserView = ensureView()
    const result = await browserView.webContents.executeJavaScript(
      `fetch(${JSON.stringify(normalized)}).then(async response => ({
        url: response.url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        text: (await response.text()).slice(0, 100000)
      }))`,
      true,
    )
    return result
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Browser action requires ${label}.`)
  }
  return value
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function summarizeState(state: DesktopBrowserState): unknown {
  return {
    url: state.url,
    title: state.title,
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    error: state.error,
  }
}

async function rememberAllowedSite(rawURL: string): Promise<void> {
  const siteKey = browserSiteKeyForURL(rawURL)
  const settings = await readDesktopStoredSettings()
  const nextPermissions = upsertBrowserSitePermission(
    settings.browserSitePermissions,
    rawURL,
    'allow',
  )
  if (
    settings.browserAllowedSites.includes(siteKey) &&
    settings.browserSitePermissions.some(
      permission => permission.origin === siteKey && permission.decision === 'allow',
    )
  ) {
    return
  }
  await saveDesktopStoredSettings({
    ...settings,
    browserAllowedSites: settings.browserAllowedSites.includes(siteKey)
      ? settings.browserAllowedSites
      : [...settings.browserAllowedSites, siteKey],
    browserSitePermissions: nextPermissions,
  })
}

async function ensureAutomationSiteAllowed(
  input: DesktopBrowserAutomationAction,
): Promise<void> {
  const targetURL =
    typeof input.url === 'string'
      ? input.url
      : typeof input.resourceUrl === 'string'
        ? input.resourceUrl
        : null
  if (!targetURL) return
  const settings = await readDesktopStoredSettings()
  const permission = browserSitePermissionForURL(settings, targetURL)
  if (permission?.decision === 'deny') {
    throw new Error(`Browser site is denied: ${permission.origin}`)
  }
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

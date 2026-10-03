import { webContents, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { BrowserTab, BrowserCommand, BrowserResult } from '@codepilotx/agent-protocol'
import type {
  DesktopBrowserSnapshot,
  DesktopBrowserBounds,
  DesktopBrowserSitePermission,
} from '@codepilotx/shared/desktop-browser-ipc'
import type { DesktopLogger } from '../logging/desktop-logger.js'
import type { SidecarSupervisor } from '../sidecar/supervisor.js'
import { BrowserHostRpcClient } from './browser-host-rpc-client.js'
import { runBrowserOperation } from './browser-operations.js'
import { normalizeDesktopBrowserUrl, isAllowedDesktopBrowserNavigation } from './browser-url.js'

type Entry = {
  tab: BrowserTab
  owner: BrowserWindow
  contents?: WebContents
  visible: boolean
  audio: boolean
  capturing: boolean
  initialized: boolean
  emulated: boolean
  abort?: AbortController
  idle?: ReturnType<typeof setTimeout>
  ready: Set<() => void>
  reporting: Promise<void>
}
type WindowHost = {
  owner: BrowserWindow
  windowId: string
  instanceId: string
  stopped: boolean
  registering?: Promise<void>
  registered: boolean
  polling: boolean
  attached: Set<number>
  permissions: DesktopBrowserSitePermission[]
  pollTimer?: ReturnType<typeof setTimeout>
  budgetTimer?: ReturnType<typeof setInterval>
  budgeting?: boolean
}
export interface DesktopBrowserControllerOptions {
  publish(owner: BrowserWindow, state: DesktopBrowserSnapshot): void
  logger: DesktopLogger
  getSupervisor: () => SidecarSupervisor | undefined
}
export class DesktopBrowserController {
  readonly #rpc: BrowserHostRpcClient
  readonly #hosts = new Map<number, WindowHost>()
  readonly #entries = new Map<string, Entry>()
  constructor(private readonly options: DesktopBrowserControllerOptions) {
    this.#rpc = new BrowserHostRpcClient(options.getSupervisor)
  }
  async list(owner: BrowserWindow): Promise<DesktopBrowserSnapshot[]> {
    const host = await this.#ensureHost(owner)
    const catalog = await this.#rpc.call('browser/list', {})
    host.permissions = catalog.permissions.map((p) => ({ ...p }))
    this.#sync(
      host,
      catalog.tabs.filter((tab) => tab.windowId === host.windowId),
    )
    return this.#owned(host).map((entry) => this.#snapshot(entry))
  }
  async getState(owner: BrowserWindow, tabId: string) {
    await this.#ensureHost(owner)
    const entry = this.#entries.get(tabId)
    return entry?.owner === owner ? this.#snapshot(entry) : this.#empty(tabId, owner)
  }
  async createOrRestore(
    owner: BrowserWindow,
    tabId: string,
    url?: string,
    sourceThreadId: string | null = null,
  ) {
    const host = await this.#ensureHost(owner)
    const tab = await this.#rpc.call('browser/create', {
      tabId,
      windowId: host.windowId,
      sourceThreadId,
      url: normalizeDesktopBrowserUrl(url ?? 'about:blank').url,
    })
    this.#sync(host, [
      ...this.#owned(host)
        .filter((e) => e.tab.tabId !== tabId)
        .map((e) => e.tab),
      tab,
    ])
    const entry = this.#require(owner, tabId)
    await this.#activate(entry)
    return this.#snapshot(entry)
  }
  async attach(owner: BrowserWindow, tabId: string, generation: string, guestId: number) {
    const host = await this.#ensureHost(owner)
    const entry = this.#require(owner, tabId)
    const guest = webContents.fromId(guestId)
    if (
      !guest ||
      !host.attached.has(guestId) ||
      entry.tab.generation !== generation ||
      entry.contents
    )
      throw new Error('浏览器宿主不匹配')
    entry.contents = guest
    entry.initialized = false
    guest.session.setPermissionCheckHandler(() => false)
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    guest.setWindowOpenHandler(({ url }) => {
      if (isAllowedDesktopBrowserNavigation(url)) {
        const normalized = normalizeDesktopBrowserUrl(url).url
        if (entry.tab.controlThreadId && !this.#allowed(host, normalized)) {
          void this.#report(entry, { error: `站点需要授权：${new URL(normalized).origin}` })
          return { action: 'deny' }
        }
        void this.#rpc
          .call('browser/create', {
            tabId: randomUUID(),
            windowId: host.windowId,
            sourceThreadId: entry.tab.sourceThreadId,
            url: normalized,
          })
          .then(async (tab) => {
            if (entry.tab.controlThreadId)
              await this.#rpc.call('browser/control', {
                tabId: tab.tabId,
                threadId: entry.tab.controlThreadId,
              })
            await this.list(owner)
          })
          .catch(() => {})
      }
      return { action: 'deny' }
    })
    const intercept = (event: Electron.Event, url: string) => {
      if (
        !isAllowedDesktopBrowserNavigation(url) ||
        (entry.tab.controlThreadId && !this.#allowed(host, url))
      ) {
        event.preventDefault()
        void this.#report(entry, {
          error: isAllowedDesktopBrowserNavigation(url)
            ? `站点需要授权：${new URL(url).origin}`
            : '此网址不受支持',
        })
      }
    }
    guest.on('will-navigate', intercept)
    guest.on('will-redirect', intercept)
    guest.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && entry.tab.controlThreadId && !this.#allowed(host, event.url))
        event.preventDefault()
    })
    guest.on('did-start-loading', () => void this.#report(entry, { loading: true, error: null }))
    guest.on('did-stop-loading', () => void this.#navigationReport(entry, false))
    const navigated = () => {
      entry.tab = { ...entry.tab, documentId: randomUUID() }
      void this.#navigationReport(entry)
    }
    guest.on('did-navigate', navigated)
    guest.on('did-navigate-in-page', navigated)
    guest.on('page-title-updated', () => void this.#navigationReport(entry))
    guest.on('media-started-playing', () => {
      entry.audio = true
    })
    guest.on('media-paused', () => {
      entry.audio = false
      void this.#budget(host)
    })
    guest.on('render-process-gone', () => {
      entry.abort?.abort()
      entry.contents = undefined
      void this.#report(entry, {
        state: 'crashed',
        loading: false,
        error: '页面进程已退出，点击重试恢复',
      })
    })
    guest.on('did-fail-load', (_event, code, _description, _url, main) => {
      if (main && code !== -3) void this.#report(entry, { loading: false, error: '页面加载失败' })
    })
    const snapshot = entry.tab
    try {
      if (snapshot.history?.length)
        await guest.navigationHistory.restore({
          entries: snapshot.history.map((e) => ({ ...e })),
          index: snapshot.historyIndex ?? snapshot.history.length - 1,
        })
      else await guest.loadURL(snapshot.url)
    } catch {
      /* Guest events own the retry state. */
    }
    if (entry.tab.generation !== generation || guest.isDestroyed()) return
    await this.#report(entry, { state: entry.visible ? 'live' : 'parked' })
    entry.initialized = true
    for (const ready of entry.ready) ready()
    entry.ready.clear()
    void this.#budget(host)
  }
  async navigate(owner: BrowserWindow, tabId: string, url: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    try {
      await (await this.#ready(entry)).loadURL(normalizeDesktopBrowserUrl(url).url)
    } catch {
      /* Guest events report errors. */
    }
    return this.#snapshot(entry)
  }
  async reload(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    ;(await this.#ready(entry)).reload()
    return this.#snapshot(entry)
  }
  async stop(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    entry.contents?.stop()
    return this.#snapshot(entry)
  }
  async goBack(owner: BrowserWindow, tabId: string) {
    return this.#history(owner, tabId, -1)
  }
  async goForward(owner: BrowserWindow, tabId: string) {
    return this.#history(owner, tabId, 1)
  }
  async #history(owner: BrowserWindow, tabId: string, offset: number) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    const guest = await this.#ready(entry)
    if (guest.navigationHistory.canGoToOffset(offset)) guest.navigationHistory.goToOffset(offset)
    return this.#snapshot(entry)
  }
  async setBounds(owner: BrowserWindow, tabId: string, _bounds: DesktopBrowserBounds) {
    return this.getState(owner, tabId)
  }
  async setVisible(owner: BrowserWindow, tabId: string, visible: boolean) {
    const entry = this.#require(owner, tabId)
    entry.visible = visible
    if (visible) {
      await this.#activate(entry)
      await this.#report(entry, { lastUsedAt: Date.now(), state: 'live' })
    } else if (entry.contents) await this.#report(entry, { state: 'parked' })
    void this.#budget(this.#hosts.get(owner.id)!)
    return this.#snapshot(entry)
  }
  focus(owner: BrowserWindow, tabId: string) {
    this.#require(owner, tabId).contents?.focus()
  }
  async close(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.#rpc.call('browser/close', { tabId })
    this.#destroy(entry)
    this.#entries.delete(tabId)
    const empty = this.#empty(tabId, owner)
    this.options.publish(owner, empty)
    return empty
  }
  async control(owner: BrowserWindow, tabId: string, threadId: string | null) {
    const entry = this.#require(owner, tabId)
    entry.abort?.abort()
    entry.tab = await this.#rpc.call('browser/control', { tabId, threadId })
    this.#publish(entry)
    return this.#snapshot(entry)
  }
  async layout(owner: BrowserWindow, tabId: string, panel: 'right' | 'bottom', order: number) {
    const entry = this.#require(owner, tabId)
    entry.tab = await this.#rpc.call('browser/layout', { tabId, panel, order })
    this.#publish(entry)
  }
  async permission(owner: BrowserWindow, origin: string, decision: 'allow' | 'deny' | 'remove') {
    const host = await this.#ensureHost(owner)
    const result = await this.#rpc.call('browser/permissions', { origin, decision })
    host.permissions = result.permissions.map((p) => ({ ...p }))
    for (const e of this.#owned(host)) this.#publish(e)
    return host.permissions
  }
  async clearAllowedSites(owner: BrowserWindow, tabId: string) {
    const host = await this.#ensureHost(owner)
    await this.#rpc.call('browser/permissions', { decision: 'clear' })
    host.permissions = []
    for (const e of this.#owned(host)) this.#publish(e)
    return this.getState(owner, tabId)
  }
  suspendAll() {
    this.#rpc.invalidate()
    for (const host of this.#hosts.values()) {
      host.registered = false
      for (const entry of this.#owned(host)) {
        entry.abort?.abort()
        this.#detach(entry)
      }
    }
  }
  dispose() {
    for (const host of this.#hosts.values()) {
      host.stopped = true
      clearTimeout(host.pollTimer)
      clearInterval(host.budgetTimer)
      void this.#rpc
        .call('browser/host/release', { windowId: host.windowId, instanceId: host.instanceId })
        .catch(() => {})
    }
    for (const e of this.#entries.values()) this.#destroy(e)
    this.#hosts.clear()
    this.#entries.clear()
  }
  #require(owner: BrowserWindow, tabId: string) {
    const entry = this.#entries.get(tabId)
    if (!entry || entry.owner !== owner) throw new Error('浏览器标签不属于当前窗口')
    return entry
  }
  #owned(host: WindowHost) {
    return [...this.#entries.values()].filter((e) => e.owner === host.owner)
  }
  #allowed(host: WindowHost, url: string) {
    if (url === 'about:blank' || url === 'about:srcdoc') return true
    try {
      return host.permissions.some(
        (p) => p.origin === new URL(url).origin && p.decision === 'allow',
      )
    } catch {
      return false
    }
  }
  async #ensureHost(owner: BrowserWindow) {
    let host = this.#hosts.get(owner.id)
    if (!host) {
      host = {
        owner,
        windowId: `window:${owner.id}`,
        instanceId: randomUUID(),
        stopped: false,
        registered: false,
        polling: false,
        attached: new Set(),
        permissions: [],
      }
      this.#hosts.set(owner.id, host)
      const budgetHost = host
      host.budgetTimer = setInterval(() => void this.#budget(budgetHost), 60_000)
      owner.webContents.on('will-attach-webview', (event, preferences, params) => {
        if (params.partition !== 'persist:codepilotx-browser' || params.src !== 'about:blank') {
          event.preventDefault()
          return
        }
        delete preferences.preload
        Object.assign(preferences, {
          session: undefined,
          partition: 'persist:codepilotx-browser',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          devTools: false,
          backgroundThrottling: false,
        })
      })
      owner.webContents.on('did-attach-webview', (_event, guest) => {
        host!.attached.add(guest.id)
        guest.once('destroyed', () => host!.attached.delete(guest.id))
      })
      owner.once('closed', () => {
        host!.stopped = true
        clearTimeout(host!.pollTimer)
        clearInterval(host!.budgetTimer)
        for (const e of this.#owned(host!)) {
          this.#destroy(e)
          this.#entries.delete(e.tab.tabId)
        }
        this.#hosts.delete(owner.id)
        void this.#rpc
          .call('browser/host/release', { windowId: host!.windowId, instanceId: host!.instanceId })
          .catch(() => {})
      })
      owner.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => {
        if (main && !inPlace) {
          for (const e of this.#owned(host!)) {
            this.#destroy(e)
            e.tab = { ...e.tab, state: 'suspended' }
          }
          host!.instanceId = randomUUID()
          host!.registered = false
        }
      })
    }
    if (!host.registered) {
      const current = host
      current.registering ??= this.#rpc
        .call('browser/host/register', {
          windowId: current.windowId,
          instanceId: current.instanceId,
        })
        .then(async (result) => {
          const catalog = await this.#rpc.call('browser/list', {})
          current.permissions = catalog.permissions.map((p) => ({ ...p }))
          this.#sync(current, result.tabs)
          current.registered = true
          if (!current.polling) {
            current.polling = true
            this.#poll(current)
          }
        })
        .finally(() => {
          current.registering = undefined
        })
      await current.registering
    }
    return host
  }
  #poll(host: WindowHost) {
    if (host.stopped) return
    const instanceId = host.instanceId
    void this.#rpc
      .call('browser/host/next', { windowId: host.windowId, instanceId })
      .then((result) => {
        if (instanceId !== host.instanceId) return
        host.permissions = result.permissions.map((p) => ({ ...p }))
        this.#sync(host, result.tabs)
        if (result.command) void this.#execute(host, result.command)
      })
      .catch(() => {
        if (instanceId !== host.instanceId) return
        host.registered = false
        for (const e of this.#owned(host)) e.abort?.abort()
      })
      .finally(() => {
        if (host.stopped) return
        host.pollTimer = setTimeout(
          () => {
            if (host.registered) this.#poll(host)
            else
              void this.#ensureHost(host.owner)
                .finally(() => this.#poll(host))
                .catch(() => {})
          },
          host.registered ? 0 : 1000,
        )
      })
  }
  #sync(host: WindowHost, tabs: readonly BrowserTab[]) {
    const ids = new Set(tabs.map((t) => t.tabId))
    for (const entry of this.#owned(host))
      if (!ids.has(entry.tab.tabId)) {
        this.#destroy(entry)
        this.#entries.delete(entry.tab.tabId)
        this.options.publish(host.owner, this.#empty(entry.tab.tabId, host.owner))
      }
    for (const tab of tabs) {
      let entry = this.#entries.get(tab.tabId)
      if (!entry) {
        entry = {
          tab,
          owner: host.owner,
          visible: false,
          audio: false,
          capturing: false,
          initialized: false,
          emulated: false,
          ready: new Set(),
          reporting: Promise.resolve(),
        }
        this.#entries.set(tab.tabId, entry)
      } else {
        if (tab.revision < entry.tab.revision) continue
        if (entry.tab.generation !== tab.generation || tab.state === 'suspended')
          this.#destroy(entry)
        if (entry.abort && (!tab.busy || entry.tab.controlThreadId !== tab.controlThreadId))
          entry.abort.abort()
        entry.tab = tab
      }
      this.#publish(entry)
    }
  }
  async #activate(entry: Entry) {
    if (entry.tab.state === 'suspended' || entry.tab.state === 'crashed') {
      const host = this.#hosts.get(entry.owner.id)!
      this.#destroy(entry)
      entry.tab = await this.#rpc.call('browser/host/restore', {
        windowId: host.windowId,
        instanceId: host.instanceId,
        tabId: entry.tab.tabId,
        generation: entry.tab.generation,
      })
    }
    this.#publish(entry)
  }
  async #ready(entry: Entry): Promise<WebContents> {
    if (entry.initialized && entry.contents && !entry.contents.isDestroyed()) return entry.contents
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer)
        entry.ready.delete(ready)
        resolve()
      }
      const timer = setTimeout(() => {
        entry.ready.delete(ready)
        reject(new Error('网页宿主连接超时'))
      }, 20_000)
      entry.ready.add(ready)
    })
    if (!entry.contents || entry.contents.isDestroyed()) throw new Error('网页已退出')
    return entry.contents
  }
  async #report(entry: Entry, patch: Record<string, unknown>) {
    const host = this.#hosts.get(entry.owner.id)
    if (!host || host.stopped) return
    const generation = entry.tab.generation
    entry.reporting = entry.reporting
      .catch(() => {})
      .then(async () => {
        if (!this.#entries.has(entry.tab.tabId) || generation !== entry.tab.generation) return
        const tab = await this.#rpc.call('browser/host/report', {
          windowId: host.windowId,
          instanceId: host.instanceId,
          tabId: entry.tab.tabId,
          generation,
          patch: patch as never,
        })
        if (entry.tab.generation === generation && tab.revision >= entry.tab.revision) {
          entry.tab = tab
          this.#publish(entry)
        }
      })
      .catch(() => {})
    await entry.reporting
  }
  async #navigationReport(entry: Entry, loading?: boolean) {
    const guest = entry.contents
    if (!guest || guest.isDestroyed()) return
    await this.#report(entry, {
      url: guest.getURL() || entry.tab.url,
      title: guest.getTitle().slice(0, 500),
      loading: loading ?? guest.isLoading(),
      documentId: entry.tab.documentId,
      canGoBack: guest.navigationHistory.canGoBack(),
      canGoForward: guest.navigationHistory.canGoForward(),
      history: guest.navigationHistory.getAllEntries().map(({ url, title }) => ({ url, title })),
      historyIndex: guest.navigationHistory.getActiveIndex(),
    })
  }
  async #execute(host: WindowHost, command: BrowserCommand) {
    const entry = this.#entries.get(command.tabId)
    if (!entry || entry.tab.generation !== command.generation || entry.owner !== host.owner) return
    const abort = new AbortController()
    entry.abort = abort
    host.permissions = command.allowedOrigins.map((origin) => ({
      origin,
      decision: 'allow',
      updatedAt: '',
    }))
    let result: BrowserResult | undefined
    let error: string | undefined
    let operationGuest: WebContents | undefined
    let temporaryViewport = false
    try {
      await this.#activate(entry)
      const guest = await this.#ready(entry)
      operationGuest = guest
      abort.signal.throwIfAborted()
      clearTimeout(entry.idle)
      entry.capturing = command.operation.action === 'screenshot'
      abort.signal.addEventListener(
        'abort',
        () => {
          if (guest.isDestroyed()) return
          guest.stop()
          if (guest.debugger.isAttached())
            void guest.debugger.sendCommand('Runtime.terminateExecution').catch(() => {})
        },
        { once: true },
      )
      if (entry.capturing && !entry.visible && !entry.emulated) {
        if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
        await guest.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
          ...entry.tab.viewport,
          deviceScaleFactor: 1,
          mobile: false,
        })
        temporaryViewport = true
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      result = await runBrowserOperation(guest, command, () => entry.tab.documentId, abort.signal)
      if (command.operation.action === 'viewport') {
        entry.emulated = true
        await this.#report(entry, {
          viewport: { width: command.operation.width!, height: command.operation.height! },
        })
      }
    } catch (cause) {
      error = abort.signal.aborted
        ? '浏览器操作已取消'
        : cause instanceof Error &&
            /^(站点需要授权|元素引用已过期|缺少|此 iframe|页面 frame|截图为空|此元素|视口尺寸)/.test(
              cause.message,
            )
          ? cause.message
          : '浏览器操作未完成，请检查页面并重新读取快照'
    } finally {
      if (
        temporaryViewport &&
        operationGuest &&
        !operationGuest.isDestroyed() &&
        operationGuest.debugger.isAttached()
      )
        await operationGuest.debugger
          .sendCommand('Emulation.clearDeviceMetricsOverride')
          .catch(() => {})
      const current = entry.tab.generation === command.generation && entry.abort === abort
      if (current) {
        entry.capturing = false
        entry.abort = undefined
        await this.#navigationReport(entry)
      }
      await this.#rpc
        .call('browser/host/complete', {
          windowId: host.windowId,
          instanceId: host.instanceId,
          requestId: command.requestId,
          generation: command.generation,
          ...(result ? { result } : {}),
          ...(error ? { error } : {}),
        })
        .catch(() => {})
      if (current)
        entry.idle = setTimeout(() => {
          if (!entry.abort) this.#detach(entry)
        }, 1500)
      void this.#budget(host)
    }
  }
  async #budget(host: WindowHost) {
    if (!host || host.stopped || host.budgeting) return
    host.budgeting = true
    try {
      const entries = this.#owned(host).filter((e) => e.contents && !e.contents.isDestroyed())
      const protectedChats = new Set<string | null>()
      const candidates = entries
        .filter(
          (e) =>
            !e.visible && !e.tab.busy && !e.abort && !e.capturing && !e.audio && !e.tab.loading,
        )
        .sort((a, b) => b.tab.lastUsedAt - a.tab.lastUsedAt)
        .filter((e) => {
          const latest = !protectedChats.has(e.tab.sourceThreadId)
          protectedChats.add(e.tab.sourceThreadId)
          return !(latest && Date.now() - e.tab.lastUsedAt < 30 * 60_000)
        })
        .sort((a, b) => a.tab.lastUsedAt - b.tab.lastUsedAt)
      for (const entry of candidates.slice(0, Math.max(0, entries.length - 32))) {
        await this.#navigationReport(entry)
        if (entry.visible || entry.tab.busy || entry.abort || entry.audio || entry.tab.loading)
          continue
        this.#destroy(entry)
        await this.#report(entry, { state: 'suspended', loading: false })
      }
    } finally {
      host.budgeting = false
    }
  }
  #detach(entry: Entry) {
    if (entry.contents?.debugger.isAttached()) entry.contents.debugger.detach()
  }
  #destroy(entry: Entry) {
    clearTimeout(entry.idle)
    entry.abort?.abort()
    entry.abort = undefined
    entry.capturing = false
    entry.emulated = false
    entry.audio = false
    this.#detach(entry)
    if (entry.contents && !entry.contents.isDestroyed())
      entry.contents.close({ waitForBeforeUnload: false })
    entry.contents = undefined
    entry.initialized = false
    for (const ready of entry.ready) ready()
    entry.ready.clear()
  }
  #snapshot(entry: Entry): DesktopBrowserSnapshot {
    const permissions = this.#hosts.get(entry.owner.id)?.permissions ?? []
    return {
      ...entry.tab,
      open: true,
      allowedSites: permissions.filter((p) => p.decision === 'allow').map((p) => p.origin),
      sitePermissions: permissions.map((p) => ({ ...p })),
    }
  }
  #empty(tabId: string, owner: BrowserWindow): DesktopBrowserSnapshot {
    const permissions = this.#hosts.get(owner.id)?.permissions ?? []
    return {
      tabId,
      open: false,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      allowedSites: permissions.filter((p) => p.decision === 'allow').map((p) => p.origin),
      sitePermissions: permissions,
    }
  }
  #publish(entry: Entry) {
    if (!entry.owner.isDestroyed()) this.options.publish(entry.owner, this.#snapshot(entry))
  }
}

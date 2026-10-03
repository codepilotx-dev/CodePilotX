import { createHash, randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import {
  BrowserTabSchema,
  BrowserPermissionSchema,
  type BrowserTab,
  type BrowserPermission,
  type BrowserCommand,
  type BrowserOperation,
  type BrowserResult,
} from '@codepilotx/agent-protocol'
import { AgentError } from '../domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type { ConfigService } from '../config/ConfigService'
import { BrowserRepository } from '../storage/repositories/browser-repository'

type Host = { instanceId: string; connectionId: string; seenAt: number; wake?: () => void }
type Pending = {
  command: BrowserCommand
  windowId: string
  dispatched: boolean
  finish: (result?: BrowserResult, error?: Error) => void
}
export function browserUrl(input: string): string {
  const value = input.trim()
  const url = new URL(
    /^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d/i.test(value)
      ? value
      : /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(value)
        ? `http://${value}`
        : `https://${value}`,
  )
  if (!['http:', 'https:'].includes(url.protocol) && url.href !== 'about:blank')
    throw new AgentError('INVALID_REQUEST', '仅支持 HTTP、HTTPS 和空白页', 400)
  if (url.username || url.password)
    throw new AgentError('INVALID_REQUEST', '浏览器地址不得包含凭据', 400)
  return url.href
}
export class BrowserService {
  readonly repository: BrowserRepository
  private readonly tabs = new Map<string, BrowserTab>()
  private readonly hosts = new Map<string, Host>()
  private readonly pending = new Map<string, Pending>()
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly config: ConfigService,
  ) {
    this.repository = new BrowserRepository(db)
    for (const tab of this.repository.list())
      this.tabs.set(tab.tabId, {
        ...tab,
        state: 'suspended',
        loading: false,
        busy: false,
        generation: randomUUID(),
        documentId: randomUUID(),
      })
  }
  available() {
    return this.repository.available()
  }
  list(windowId?: string) {
    return [...this.tabs.values()]
      .filter((tab) => !windowId || tab.windowId === windowId)
      .sort((a, b) => a.order - b.order)
  }
  require(tabId: string) {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new AgentError('INVALID_REQUEST', '浏览器标签不存在', 404)
    return tab
  }
  permissions(): BrowserPermission[] {
    const desktop = this.config.snapshot().desktop as Record<string, unknown> | undefined
    const values = Array.isArray(desktop?.browserSitePermissions)
      ? desktop.browserSitePermissions
      : []
    const decode = Schema.decodeUnknownSync(BrowserPermissionSchema)
    const records = values.flatMap((value) => {
      try {
        return [decode(value)]
      } catch {
        return []
      }
    })
    const legacy = Array.isArray(desktop?.browserAllowedSites) ? desktop.browserAllowedSites : []
    for (const value of legacy) {
      try {
        if (typeof value !== 'string' || !/^https?:\/\//.test(value)) continue
        const origin = new URL(value).origin
        if (!records.some((item) => item.origin === origin))
          records.push({ origin, decision: 'allow', updatedAt: new Date(0).toISOString() })
      } catch {
        /* Unsupported old entries remain in configuration. */
      }
    }
    return records
  }
  async setPermission(origin?: string, decision?: 'allow' | 'deny' | 'remove' | 'clear') {
    if (!decision) return this.permissions()
    if (decision !== 'clear' && (!origin || new URL(browserUrl(origin)).origin !== origin))
      throw new AgentError('INVALID_REQUEST', '授权必须使用完整站点 origin', 400)
    const current = await this.config.read({ includeLayers: true })
    const user = current.layers?.find((layer) => layer.kind === 'user')
    const desktop = user?.config.desktop as Record<string, unknown> | undefined
    const existing = Array.isArray(desktop?.browserSitePermissions)
      ? desktop.browserSitePermissions
      : []
    const next =
      decision === 'clear'
        ? []
        : existing.filter(
            (item) =>
              !item ||
              typeof item !== 'object' ||
              (item as Record<string, unknown>).origin !== origin,
          )
    if (decision === 'allow' || decision === 'deny')
      next.push({ origin: origin!, decision, updatedAt: new Date().toISOString() })
    const allowed =
      decision === 'clear'
        ? []
        : (Array.isArray(desktop?.browserAllowedSites) ? desktop.browserAllowedSites : []).filter(
            (value) =>
              value !== origin &&
              (typeof value !== 'string' ||
                !URL.canParse(value) ||
                new URL(value).origin !== origin),
          )
    if (decision === 'allow') allowed.push(origin!)
    await this.config.batchWrite({
      target: { kind: 'user' },
      edits: [
        { keyPath: ['desktop', 'browserSitePermissions'], value: next as never },
        { keyPath: ['desktop', 'browserAllowedSites'], value: allowed as never },
      ],
      ...(user ? { expectedVersion: user.version } : {}),
    })
    if (decision !== 'allow')
      for (const pending of [...this.pending.values()])
        pending.finish(undefined, new AgentError('RUN_ABORTED', '站点授权已撤销', 499))
    this.wakeAll()
    return this.permissions()
  }
  async create(
    input: { tabId?: string; windowId?: string; sourceThreadId: string | null; url?: string },
    agent = false,
  ) {
    if (!this.available()) throw new AgentError('CAPABILITY_REQUIRED', '浏览器存储不可用', 409)
    const windowId =
      input.windowId ??
      [...this.hosts.entries()].filter(([, host]) => Date.now() - host.seenAt < 60_000).at(-1)?.[0]
    if (!windowId || !this.hosts.has(windowId))
      throw new AgentError('INVALID_REQUEST', '桌面浏览器尚未连接', 409)
    if (input.sourceThreadId && !this.db.getThread(input.sourceThreadId))
      throw new AgentError('INVALID_REQUEST', '来源聊天不存在', 404)
    const tabId = input.tabId ?? randomUUID()
    if (this.tabs.has(tabId)) {
      const tab = this.require(tabId)
      if (tab.windowId !== windowId)
        throw new AgentError('PERMISSION_DENIED', '标签属于其他窗口', 403)
      return tab
    }
    return this.save({
      tabId,
      windowId,
      sourceThreadId: input.sourceThreadId,
      controlThreadId: agent ? input.sourceThreadId : null,
      url: browserUrl(input.url ?? 'about:blank'),
      title: '新标签页',
      state: 'suspended',
      loading: false,
      busy: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      generation: randomUUID(),
      documentId: randomUUID(),
      viewport: { width: 1280, height: 720 },
      panel: 'right',
      order: Date.now(),
      lastUsedAt: Date.now(),
      revision: 0,
    })
  }
  async control(tabId: string, threadId: string | null) {
    const tab = this.require(tabId)
    if (threadId && !this.db.getThread(threadId))
      throw new AgentError('INVALID_REQUEST', '聊天不存在', 404)
    this.cancelTab(tabId)
    return this.save({ ...tab, controlThreadId: threadId, busy: false })
  }
  async close(tabId: string) {
    this.require(tabId)
    this.cancelTab(tabId)
    this.tabs.delete(tabId)
    await this.changed(tabId, () => this.repository.remove(tabId))
    this.wakeAll()
  }
  async layout(tabId: string, panel: 'right' | 'bottom', order: number) {
    return this.save({ ...this.require(tabId), panel, order })
  }
  async register(windowId: string, instanceId: string, connectionId: string) {
    const old = this.hosts.get(windowId)
    if (old && old.instanceId !== instanceId) this.release(windowId, old.instanceId)
    this.hosts.set(windowId, { instanceId, connectionId, seenAt: Date.now() })
    for (const tab of this.list()) {
      if (tab.windowId === windowId || !this.hosts.has(tab.windowId))
        await this.save({
          ...tab,
          windowId,
          ...(old && old.instanceId !== instanceId
            ? {
                state: 'suspended' as const,
                generation: randomUUID(),
                documentId: randomUUID(),
                busy: false,
                loading: false,
              }
            : {}),
        })
    }
    return { tabs: this.list(windowId) }
  }
  host(windowId: string, instanceId: string, connectionId?: string) {
    const host = this.hosts.get(windowId)
    if (
      !host ||
      host.instanceId !== instanceId ||
      (connectionId && host.connectionId !== connectionId)
    )
      throw new AgentError('PERMISSION_DENIED', '浏览器宿主已失效', 403)
    host.seenAt = Date.now()
    return host
  }
  async next(windowId: string, instanceId: string, connectionId: string) {
    const host = this.host(windowId, instanceId, connectionId)
    const take = () =>
      [...this.pending.values()].find(
        (pending) => pending.windowId === windowId && !pending.dispatched,
      )
    let next = take()
    if (!next)
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          if (host.wake === finish) delete host.wake
          resolve()
        }
        const timer = setTimeout(finish, 20_000)
        host.wake?.()
        host.wake = finish
      })
    this.host(windowId, instanceId, connectionId)
    next = take()
    if (next) next.dispatched = true
    return {
      command: next?.command ?? null,
      tabs: this.list(windowId),
      permissions: this.permissions(),
    }
  }
  complete(
    windowId: string,
    instanceId: string,
    requestId: string,
    generation: string,
    result?: BrowserResult,
    error?: string,
  ) {
    this.host(windowId, instanceId)
    const pending = this.pending.get(requestId)
    if (!pending) return
    if (pending.windowId !== windowId || pending.command.generation !== generation)
      throw new AgentError('PERMISSION_DENIED', '浏览器命令代际不匹配', 403)
    pending.finish(
      result,
      error ? new AgentError('INVALID_REQUEST', error.slice(0, 2000), 409) : undefined,
    )
  }
  async report(
    windowId: string,
    instanceId: string,
    tabId: string,
    generation: string,
    patch: unknown,
  ) {
    this.host(windowId, instanceId)
    const tab = this.require(tabId)
    if (tab.windowId !== windowId || tab.generation !== generation)
      throw new AgentError('PERMISSION_DENIED', '浏览器页面已失效', 409)
    const p = patch as Record<string, unknown>
    const values: Record<string, unknown> = {}
    for (const key of [
      'url',
      'title',
      'state',
      'loading',
      'canGoBack',
      'canGoForward',
      'error',
      'documentId',
      'viewport',
      'lastUsedAt',
    ] as const)
      if (p && key in p) values[key] = p[key]
    if (typeof values.url === 'string') values.url = browserUrl(values.url)
    if (Array.isArray(p?.history))
      Object.assign(values, this.repository.normalizeHistory(p.history, Number(p.historyIndex)))
    return this.save(Schema.decodeUnknownSync(BrowserTabSchema)({ ...tab, ...values }))
  }
  async restore(windowId: string, instanceId: string, tabId: string, generation: string) {
    this.host(windowId, instanceId)
    const tab = this.require(tabId)
    if (tab.windowId !== windowId || tab.generation !== generation)
      throw new AgentError('PERMISSION_DENIED', '浏览器页面已失效', 409)
    this.cancelTab(tabId)
    return this.save({
      ...tab,
      state: 'parked',
      generation: randomUUID(),
      documentId: randomUUID(),
      loading: false,
      busy: false,
      error: null,
    })
  }
  release(windowId: string, instanceId: string) {
    const host = this.hosts.get(windowId)
    if (!host || host.instanceId !== instanceId) return
    this.hosts.delete(windowId)
    host.wake?.()
    for (const pending of [...this.pending.values()])
      if (pending.windowId === windowId)
        pending.finish(
          undefined,
          new AgentError('INVALID_REQUEST', '浏览器连接已中断，操作不会自动重放', 409),
        )
  }
  inspect(threadId: string, tabId?: string, operation?: BrowserOperation) {
    if (operation?.url && operation.action !== 'navigate')
      throw new AgentError('INVALID_REQUEST', '只有导航操作接受 URL', 400)
    if (operation?.action === 'navigate' && !operation.url)
      throw new AgentError('INVALID_REQUEST', '导航操作缺少网址', 400)
    const tab = tabId ? this.require(tabId) : undefined
    if (tab && tab.controlThreadId !== threadId)
      throw new AgentError('PERMISSION_DENIED', '请先将此标签交给当前聊天', 403)
    const url = operation?.url ? browserUrl(operation.url) : tab?.url
    const origin = url && url !== 'about:blank' ? new URL(url).origin : null
    const permission = this.permissions().find((item) => item.origin === origin)
    if (permission?.decision === 'deny')
      throw new AgentError('PERMISSION_DENIED', '此站点的浏览器授权已被拒绝', 403)
    return {
      origin,
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            threadId,
            tabId,
            operation,
            origin,
            control: tab?.controlThreadId,
            documentId: tab?.documentId,
          }),
        )
        .digest('hex'),
      affectedPaths: [],
      ruleRequiresApproval: Boolean(origin && permission?.decision !== 'allow'),
    }
  }
  async execute(threadId: string, tabId: string, operation: BrowserOperation, signal: AbortSignal) {
    const inspected = this.inspect(threadId, tabId, operation)
    // Reached only after ToolExecutor authorizes this exact invocation.
    if (inspected.origin && inspected.ruleRequiresApproval)
      await this.setPermission(inspected.origin, 'allow')
    this.inspect(threadId, tabId, operation)
    let tab = this.require(tabId)
    if (tab.busy) throw new AgentError('INVALID_REQUEST', '此标签已有操作正在执行', 409)
    const host = this.hosts.get(tab.windowId)
    if (!host || Date.now() - host.seenAt > 60_000)
      throw new AgentError('INVALID_REQUEST', '桌面浏览器不可用', 409)
    signal.throwIfAborted()
    if (tab.state === 'suspended' || tab.state === 'crashed')
      tab = await this.save({
        ...tab,
        state: 'parked',
        generation: randomUUID(),
        documentId: randomUUID(),
        error: null,
      })
    await this.save({ ...tab, busy: true })
    const command: BrowserCommand = {
      requestId: randomUUID(),
      tabId,
      generation: tab.generation,
      operation: operation.url ? { ...operation, url: browserUrl(operation.url) } : operation,
      allowedOrigins: this.permissions()
        .filter((p) => p.decision === 'allow')
        .map((p) => p.origin),
    }
    try {
      signal.throwIfAborted()
      const current = this.require(tabId)
      if (
        current.generation !== command.generation ||
        current.controlThreadId !== threadId ||
        !current.busy
      )
        throw new AgentError('RUN_ABORTED', '页面已交接或关闭', 499)
      return await new Promise<BrowserResult>((resolve, reject) => {
        const abort = () =>
          finish(undefined, new AgentError('RUN_ABORTED', '浏览器操作已取消', 499))
        const finish = (result?: BrowserResult, error?: Error) => {
          if (!this.pending.delete(command.requestId)) return
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          if (error) reject(error)
          else resolve(result ?? { text: '完成' })
          host.wake?.()
        }
        const timer = setTimeout(
          () =>
            finish(
              undefined,
              new AgentError('INVALID_REQUEST', '浏览器操作超时；不会自动重放', 408),
            ),
          30_000,
        )
        this.pending.set(command.requestId, {
          command,
          windowId: tab.windowId,
          dispatched: false,
          finish,
        })
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        host.wake?.()
      })
    } finally {
      const current = this.tabs.get(tabId)
      if (current?.generation === command.generation) await this.save({ ...current, busy: false })
    }
  }
  private cancelTab(tabId: string) {
    for (const pending of [...this.pending.values()])
      if (pending.command.tabId === tabId)
        pending.finish(undefined, new AgentError('RUN_ABORTED', '页面已交接或关闭', 499))
  }
  private wakeAll() {
    for (const host of this.hosts.values()) host.wake?.()
  }
  private async changed(tabId: string, write: () => void) {
    const event = this.db.sqlite.transaction(() => {
      write()
      return this.db.insertEvent(null, null, 'browser/changed', { tabId })
    })()
    await Effect.runPromise(this.hub.publish(event))
  }
  private async save(tab: BrowserTab) {
    const next = {
      ...tab,
      revision: Math.max(tab.revision, this.tabs.get(tab.tabId)?.revision ?? 0) + 1,
    }
    await this.changed(tab.tabId, () => {
      this.repository.save(next)
      this.tabs.set(tab.tabId, next)
    })
    this.wakeAll()
    return next
  }
  dispose() {
    for (const [windowId, host] of [...this.hosts]) this.release(windowId, host.instanceId)
  }
}

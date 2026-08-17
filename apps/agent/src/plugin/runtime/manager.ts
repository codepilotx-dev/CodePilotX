/**
 * Application 插件运行时管理器。
 *
 * 语义（对齐 McpConnectionManager 的 generation/lease/retire）：
 * - reconcile 扫描 inventory，按 service graph 拓扑序启动（staging 全部健康
 *   后才把 generation 切为 active；staging 失败保留上一 generation）；
 * - main turn 与 subagent 通过 acquireForRequest 同时取得当前 generation 租约；
 * - retired generation 等 leases=0 后 quiesce/shutdown（超时清理进程树）；
 * - crash loop 达到阈值自动 disable 并保留安全诊断；
 * - 普通 disable 停止新 lease 等 drain；强制 disable 立即杀进程树。
 */

import { isAbsolute, join, relative, resolve } from "node:path"
import type { PluginManifestV1 } from "@codepilotx/plugin-sdk"
import { PluginInstallError, PluginInstaller } from "../installer"
import { PluginRepository, type StoredPluginPackage } from "../../storage/repositories/plugin-repository"
import { buildServiceGraph, type PluginRuntimeStatus, type ServiceGraphNode } from "./service-graph"
import { createInstanceToken, ProcessSupervisor, RUNNER_SHUTDOWN_TIMEOUT_MS } from "./supervisor"
import { AgentError } from "../../domain"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"

export const PLUGIN_CRASH_LIMIT = 3
export const PLUGIN_CRASH_RETRY_DELAY_MS = 1_000

export interface PluginRuntimeLease {
  id: string
  generation: number
  release(): Promise<void>
}

export type BrokerRespond = (result: unknown, error?: { code: string; message: string; retryable: boolean }) => void
export type BrokerHandler = (method: string, params: unknown, respond: BrokerRespond) => void

export interface ReconcileResult {
  activated: string[]
  retired: string[]
  waiting: Array<{ pluginId: string; missingKeys: string[] }>
  conflicts: Array<{ key: string; providers: string[] }>
  cycles: Array<{ pluginIds: string[] }>
  failed: Array<{ pluginId: string; code: string; message: string }>
}

interface ActivePlugin {
  plugin: StoredPluginPackage
  manifest: PluginManifestV1
  node: ServiceGraphNode
  state: PluginRuntimeStatus
  generationId: string
  generationNumber: number
  supervisor: ProcessSupervisor | null
  leases: number
  retired: boolean
  crashCount: number
  lastError: { code: string; message: string; retryable: boolean } | null
  retryTimer: ReturnType<typeof setTimeout> | null
}

const runtimeKindOf = (manifest: PluginManifestV1): "declarative" | "process" | "system" =>
  manifest.runtime.kind === "system" ? "system" : manifest.runtime.kind === "process" ? "process" : "declarative"

const manifestOf = (plugin: StoredPluginPackage): PluginManifestV1 | null => {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifestV1
  } catch {
    return null
  }
}

const nodeOf = (plugin: StoredPluginPackage, manifest: PluginManifestV1): ServiceGraphNode => ({
  pluginId: plugin.pluginId,
  provides: (manifest.contributes?.services ?? []).map((service) => ({
    pluginId: plugin.pluginId,
    key: service.key,
    version: service.version,
    singleton: service.singleton ?? false,
  })),
  requires: [
    ...Object.entries(manifest.requires?.services ?? {}).map(([key, range]) => ({
      pluginId: plugin.pluginId,
      kind: "required" as const,
      key,
      range,
    })),
    ...Object.entries(manifest.requires?.optionalServices ?? {}).map(([key, range]) => ({
      pluginId: plugin.pluginId,
      kind: "optional" as const,
      key,
      range,
    })),
  ],
})

export class PluginRuntimeManager {
  private readonly repo: PluginRepository
  private readonly plugins = new Map<string, ActivePlugin>()
  /** 独立于条目的连续崩溃计数（startProcess 失败时条目可能未入 map）。 */
  private readonly crashCounts = new Map<string, number>()
  /** 图阻塞（missing/cycle/conflict）插件 → waiting 状态。 */
  private readonly waitingPlugins = new Set<string>()
  /** service key（含 @major）→ provider pluginId（最近一次 reconcile 结果）。 */
  private providersByKey = new Map<string, string>()
  private brokerProvider: ((pluginId: string) => BrokerHandler) | null = null
  private nextGeneration = 1
  private reconciling: Promise<ReconcileResult> | null = null

  constructor(
    private readonly options: {
      db: AgentDatabase
      installer: PluginInstaller
      publish: (event: { method: string; params: unknown }) => Promise<void>
      /** 供 PluginService.list 合并运行时状态。 */
      onStatusChanged?: (pluginId: string, status: PluginRuntimeStatus) => void
      /** 覆盖 runner initialize 握手超时（测试用）。 */
      initializeTimeoutMs?: number
    },
  ) {
    this.repo = new PluginRepository(options.db)
  }

  /** 注册 Host broker（KV/serviceCall/credentialUse 等转发）。 */
  setBrokerProvider(provider: (pluginId: string) => BrokerHandler) {
    this.brokerProvider = provider
  }

  /** service key（含 @major）→ provider pluginId。 */
  serviceProvider(key: string): string | null {
    return this.providersByKey.get(key) ?? null
  }

  /** 幂等 reconcile：并发调用共享同一轮。 */
  reconcile(): Promise<ReconcileResult> {
    if (this.reconciling) return this.reconciling
    this.reconciling = this.performReconcile().finally(() => { this.reconciling = null })
    return this.reconciling
  }

  private async performReconcile(): Promise<ReconcileResult> {
    const result: ReconcileResult = { activated: [], retired: [], waiting: [], conflicts: [], cycles: [], failed: [] }
    const desired = this.repo.listPackages().filter((plugin) => {
      const manifest = manifestOf(plugin)
      if (!manifest) return false
      const kind = runtimeKindOf(manifest)
      if (kind === "system") return false // System Profile 由 PR 7 管理
      const activation = this.repo.getActivation(plugin.pluginId, "")
      if (!activation?.enabled) return false
      if (!this.repo.hasGrant(plugin.pluginId, plugin.digest, "__digest__")) return false
      return true
    })

    const nodes = desired.flatMap((plugin) => {
      const manifest = manifestOf(plugin)
      return manifest ? [{ plugin, manifest, node: nodeOf(plugin, manifest) }] : []
    })

    const graph = buildServiceGraph(nodes.map((entry) => entry.node))
    this.providersByKey = graph.providersByKey
    result.waiting = graph.waiting
    result.conflicts = graph.conflicts
    result.cycles = graph.cycles
    // 图阻塞的插件记录 waiting 状态（不含运行条目）。
    this.waitingPlugins.clear()
    for (const item of graph.waiting) this.waitingPlugins.add(item.pluginId)
    for (const cycle of graph.cycles) for (const pluginId of cycle.pluginIds) this.waitingPlugins.add(pluginId)
    for (const conflict of graph.conflicts) {
      for (const provider of conflict.providers) this.waitingPlugins.add(provider)
    }

    const byId = new Map(nodes.map((entry) => [entry.plugin.pluginId, entry] as const))
    const desiredIds = new Set(nodes.map((entry) => entry.plugin.pluginId))

    // 1. retire 不再需要或图被阻塞的插件（digest 变化不在此 retire：
    //    last-good 语义要求新 generation 健康后才替换旧进程）。
    for (const [pluginId, active] of [...this.plugins.entries()]) {
      const stillDesired = desiredIds.has(pluginId)
      const blocked = graph.waiting.some((item) => item.pluginId === pluginId)
        || graph.cycles.some((cycle) => cycle.pluginIds.includes(pluginId))
      if (!stillDesired || blocked) {
        this.retire(active)
        result.retired.push(pluginId)
      }
    }

    // 2. 拓扑序启动/复用。staging 全部健康后才替换 active：新 generation
    //    启动成功前旧进程保持 active（last-good 语义）。
    for (const pluginId of graph.activationOrder) {
      const entry = byId.get(pluginId)
      if (!entry) continue
      const existing = this.plugins.get(pluginId)
      if (existing && existing.plugin.digest === entry.plugin.digest && existing.state === "active") {
        continue
      }
      const kind = runtimeKindOf(entry.manifest)
      if (kind === "declarative") {
        this.activateDeclarative(entry.plugin, entry.manifest)
        result.activated.push(pluginId)
        continue
      }
      const previous = existing
      try {
        const started = await this.startProcess(entry.plugin, entry.manifest)
        this.plugins.set(pluginId, started)
        this.setStatus(started, "active")
        if (previous) {
          this.retire(previous)
          result.retired.push(pluginId)
          if (previous.leases === 0 && previous.supervisor) {
            await this.shutdownProcess(previous)
          }
        }
        result.activated.push(pluginId)
      } catch (cause) {
        const code = cause instanceof PluginInstallError ? cause.code
          : cause instanceof AgentError ? cause.code
            : "PLUGIN_INSTALL_FAILED"
        const message = cause instanceof Error ? cause.message : "插件启动失败"
        // 保留 last-good：previous 仍在 map 中且未 retire。
        if (!previous) this.markFailed(entry.plugin.pluginId, { code, message, retryable: true })
        result.failed.push({ pluginId: entry.plugin.pluginId, code, message })
      }
    }

    // 3. 清理已 retire 的进程（leases=0 时关闭）。
    for (const [pluginId, active] of [...this.plugins.entries()]) {
      if (active.retired && active.leases === 0 && active.supervisor) {
        void this.shutdownProcess(active)
      }
    }
    return result
  }

  /** main turn 与 subagent 共用：取得全部 active 进程插件的 generation 租约。 */
  async acquireForRequest(_request: { threadID: string; turnID: string; agentID: string; sessionID: string }): Promise<PluginRuntimeLease[]> {
    await this.reconcile()
    const leases: PluginRuntimeLease[] = []
    for (const active of this.plugins.values()) {
      if (active.state !== "active" || !active.supervisor || active.retired) continue
      active.leases += 1
      let released = false
      leases.push({
        id: `${active.plugin.pluginId}@${active.generationId}`,
        generation: active.generationNumber,
        release: async () => {
          if (released) return
          released = true
          active.leases = Math.max(0, active.leases - 1)
          if (active.retired && active.leases === 0 && active.supervisor) {
            await this.shutdownProcess(active)
          }
        },
      })
    }
    return leases
  }

  status(pluginId: string): PluginRuntimeStatus {
    const active = this.plugins.get(pluginId)
    if (active) return active.state
    if (this.waitingPlugins.has(pluginId)) return "waiting"
    return "disabled"
  }

  /** 向 active 插件的 runner 发起请求（工具执行、命令、视图、serviceCall 等转发）。 */
  async call(
    pluginId: string,
    method: string,
    params: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const active = this.plugins.get(pluginId)
    if (!active || active.state !== "active" || active.retired || !active.supervisor) {
      throw new AgentError("PLUGIN_NOT_FOUND", `插件 ${pluginId} 当前不可用`, 503)
    }
    if (options.signal?.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    let cancelled = false
    const onAbort = () => { cancelled = true }
    options.signal?.addEventListener("abort", onAbort, { once: true })
    try {
      const request = active.supervisor.request(method, params, options.timeoutMs)
      const result = await request
      if (cancelled || options.signal?.aborted) {
        throw new AgentError("RUN_ABORTED", "任务已停止", 499)
      }
      return result
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
      throw new AgentError("PLUGIN_INSTALL_FAILED", "插件调用失败", 502)
    } finally {
      options.signal?.removeEventListener("abort", onAbort)
    }
  }

  /** 全部 active 插件（供贡献适配器构建目录）。 */
  activePlugins(): Array<{ plugin: StoredPluginPackage; manifest: PluginManifestV1; generationId: string }> {
    const entries: Array<{ plugin: StoredPluginPackage; manifest: PluginManifestV1; generationId: string }> = []
    for (const active of this.plugins.values()) {
      if (active.state === "active" && !active.retired) {
        entries.push({ plugin: active.plugin, manifest: active.manifest, generationId: active.generationId })
      }
    }
    return entries
  }

  statuses(): ReadonlyMap<string, PluginRuntimeStatus> {
    return new Map([...this.plugins.entries()].map(([pluginId, active]) => [pluginId, active.state]))
  }

  /** 普通 disable：停止新 lease 并等待 drain（由调用方先写 DB）。 */
  async disable(pluginId: string): Promise<void> {
    const active = this.plugins.get(pluginId)
    if (!active) return
    this.retire(active)
    if (active.leases === 0 && active.supervisor) {
      await this.shutdownProcess(active)
    }
  }

  /** 强制 disable：取消一切并杀进程树。 */
  forceDisable(pluginId: string): void {
    const active = this.plugins.get(pluginId)
    if (!active) return
    this.retire(active)
    if (active.supervisor) active.supervisor.forceKill()
    this.setStatus(active, "disabled")
    this.plugins.delete(pluginId)
  }

  async dispose(): Promise<void> {
    for (const active of [...this.plugins.values()]) {
      if (active.retryTimer) clearTimeout(active.retryTimer)
      active.retired = true
      active.leases = 0
      if (active.supervisor) await this.shutdownProcess(active)
    }
    this.plugins.clear()
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private activateDeclarative(plugin: StoredPluginPackage, manifest: PluginManifestV1) {
    const existing = this.plugins.get(plugin.pluginId)
    if (existing) {
      existing.plugin = plugin
      existing.manifest = manifest
      this.setStatus(existing, "active")
      return
    }
    const active: ActivePlugin = {
      plugin,
      manifest,
      node: nodeOf(plugin, manifest),
      state: "active",
      generationId: `decl-${plugin.digest.slice(0, 12)}`,
      generationNumber: this.nextGeneration++,
      supervisor: null,
      leases: 0,
      retired: false,
      crashCount: 0,
      lastError: null,
      retryTimer: null,
    }
    this.plugins.set(plugin.pluginId, active)
    this.setStatus(active, "active")
  }

  /** 启动进程并返回新 ActivePlugin（不写 map；由调用方决定替换时机与 last-good）。 */
  private async startProcess(plugin: StoredPluginPackage, manifest: PluginManifestV1): Promise<ActivePlugin> {
    const packageRoot = plugin.installedPath
    const executable = manifest.runtime.kind === "process" ? manifest.runtime.executable : ""
    const instanceToken = createInstanceToken()
    const generationId = `${plugin.pluginId}@${plugin.version}-${plugin.digest.slice(0, 12)}`
    let supervisorRef: ProcessSupervisor | null = null
    const supervisor = new ProcessSupervisor({
      pluginId: plugin.pluginId,
      generationId,
      packageRoot,
      executable,
      ...(manifest.runtime.kind === "process" && manifest.runtime.args !== undefined ? { args: manifest.runtime.args } : {}),
      instanceToken,
      environment: {
        CPX_PLUGIN_ID: plugin.pluginId,
        CPX_GENERATION: generationId,
        CPX_PLUGIN_DATA_DIR: join(this.options.installer.dataRoot(), plugin.pluginId),
      },
      onClientRequest: (method, params, respond) => {
        const broker = this.brokerProvider?.(plugin.pluginId)
        if (broker) {
          broker(method, params, respond)
          return
        }
        respond(undefined, { code: "UNKNOWN_METHOD", message: `Host 方法暂不可用：${method}`, retryable: false })
      },
      onClientNotification: (method, params) => {
        if (method === "host/log") {
          // 首版仅安全记录日志级别；正文脱敏由 PR 5 处理。
          const entry = params as { level?: string; message?: string } | undefined
          void this.options.publish({
            method: "plugin/runtime-status-changed",
            params: { pluginId: plugin.pluginId, status: entry?.level === "error" ? "crashed" : "active" },
          }).catch(() => undefined)
          return
        }
        if (method === "host/progress") return
        if (method === "host/viewInvalidate") return
      },
      onExit: (code, reason) => {
        void this.handleRunnerExit(plugin.pluginId, supervisorRef, code, reason)
      },
    })
    supervisorRef = supervisor
    const active: ActivePlugin = {
      plugin,
      manifest,
      node: nodeOf(plugin, manifest),
      state: "waiting",
      generationId,
      generationNumber: this.nextGeneration++,
      supervisor,
      leases: 0,
      retired: false,
      crashCount: this.crashCounts.get(plugin.pluginId) ?? 0,
      lastError: null,
      retryTimer: null,
    }
    try {
      const handshake = await supervisor.start(manifest, this.options.initializeTimeoutMs)
      void handshake
      active.state = "active"
      active.crashCount = 0
      this.crashCounts.set(plugin.pluginId, 0)
      active.lastError = null
      return active
    } catch (cause) {
      supervisor.forceKill()
      throw cause
    }
  }

  private retire(active: ActivePlugin) {
    if (active.retired) return
    active.retired = true
    this.setStatus(active, "retiring")
  }

  private async shutdownProcess(active: ActivePlugin) {
    const supervisor = active.supervisor
    if (!supervisor) return
    active.supervisor = null
    try {
      await supervisor.close(RUNNER_SHUTDOWN_TIMEOUT_MS)
    } catch {
      supervisor.forceKill()
    }
    // 只删除仍指向该条目的 map 项（新 generation 可能已替换）。
    if (this.plugins.get(active.plugin.pluginId) === active) {
      this.plugins.delete(active.plugin.pluginId)
    }
    this.setStatus(active, "disabled")
  }

  private async handleRunnerExit(pluginId: string, supervisor: ProcessSupervisor | null, code: number | null, reason: "exit" | "signal" | "pipe") {
    const active = this.plugins.get(pluginId)
    // 旧 generation 的进程退出不得影响新条目的状态。
    if (active && supervisor && active.supervisor !== supervisor) return
    const crashCount = (this.crashCounts.get(pluginId) ?? 0) + 1
    this.crashCounts.set(pluginId, crashCount)
    if (active) {
      if (active.retired || active.state === "disabled") return
      active.crashCount = crashCount
      active.lastError = {
        code: reason === "pipe" ? "PLUGIN_PIPE_BROKEN" : "PLUGIN_PROCESS_EXITED",
        message: `Runner 进程退出（code=${code ?? "unknown"}）`,
        retryable: true,
      }
    }
    if (crashCount >= PLUGIN_CRASH_LIMIT) {
      // crash loop：自动 disable 并保留诊断。
      this.repo.setActivation(pluginId, "", false)
      this.waitingPlugins.delete(pluginId)
      if (active) {
        if (active.retryTimer) {
          clearTimeout(active.retryTimer)
          active.retryTimer = null
        }
        this.setStatus(active, "disabled")
        if (this.plugins.get(pluginId) === active) this.plugins.delete(pluginId)
      }
      return
    }
    if (active) {
      if (active.retryTimer) clearTimeout(active.retryTimer)
      this.setStatus(active, "crashed")
      active.retryTimer = setTimeout(() => {
        active.retryTimer = null
        void this.reconcile().catch(() => undefined)
      }, PLUGIN_CRASH_RETRY_DELAY_MS)
    } else {
      // 条目尚未入 map（startProcess 失败路径）：直接安排重试。
      setTimeout(() => { void this.reconcile().catch(() => undefined) }, PLUGIN_CRASH_RETRY_DELAY_MS)
    }
  }

  private markFailed(pluginId: string, error: { code: string; message: string; retryable: boolean }) {
    const active = this.plugins.get(pluginId)
    if (active) {
      active.lastError = error
      this.setStatus(active, "crashed")
    }
  }

  private setStatus(active: ActivePlugin, status: PluginRuntimeStatus) {
    active.state = status
    this.options.onStatusChanged?.(active.plugin.pluginId, status)
    void this.options.publish({
      method: "plugin/runtime-status-changed",
      params: { pluginId: active.plugin.pluginId, status },
    }).catch(() => undefined)
  }
}

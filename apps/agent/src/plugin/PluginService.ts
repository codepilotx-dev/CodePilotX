/**
 * 插件管理 service：Inventory、安装/链接/启停/卸载、配置、授权与 Profile 管理。
 *
 * RPC handler 只做 decode 并调用本 service；本 service 只调用 PluginRepository
 * 与 PluginInstaller，不内联 SQL。所有 mutation 带 operationId 幂等。
 *
 * 信任模型：
 * - Developer Mode 默认关闭；process/system 包在未开启时不能 enable。
 * - 每个新 digest 需要独立信任确认（plugin/grants/update 写入 "__digest__" 确认）；
 *   新 digest 不继承旧 digest 的信任。
 */

import { createHash, randomUUID } from "node:crypto"
import Ajv from "ajv"
import type { ConfigService } from "../config/ConfigService"
import { AgentError } from "../domain"
import { PluginInstallError, PluginInstaller } from "./installer"
import { PluginRepository, type StoredPluginPackage } from "../storage/repositories/plugin-repository"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventEnvelope } from "../domain"

export const PLUGIN_DIGEST_TRUST_KEY = "__digest__"
export const PLUGIN_CONFIG_KV_KEY = "__config__"

export interface PluginSummary {
  pluginId: string
  version: string
  displayName: string
  description: string
  publisher: string
  tier: "application" | "system"
  runtimeKind: "declarative" | "process" | "system"
  digest: string
  source: "package" | "linked-directory"
  linkedPath: string | null
  stagedDirectoryDigest: string | null
  runtimeStatus: "waiting" | "active" | "retiring" | "crashed" | "disabled"
  trustedDigest: boolean
  enabledGlobal: boolean
  workspaceOverrides: Array<{ workspaceKey: string; enabled: boolean }>
  installedAt: number
  updatedAt: number
}

const safeError = (code: string, message: string, status = 400): AgentError => new AgentError(code as never, message, status)

const runtimeKindOf = (plugin: StoredPluginPackage): "declarative" | "process" | "system" => {
  try {
    const manifest = JSON.parse(plugin.manifestJson) as { runtime?: { kind?: string } }
    const kind = manifest.runtime?.kind
    return kind === "system" ? "system" : kind === "process" ? "process" : "declarative"
  } catch {
    return "declarative"
  }
}

export class PluginService {
  private readonly repo: PluginRepository
  private readonly ajv = new Ajv({ strict: false, allErrors: true })

  constructor(
    private readonly options: {
      db: AgentDatabase
      installer: PluginInstaller
      configService: ConfigService
      publish: (event: EventEnvelope) => Promise<void>
      /** 运行时状态来源（PluginRuntimeManager.statuses）。 */
      runtimeStatuses?: () => ReadonlyMap<string, "waiting" | "active" | "retiring" | "crashed" | "disabled">
      /** inventory 变化后回调（PluginRuntimeManager.reconcile）。 */
      onInventoryChanged?: () => void | Promise<void>
      /** 贡献目录（PluginContributionAdapter.contributionList）。 */
      contributionList?: () => unknown
      /** 插件命令执行（PR 6；内部按 trigger 查命令并转发 runner）。 */
      commandExecute?: (input: { pluginId: string; commandId: string; args?: string }) => Promise<{ promptTemplate?: string; actionResult?: unknown }>
      /** 插件视图渲染与动作（PR 6）。 */
      viewCall?: {
        renderView: (input: { pluginId: string; viewId: string; instanceId: string }) => Promise<{ nodes: unknown[] }>
        viewAction: (input: { pluginId: string; viewId: string; instanceId: string; actionId: string; params?: unknown }) => Promise<{ ok: true }>
      }
    },
  ) {
    this.repo = new PluginRepository(options.db)
  }

  private get developerModeEnabled(): boolean {
    const config = this.options.configService.snapshot()
    const plugins = (config.plugins ?? {}) as Record<string, unknown>
    return plugins.developerMode === true
  }

  private async publishInventory() {
    await this.options.publish({
      id: 0,
      afterSequence: 0,
      threadId: null,
      turnId: null,
      method: "plugin/inventory-changed",
      params: { changedAt: Date.now() },
      createdAt: Date.now(),
    }).catch(() => undefined)
    const callback = this.options.onInventoryChanged
    if (callback) await Promise.resolve(callback()).catch(() => undefined)
  }

  private async publishOperation(operationId: string, status: "pending" | "completed" | "failed") {
    await this.options.publish({
      id: 0,
      afterSequence: 0,
      threadId: null,
      turnId: null,
      method: "plugin/operation-updated",
      params: { operationId, status },
      createdAt: Date.now(),
    }).catch(() => undefined)
  }

  private requestHash(method: string, params: unknown): string {
    return createHash("sha256").update(JSON.stringify({ method, params }), "utf8").digest("hex")
  }

  // ── inventory ──────────────────────────────────────────────────────────

  list(): PluginSummary[] {
    const statuses = this.options.runtimeStatuses?.() ?? new Map()
    return this.repo.listPackages().map((plugin) => {
      const activations = this.repo.listActivations(plugin.pluginId)
      const global = activations.find((row) => row.workspaceKey === "")
      return {
        pluginId: plugin.pluginId,
        version: plugin.version,
        displayName: plugin.displayName,
        description: plugin.description,
        publisher: plugin.publisher,
        tier: plugin.tier,
        runtimeKind: runtimeKindOf(plugin),
        digest: plugin.digest,
        source: plugin.source,
        linkedPath: plugin.linkedPath,
        stagedDirectoryDigest: plugin.stagedDirectoryDigest,
        runtimeStatus: statuses.get(plugin.pluginId) ?? "disabled",
        trustedDigest: this.repo.hasGrant(plugin.pluginId, plugin.digest, PLUGIN_DIGEST_TRUST_KEY),
        enabledGlobal: global?.enabled ?? false,
        workspaceOverrides: activations
          .filter((row) => row.workspaceKey !== "")
          .map((row) => ({ workspaceKey: row.workspaceKey, enabled: row.enabled })),
        installedAt: plugin.installedAt,
        updatedAt: plugin.updatedAt,
      }
    })
  }

  // ── 安装 / 链接 / 卸载 ────────────────────────────────────────────────

  async installPackage(input: { packagePath: string; operationId: string }): Promise<{ pluginId: string; version: string; digest: string; status: "installed-disabled" }> {
    const operation = this.repo.createOperation({
      operationId: input.operationId,
      pluginId: "system",
      method: "plugin/installPackage",
      requestHash: this.requestHash("plugin/installPackage", { packagePath: input.packagePath }),
    })
    await this.publishOperation(input.operationId, operation.status)
    if (operation.status !== "pending") {
      if (operation.status === "failed") throw safeError(operation.errorCode ?? "PLUGIN_INSTALL_FAILED", "安装操作已失败", 400)
      const result = operation.result ? JSON.parse(operation.result) as { pluginId: string; version: string; digest: string; status: "installed-disabled" } : null
      if (result) return result
      throw safeError("OPERATION_ID_CONFLICT", "operationId 已存在且结果不可用", 409)
    }
    try {
      const installed = await this.options.installer.installPackage(input.packagePath)
      const result = { pluginId: installed.pluginId, version: installed.version, digest: installed.digest, status: "installed-disabled" as const }
      this.repo.completeOperation(input.operationId, "completed", result, null)
      await this.publishOperation(input.operationId, "completed")
      await this.publishInventory()
      return result
    } catch (cause) {
      this.repo.completeOperation(input.operationId, "failed", undefined, cause instanceof PluginInstallError ? cause.code : "PLUGIN_INSTALL_FAILED")
      await this.publishOperation(input.operationId, "failed")
      throw this.mapInstallError(cause)
    }
  }

  async linkDirectory(input: { directoryPath: string; operationId: string }): Promise<{ pluginId: string; version: string; digest: string; status: "installed-disabled" }> {
    const operation = this.repo.createOperation({
      operationId: input.operationId,
      pluginId: "system",
      method: "plugin/linkDirectory",
      requestHash: this.requestHash("plugin/linkDirectory", { directoryPath: input.directoryPath }),
    })
    await this.publishOperation(input.operationId, operation.status)
    if (operation.status !== "pending") {
      const result = operation.result ? JSON.parse(operation.result) as { pluginId: string; version: string; digest: string; status: "installed-disabled" } : null
      if (result) return result
      throw safeError("OPERATION_ID_CONFLICT", "operationId 已存在且结果不可用", 409)
    }
    try {
      const linked = await this.options.installer.linkDirectory(input.directoryPath)
      const result = { pluginId: linked.pluginId, version: linked.version, digest: linked.digest, status: "installed-disabled" as const }
      this.repo.completeOperation(input.operationId, "completed", result, null)
      await this.publishOperation(input.operationId, "completed")
      await this.publishInventory()
      return result
    } catch (cause) {
      this.repo.completeOperation(input.operationId, "failed", undefined, cause instanceof PluginInstallError ? cause.code : "PLUGIN_LINK_INVALID")
      await this.publishOperation(input.operationId, "failed")
      throw this.mapInstallError(cause)
    }
  }

  async unlinkDirectory(input: { pluginId: string; operationId: string }): Promise<{ ok: true }> {
    const hash = this.requestHash("plugin/unlinkDirectory", { pluginId: input.pluginId })
    const existing = this.repo.getOperation(input.operationId)
    if (existing) {
      if (existing.method !== "plugin/unlinkDirectory" || existing.requestHash !== hash) {
        throw safeError("OPERATION_ID_CONFLICT", "operationId 已用于其他操作", 409)
      }
      if (existing.status === "completed") return { ok: true }
      if (existing.status === "failed") throw safeError(existing.errorCode ?? "PLUGIN_LINK_INVALID", "操作已失败", 400)
    }
    const operation = this.repo.createOperation({
      operationId: input.operationId,
      pluginId: input.pluginId,
      method: "plugin/unlinkDirectory",
      requestHash: hash,
    })
    const plugin = this.repo.getPackage(input.pluginId)
    if (!plugin) throw safeError("PLUGIN_NOT_FOUND", "插件未安装", 404)
    if (plugin.source !== "linked-directory") throw safeError("PLUGIN_LINK_INVALID", "插件不是开发目录链接", 400)
    this.repo.removePackage(input.pluginId)
    this.repo.completeOperation(input.operationId, "completed", { ok: true }, null)
    await this.publishOperation(input.operationId, "completed")
    await this.publishInventory()
    return { ok: true }
  }

  async uninstall(input: { pluginId: string; operationId: string }): Promise<{ ok: true }> {
    const hash = this.requestHash("plugin/uninstall", { pluginId: input.pluginId })
    const existing = this.repo.getOperation(input.operationId)
    if (existing) {
      if (existing.method !== "plugin/uninstall" || existing.requestHash !== hash) {
        throw safeError("OPERATION_ID_CONFLICT", "operationId 已用于其他操作", 409)
      }
      if (existing.status === "completed") return { ok: true }
      if (existing.status === "failed") throw safeError(existing.errorCode ?? "PLUGIN_INSTALL_FAILED", "操作已失败", 400)
    }
    const operation = this.repo.createOperation({
      operationId: input.operationId,
      pluginId: input.pluginId,
      method: "plugin/uninstall",
      requestHash: hash,
    })
    try {
      await this.options.installer.uninstall(input.pluginId)
    } catch (cause) {
      if (cause instanceof PluginInstallError && cause.code === "PLUGIN_NOT_FOUND") throw safeError("PLUGIN_NOT_FOUND", "插件未安装", 404)
      this.repo.completeOperation(input.operationId, "failed", undefined, cause instanceof PluginInstallError ? cause.code : "PLUGIN_INSTALL_FAILED")
      await this.publishOperation(input.operationId, "failed")
      throw this.mapInstallError(cause)
    }
    this.repo.completeOperation(input.operationId, "completed", { ok: true }, null)
    await this.publishOperation(input.operationId, "completed")
    await this.publishInventory()
    return { ok: true }
  }

  // ── enablement ────────────────────────────────────────────────────────

  async enable(input: { pluginId: string; scope: "global" | "workspace"; workspaceKey?: string; operationId: string }): Promise<{ ok: true }> {
    const plugin = this.requirePlugin(input.pluginId)
    // Developer Mode 门禁：process/system 包未开启 Developer Mode 时不能启用。
    if (runtimeKindOf(plugin) !== "declarative" && !this.developerModeEnabled) {
      throw safeError("PLUGIN_DEVELOPER_MODE_REQUIRED", "启用 process/System 插件需要先开启 Developer Mode", 403)
    }
    // 每个新 digest 需要独立信任确认。
    if (!this.repo.hasGrant(plugin.pluginId, plugin.digest, PLUGIN_DIGEST_TRUST_KEY)) {
      throw safeError("PLUGIN_DIGEST_UNTRUSTED", "当前 digest 尚未确认信任，请先确认权限与信任", 403)
    }
    if (input.scope === "workspace" && !input.workspaceKey) {
      throw safeError("INVALID_REQUEST", "workspace 启用必须提供 workspaceKey", 400)
    }
    this.repo.setActivation(plugin.pluginId, input.scope === "workspace" ? input.workspaceKey! : "", true)
    this.persistOperation(input.operationId, "plugin/enable", { pluginId: input.pluginId })
    await this.publishInventory()
    return { ok: true }
  }

  async disable(input: { pluginId: string; scope: "global" | "workspace"; workspaceKey?: string; force?: boolean; operationId: string }): Promise<{ ok: true }> {
    const plugin = this.requirePlugin(input.pluginId)
    // force 只影响 runner 停止方式（PR 4）；DB 层一律立即写 disabled。
    this.repo.setActivation(plugin.pluginId, input.scope === "workspace" ? input.workspaceKey ?? "" : "", false)
    this.persistOperation(input.operationId, "plugin/disable", { pluginId: input.pluginId })
    await this.publishInventory()
    return { ok: true }
  }

  // ── 配置 ──────────────────────────────────────────────────────────────

  configGet(input: { pluginId: string }): { pluginId: string; config: unknown } {
    this.requirePlugin(input.pluginId)
    const entry = this.repo.kvGet(input.pluginId, "global", "", PLUGIN_CONFIG_KV_KEY)
    let config: unknown = {}
    if (entry) {
      try { config = JSON.parse(entry.value) } catch { config = {} }
    }
    return { pluginId: input.pluginId, config }
  }

  async configUpdate(input: { pluginId: string; config: unknown; operationId: string }): Promise<{ pluginId: string; config: unknown }> {
    const plugin = this.requirePlugin(input.pluginId)
    // configSchema（manifest 声明）校验：无效配置直接拒绝。
    const manifest = JSON.parse(plugin.manifestJson) as { configSchema?: unknown }
    if (manifest.configSchema && typeof manifest.configSchema === "object" && manifest.configSchema !== null) {
      const validate = this.ajv.compile(manifest.configSchema as Record<string, unknown>)
      if (!validate(input.config ?? {})) {
        const message = validate.errors?.[0]
          ? `${validate.errors[0].instancePath || "/"} ${validate.errors[0].message ?? "配置无效"}`
          : "配置不符合插件声明的 configSchema"
        throw safeError("CONFIG_VALIDATION_ERROR", `插件配置无效：${message}`, 400)
      }
    }
    const value = JSON.stringify(input.config ?? {})
    this.repo.kvPut(input.pluginId, "global", "", PLUGIN_CONFIG_KV_KEY, value)
    this.persistOperation(input.operationId, "plugin/config/update", { pluginId: input.pluginId })
    await this.publishInventory()
    return { pluginId: input.pluginId, config: input.config }
  }

  // ── 授权与信任 ────────────────────────────────────────────────────────

  grantsGet(input: { pluginId: string }): { pluginId: string; digest: string; grants: Array<{ permissionId: string; granted: boolean }> } {
    const plugin = this.requirePlugin(input.pluginId)
    return {
      pluginId: plugin.pluginId,
      digest: plugin.digest,
      grants: this.repo.listGrants(plugin.pluginId).map((row) => ({ permissionId: row.permissionId, granted: row.granted })),
    }
  }

  async grantsUpdate(input: { pluginId: string; grants: ReadonlyArray<{ permissionId: string; granted: boolean }>; operationId: string }): Promise<{ pluginId: string; digest: string; grants: Array<{ permissionId: string; granted: boolean }> }> {
    const plugin = this.requirePlugin(input.pluginId)
    for (const grant of input.grants) {
      this.repo.setGrant(plugin.pluginId, plugin.digest, grant.permissionId, grant.granted)
    }
    this.persistOperation(input.operationId, "plugin/grants/update", { pluginId: input.pluginId })
    await this.publishInventory()
    return {
      pluginId: plugin.pluginId,
      digest: plugin.digest,
      grants: this.repo.listGrants(plugin.pluginId).map((row) => ({ permissionId: row.permissionId, granted: row.granted })),
    }
  }

  // ── 贡献目录与命令执行（转发 PluginContributionAdapter；PR 6） ─────────

  contributionList(): unknown {
    return this.options.contributionList?.() ?? {
      tools: [], skills: [], mcpServers: [], promptCommands: [], settings: [], workbenchViews: [],
    }
  }

  async executeCommand(input: { pluginId: string; commandId: string; args?: string }): Promise<{ promptTemplate?: string; actionResult?: unknown }> {
    if (!this.options.commandExecute) {
      throw safeError("PLUGIN_NOT_FOUND", "插件命令执行器不可用", 503)
    }
    return this.options.commandExecute(input)
  }

  async renderView(input: { pluginId: string; viewId: string; instanceId: string }): Promise<{ nodes: unknown[] }> {
    if (!this.options.viewCall) {
      throw safeError("PLUGIN_NOT_FOUND", "插件视图渲染器不可用", 503)
    }
    return this.options.viewCall.renderView(input)
  }

  async viewAction(input: { pluginId: string; viewId: string; instanceId: string; actionId: string; params?: unknown }): Promise<{ ok: true }> {
    if (!this.options.viewCall) {
      throw safeError("PLUGIN_NOT_FOUND", "插件视图动作不可用", 503)
    }
    return this.options.viewCall.viewAction(input)
  }

  // ── System Profile（最小实现；完整 stage/boot/fallback 在 PR 7） ───────

  profileList(): Array<{ id: string; pluginId: string; version: string; digest: string; status: string; createdAt: number }> {
    return this.repo.listPackages()
      .filter((plugin) => plugin.tier === "system")
      .flatMap((plugin) => this.repo.listGenerations(plugin.pluginId, "system"))
      .map((row) => ({
        id: row.id,
        pluginId: row.pluginId,
        version: row.version,
        digest: row.digest,
        status: row.status,
        createdAt: row.createdAt,
      }))
  }

  profileStage(input: { pluginId: string; config: unknown; operationId: string }): { generationId: string; status: "staged" } {
    const plugin = this.requirePlugin(input.pluginId)
    if (plugin.tier !== "system") throw safeError("PLUGIN_PROFILE_INVALID", "只有 System 插件可以 stage 为 Profile", 400)
    if (!this.developerModeEnabled) throw safeError("PLUGIN_DEVELOPER_MODE_REQUIRED", "System Profile 需要先开启 Developer Mode", 403)
    // config 按 manifest configSchema 校验（stage 不改变当前 runtime）。
    const manifest = JSON.parse(plugin.manifestJson) as { configSchema?: unknown }
    if (manifest.configSchema && typeof manifest.configSchema === "object" && manifest.configSchema !== null) {
      const validate = this.ajv.compile(manifest.configSchema as Record<string, unknown>)
      if (!validate(input.config ?? {})) {
        const message = validate.errors?.[0]
          ? `${validate.errors[0].instancePath || "/"} ${validate.errors[0].message ?? "配置无效"}`
          : "配置不符合 configSchema"
        throw safeError("CONFIG_VALIDATION_ERROR", `System Profile 配置无效：${message}`, 400)
      }
    }
    const generationId = `gen-${randomUUID()}`
    this.repo.insertGeneration({
      id: generationId,
      pluginId: plugin.pluginId,
      kind: "system",
      version: plugin.version,
      digest: plugin.digest,
      status: "staged",
      configJson: JSON.stringify(input.config ?? {}),
    })
    this.persistOperation(input.operationId, "plugin/profile/stage", { pluginId: input.pluginId })
    return { generationId, status: "staged" }
  }

  profileApplyOnRestart(input: { generationId: string; operationId: string }): { generationId: string; restartRequired: true } {
    const generation = this.repo.listPackages()
      .filter((p) => p.tier === "system")
      .flatMap((p) => this.repo.listGenerations(p.pluginId, "system"))
      .find((row) => row.id === input.generationId)
    if (!generation) throw safeError("PLUGIN_PROFILE_INVALID", "generation 不存在", 404)
    if (generation.status !== "staged") throw safeError("PLUGIN_PROFILE_INVALID", "只有 staged generation 可以应用到重启", 409)
    this.repo.setAppSetting("plugins.pendingSystemProfile", JSON.stringify({ generationId: generation.id }))
    this.persistOperation(input.operationId, "plugin/profile/applyOnRestart", { generationId: input.generationId })
    return { generationId: generation.id, restartRequired: true }
  }

  // ── operations ────────────────────────────────────────────────────────

  operationGet(input: { operationId: string }): { operationId: string; pluginId: string; method: string; status: string; result: unknown; errorCode: string | null; createdAt: number; updatedAt: number } {
    const operation = this.repo.getOperation(input.operationId)
    if (!operation) throw safeError("PLUGIN_OPERATION_NOT_FOUND", "操作不存在", 404)
    return {
      operationId: operation.operationId,
      pluginId: operation.pluginId,
      method: operation.method,
      status: operation.status,
      result: operation.result ? JSON.parse(operation.result) : undefined,
      errorCode: operation.errorCode,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    }
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private requirePlugin(pluginId: string): StoredPluginPackage {
    const plugin = this.repo.getPackage(pluginId)
    if (!plugin) throw safeError("PLUGIN_NOT_FOUND", "插件未安装", 404)
    return plugin
  }

  private persistOperation(operationId: string, method: string, params: Record<string, unknown>, result: unknown = { ok: true }) {
    const hash = this.requestHash(method, params)
    const existing = this.repo.getOperation(operationId)
    if (existing) {
      if (existing.method !== method || existing.requestHash !== hash) {
        throw safeError("OPERATION_ID_CONFLICT", "operationId 已用于其他操作", 409)
      }
      return
    }
    const operation = this.repo.createOperation({
      operationId,
      pluginId: (params.pluginId as string) ?? "system",
      method,
      requestHash: hash,
    })
    if (operation.status === "pending") {
      this.repo.completeOperation(operationId, "completed", result, null)
    }
    void this.publishOperation(operationId, "completed")
  }

  private mapInstallError(cause: unknown): AgentError {
    if (cause instanceof PluginInstallError) {
      return safeError(cause.code, cause.message)
    }
    return safeError("PLUGIN_INSTALL_FAILED", "插件安装失败")
  }
}

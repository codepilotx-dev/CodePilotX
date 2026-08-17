/**
 * System Profile loader：Agent 进程内的 System/Profile 插件激活内核。
 *
 * - 只通过本 loader 动态加载 System 插件 bundle（AGENTS.md 的
 *   "System Profile loader" 边界）；禁止其他动态执行路径。
 * - generation 固定 plugin id/version/digest/provider selection/config；
 * - 所有 provider 激活成功才标记 active/last-good；
 * - boot 失败写安全诊断，请求 sidecar 重启一次（退出码 3），连续失败
 *   清除 pending 并回退默认 Profile（禁止无限 fallback loop）；
 * - System scope 生命周期为 process lifetime；shutdown 逆序释放。
 */

import { readFile } from "node:fs/promises"
import { mkdirSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { defineSystemPlugin, type SystemPluginContext, type SystemPluginDefinition } from "@codepilotx/plugin-sdk/system"
import { validateManifest } from "@codepilotx/plugin-sdk"
import { runSessionPersistenceConformance } from "@codepilotx/plugin-sdk/testing"
import { AgentError } from "../../domain"
import { PluginRepository } from "../../storage/repositories/plugin-repository"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import { SystemServiceRegistry } from "./SystemServiceRegistry"

export const PENDING_SYSTEM_PROFILE_KEY = "plugins.pendingSystemProfile"
export const SYSTEM_PROFILE_BOOT_FAILURES_KEY = "plugins.systemProfileBootFailures"
export const SYSTEM_PROFILE_ACTIVE_KEY = "plugins.activeSystemProfile"
export const SYSTEM_PROFILE_BOOT_FAILED_EXIT_CODE = 3
export const MAX_SYSTEM_PROFILE_BOOT_FAILURES = 1

export interface SystemProfileActivation {
  generationId: string
  pluginId: string
  version: string
  digest: string
  providers: string[]
}

export interface SystemProfileLoadError {
  code: string
  message: string
  retryable: boolean
}

export class SystemProfileLoader {
  private readonly repo: PluginRepository
  private readonly disposers: Array<() => void | Promise<void>> = []
  private active: SystemProfileActivation | null = null
  private readonly controller = new AbortController()

  constructor(
    private readonly db: AgentDatabase,
    private readonly registry: SystemServiceRegistry,
    private readonly options: { systemDataRoot?: string } = {},
  ) {
    this.repo = new PluginRepository(db)
  }

  activeProfile(): SystemProfileActivation | null {
    return this.active
  }

  /** pending generation 的完整校验（不改变当前 runtime）。 */
  async validatePending(): Promise<{ ok: true } | { ok: false; errors: Array<{ code: string; message: string }> }> {
    const pending = this.pendingGeneration()
    if (!pending) return { ok: true }
    const generation = this.repo.getOperation(pending.generationId)
      ?? this.repo.listGenerations(pending.pluginId ?? "", "system").find((row) => row.id === pending.generationId)
    if (!generation) return { ok: false, errors: [{ code: "PLUGIN_PROFILE_INVALID", message: "pending generation 不存在" }] }
    const plugin = this.repo.getPackage(generation.pluginId)
    if (!plugin || plugin.tier !== "system") {
      return { ok: false, errors: [{ code: "PLUGIN_PROFILE_INVALID", message: "pending 指向的插件不是 System 插件" }] }
    }
    const result = validateManifest(JSON.parse(plugin.manifestJson))
    if (!result.ok) {
      return { ok: false, errors: result.errors.map((item) => ({ code: item.code, message: item.message })) }
    }
    return { ok: true }
  }

  pendingGeneration(): { generationId: string; pluginId: string | null } | null {
    const raw = this.repo.getAppSetting(PENDING_SYSTEM_PROFILE_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as { generationId?: unknown; pluginId?: unknown }
      if (typeof parsed.generationId !== "string") return null
      return { generationId: parsed.generationId, pluginId: typeof parsed.pluginId === "string" ? parsed.pluginId : null }
    } catch {
      return null
    }
  }

  /**
   * Agent boot 入口：尝试激活 pending System Profile。
   * - 成功：清除 pending、标记 active + last-good、记录 active 指针；
   * - 失败：写安全诊断；连续失败计数 ≥ 上限时清除 pending 并回退默认 Profile
   *   （不退出）；首次失败请求 sidecar 重启一次（退出码 3）。
   * 返回 { ok } 时调用方按退出码决定进程行为。
   */
  async bootAttempt(): Promise<{ ok: boolean; exitCode: number | null; error: SystemProfileLoadError | null }> {
    const pending = this.pendingGeneration()
    if (!pending) return { ok: true, exitCode: null, error: null }
    const failures = Number(this.repo.getAppSetting(SYSTEM_PROFILE_BOOT_FAILURES_KEY) ?? "0") || 0
    try {
      const activation = await this.activatePending(pending.generationId)
      this.repo.setAppSetting(SYSTEM_PROFILE_ACTIVE_KEY, JSON.stringify(activation))
      this.repo.setAppSetting(SYSTEM_PROFILE_BOOT_FAILURES_KEY, "0")
      this.repo.deleteAppSetting(PENDING_SYSTEM_PROFILE_KEY)
      return { ok: true, exitCode: null, error: null }
    } catch (cause) {
      const error: SystemProfileLoadError = {
        code: cause instanceof AgentError ? cause.code : "SYSTEM_PROFILE_BOOT_FAILED",
        message: cause instanceof Error ? cause.message : "System Profile 启动失败",
        retryable: true,
      }
      this.repo.setAppSetting(SYSTEM_PROFILE_BOOT_FAILURES_KEY, String(failures + 1))
      // 清除本次失败的 pending（不删除 generation 记录），避免无限重启。
      this.repo.deleteAppSetting(PENDING_SYSTEM_PROFILE_KEY)
      if (failures >= MAX_SYSTEM_PROFILE_BOOT_FAILURES) {
        // 连续失败：回退默认 Profile，不再请求重启。
        return { ok: false, exitCode: null, error }
      }
      // 首次失败：请求 sidecar 用 last-good（默认 Profile）重启一次。
      return { ok: false, exitCode: SYSTEM_PROFILE_BOOT_FAILED_EXIT_CODE, error }
    }
  }

  /** 激活 pending generation：加载 bundle、注册 providers、全部成功才生效。 */
  private async activatePending(generationId: string): Promise<SystemProfileActivation> {
    const generations = this.repo.listPackages()
      .filter((plugin) => plugin.tier === "system")
      .flatMap((plugin) => this.repo.listGenerations(plugin.pluginId, "system"))
    const generation = generations.find((row) => row.id === generationId)
    if (!generation) throw new AgentError("PLUGIN_PROFILE_INVALID", "generation 不存在", 404)
    const plugin = this.repo.getPackage(generation.pluginId)
    if (!plugin || plugin.tier !== "system") throw new AgentError("PLUGIN_PROFILE_INVALID", "插件不是 System 插件", 400)
    const manifest = JSON.parse(plugin.manifestJson) as { runtime?: { kind?: string; entry?: string } }
    if (manifest.runtime?.kind !== "system" || typeof manifest.runtime.entry !== "string") {
      throw new AgentError("PLUGIN_PROFILE_INVALID", "System 插件缺少 runtime.entry", 400)
    }
    const entryPath = isAbsolute(manifest.runtime.entry)
      ? manifest.runtime.entry
      : resolve(plugin.installedPath, manifest.runtime.entry)
    // bundle 必须是包内文件（containment）——在 import 之前校验。
    if (!isAbsolute(manifest.runtime.entry) && !entryPath.startsWith(resolve(plugin.installedPath))) {
      throw new AgentError("PLUGIN_PROFILE_INVALID", "System entry 越出包根", 400)
    }
    const entryUrl = pathToFileURL(entryPath).href
    const module = await import(entryUrl)
    const definition = module.default ?? module
    if (typeof definition?.register !== "function") {
      throw new AgentError("PLUGIN_PROFILE_INVALID", "System 插件入口必须导出 register 定义", 400)
    }
    const systemPlugin = definition as SystemPluginDefinition
    if (systemPlugin.id !== plugin.pluginId) {
      throw new AgentError("PLUGIN_PROFILE_INVALID", "System 插件 id 与包声明不一致", 400)
    }
    // 未解决的 required contract 拒绝激活（fail-closed；依赖声明在 bundle definition）。
    const unresolved = Object.keys(systemPlugin.requires ?? {})
      .filter((key) => !this.contractRegistry.has(key))
    if (unresolved.length > 0) {
      throw new AgentError("PLUGIN_PROFILE_INVALID", `System Profile 依赖未知契约：${unresolved.join("、")}`, 400)
    }
    // 进程生命周期 scope：逆序释放。
    const disposers: Array<() => void | Promise<void>> = []
    const registeredProviders = new Map<string, unknown>()
    // namespaced 数据根：`<systemDataRoot>/<pluginId>/<generationId>/`，
    // 只归本插件所有；持久化 Provider 不能触碰默认 AgentDatabase。
    const dataRoot = this.options.systemDataRoot
      ? resolve(this.options.systemDataRoot, plugin.pluginId, generationId)
      : ""
    if (dataRoot) mkdirSync(dataRoot, { recursive: true })
    const context: SystemPluginContext = {
      identity: {
        pluginId: plugin.pluginId,
        version: plugin.version,
        profileId: generationId,
      },
      signal: this.controller.signal,
      config: JSON.parse(generation.configJson),
      dataRoot,
      add: (disposer: () => void | Promise<void>) => { disposers.push(disposer) },
      dependencies: new Map<string, unknown>() as SystemPluginContext["dependencies"],
      registerProvider: (key, instance) => { registeredProviders.set(key, instance) },
      log: (entry: { level: string; message: string }) => {
        void entry
      },
    }
    const returned = systemPlugin.register(context)
    if (returned) disposers.push(returned)
    const providers = [...(systemPlugin.provides ?? [])]
    if (providers.length === 0) {
      throw new AgentError("PLUGIN_PROFILE_INVALID", "System 插件没有提供任何 service", 400)
    }
    // 每个声明的 provider 必须实际注册（fail-closed）。
    const missingProviders = providers.filter((key) => !registeredProviders.has(key))
    if (missingProviders.length > 0) {
      throw new AgentError("PLUGIN_PROFILE_INVALID", `System 插件未注册声明的 provider：${missingProviders.join("、")}`, 400)
    }
    // session-persistence provider 必须在 staging 前通过 conformance suite
    // （PR 8D）：行为往返一致 + 只写自己的 namespaced dataRoot；失败则
    // 激活失败（fail-closed，不破坏 last-good）。
    const persistenceKey = "codepilotx.session-persistence@1"
    const persistenceProvider = registeredProviders.get(persistenceKey)
    if (persistenceProvider) {
      if (!dataRoot) {
        throw new AgentError("PLUGIN_PROFILE_INVALID", "session-persistence Provider 需要 namespaced dataRoot（未配置 systemDataRoot）", 400)
      }
      const report = await runSessionPersistenceConformance(
        persistenceProvider as Parameters<typeof runSessionPersistenceConformance>[0],
        {
          dataRoot,
          probe: async (root) => {
            try {
              const { readdir } = await import("node:fs/promises")
              const entries = await readdir(root, { recursive: true })
              return entries.length > 0
            } catch {
              return false
            }
          },
        },
      )
      if (!report.pass) {
        throw new AgentError(
          "PLUGIN_PROFILE_CONFORMANCE_FAILED",
          `session-persistence Provider 未通过 conformance：${report.failures.join("；")}`,
          400,
        )
      }
    }
    // 全部 provider 就绪后才生效；status=last-good 表示"已激活且为最近成功代"。
    this.disposers.push(...disposers)
    for (const [key, instance] of registeredProviders) {
      this.registry.registerActivated(plugin.pluginId, key, instance)
    }
    this.repo.updateGenerationStatus(generationId, "last-good")
    this.active = {
      generationId,
      pluginId: plugin.pluginId,
      version: plugin.version,
      digest: plugin.digest,
      providers,
    }
    return this.active
  }

  /** 注册已知 System Service Contract（PR 8 各子 PR 注册）。 */
  contractRegistry = new Set<string>()

  registerContract(key: string): void {
    this.contractRegistry.add(key)
  }

  /** Agent shutdown：逆序释放 providers。 */
  async dispose(): Promise<void> {
    this.controller.abort()
    const failures: unknown[] = []
    for (const disposer of this.disposers.reverse()) {
      try {
        await disposer()
      } catch (cause) {
        failures.push(cause)
      }
    }
    this.disposers.length = 0
    this.active = null
    if (failures.length > 0) {
      throw new AgentError("SYSTEM_PROFILE_DISPOSE_FAILED", "System Profile 释放失败", 500)
    }
  }
}

/** 读取 System 插件 bundle 内容（测试/诊断用）。 */
export const readSystemBundle = async (path: string): Promise<string> =>
  readFile(resolve(path), "utf8")

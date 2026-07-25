import { resolve } from "node:path"
import type {
  SandboxRuntimeConfig,
  SrtWinSpawn,
  WindowsSandboxUserStatus,
  WindowsWfpStatusResult,
} from "@anthropic-ai/sandbox-runtime"
import { AgentError } from "../domain"
import { validateSrtHelper } from "./SandboxHelper"
import { runHostCommand, type ProcessResult } from "./SandboxProcess"
import {
  SRT_INSTALL_GENERATION,
  SRT_MAX_CONCURRENT_COMMANDS,
  SRT_PROXY_PORT_RANGE,
  SRT_RUNTIME_VERSION,
  SRT_WINDOWS_MATURITY,
} from "./SandboxRuntimeManifest"
import { SandboxWorkerPool } from "./SandboxWorkerPool"

export { runHostCommand }
export type { ProcessResult }

export type SandboxState = "unsupported" | "not-installed" | "installing" | "available" | "damaged" | "repair-required"

export interface SandboxStatus {
  state: SandboxState
  platform: NodeJS.Platform
  architecture: string
  runtimeVersion: string
  helperPath: string | null
  helperSha256: string | null
  user: WindowsSandboxUserStatus | null
  wfp: WindowsWfpStatusResult | null
  error: string | null
}

export interface PublicSandboxStatus {
  state: SandboxState
  platform: string
  architecture: string
  runtimeVersion: string
  maturity: typeof SRT_WINDOWS_MATURITY
  maxConcurrentCommands: number
  error: string | null
  operations: {
    canInstall: boolean
    canRepair: boolean
    canUninstall: boolean
  }
}

export interface SandboxedProcessRequest {
  command: string
  cwd: string
  /** Trusted runtime environment additions resolved by the Agent. */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  config: SandboxRuntimeConfig
  signal?: AbortSignal
}

export interface SandboxRuntimeAdapter {
  getStatus(): Promise<SandboxStatus>
  refreshStatus(): Promise<SandboxStatus>
  install(): Promise<void>
  uninstall(): Promise<void>
  run(request: SandboxedProcessRequest): Promise<ProcessResult>
  dispose(): Promise<void>
}

type SandboxRuntimeModule = typeof import("@anthropic-ai/sandbox-runtime")

export type SandboxInstallationRecord = {
  generation: number
  runtimeVersion: string
  proxyPortRange: [number, number]
  maxConcurrentCommands: number
  installed: boolean
}

export interface SandboxInstallationStore {
  get(): SandboxInstallationRecord | null
  set(value: SandboxInstallationRecord): void
}

export interface AnthropicSandboxRuntimeAdapterOptions {
  helperPath?: string | null
  installationStore?: SandboxInstallationStore
  workerPool?: SandboxWorkerPool
}

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

const isSandboxTimeout = (message: string) =>
  /\bETIMEDOUT\b|timed?\s*out/i.test(message)

const isSandboxPathAccessDenied = (message: string) =>
  /acl\s+(?:grant|stamp)|ERROR_ACCESS_DENIED|WIN32_ERROR\s*=\s*0x0*5\b|0x0*5\b.*access/i.test(message)

export function mapSandboxInitializationError(cause: unknown): AgentError {
  if (cause instanceof AgentError) return cause
  const message = errorText(cause)
  if (isSandboxPathAccessDenied(message)) {
    return new AgentError(
      "SANDBOX_PATH_ACCESS_DENIED",
      "SRT 无法为工作区配置访问权限。请检查项目目录权限或安全软件拦截后重试。",
      503,
    )
  }
  if (isSandboxTimeout(message)) {
    return new AgentError(
      "SANDBOX_RUNTIME_TIMEOUT",
      "SRT 沙箱初始化超时。请先重启 CodePilotX；如果持续出现，请在设置中修复沙箱运行环境。",
      504,
    )
  }
  return new AgentError(
    "SANDBOX_UNAVAILABLE",
    "SRT 沙箱初始化失败。请重试或在设置中检查沙箱运行环境。",
    503,
  )
}

export function sandboxStatusFailure(cause: unknown, phase: "helper" | "runtime-status") {
  if (cause instanceof AgentError) return cause.message
  const message = errorText(cause)
  if (isSandboxTimeout(message)) {
    return "SRT 状态检测超时。请先重启 CodePilotX；如果持续出现，请在设置中修复沙箱运行环境。"
  }
  if (isSandboxPathAccessDenied(message)) {
    return "SRT 无法检查沙箱权限。请检查安全软件拦截；如果持续出现，请修复沙箱运行环境。"
  }
  return phase === "helper"
    ? "SRT helper 无法加载或校验失败，请修复沙箱运行环境。"
    : "SRT 状态无法验证，请重启 CodePilotX 后重试。"
}

export function classifyWindowsSandboxStatus(
  user: WindowsSandboxUserStatus,
  wfp: WindowsWfpStatusResult,
): Pick<SandboxStatus, "state" | "error"> {
  if (!user.provisioned) {
    return {
      state: "not-installed",
      error: "SRT 沙箱尚未安装，首次使用需要完成安装。",
    }
  }

  const missing: string[] = []
  if (!user.credPresent) missing.push("沙箱账号凭据")
  if (!user.groupExists) missing.push("sandbox-runtime-users 本地组")
  if (!user.inBuiltinUsers) missing.push("Users 组成员关系")
  if (!user.inSandboxGroup) missing.push("sandbox-runtime-users 组成员关系")
  if (!user.hiddenFromLogon) missing.push("登录界面隐藏配置")
  if (wfp.state === "absent") missing.push("WFP 网络过滤器")
  if (missing.length > 0) {
    return {
      state: "repair-required",
      error: `SRT 沙箱需要修复：缺少或异常的${missing.join("、")}。`,
    }
  }

  // BFE filter enumeration requires elevation. sandbox-runtime performs the
  // non-elevated behavioral WFP verification during initialize() and fails
  // closed there, so "cannot-read" is informational rather than an error.
  return { state: "available", error: null }
}

export function toPublicSandboxStatus(status: SandboxStatus): PublicSandboxStatus {
  const canInstall = status.state === "not-installed"
  const canRepair = status.state === "repair-required" || status.state === "damaged"
  const canUninstall = status.state === "available" || canRepair
  return {
    state: status.state,
    platform: status.platform,
    architecture: status.architecture,
    runtimeVersion: status.runtimeVersion,
    maturity: SRT_WINDOWS_MATURITY,
    maxConcurrentCommands: SRT_MAX_CONCURRENT_COMMANDS,
    error: status.error,
    operations: { canInstall, canRepair, canUninstall },
  }
}

export function sandboxNotReadyError(status: SandboxStatus): AgentError {
  if (status.state === "not-installed") {
    return new AgentError(
      "SANDBOX_SETUP_REQUIRED",
      status.error ?? "SRT 沙箱尚未安装，首次使用需要完成安装。",
      503,
      toPublicSandboxStatus(status),
    )
  }
  if (status.state === "repair-required" || status.state === "damaged") {
    return new AgentError(
      "SANDBOX_REPAIR_REQUIRED",
      status.error ?? "SRT 沙箱需要修复后才能执行命令。",
      503,
      toPublicSandboxStatus(status),
    )
  }
  return new AgentError(
    "SANDBOX_UNAVAILABLE",
    status.error ?? "SRT 沙箱当前不可用。",
    503,
    toPublicSandboxStatus(status),
  )
}

export class AnthropicSandboxRuntimeAdapter implements SandboxRuntimeAdapter {
  private runtime: SandboxRuntimeModule | null = null
  private statusCache: SandboxStatus | null = null
  private refreshTask: Promise<SandboxStatus> | null = null
  private readonly helperPath: string | null
  private readonly installationStore: SandboxInstallationStore | undefined
  private readonly workerPool: SandboxWorkerPool

  constructor(options: string | null | AnthropicSandboxRuntimeAdapterOptions = process.env.CODEPILOTX_SRT_WIN_PATH?.trim() || null) {
    if (typeof options === "string" || options === null) {
      this.helperPath = options
      this.workerPool = new SandboxWorkerPool()
      return
    }
    this.helperPath = options.helperPath ?? process.env.CODEPILOTX_SRT_WIN_PATH?.trim() ?? null
    this.installationStore = options.installationStore
    this.workerPool = options.workerPool ?? new SandboxWorkerPool()
  }

  private async api() {
    return this.runtime ??= await import("@anthropic-ai/sandbox-runtime")
  }

  private async resolvedHelper(): Promise<{ path: string; spawn: SrtWinSpawn }> {
    const api = await this.api()
    const spawnTarget = api.resolveSrtWin(this.helperPath ? { path: this.helperPath } : undefined)
    return { path: spawnTarget.exe, spawn: spawnTarget }
  }

  private validateHelper(path: string) {
    return validateSrtHelper(path)
  }

  async getStatus(): Promise<SandboxStatus> {
    return this.statusCache ?? this.refreshStatus()
  }

  async refreshStatus(): Promise<SandboxStatus> {
    if (this.refreshTask) return this.refreshTask
    const task = this.probeStatus()
      .then((status) => {
        this.statusCache = status
        return status
      })
      .finally(() => {
        if (this.refreshTask === task) this.refreshTask = null
      })
    this.refreshTask = task
    return task
  }

  private async probeStatus(): Promise<SandboxStatus> {
    const base: SandboxStatus = {
      state: "unsupported",
      platform: process.platform,
      architecture: process.arch,
      runtimeVersion: SRT_RUNTIME_VERSION,
      helperPath: null,
      helperSha256: null,
      user: null,
      wfp: null,
      error: null,
    }
    if (process.platform !== "win32" || !("x64" === process.arch || "arm64" === process.arch)) return base
    let phase: "helper" | "runtime-status" = "helper"
    try {
      const api = await this.api()
      const helper = await this.resolvedHelper()
      base.helperPath = helper.path
      base.helperSha256 = this.validateHelper(helper.path)
      phase = "runtime-status"
      base.user = api.getWindowsSandboxUserStatus({ srtWin: helper.spawn })
      base.wfp = api.getWindowsWfpStatus({ srtWin: helper.spawn })
      const classified = classifyWindowsSandboxStatus(base.user, base.wfp)
      base.state = classified.state
      base.error = classified.error
      if (base.state === "available") {
        const installedRange = base.wfp.state === "installed" ? base.wfp.portRange : undefined
        if (installedRange && (
          installedRange[0] !== SRT_PROXY_PORT_RANGE[0]
          || installedRange[1] !== SRT_PROXY_PORT_RANGE[1]
        )) {
          base.state = "repair-required"
          base.error = `SRT WFP 端口范围需要更新为 ${SRT_PROXY_PORT_RANGE[0]}–${SRT_PROXY_PORT_RANGE[1]}。`
        } else if (this.installationStore && !this.installationMatches(this.installationStore.get())) {
          base.state = "repair-required"
          base.error = "SRT 安装代际或并发端口配置已过期，需要修复。"
        }
      }
    } catch (cause) {
      base.helperPath ??= this.helperPath
      base.state = phase === "helper" ? "damaged" : "repair-required"
      base.error = sandboxStatusFailure(cause, phase)
    }
    return base
  }

  async install() {
    if (process.platform !== "win32") throw new AgentError("SANDBOX_UNSUPPORTED", "当前平台不支持 Windows SRT 安装", 409)
    this.requireIdleForMaintenance()
    const api = await this.api()
    const helper = await this.resolvedHelper()
    this.validateHelper(helper.path)
    const result = api.installWindowsSandbox({
      srtWin: helper.spawn,
      proxyPortRange: SRT_PROXY_PORT_RANGE,
    })
    if (result.cancelled) throw new AgentError("SANDBOX_INSTALL_CANCELLED", "用户取消了 SRT 安装", 409)
    this.installationStore?.set(this.expectedInstallation(true))
    this.statusCache = null
    await this.workerPool.recycleIdleWorkers()
  }

  async uninstall() {
    if (process.platform !== "win32") throw new AgentError("SANDBOX_UNSUPPORTED", "当前平台不支持 Windows SRT 卸载", 409)
    this.requireIdleForMaintenance()
    const api = await this.api()
    const helper = await this.resolvedHelper()
    this.validateHelper(helper.path)
    const result = api.uninstallWindowsSandbox({ srtWin: helper.spawn })
    if (result.cancelled) throw new AgentError("SANDBOX_UNINSTALL_CANCELLED", "用户取消了 SRT 卸载", 409)
    this.installationStore?.set(this.expectedInstallation(false))
    this.statusCache = null
    await this.workerPool.recycleIdleWorkers()
  }

  async run(request: SandboxedProcessRequest) {
    if (process.platform !== "win32" || !("x64" === process.arch || "arm64" === process.arch)) {
      throw sandboxNotReadyError(await this.getStatus())
    }
    const status = await this.getStatus()
    if (status.state !== "available") throw sandboxNotReadyError(status)
    try {
      const helper = await this.resolvedHelper()
      this.validateHelper(helper.path)
      const windows = {
        ...request.config.windows,
        sandboxUser: "srt-sandbox",
        proxyPortRange: [...SRT_PROXY_PORT_RANGE] as [number, number],
        srtWin: { path: helper.path },
      }
      return await this.workerPool.run({
        command: request.command,
        cwd: request.cwd,
        ...(request.env ? { env: request.env } : {}),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        config: { ...request.config, windows },
      }, request.signal)
    } catch (cause) {
      if (cause instanceof AgentError) {
        if (cause.code.startsWith("SANDBOX_")) this.statusCache = null
        throw cause
      }
      this.statusCache = null
      throw mapSandboxInitializationError(cause)
    }
  }

  async dispose() {
    await this.workerPool.dispose()
  }

  private requireIdleForMaintenance() {
    if (this.workerPool.hasWork()) {
      throw new AgentError("SANDBOX_BUSY", "沙箱仍有活动或排队命令，请停止相关任务后重试", 409)
    }
  }

  private expectedInstallation(installed: boolean): SandboxInstallationRecord {
    return {
      generation: SRT_INSTALL_GENERATION,
      runtimeVersion: SRT_RUNTIME_VERSION,
      proxyPortRange: [...SRT_PROXY_PORT_RANGE],
      maxConcurrentCommands: SRT_MAX_CONCURRENT_COMMANDS,
      installed,
    }
  }

  private installationMatches(record: SandboxInstallationRecord | null) {
    return Boolean(
      record?.installed
      && record.generation === SRT_INSTALL_GENERATION
      && record.runtimeVersion === SRT_RUNTIME_VERSION
      && record.maxConcurrentCommands === SRT_MAX_CONCURRENT_COMMANDS
      && record.proxyPortRange[0] === SRT_PROXY_PORT_RANGE[0]
      && record.proxyPortRange[1] === SRT_PROXY_PORT_RANGE[1],
    )
  }
}

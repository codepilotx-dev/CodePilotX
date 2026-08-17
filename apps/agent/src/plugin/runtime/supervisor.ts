/**
 * Application 插件进程 supervisor。
 *
 * - spawn 使用最小环境 allowlist（不含 Agent token/Provider key/SQLite 路径）；
 * - 随机 instance token 只用于 initialize 握手；
 * - stdio 行协议 + plugin-sdk codec（单条 ≤1 MiB）；
 * - initialize 超时 10s；优雅 shutdown 超时 5s，超时后 taskkill 完整进程树；
 * - runner 崩溃/pipe 中断 → onExit 回调（crash 检测）。
 */

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline"
import { isAbsolute, join, relative, resolve } from "node:path"
import { decodeMessage, encodeMessage, type PluginHostNotificationMethod, type PluginHostRequestMethod, type PluginMessage } from "@codepilotx/plugin-sdk/wire"
import { PluginSdkError } from "@codepilotx/plugin-sdk"
import { AgentError } from "../../domain"
import { killProcessTree } from "../../tool/Shell/HostProcess"

export const RUNNER_INITIALIZE_TIMEOUT_MS = 10_000
export const RUNNER_SHUTDOWN_TIMEOUT_MS = 5_000
export const RUNNER_REQUEST_TIMEOUT_MS = 30_000

/** 最小环境 allowlist：runner 只获得运行 Bun 脚本所需的最小 Windows 环境。 */
export const RUNNER_ALLOWED_ENV_KEYS = new Set([
  "PATH",
  "SystemRoot",
  "WINDIR",
  "windir",
  "SystemDrive",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PATHEXT",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "PUBLIC",
  "LANG",
  "LC_ALL",
])

export interface RunnerEnvironmentOptions {
  /** 额外注入（仅允许插件数据目录等明确键；敏感键一律拒绝）。 */
  extra?: Record<string, string>
}

export const buildRunnerEnvironment = (options: RunnerEnvironmentOptions = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}
  for (const key of RUNNER_ALLOWED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (RUNNER_ALLOWED_ENV_KEYS.has(key) || key.startsWith("CPX_")) {
      env[key] = value
    }
  }
  return env
}

export interface SpawnedRunnerOptions {
  pluginId: string
  generationId: string
  /** 包根（installedPath 或 linkedPath）。 */
  packageRoot: string
  /** manifest runtime.executable（相对包根）。 */
  executable: string
  args?: string[]
  /** 每个进程实例的握手 token（由 supervisor 生成）。 */
  instanceToken: string
  /** 额外注入环境（仅允许 allowlist 键或 CPX_ 前缀；测试用 CPX_MODE 等）。 */
  environment?: Record<string, string>
  /** 处理来自 runner 的 clientRequest（host/serviceCall 等）。 */
  onClientRequest?: (method: string, params: unknown, respond: (result: unknown, error?: { code: string; message: string; retryable: boolean }) => void) => void
  /** 处理来自 runner 的 clientNotification（host/log 等）。 */
  onClientNotification?: (method: string, params: unknown) => void
  onExit?: (code: number | null, reason: "exit" | "signal" | "pipe") => void
}

export class ProcessSupervisor {
  private child: ReturnType<typeof spawn> | null = null
  private readonly pending = new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private requestSeq = 0
  private closing = false
  private exited = false

  constructor(private readonly options: SpawnedRunnerOptions) {}

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  /** 启动进程并完成 initialize 握手；返回 initialize 响应。 */
  async start(manifest: unknown, initializeTimeoutMs = RUNNER_INITIALIZE_TIMEOUT_MS): Promise<{ initialize: unknown; instanceToken: string }> {
    const { packageRoot, executable } = this.options
    // executable 必须位于包根内（防止越界路径）。
    const scriptPath = resolve(packageRoot, executable)
    if (isAbsolute(executable) || !containedInRoot(packageRoot, scriptPath)) {
      throw new AgentError("PLUGIN_INSTALL_FAILED", "插件 executable 越出包根", 400)
    }
    const env = buildRunnerEnvironment({
      extra: {
        CPX_INSTANCE_TOKEN: this.options.instanceToken,
        ...(this.options.environment ?? {}),
      },
    })
    const child = spawn(process.execPath, [scriptPath, ...(this.options.args ?? [])], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    })
    this.child = child
    child.on("error", (error) => {
      this.onProcessExit(null, "pipe", error)
    })
    child.on("exit", (code) => {
      this.onProcessExit(code, "exit")
    })
    child.on("close", () => {
      if (this.child === child) this.onProcessExit(null, "pipe")
    })
    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    lines.on("line", (line) => {
      try {
        this.handleMessage(line)
      } catch (error) {
        void this.log("error", error instanceof Error ? error.message : "消息处理失败")
      }
    })
    child.stderr!.on("data", (chunk: Buffer) => {
      // stderr 只作诊断：截断且脱敏后交给 onExit 侧记录；首版仅丢弃（避免
      // 泄露路径），诊断页在 PR 9 提供安全输出。
      void chunk
    })

    // initialize 握手（默认 10s 超时）。
    const initialize = await this.request("plugin/initialize", {
      manifest,
      config: {},
      instanceToken: this.options.instanceToken,
    }, initializeTimeoutMs)
    return { initialize, instanceToken: this.options.instanceToken }
  }

  /** 发送 host→plugin 请求并等待响应。 */
  request(method: string, params: unknown, timeoutMs = RUNNER_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const requestId = `${this.options.pluginId}:${this.options.generationId}:${++this.requestSeq}:${method}`
    const message: PluginMessage = {
      protocol: "cpx-plugin-rpc@1",
      version: 1,
      pluginId: this.options.pluginId,
      generation: this.options.generationId,
      kind: "request",
      requestId,
      method: method as PluginHostRequestMethod,
      params: params as never,
    }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new PluginSdkError({ code: "RPC_TIMEOUT", message: `Runner 请求超时：${method}`, retryable: true }))
      }, timeoutMs)
      this.pending.set(requestId, { resolve: resolvePromise, reject, timer })
      this.send(message)
    })
  }

  /** 发送 host→plugin 通知。 */
  notify(method: string, params: unknown): void {
    const message: PluginMessage = {
      protocol: "cpx-plugin-rpc@1",
      version: 1,
      pluginId: this.options.pluginId,
      generation: this.options.generationId,
      kind: "notification",
      method: method as PluginHostNotificationMethod,
      params: params as never,
    }
    this.send(message)
  }

  /** 优雅关闭：quiesce → 等待退出（5s）→ 完整进程树清理。 */
  async close(gracefulTimeoutMs = RUNNER_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.closing || this.exited) return
    this.closing = true
    try {
      await this.request("plugin/quiesce", {}, gracefulTimeoutMs)
    } catch {
      // 超时或 runner 已死：继续清理。
    }
    if (!this.exited && this.child) {
      this.child.kill()
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(() => {
          if (this.child) killProcessTree(this.child)
          resolvePromise()
        }, gracefulTimeoutMs)
        this.child?.once("exit", () => {
          clearTimeout(timer)
          resolvePromise()
        })
      })
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new PluginSdkError({ code: "RPC_CANCELLED", message: "Runner 已关闭", retryable: false }))
    }
    this.pending.clear()
  }

  /** 强制终止：取消一切并杀完整进程树。 */
  forceKill(): void {
    if (this.child && !this.exited) {
      killProcessTree(this.child)
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new PluginSdkError({ code: "RPC_CANCELLED", message: "Runner 被强制终止", retryable: false }))
    }
    this.pending.clear()
  }

  private send(message: PluginMessage): void {
    if (!this.child?.stdin?.writable || this.exited) {
      throw new PluginSdkError({ code: "HOST_UNAVAILABLE", message: "Runner 进程不可写", retryable: true })
    }
    this.child.stdin.write(`${encodeMessage(message)}\n`)
  }

  private handleMessage(line: string): void {
    const message = decodeMessage(line)
    switch (message.kind) {
      case "response": {
        const pending = this.pending.get(message.requestId)
        if (!pending) return
        this.pending.delete(message.requestId)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new PluginSdkError({
            code: message.error.code as never,
            message: message.error.message,
            retryable: message.error.retryable,
          }))
        } else {
          pending.resolve(message.result)
        }
        return
      }
      case "clientRequest": {
        const respond = (result: unknown, error?: { code: string; message: string; retryable: boolean }) => {
          const response: PluginMessage = {
            protocol: "cpx-plugin-rpc@1",
            version: 1,
            pluginId: this.options.pluginId,
            generation: this.options.generationId,
            kind: "response",
            requestId: message.requestId,
            ...(error ? { error } : { result: result as never }),
          }
          this.send(response)
        }
        this.options.onClientRequest?.(message.method, message.params, respond)
        return
      }
      case "clientNotification":
        this.options.onClientNotification?.(message.method, message.params)
        return
      case "request":
      case "notification":
        // runner 不应主动向 host 发 request；忽略并诊断。
        return
    }
  }

  private onProcessExit(code: number | null, reason: "exit" | "signal" | "pipe", _error?: Error): void {
    if (this.exited) return
    this.exited = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new PluginSdkError({ code: "HOST_UNAVAILABLE", message: "Runner 进程已退出", retryable: true }))
    }
    this.pending.clear()
    this.options.onExit?.(code, reason)
  }

  private async log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void> {
    this.options.onClientNotification?.("host/log", { level, message })
  }
}

const containedInRoot = (root: string, candidate: string) => {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

/** 生成随机 instance token（只用于 runner 握手，不落库）。 */
export const createInstanceToken = () => randomBytes(24).toString("hex")

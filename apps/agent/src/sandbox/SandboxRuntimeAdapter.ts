import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcessByStdio, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { Readable } from "node:stream"
import { createInterface } from "node:readline"
import type {
  SandboxRuntimeConfig,
  SrtWinSpawn,
  WindowsSandboxUserStatus,
  WindowsWfpStatusResult,
} from "@anthropic-ai/sandbox-runtime"
import { AgentError } from "../domain"

export const SANDBOX_RUNTIME_VERSION = "0.0.65"
const MAX_OUTPUT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const SETUP_TIMEOUT_MS = 75_000
const WORKER_GRACE_MS = 10_000
const EXPECTED_HELPER_SHA256 = {
  x64: "777736e17d6cf9b4280f155f5cda731fdff0f789fa16e6cb3adc0006073e241a",
  arm64: "17a63aa8c010662b3e723f75d13d8672c69beeca8d072f4b2dce7484e850023a",
} as const

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

export interface SandboxedProcessRequest {
  command: string
  cwd: string
  /** Trusted runtime environment additions resolved by the Agent. */
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  config: SandboxRuntimeConfig
  signal?: AbortSignal
  diagnostics?: {
    threadID?: string
    turnID?: string
    toolCallID?: string
  }
}

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

export interface SandboxRuntimeAdapter {
  getStatus(): Promise<SandboxStatus>
  install(): Promise<void>
  uninstall(): Promise<void>
  run(request: SandboxedProcessRequest): Promise<ProcessResult>
  reset(): Promise<void>
  dispose(): Promise<void>
}

type SandboxRuntimeModule = typeof import("@anthropic-ai/sandbox-runtime")

interface SandboxLogger {
  info(event: string, details?: Record<string, unknown>): void
  warn(event: string, details?: Record<string, unknown>): void
  error(event: string, details?: Record<string, unknown>): void
}

type SandboxWorkerOperation =
  | { operation: "status"; helperPath: string | null }
  | { operation: "install" | "uninstall" | "reset" | "shutdown"; helperPath: string | null }
  | { operation: "run"; helperPath: string | null; request: Omit<SandboxedProcessRequest, "signal" | "diagnostics"> }

type SandboxWorkerRequest = SandboxWorkerOperation & { requestId: string }

type SandboxWorkerFrame =
  | { requestId: string; type: "phase"; phase: "status" | "setup" | "command" | "cleanup" }
  | { requestId: string; type: "session"; event: "initialized" | "reused" | "switching" | "disposed" | "invalidated"; fingerprint: string | null; previousFingerprint?: string | null; durationMs?: number }
  | { requestId: string; type: "result"; value: unknown }
  | { requestId: string; type: "error"; code: string; message: string; status: number; details?: unknown }

type CapturedChild = ChildProcessByStdio<null, Readable, Readable>

interface CommandShell {
  exe: string
  args: readonly string[]
}

const unique = (values: readonly string[]) => [...new Set(values.map((value) => resolve(value)))]

const PATH_ARRAY_KEYS = new Set(["allowRead", "allowWrite", "denyRead", "denyWrite"])
const DOMAIN_ARRAY_KEYS = new Set(["allowedDomains", "deniedDomains"])

function normalizeFingerprintValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => {
      if (typeof item !== "string") return normalizeFingerprintValue(item)
      if (PATH_ARRAY_KEYS.has(key)) {
        const path = resolve(item).replace(/[\\/]+$/, "")
        return process.platform === "win32" ? path.toLowerCase() : path
      }
      if (DOMAIN_ARRAY_KEYS.has(key)) return item.trim().toLowerCase()
      return item
    })
    return PATH_ARRAY_KEYS.has(key) || DOMAIN_ARRAY_KEYS.has(key)
      ? [...new Set(normalized as Array<string>)].sort()
      : normalized
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && typeof item !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([childKey, item]) => [childKey, normalizeFingerprintValue(item, childKey)]),
    )
  }
  return value
}

const mergeProcessEnvironment = (base: NodeJS.ProcessEnv, additions?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (!additions) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(additions)) {
    if (key.toLowerCase() === "path") {
      for (const existing of Object.keys(merged)) if (existing.toLowerCase() === "path") delete merged[existing]
    }
    merged[key] = value
  }
  return merged
}

export function sandboxPolicyFingerprint(config: SandboxRuntimeConfig): string {
  return createHash("sha256").update(JSON.stringify(normalizeFingerprintValue(config))).digest("hex")
}

function findExecutable(names: readonly string[]) {
  const pathEntries = (process.env.PATH ?? "").split(";").filter(Boolean)
  for (const name of names) {
    for (const directory of pathEntries) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function preferredShell(): CommandShell {
  const pwsh = findExecutable(["pwsh.exe", "pwsh"])
  if (pwsh) return { exe: pwsh, args: ["-NoProfile", "-NonInteractive", "-Command"] }
  const powershell = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe"
  return { exe: powershell, args: ["-NoProfile", "-NonInteractive", "-Command"] }
}

function killProcessTree(child: CapturedChild) {
  if (child.pid === undefined) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  } else {
    child.kill("SIGTERM")
  }
}

function boundedTimeout(timeoutMs: number | undefined) {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AgentError("INVALID_TIMEOUT", "Shell 超时时间必须是正数", 400)
  return Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS)
}

async function collectProcess(child: CapturedChild, timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  let stdout = ""
  let stderr = ""
  let stdoutBytes = 0
  let stderrBytes = 0
  let truncated = false
  let timedOut = false
  let terminating = false

  const append = (target: "stdout" | "stderr", chunk: Buffer) => {
    const currentBytes = target === "stdout" ? stdoutBytes : stderrBytes
    if (currentBytes >= MAX_OUTPUT_BYTES) {
      truncated = true
      return
    }
    const remaining = MAX_OUTPUT_BYTES - currentBytes
    const accepted = chunk.subarray(0, remaining)
    if (target === "stdout") stdoutBytes += accepted.byteLength
    else stderrBytes += accepted.byteLength
    if (accepted.byteLength < chunk.byteLength) truncated = true
    if (target === "stdout") stdout += accepted.toString("utf8")
    else stderr += accepted.toString("utf8")
  }

  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk))
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk))

  const terminate = () => {
    if (terminating) return
    terminating = true
    killProcessTree(child)
  }
  const abort = () => terminate()
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) terminate()
  const timer = setTimeout(() => {
    timedOut = true
    terminate()
  }, timeoutMs)

  const [exitCode, exitSignal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolveExit, rejectExit) => {
    child.once("error", rejectExit)
    child.once("exit", (code, exitSignal) => resolveExit([code, exitSignal]))
  }).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  })
  if (signal?.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
  return { exitCode, signal: exitSignal, stdout, stderr, timedOut, truncated }
}

export async function runHostCommand(command: string, cwd: string, timeoutMs?: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<ProcessResult> {
  const shell = preferredShell()
  const child = spawn(shell.exe, [...shell.args, command], {
    cwd,
    env: mergeProcessEnvironment(process.env, env),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return collectProcess(child, boundedTimeout(timeoutMs), signal)
}

class DirectSandboxRuntime implements SandboxRuntimeAdapter {
  private runtime: SandboxRuntimeModule | null = null
  private queue = Promise.resolve()
  private activeFingerprint: string | null = null

  constructor(
    private readonly helperPath: string | null = process.env.CODEPILOTX_SRT_WIN_PATH?.trim() || null,
    private readonly onPhase: (phase: "status" | "setup" | "command" | "cleanup") => void = () => undefined,
    private readonly onSession: (event: "initialized" | "reused" | "switching" | "disposed" | "invalidated", details: { fingerprint: string | null; previousFingerprint?: string | null; durationMs?: number }) => void = () => undefined,
  ) {}

  private async api() {
    return this.runtime ??= await import("@anthropic-ai/sandbox-runtime")
  }

  private async resolvedHelper(): Promise<{ path: string; spawn: SrtWinSpawn }> {
    const api = await this.api()
    const spawnTarget = api.resolveSrtWin(this.helperPath ? { path: this.helperPath } : undefined)
    return { path: spawnTarget.exe, spawn: spawnTarget }
  }

  private helperDigest(path: string) {
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  }

  private validateHelper(path: string) {
    const expected = EXPECTED_HELPER_SHA256[process.arch as keyof typeof EXPECTED_HELPER_SHA256]
    if (!expected) throw new AgentError("SANDBOX_HELPER_UNSUPPORTED", `没有 ${process.arch} 的 SRT helper 校验清单`, 503)
    const digest = this.helperDigest(path)
    if (digest !== expected) throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper SHA-256 校验失败", 503, { path, digest, expected })
    const image = readFileSync(path)
    if (image.length < 0x40 || image.toString("ascii", 0, 2) !== "MZ") throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper 不是有效的 Windows PE 文件", 503)
    const peOffset = image.readUInt32LE(0x3c)
    if (peOffset + 6 > image.length || image.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper PE 头无效", 503)
    const machine = image.readUInt16LE(peOffset + 4)
    const expectedMachine = process.arch === "x64" ? 0x8664 : 0xaa64
    if (machine !== expectedMachine) throw new AgentError("SANDBOX_HELPER_INVALID", "SRT helper 架构与 Agent 不匹配", 503, { machine, expectedMachine })
    return digest
  }

  async getStatus(): Promise<SandboxStatus> {
    this.onPhase("status")
    const base: SandboxStatus = {
      state: "unsupported",
      platform: process.platform,
      architecture: process.arch,
      runtimeVersion: SANDBOX_RUNTIME_VERSION,
      helperPath: null,
      helperSha256: null,
      user: null,
      wfp: null,
      error: null,
    }
    if (process.platform !== "win32" || !("x64" === process.arch || "arm64" === process.arch)) return base
    try {
      const api = await this.api()
      const helper = await this.resolvedHelper()
      base.helperPath = helper.path
      base.helperSha256 = this.validateHelper(helper.path)
      base.user = api.getWindowsSandboxUserStatus({ srtWin: helper.spawn })
      base.wfp = api.getWindowsWfpStatus({ srtWin: helper.spawn })
      base.state = base.user.provisioned && base.user.credPresent && base.wfp.state !== "absent" ? "available" : base.user.provisioned ? "repair-required" : "not-installed"
      if (base.user.provisioned !== base.user.inSandboxGroup || !base.user.hiddenFromLogon || !base.user.groupExists) base.state = "repair-required"
      if (base.wfp.state === "cannot-read") base.error = base.wfp.hint ?? "无法读取 WFP 状态；运行时会执行非管理员行为验证"
    } catch (cause) {
      base.helperPath ??= this.helperPath
      base.state = base.helperPath ? "damaged" : "not-installed"
      base.error = cause instanceof Error ? cause.message : String(cause)
    }
    return base
  }

  async install() {
    if (process.platform !== "win32") throw new AgentError("SANDBOX_UNSUPPORTED", "当前平台不支持 Windows SRT 安装", 409)
    await this.reset()
    const api = await this.api()
    const helper = await this.resolvedHelper()
    this.validateHelper(helper.path)
    const result = api.installWindowsSandbox({ srtWin: helper.spawn })
    if (result.cancelled) throw new AgentError("SANDBOX_INSTALL_CANCELLED", "用户取消了 SRT 安装", 409)
  }

  async uninstall() {
    if (process.platform !== "win32") throw new AgentError("SANDBOX_UNSUPPORTED", "当前平台不支持 Windows SRT 卸载", 409)
    await this.reset()
    const api = await this.api()
    const helper = await this.resolvedHelper()
    this.validateHelper(helper.path)
    const result = api.uninstallWindowsSandbox({ srtWin: helper.spawn })
    if (result.cancelled) throw new AgentError("SANDBOX_UNINSTALL_CANCELLED", "用户取消了 SRT 卸载", 409)
  }

  async run(request: SandboxedProcessRequest) {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const api = await this.api()
      const fingerprint = sandboxPolicyFingerprint(request.config)
      await this.ensureInitialized(api, request.config, fingerprint)
      this.onPhase("command")
      const shell = preferredShell()
      const wrapped = await api.SandboxManager.wrapWithSandboxArgv(request.command, { exe: shell.exe, args: shell.args }, undefined, request.signal, request.cwd)
      const child = spawn(wrapped.argv[0]!, wrapped.argv.slice(1), {
        cwd: request.cwd,
        env: mergeProcessEnvironment(wrapped.env, request.env),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      try {
        return await collectProcess(child, boundedTimeout(request.timeoutMs), request.signal)
      } finally {
        this.onPhase("cleanup")
        api.SandboxManager.cleanupAfterCommand()
      }
    } finally {
      release()
    }
  }

  private async ensureInitialized(api: SandboxRuntimeModule, config: SandboxRuntimeConfig, fingerprint: string): Promise<void> {
    if (this.activeFingerprint === fingerprint) {
      this.onSession("reused", { fingerprint })
      return
    }
    const previousFingerprint = this.activeFingerprint
    const startedAt = Date.now()
    if (previousFingerprint) {
      this.onSession("switching", { fingerprint, previousFingerprint })
      this.onPhase("cleanup")
      await api.SandboxManager.reset()
      this.activeFingerprint = null
    } else {
      const status = await this.getStatus()
      if (status.state !== "available") throw new AgentError("SANDBOX_NOT_READY", status.error ?? "SRT 沙箱未安装或需要修复", 503, status)
    }
    try {
      this.onPhase("setup")
      await api.SandboxManager.initialize(config)
      this.activeFingerprint = fingerprint
      this.onSession("initialized", { fingerprint, ...(previousFingerprint ? { previousFingerprint } : {}), durationMs: Date.now() - startedAt })
    } catch (cause) {
      this.activeFingerprint = null
      this.onSession("invalidated", { fingerprint, ...(previousFingerprint ? { previousFingerprint } : {}), durationMs: Date.now() - startedAt })
      await api.SandboxManager.reset().catch(() => undefined)
      throw cause
    }
  }

  async reset() {
    if (!this.runtime || !this.activeFingerprint) return
    const previousFingerprint = this.activeFingerprint
    this.onPhase("cleanup")
    try {
      await this.runtime.SandboxManager.reset()
    } finally {
      this.activeFingerprint = null
    }
    this.onSession("disposed", { fingerprint: null, previousFingerprint })
  }

  async dispose() {
    await this.reset()
  }
}

export interface SandboxWorkerClientOptions {
  logger?: SandboxLogger
  setupTimeoutMs?: number
  spawnWorker?: () => ChildProcessWithoutNullStreams
}

function defaultWorkerCommand(): { executable: string; args: string[] } {
  const executableName = basename(process.execPath).toLowerCase()
  if (executableName === "codepilotx-agent.exe" || executableName === "codepilotx-agent") {
    return { executable: process.execPath, args: ["--sandbox-worker"] }
  }
  return {
    executable: process.execPath,
    args: [resolve(import.meta.dir, "../index.ts"), "--sandbox-worker"],
  }
}

function spawnDefaultWorker(): ChildProcessWithoutNullStreams {
  const command = defaultWorkerCommand()
  return spawn(command.executable, command.args, {
    cwd: process.cwd(),
    env: { ...process.env },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
}

function stopWorkerTree(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  child.unref()
}

function pathCounts(config: SandboxRuntimeConfig | undefined) {
  return {
    allowReadCount: config?.filesystem?.allowRead?.length ?? 0,
    allowWriteCount: config?.filesystem?.allowWrite?.length ?? 0,
    denyReadCount: config?.filesystem?.denyRead?.length ?? 0,
    denyWriteCount: config?.filesystem?.denyWrite?.length ?? 0,
  }
}

function workerError(frame: Extract<SandboxWorkerFrame, { type: "error" }>): AgentError {
  return new AgentError(frame.code, frame.message, frame.status, frame.details)
}

interface ActiveWorkerRequest {
  requestId: string
  operation: SandboxWorkerOperation
  startedAt: number
  phase: "starting" | "status" | "setup" | "command" | "cleanup"
  commandStarted: boolean
  timer?: NodeJS.Timeout
  signal?: AbortSignal
  abort?: () => void
  baseDetails: Record<string, unknown>
  resolve(value: unknown): void
  reject(cause: unknown): void
}

interface PersistentSandboxWorker {
  child: ChildProcessWithoutNullStreams
  pending: string
  stderrBytes: number
  active: ActiveWorkerRequest | null
  closing: boolean
}

export class AnthropicSandboxRuntimeAdapter implements SandboxRuntimeAdapter {
  private queue = Promise.resolve()
  private previousWorkerFailed = false
  private worker: PersistentSandboxWorker | null = null
  private disposed = false
  private readonly logger: SandboxLogger | undefined
  private readonly setupTimeoutMs: number
  private readonly spawnWorker: () => ChildProcessWithoutNullStreams

  constructor(
    private readonly helperPath: string | null = process.env.CODEPILOTX_SRT_WIN_PATH?.trim() || null,
    options: SandboxWorkerClientOptions = {},
  ) {
    this.logger = options.logger
    this.setupTimeoutMs = options.setupTimeoutMs ?? SETUP_TIMEOUT_MS
    this.spawnWorker = options.spawnWorker ?? spawnDefaultWorker
  }

  getStatus(): Promise<SandboxStatus> {
    return this.serialized({ operation: "status", helperPath: this.helperPath }) as Promise<SandboxStatus>
  }

  async install(): Promise<void> {
    await this.serialized({ operation: "install", helperPath: this.helperPath })
  }

  async uninstall(): Promise<void> {
    await this.serialized({ operation: "uninstall", helperPath: this.helperPath })
  }

  async reset(): Promise<void> {
    if (!this.worker) return
    await this.serialized({ operation: "reset", helperPath: this.helperPath })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (!this.worker) return
    await this.serialized({ operation: "shutdown", helperPath: this.helperPath }).catch((cause) => {
      this.logger?.warn("sandbox.session.invalidated", { reason: "shutdown-failed", error: cause instanceof Error ? cause.name : "unknown" })
      const worker = this.worker
      if (worker) this.invalidateWorker(worker, "shutdown-failed")
    })
  }

  run(request: SandboxedProcessRequest): Promise<ProcessResult> {
    const { signal: _signal, diagnostics: _diagnostics, ...workerRequest } = request
    return this.serialized(
      { operation: "run", helperPath: this.helperPath, request: workerRequest },
      request.signal,
      request.diagnostics,
    ) as Promise<ProcessResult>
  }

  private async serialized(operation: SandboxWorkerOperation, signal?: AbortSignal, diagnostics?: SandboxedProcessRequest["diagnostics"]): Promise<unknown> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolveQueue) => { release = resolveQueue })
    await previous
    try {
      return await this.executeWorker(operation, signal, diagnostics)
    } finally {
      release()
    }
  }

  private executeWorker(operation: SandboxWorkerOperation, signal?: AbortSignal, diagnostics?: SandboxedProcessRequest["diagnostics"]): Promise<unknown> {
    if (this.disposed && operation.operation !== "shutdown") return Promise.reject(new AgentError("SANDBOX_DISPOSED", "SRT 沙箱会话已经关闭", 503))
    if (signal?.aborted) return Promise.reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
    const worker = this.ensureWorker()
    if (worker.active) return Promise.reject(new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 同时收到多个请求", 500))
    const child = worker.child
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    const counts = operation.operation === "run" ? pathCounts(operation.request.config) : {}
    const fingerprint = operation.operation === "run" ? sandboxPolicyFingerprint(operation.request.config) : undefined
    const baseDetails = {
      operation: operation.operation,
      pid: child.pid,
      runtimeVersion: SANDBOX_RUNTIME_VERSION,
      helper: this.helperPath ? basename(this.helperPath) : null,
      ...(fingerprint ? { fingerprint } : {}),
      ...counts,
      ...diagnostics,
    }
    if (operation.operation !== "run" || !fingerprint) this.logger?.info("sandbox.worker.started", baseDetails)

    return new Promise((resolveResult, rejectResult) => {
      let settled = false
      let active!: ActiveWorkerRequest
      const cleanup = () => {
        if (active.timer) clearTimeout(active.timer)
        if (active.abort) signal?.removeEventListener("abort", active.abort)
        if (worker.active === active) worker.active = null
      }
      const finishResolve = (value: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        const durationMs = Date.now() - startedAt
        if (this.previousWorkerFailed) {
          this.previousWorkerFailed = false
          this.logger?.info("sandbox.worker.recovered", { ...baseDetails, durationMs })
        }
        if (operation.operation === "shutdown") {
          worker.closing = true
          child.stdin.end()
          if (this.worker === worker) this.worker = null
        }
        resolveResult(value)
      }
      const finishReject = (cause: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        this.previousWorkerFailed = true
        rejectResult(cause)
      }
      active = {
        requestId,
        operation,
        startedAt,
        phase: "starting",
        commandStarted: false,
        ...(signal ? { signal } : {}),
        baseDetails,
        resolve: finishResolve,
        reject: finishReject,
      }
      worker.active = active

      const armTimer = (timeoutMs: number) => {
        if (active.timer) clearTimeout(active.timer)
        active.timer = setTimeout(() => {
          const durationMs = Date.now() - startedAt
          const code = active.phase === "command" || (active.phase === "cleanup" && active.commandStarted)
            ? "SANDBOX_WORKER_TIMEOUT"
            : "SANDBOX_SETUP_TIMEOUT"
          const message = code === "SANDBOX_WORKER_TIMEOUT" ? "沙箱命令 worker 超时" : "SRT 沙箱准备超时，命令尚未开始执行"
          this.logger?.error("sandbox.worker.timeout", { ...baseDetails, phase: active.phase, durationMs, code })
          this.previousWorkerFailed = true
          finishReject(new AgentError(code, message, 504, { phase: code === "SANDBOX_SETUP_TIMEOUT" ? "setup" : active.phase, durationMs, runtimeVersion: SANDBOX_RUNTIME_VERSION, helper: baseDetails.helper, ...counts }))
          this.invalidateWorker(worker, code)
        }, timeoutMs)
      }
      const abort = () => {
        finishReject(new AgentError("RUN_ABORTED", "任务已停止", 499))
        this.invalidateWorker(worker, "abort")
      }
      active.abort = abort
      signal?.addEventListener("abort", abort, { once: true })

      armTimer(this.setupTimeoutMs)
      child.stdin.write(`${JSON.stringify({ ...operation, requestId } satisfies SandboxWorkerRequest)}\n`, "utf8", (cause) => {
        if (!cause) return
        finishReject(new AgentError("SANDBOX_WORKER_PROTOCOL", "无法向 SRT worker 发送请求", 502, { name: cause.name }))
        this.invalidateWorker(worker, "stdin-error")
      })
    })
  }

  private ensureWorker(): PersistentSandboxWorker {
    if (this.worker && this.worker.child.exitCode === null && this.worker.child.signalCode === null) return this.worker
    const child = this.spawnWorker()
    const worker: PersistentSandboxWorker = { child, pending: "", stderrBytes: 0, active: null, closing: false }
    this.worker = worker
    this.logger?.info("sandbox.worker.started", { pid: child.pid, runtimeVersion: SANDBOX_RUNTIME_VERSION, helper: this.helperPath ? basename(this.helperPath) : null })
    child.stdout.on("data", (chunk: Buffer) => this.handleWorkerOutput(worker, chunk))
    child.stderr.on("data", (chunk: Buffer) => { worker.stderrBytes = Math.min(MAX_OUTPUT_BYTES, worker.stderrBytes + chunk.byteLength) })
    child.once("error", (cause) => {
      worker.active?.reject(new AgentError("SANDBOX_WORKER_SPAWN", "无法启动 SRT worker", 503, { name: cause.name }))
      this.invalidateWorker(worker, "spawn-error")
    })
    child.once("exit", (exitCode, exitSignal) => {
      const active = worker.active
      if (active) active.reject(new AgentError("SANDBOX_WORKER_EXITED", "SRT worker 在返回结果前退出", 502, { phase: active.phase, exitCode, exitSignal }))
      if (this.worker === worker) this.worker = null
      const details = { pid: child.pid, phase: active?.phase, exitCode, exitSignal, stderrBytes: worker.stderrBytes }
      if (worker.closing && exitCode === 0) this.logger?.info("sandbox.worker.exited", details)
      else this.logger?.error("sandbox.worker.exited", details)
    })
    return worker
  }

  private handleWorkerOutput(worker: PersistentSandboxWorker, chunk: Buffer): void {
    worker.pending += chunk.toString("utf8")
    if (Buffer.byteLength(worker.pending, "utf8") > MAX_OUTPUT_BYTES) {
      worker.active?.reject(new AgentError("SANDBOX_WORKER_OUTPUT_LIMIT", "SRT worker 协议输出超过限制", 502))
      this.invalidateWorker(worker, "output-limit")
      return
    }
    const lines = worker.pending.split(/\r?\n/)
    worker.pending = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      let frame: SandboxWorkerFrame
      try {
        frame = JSON.parse(line) as SandboxWorkerFrame
      } catch {
        worker.active?.reject(new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 返回了无效协议数据", 502))
        this.invalidateWorker(worker, "invalid-json")
        return
      }
      const active = worker.active
      if (!active || frame.requestId !== active.requestId) {
        active?.reject(new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 返回了不匹配的请求", 502))
        this.invalidateWorker(worker, "request-mismatch")
        return
      }
      if (frame.type === "phase") {
        active.phase = frame.phase
        this.logger?.info("sandbox.worker.phase", { ...active.baseDetails, phase: frame.phase, durationMs: Date.now() - active.startedAt })
        if (frame.phase === "command") {
          active.commandStarted = true
          const commandTimeout = active.operation.operation === "run" ? boundedTimeout(active.operation.request.timeoutMs) : this.setupTimeoutMs
          this.armActiveTimer(worker, active, commandTimeout + WORKER_GRACE_MS)
        } else if (frame.phase === "cleanup") {
          const timeout = active.commandStarted ? this.setupTimeoutMs : Math.max(1, this.setupTimeoutMs - (Date.now() - active.startedAt))
          this.armActiveTimer(worker, active, timeout)
        }
      } else if (frame.type === "session") {
        this.logger?.info(`sandbox.session.${frame.event}`, { ...active.baseDetails, fingerprint: frame.fingerprint, previousFingerprint: frame.previousFingerprint, durationMs: frame.durationMs })
      } else if (frame.type === "result") {
        active.resolve(frame.value)
      } else if (frame.type === "error") {
        if (frame.code === "SANDBOX_SETUP_TIMEOUT") {
          const durationMs = Date.now() - active.startedAt
          this.logger?.error("sandbox.worker.timeout", { ...active.baseDetails, phase: active.phase, durationMs, code: frame.code })
        }
        active.reject(workerError(frame))
      }
    }
  }

  private armActiveTimer(worker: PersistentSandboxWorker, active: ActiveWorkerRequest, timeoutMs: number): void {
    if (active.timer) clearTimeout(active.timer)
    active.timer = setTimeout(() => {
      const durationMs = Date.now() - active.startedAt
      const code = active.phase === "command" || (active.phase === "cleanup" && active.commandStarted) ? "SANDBOX_WORKER_TIMEOUT" : "SANDBOX_SETUP_TIMEOUT"
      this.logger?.error("sandbox.worker.timeout", { ...active.baseDetails, phase: active.phase, durationMs, code })
      active.reject(new AgentError(code, code === "SANDBOX_WORKER_TIMEOUT" ? "沙箱命令 worker 超时" : "SRT 沙箱准备超时，命令尚未开始执行", 504, { phase: code === "SANDBOX_SETUP_TIMEOUT" ? "setup" : active.phase, durationMs }))
      this.invalidateWorker(worker, code)
    }, timeoutMs)
  }

  private invalidateWorker(worker: PersistentSandboxWorker, reason: string): void {
    if (this.worker === worker) this.worker = null
    if (worker.active?.timer) clearTimeout(worker.active.timer)
    worker.active = null
    this.previousWorkerFailed = true
    this.logger?.warn("sandbox.session.invalidated", { pid: worker.child.pid, reason })
    stopWorkerTree(worker.child)
  }
}

function writeWorkerFrame(frame: SandboxWorkerFrame): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function serializeWorkerError(requestId: string, cause: unknown, phase?: string, commandStarted = false): Extract<SandboxWorkerFrame, { type: "error" }> {
  if (cause instanceof AgentError) {
    return { requestId, type: "error", code: cause.code, message: cause.message, status: cause.status, ...(cause.details === undefined ? {} : { details: cause.details }) }
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  if (!commandStarted && /\bETIMEDOUT\b/i.test(message) && /srt-win|spawnSync/i.test(message)) {
    return {
      requestId,
      type: "error",
      code: "SANDBOX_SETUP_TIMEOUT",
      message: "SRT 沙箱准备超时，命令尚未开始执行",
      status: 504,
      details: { phase: phase ?? "setup" },
    }
  }
  return { requestId, type: "error", code: "SANDBOX_WORKER_INTERNAL", message, status: 500 }
}

export async function runSandboxWorkerProcess(): Promise<number> {
  let runtime: DirectSandboxRuntime | null = null
  let runtimeHelperPath: string | null | undefined
  let phase: "status" | "setup" | "command" | "cleanup" | undefined
  let commandStarted = false
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let requestId = "unknown"
    phase = undefined
    commandStarted = false
    try {
      if (Buffer.byteLength(line, "utf8") > MAX_OUTPUT_BYTES) throw new AgentError("SANDBOX_WORKER_INPUT_LIMIT", "SRT worker 请求超过限制", 413)
      const operation = JSON.parse(line) as SandboxWorkerRequest
      if (!operation.requestId || typeof operation.requestId !== "string") throw new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 请求缺少 requestId", 400)
      requestId = operation.requestId
      if (runtimeHelperPath !== undefined && operation.helperPath !== runtimeHelperPath) throw new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 运行期间 helper 配置发生变化", 409)
      runtimeHelperPath ??= operation.helperPath
      runtime ??= new DirectSandboxRuntime(operation.helperPath, (nextPhase) => {
        phase = nextPhase
        if (nextPhase === "command") commandStarted = true
        writeWorkerFrame({ requestId, type: "phase", phase: nextPhase })
      }, (event, details) => {
        writeWorkerFrame({ requestId, type: "session", event, ...details })
      })
      let value: unknown
      if (operation.operation === "status") value = await runtime.getStatus()
      else if (operation.operation === "install") value = await runtime.install()
      else if (operation.operation === "uninstall") value = await runtime.uninstall()
      else if (operation.operation === "reset") value = await runtime.reset()
      else if (operation.operation === "shutdown") value = await runtime.dispose()
      else if (operation.operation === "run") value = await runtime.run(operation.request)
      else throw new AgentError("SANDBOX_WORKER_PROTOCOL", "SRT worker 操作无效", 400)
      writeWorkerFrame({ requestId, type: "result", value: value ?? null })
      if (operation.operation === "shutdown") break
    } catch (cause) {
      writeWorkerFrame(serializeWorkerError(requestId, cause, phase, commandStarted))
    }
  }
  await runtime?.dispose().catch(() => undefined)
  return 0
}

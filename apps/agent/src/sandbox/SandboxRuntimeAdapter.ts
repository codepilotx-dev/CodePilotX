import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process"
import type { Readable } from "node:stream"
import { tmpdir } from "node:os"
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
  timeoutMs?: number
  config: SandboxRuntimeConfig
  signal?: AbortSignal
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
}

type SandboxRuntimeModule = typeof import("@anthropic-ai/sandbox-runtime")

type CapturedChild = ChildProcessByStdio<null, Readable, Readable>

interface CommandShell {
  exe: string
  args: readonly string[]
}

const unique = (values: readonly string[]) => [...new Set(values.map((value) => resolve(value)))]

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

export async function runHostCommand(command: string, cwd: string, timeoutMs?: number, signal?: AbortSignal): Promise<ProcessResult> {
  const shell = preferredShell()
  const child = spawn(shell.exe, [...shell.args, command], {
    cwd,
    env: { ...process.env },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return collectProcess(child, boundedTimeout(timeoutMs), signal)
}

export class AnthropicSandboxRuntimeAdapter implements SandboxRuntimeAdapter {
  private runtime: SandboxRuntimeModule | null = null
  private queue = Promise.resolve()

  constructor(private readonly helperPath: string | null = process.env.CODEPILOTX_SRT_WIN_PATH?.trim() || null) {}

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
    const api = await this.api()
    const helper = await this.resolvedHelper()
    this.validateHelper(helper.path)
    const result = api.installWindowsSandbox({ srtWin: helper.spawn })
    if (result.cancelled) throw new AgentError("SANDBOX_INSTALL_CANCELLED", "用户取消了 SRT 安装", 409)
  }

  async uninstall() {
    if (process.platform !== "win32") throw new AgentError("SANDBOX_UNSUPPORTED", "当前平台不支持 Windows SRT 卸载", 409)
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
      const status = await this.getStatus()
      if (status.state !== "available") throw new AgentError("SANDBOX_NOT_READY", status.error ?? "SRT 沙箱未安装或需要修复", 503, status)
      try {
        await api.SandboxManager.initialize(request.config)
        const shell = preferredShell()
        const wrapped = await api.SandboxManager.wrapWithSandboxArgv(request.command, { exe: shell.exe, args: shell.args }, undefined, request.signal, request.cwd)
        const child = spawn(wrapped.argv[0]!, wrapped.argv.slice(1), {
          cwd: request.cwd,
          env: wrapped.env,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
        return await collectProcess(child, boundedTimeout(request.timeoutMs), request.signal)
      } finally {
        await api.SandboxManager.reset()
      }
    } finally {
      release()
    }
  }

  async reset() {
    if (!this.runtime) return
    await this.runtime.SandboxManager.reset()
  }
}

export function createSessionTemp() {
  return mkdtempSync(join(tmpdir(), "codepilotx-session-"))
}

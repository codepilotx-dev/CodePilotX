import { spawn } from "node:child_process"
import { AgentError } from "../domain"
import {
  boundedTimeout,
  collectProcess,
  mergeProcessEnvironment,
  preferredShell,
  temporarilyApplyProcessEnvironment,
  type ProcessResult,
} from "./SandboxProcess"
import {
  decodeSandboxWorkerRequest,
  encodeSandboxWorkerFrame,
  SandboxWorkerFrameDecoder,
  type SandboxWorkerError,
  type SandboxWorkerPhase,
  type SandboxWorkerResponse,
  type SerializedSandboxRequest,
} from "./SandboxWorkerProtocol"
import { SRT_WORKER_PROTOCOL_VERSION } from "./SandboxRuntimeManifest"
import { validateSrtHelper } from "./SandboxHelper"

const sandboxTimeoutMessages: Record<SandboxWorkerPhase, string> = {
  initialize: "SRT 沙箱初始化超时",
  wrap: "SRT 沙箱命令准备超时",
  run: "SRT 沙箱命令执行超时",
  reset: "SRT 沙箱清理超时",
}

const withSandboxWorkerPhase = (
  error: Omit<SandboxWorkerError, "phase">,
  phase?: SandboxWorkerPhase,
): SandboxWorkerError => phase ? { ...error, phase } : error

export const sandboxWorkerSafeError = (
  cause: unknown,
  phase?: SandboxWorkerPhase,
): SandboxWorkerError => {
  if (cause instanceof AgentError) {
    if (cause.code === "RUN_ABORTED") {
      return withSandboxWorkerPhase({ code: "RUN_ABORTED", message: "任务已停止", status: 499 }, phase)
    }
    if (cause.code === "INVALID_TIMEOUT") {
      return withSandboxWorkerPhase({ code: "INVALID_TIMEOUT", message: "Shell 超时时间无效", status: 400 }, phase)
    }
    if (cause.code === "SANDBOX_UNAVAILABLE") {
      return withSandboxWorkerPhase({ code: "SANDBOX_UNAVAILABLE", message: "SRT 沙箱执行失败", status: 503 }, phase)
    }
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/\bETIMEDOUT\b|timed?\s*out/i.test(message)) {
    return withSandboxWorkerPhase({
      code: "SANDBOX_RUNTIME_TIMEOUT",
      message: phase ? sandboxTimeoutMessages[phase] : "SRT 沙箱初始化或执行超时",
      status: 504,
    }, phase)
  }
  if (/acl\s+(?:grant|stamp)|ERROR_ACCESS_DENIED|WIN32_ERROR\s*=\s*0x0*5\b|0x0*5\b.*access/i.test(message)) {
    return withSandboxWorkerPhase({
      code: "SANDBOX_PATH_ACCESS_DENIED",
      message: "SRT 无法配置工作区访问权限",
      status: 503,
    }, phase)
  }
  return withSandboxWorkerPhase({ code: "SANDBOX_UNAVAILABLE", message: "SRT 沙箱执行失败", status: 503 }, phase)
}

class SandboxWorkerExecutionError {
  constructor(
    readonly cause: unknown,
    readonly recycle: boolean,
    readonly phase: SandboxWorkerPhase,
  ) {}
}

const write = (message: SandboxWorkerResponse) =>
  new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(encodeSandboxWorkerFrame(message), (cause) => cause ? rejectWrite(cause) : resolveWrite())
  })

async function execute(request: SerializedSandboxRequest, signal: AbortSignal): Promise<{ result: ProcessResult; recycle: boolean }> {
  let api: typeof import("@anthropic-ai/sandbox-runtime") | null = null
  let result: ProcessResult | null = null
  let initialized = false
  let recycle = false
  let executionCause: unknown = null
  let executionPhase: SandboxWorkerPhase = "initialize"
  let phase: SandboxWorkerPhase = "initialize"
  try {
    api = await import("@anthropic-ai/sandbox-runtime")
    const helper = api.resolveSrtWin(request.config.windows?.srtWin)
    validateSrtHelper(helper.exe)
    const restoreEnvironment = temporarilyApplyProcessEnvironment(request.env)
    let wrapped: Awaited<ReturnType<typeof api.SandboxManager.wrapWithSandboxArgv>>
    try {
      try {
        await api.SandboxManager.initialize(request.config)
      } catch (cause) {
        recycle = true
        throw cause
      }
      initialized = true
      const shell = preferredShell()
      phase = "wrap"
      wrapped = await api.SandboxManager.wrapWithSandboxArgv(
        request.command,
        { exe: shell.exe, args: shell.args },
        undefined,
        signal,
        request.cwd,
      )
    } finally {
      restoreEnvironment()
    }
    phase = "run"
    const child = spawn(wrapped.argv[0]!, wrapped.argv.slice(1), {
      cwd: request.cwd,
      env: mergeProcessEnvironment(wrapped.env, request.env, { protectSandboxVariables: true }),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    result = await collectProcess(child, boundedTimeout(request.timeoutMs), signal)
  } catch (cause) {
    executionCause = cause
    executionPhase = phase
  } finally {
    if (initialized && api) {
      try {
        phase = "reset"
        await api.SandboxManager.reset()
      } catch {
        recycle = true
      }
    }
  }
  if (executionCause !== null) throw new SandboxWorkerExecutionError(executionCause, recycle, executionPhase)
  if (!result) {
    throw new SandboxWorkerExecutionError(
      new AgentError("SANDBOX_UNAVAILABLE", "SRT 沙箱未返回执行结果", 503),
      recycle,
      "run",
    )
  }
  return { result, recycle }
}

export async function startSandboxWorker() {
  if (process.env.CODEPILOTX_SANDBOX_WORKER !== "1") {
    throw new Error("Sandbox worker 只能由 Agent 内部启动")
  }
  const decoder = new SandboxWorkerFrameDecoder(decodeSandboxWorkerRequest)
  let active: { id: string; controller: AbortController } | null = null
  let shuttingDown = false

  const handle = async (message: ReturnType<typeof decodeSandboxWorkerRequest>) => {
    if (message.type === "shutdown") {
      shuttingDown = true
      active?.controller.abort()
      if (!active) process.exit(0)
      return
    }
    if (message.type === "cancel") {
      if (active?.id === message.id) active.controller.abort()
      return
    }
    if (active) {
      await write({
        type: "error",
        protocol: SRT_WORKER_PROTOCOL_VERSION,
        id: message.id,
        error: { code: "SANDBOX_WORKER_BUSY", message: "沙箱 worker 正在执行其他任务", status: 409 },
        recycle: false,
      })
      return
    }
    const controller = new AbortController()
    active = { id: message.id, controller }
    try {
      const output = await execute(message.request, controller.signal)
      await write({
        type: "result",
        protocol: SRT_WORKER_PROTOCOL_VERSION,
        id: message.id,
        result: output.result,
        recycle: output.recycle,
      })
      if (output.recycle) shuttingDown = true
    } catch (cause) {
      const executionError = cause instanceof SandboxWorkerExecutionError ? cause : null
      await write({
        type: "error",
        protocol: SRT_WORKER_PROTOCOL_VERSION,
        id: message.id,
        error: sandboxWorkerSafeError(executionError?.cause ?? cause, executionError?.phase),
        recycle: executionError?.recycle ?? false,
      })
      if (executionError?.recycle) shuttingDown = true
    } finally {
      active = null
      if (shuttingDown) process.exit(0)
    }
  }

  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) void handle(message)
    } catch {
      process.exit(64)
    }
  })
  process.stdin.once("end", () => {
    shuttingDown = true
    active?.controller.abort()
    if (!active) process.exit(0)
  })
  await write({ type: "ready", protocol: SRT_WORKER_PROTOCOL_VERSION })
}

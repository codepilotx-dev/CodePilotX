import { basename, resolve } from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { AgentError } from "../domain"
import { killProcessTree, type ProcessResult } from "./SandboxProcess"
import {
  decodeSandboxWorkerResponse,
  encodeSandboxWorkerFrame,
  SandboxWorkerFrameDecoder,
  type SandboxWorkerRequest,
  type SandboxWorkerResponse,
  type SerializedSandboxRequest,
} from "./SandboxWorkerProtocol"
import {
  SRT_MAX_CONCURRENT_COMMANDS,
  SRT_WORKER_IDLE_TIMEOUT_MS,
  SRT_WORKER_PROTOCOL_VERSION,
} from "./SandboxRuntimeManifest"

const WORKER_READY_TIMEOUT_MS = 10_000
const WORKER_CANCEL_GRACE_MS = 2_000
const SENSITIVE_ENV_NAME = /(?:^|_)(?:api[_-]?key|token|secret|password|credential|private[_-]?key)(?:$|_)/i
const SENSITIVE_ENV_NAMES = new Set([
  "aws_access_key_id",
  "kubeconfig",
])

export type SandboxWorkerCommand = {
  executable: string
  args: string[]
  cwd: string
}

type WorkerState = "starting" | "idle" | "busy" | "closing"

type PendingJob = {
  id: string
  request: SerializedSandboxRequest
  signal?: AbortSignal
  resolve: (result: ProcessResult) => void
  reject: (cause: unknown) => void
  abort?: () => void
  worker?: WorkerHandle
  settled: boolean
}

type WorkerHandle = {
  id: string
  child: ChildProcessWithoutNullStreams
  decoder: SandboxWorkerFrameDecoder<SandboxWorkerResponse>
  state: WorkerState
  current: PendingJob | null
  readyTimer: ReturnType<typeof setTimeout> | null
  idleTimer: ReturnType<typeof setTimeout> | null
  cancelTimer: ReturnType<typeof setTimeout> | null
}

export function resolveSandboxWorkerCommand(runtime: {
  execPath: string
  argv: readonly string[]
  cwd: string
} = {
  execPath: process.execPath,
  argv: process.argv,
  cwd: process.cwd(),
}): SandboxWorkerCommand {
  const executableName = basename(runtime.execPath).toLowerCase()
  const isRuntimeExecutable = executableName === "bun.exe" || executableName === "bun" || executableName === "node.exe" || executableName === "node"
  if (!isRuntimeExecutable) {
    return { executable: runtime.execPath, args: ["--sandbox-worker"], cwd: runtime.cwd }
  }
  const entrypoint = runtime.argv[1]
  if (!entrypoint) throw new AgentError("SANDBOX_WORKER_UNAVAILABLE", "无法解析 Agent worker 入口", 503)
  return {
    executable: runtime.execPath,
    args: [resolve(entrypoint), "--sandbox-worker"],
    cwd: runtime.cwd,
  }
}

export interface SandboxWorkerPoolOptions {
  maxWorkers?: number
  idleTimeoutMs?: number
  readyTimeoutMs?: number
  cancelGraceMs?: number
  command?: () => SandboxWorkerCommand
  spawnWorker?: (command: SandboxWorkerCommand) => ChildProcessWithoutNullStreams
}

export function sandboxWorkerEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(base).filter(([name]) =>
        !SENSITIVE_ENV_NAME.test(name) && !SENSITIVE_ENV_NAMES.has(name.toLowerCase())
      ),
    ),
    CODEPILOTX_SANDBOX_WORKER: "1",
  }
}

export class SandboxWorkerPool {
  private readonly workers = new Map<string, WorkerHandle>()
  private readonly queue: PendingJob[] = []
  private readonly maxWorkers: number
  private readonly idleTimeoutMs: number
  private readonly readyTimeoutMs: number
  private readonly cancelGraceMs: number
  private closing = false

  constructor(private readonly options: SandboxWorkerPoolOptions = {}) {
    this.maxWorkers = options.maxWorkers ?? SRT_MAX_CONCURRENT_COMMANDS
    this.idleTimeoutMs = options.idleTimeoutMs ?? SRT_WORKER_IDLE_TIMEOUT_MS
    this.readyTimeoutMs = options.readyTimeoutMs ?? WORKER_READY_TIMEOUT_MS
    this.cancelGraceMs = options.cancelGraceMs ?? WORKER_CANCEL_GRACE_MS
  }

  stats() {
    return {
      active: [...this.workers.values()].filter((worker) => worker.state === "busy").length,
      queued: this.queue.length,
      workers: this.workers.size,
      max: this.maxWorkers,
    }
  }

  hasWork() {
    const stats = this.stats()
    return stats.active > 0 || stats.queued > 0
  }

  run(request: SerializedSandboxRequest, signal?: AbortSignal): Promise<ProcessResult> {
    if (this.closing) return Promise.reject(new AgentError("SANDBOX_DISPOSED", "沙箱执行器已关闭", 503))
    if (signal?.aborted) return Promise.reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
    return new Promise<ProcessResult>((resolveResult, reject) => {
      const job: PendingJob = {
        id: crypto.randomUUID(),
        request,
        ...(signal ? { signal } : {}),
        resolve: resolveResult,
        reject,
        settled: false,
      }
      const abort = () => this.cancel(job)
      job.abort = abort
      signal?.addEventListener("abort", abort, { once: true })
      this.queue.push(job)
      this.dispatch()
    })
  }

  async recycleIdleWorkers() {
    const idle = [...this.workers.values()].filter((worker) => worker.state === "idle")
    await Promise.all(idle.map((worker) => this.closeWorker(worker)))
  }

  async dispose() {
    if (this.closing) return
    this.closing = true
    for (const job of this.queue.splice(0)) {
      this.settle(job, new AgentError("SANDBOX_DISPOSED", "沙箱执行器已关闭", 503))
    }
    const workers = [...this.workers.values()]
    const exits = workers.map((worker) => new Promise<void>((resolveExit) => {
      if (!this.workers.has(worker.id)) resolveExit()
      else worker.child.once("exit", () => resolveExit())
    }))
    for (const worker of workers) {
      try {
        if (worker.current) this.cancel(worker.current)
        else this.send(worker, { type: "shutdown", protocol: SRT_WORKER_PROTOCOL_VERSION })
      } catch {
        killProcessTree(worker.child)
        this.removeWorker(worker)
      }
    }
    await Promise.race([
      Promise.all(exits),
      new Promise((resolveWait) => setTimeout(resolveWait, this.cancelGraceMs)),
    ])
    for (const worker of [...this.workers.values()]) {
      killProcessTree(worker.child)
      this.removeWorker(worker)
    }
  }

  private dispatch() {
    if (this.closing) return
    while (this.queue.length > 0) {
      const idle = [...this.workers.values()].find((worker) => worker.state === "idle")
      if (idle) {
        this.assign(idle, this.queue.shift()!)
        continue
      }
      if (this.workers.size >= this.maxWorkers) return
      const starting = [...this.workers.values()].filter((worker) => worker.state === "starting").length
      if (starting >= this.queue.length) return
      this.startWorker()
    }
  }

  private startWorker() {
    const command = (this.options.command ?? resolveSandboxWorkerCommand)()
    const child = this.options.spawnWorker
      ? this.options.spawnWorker(command)
      : spawn(command.executable, command.args, {
        cwd: command.cwd,
        env: sandboxWorkerEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      })
    const worker: WorkerHandle = {
      id: crypto.randomUUID(),
      child,
      decoder: new SandboxWorkerFrameDecoder(decodeSandboxWorkerResponse),
      state: "starting",
      current: null,
      readyTimer: null,
      idleTimer: null,
      cancelTimer: null,
    }
    this.workers.set(worker.id, worker)
    child.stderr.resume()
    worker.readyTimer = setTimeout(() => {
      this.failWorker(worker, new AgentError("SANDBOX_WORKER_TIMEOUT", "沙箱 worker 启动超时", 504))
    }, this.readyTimeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of worker.decoder.push(chunk)) this.onMessage(worker, message)
      } catch {
        this.failWorker(worker, new AgentError("SANDBOX_WORKER_PROTOCOL", "沙箱 worker 协议无效", 503))
      }
    })
    child.once("error", () => {
      this.failWorker(worker, new AgentError("SANDBOX_WORKER_CRASHED", "沙箱 worker 无法启动", 503))
    })
    child.once("exit", () => {
      if (!this.workers.has(worker.id)) return
      const cause = worker.current?.signal?.aborted
        ? new AgentError("RUN_ABORTED", "任务已停止", 499)
        : new AgentError("SANDBOX_WORKER_CRASHED", "沙箱 worker 异常退出，命令不会自动重试", 503)
      this.failWorker(worker, cause)
    })
  }

  private onMessage(worker: WorkerHandle, message: SandboxWorkerResponse) {
    if (message.type === "ready") {
      if (worker.state !== "starting") return this.failWorker(worker, new AgentError("SANDBOX_WORKER_PROTOCOL", "沙箱 worker 重复就绪", 503))
      if (worker.readyTimer) clearTimeout(worker.readyTimer)
      worker.readyTimer = null
      worker.state = "idle"
      this.scheduleIdle(worker)
      this.dispatch()
      return
    }
    const job = worker.current
    if (!job || job.id !== message.id) {
      return this.failWorker(worker, new AgentError("SANDBOX_WORKER_PROTOCOL", "沙箱 worker 响应与任务不匹配", 503))
    }
    if (worker.cancelTimer) clearTimeout(worker.cancelTimer)
    worker.cancelTimer = null
    worker.current = null
    const shouldClose = this.closing || message.recycle
    if (shouldClose) worker.state = "closing"
    if (message.type === "result") this.settle(job, null, message.result)
    else {
      this.settle(job, new AgentError(
        message.error.code,
        message.error.message,
        message.error.status,
        message.error.phase ? { phase: message.error.phase } : undefined,
      ))
    }
    if (shouldClose) {
      void this.closeWorker(worker)
    } else {
      worker.state = "idle"
      this.scheduleIdle(worker)
      this.dispatch()
    }
  }

  private assign(worker: WorkerHandle, job: PendingJob) {
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    worker.idleTimer = null
    worker.state = "busy"
    worker.current = job
    job.worker = worker
    try {
      this.send(worker, {
        type: "run",
        protocol: SRT_WORKER_PROTOCOL_VERSION,
        id: job.id,
        request: job.request,
      })
    } catch (cause) {
      this.failWorker(worker, cause)
    }
  }

  private cancel(job: PendingJob) {
    if (job.settled) return
    const queuedIndex = this.queue.indexOf(job)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      this.settle(job, new AgentError("RUN_ABORTED", "任务已停止", 499))
      return
    }
    const worker = job.worker
    if (!worker || worker.current !== job) return
    try {
      this.send(worker, { type: "cancel", protocol: SRT_WORKER_PROTOCOL_VERSION, id: job.id })
    } catch {
      this.failWorker(
        worker,
        job.signal?.aborted
          ? new AgentError("RUN_ABORTED", "任务已停止", 499)
          : new AgentError("SANDBOX_WORKER_CRASHED", "沙箱 worker 通信失败", 503),
      )
      return
    }
    if (worker.cancelTimer) clearTimeout(worker.cancelTimer)
    worker.cancelTimer = setTimeout(() => killProcessTree(worker.child), this.cancelGraceMs)
  }

  private send(worker: WorkerHandle, message: SandboxWorkerRequest) {
    if (worker.child.stdin.destroyed || !worker.child.stdin.writable) {
      throw new AgentError("SANDBOX_WORKER_CRASHED", "沙箱 worker 通信已关闭", 503)
    }
    worker.child.stdin.write(encodeSandboxWorkerFrame(message))
  }

  private scheduleIdle(worker: WorkerHandle) {
    if (this.idleTimeoutMs <= 0) return
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    worker.idleTimer = setTimeout(() => {
      if (worker.state === "idle") void this.closeWorker(worker)
    }, this.idleTimeoutMs)
  }

  private async closeWorker(worker: WorkerHandle) {
    if (!this.workers.has(worker.id)) return
    worker.state = "closing"
    try {
      this.send(worker, { type: "shutdown", protocol: SRT_WORKER_PROTOCOL_VERSION })
    } catch {
      killProcessTree(worker.child)
    }
    await Promise.race([
      new Promise<void>((resolveExit) => worker.child.once("exit", () => resolveExit())),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, this.cancelGraceMs)),
    ])
    if (this.workers.has(worker.id)) killProcessTree(worker.child)
    this.removeWorker(worker)
    this.dispatch()
  }

  private failWorker(worker: WorkerHandle, cause: unknown) {
    if (!this.workers.has(worker.id)) return
    if (worker.current) this.settle(worker.current, cause)
    else if (worker.state === "starting") {
      const waiting = this.queue.shift()
      if (waiting) this.settle(waiting, cause)
    }
    killProcessTree(worker.child)
    this.removeWorker(worker)
    this.dispatch()
  }

  private removeWorker(worker: WorkerHandle) {
    if (worker.readyTimer) clearTimeout(worker.readyTimer)
    if (worker.idleTimer) clearTimeout(worker.idleTimer)
    if (worker.cancelTimer) clearTimeout(worker.cancelTimer)
    worker.readyTimer = null
    worker.idleTimer = null
    worker.cancelTimer = null
    worker.current = null
    this.workers.delete(worker.id)
  }

  private settle(job: PendingJob, cause: unknown | null, result?: ProcessResult) {
    if (job.settled) return
    job.settled = true
    job.signal?.removeEventListener("abort", job.abort!)
    if (cause) job.reject(cause)
    else job.resolve(result!)
  }
}

import { spawn } from "node:child_process"
import { AgentError } from "../domain"
import { getToolingManager, type ManagedToolID, type ToolingResolution } from "./ToolingManager"

export type ToolingResolver = (id: ManagedToolID, options?: { signal?: AbortSignal }) => Promise<ToolingResolution>

export interface ToolProcessRequest {
  executable: string
  args: readonly string[]
  cwd: string
  signal: AbortSignal
  timeoutMs: number
  maxOutputBytes: number
}

export interface ToolProcessResult {
  exitCode: number
  stdout: Buffer
  stderr: string
}

export type ToolProcessRunner = (request: ToolProcessRequest) => Promise<ToolProcessResult>

export const resolveManagedTool: ToolingResolver = (id, options) => getToolingManager().resolve(id, options)

export const runToolProcess: ToolProcessRunner = (request) => new Promise((resolve, reject) => {
  if (request.signal.aborted) {
    reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
    return
  }

  const child = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let outputBytes = 0
  let settled = false
  let failure: AgentError | null = null

  const stop = (error: AgentError) => {
    if (failure) return
    failure = error
    child.kill("SIGKILL")
  }
  const onAbort = () => stop(new AgentError("RUN_ABORTED", "任务已停止", 499))
  request.signal.addEventListener("abort", onAbort, { once: true })
  const timer = setTimeout(() => stop(new AgentError("WORKSPACE_SEARCH_TIMEOUT", `工作区搜索超过 ${request.timeoutMs / 1_000} 秒预算`, 408)), request.timeoutMs)

  child.stdout.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength
    if (outputBytes > request.maxOutputBytes) {
      stop(new AgentError("WORKSPACE_SEARCH_OUTPUT_LIMIT", "工作区搜索输出超过安全上限", 413))
      return
    }
    stdout.push(chunk)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.reduce((sum, item) => sum + item.byteLength, 0) < 64 * 1024) stderr.push(chunk)
  })
  child.once("error", (cause) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    request.signal.removeEventListener("abort", onAbort)
    reject(failure ?? new AgentError("TOOLING_PROCESS_FAILED", `无法启动工具进程：${cause.message}`, 503))
  })
  child.once("close", (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    request.signal.removeEventListener("abort", onAbort)
    if (failure) {
      reject(failure)
      return
    }
    resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8").slice(0, 64 * 1024) })
  })
})

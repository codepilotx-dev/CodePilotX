import { isAbsolute } from "node:path"
import { StringDecoder } from "node:string_decoder"
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import type { ProcessResult } from "./SandboxProcess"
import { SRT_WORKER_PROTOCOL_VERSION } from "./SandboxRuntimeManifest"

export const MAX_SANDBOX_WORKER_FRAME_BYTES = 1024 * 1024

export type SerializedSandboxRequest = {
  command: string
  cwd: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
  config: SandboxRuntimeConfig
}

export type SandboxWorkerRequest =
  | { type: "run"; protocol: number; id: string; request: SerializedSandboxRequest }
  | { type: "cancel"; protocol: number; id: string }
  | { type: "shutdown"; protocol: number }

export type SandboxWorkerPhase = "initialize" | "wrap" | "run" | "reset"

export type SandboxWorkerError = {
  code: string
  message: string
  status: number
  phase?: SandboxWorkerPhase
}

export type SandboxWorkerResponse =
  | { type: "ready"; protocol: number }
  | { type: "result"; protocol: number; id: string; result: ProcessResult; recycle: boolean }
  | { type: "error"; protocol: number; id: string; error: SandboxWorkerError; recycle: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allow = new Set(allowed)
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new Error("Sandbox worker 消息包含未知字段")
  }
}

function assertJsonSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number" && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Sandbox worker 消息包含循环引用")
    seen.add(value)
    for (const item of value) assertJsonSafe(item, seen)
    seen.delete(value)
    return
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new Error("Sandbox worker 消息包含循环引用")
    seen.add(value)
    for (const item of Object.values(value)) {
      if (item !== undefined) assertJsonSafe(item, seen)
    }
    seen.delete(value)
    return
  }
  if (value === undefined) return
  throw new Error("Sandbox worker 消息包含不可序列化字段")
}

function validateEnvironment(value: unknown): Record<string, string | undefined> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Sandbox worker env 无效")
  const result: Record<string, string | undefined> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (
      !key
      || key.includes("\0")
      || !["path", "pathext"].includes(normalized)
      || (item !== undefined && typeof item !== "string")
    ) {
      throw new Error("Sandbox worker env 无效")
    }
    result[key] = item as string | undefined
  }
  return result
}

function validateRunRequest(value: unknown): SerializedSandboxRequest {
  if (!isRecord(value)) throw new Error("Sandbox worker run request 无效")
  assertExactKeys(value, ["command", "cwd", "env", "timeoutMs", "config"])
  if (typeof value.command !== "string" || !value.command || value.command.length > 32_000 || value.command.includes("\0")) {
    throw new Error("Sandbox worker command 无效")
  }
  if (typeof value.cwd !== "string" || !isAbsolute(value.cwd) || value.cwd.includes("\0")) {
    throw new Error("Sandbox worker cwd 必须是绝对路径")
  }
  if (value.timeoutMs !== undefined && (
    typeof value.timeoutMs !== "number"
    || !Number.isFinite(value.timeoutMs)
    || value.timeoutMs <= 0
  )) {
    throw new Error("Sandbox worker timeoutMs 无效")
  }
  if (!isRecord(value.config)) throw new Error("Sandbox worker config 无效")
  assertJsonSafe(value.config)
  const filesystem = value.config.filesystem
  if (isRecord(filesystem)) {
    for (const field of ["denyRead", "allowRead", "allowWrite", "denyWrite"] as const) {
      const paths = filesystem[field]
      if (paths === undefined) continue
      if (!Array.isArray(paths) || paths.some((path) =>
        typeof path !== "string" || !isAbsolute(path) || path.includes("\0")
      )) {
        throw new Error(`Sandbox worker ${field} 必须只包含绝对路径`)
      }
    }
  }
  const windows = value.config.windows
  if (isRecord(windows) && isRecord(windows.srtWin)) {
    const helperPath = windows.srtWin.path
    if (typeof helperPath !== "string" || !isAbsolute(helperPath) || helperPath.includes("\0")) {
      throw new Error("Sandbox worker helper 必须使用绝对路径")
    }
  }
  const env = validateEnvironment(value.env)
  return {
    command: value.command,
    cwd: value.cwd,
    ...(env ? { env } : {}),
    ...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
    config: value.config as SandboxRuntimeConfig,
  }
}

function validateProtocol(value: unknown) {
  if (value !== SRT_WORKER_PROTOCOL_VERSION) {
    throw new Error("Sandbox worker 协议版本不匹配")
  }
}

const isSandboxWorkerPhase = (value: unknown): value is SandboxWorkerPhase =>
  value === "initialize" || value === "wrap" || value === "run" || value === "reset"

export function decodeSandboxWorkerRequest(raw: unknown): SandboxWorkerRequest {
  if (!isRecord(raw) || typeof raw.type !== "string") throw new Error("Sandbox worker 请求无效")
  if (raw.type === "run") {
    assertExactKeys(raw, ["type", "protocol", "id", "request"])
    validateProtocol(raw.protocol)
    if (typeof raw.id !== "string" || !raw.id) throw new Error("Sandbox worker request id 无效")
    return { type: "run", protocol: SRT_WORKER_PROTOCOL_VERSION, id: raw.id, request: validateRunRequest(raw.request) }
  }
  if (raw.type === "cancel") {
    assertExactKeys(raw, ["type", "protocol", "id"])
    validateProtocol(raw.protocol)
    if (typeof raw.id !== "string" || !raw.id) throw new Error("Sandbox worker request id 无效")
    return { type: "cancel", protocol: SRT_WORKER_PROTOCOL_VERSION, id: raw.id }
  }
  if (raw.type === "shutdown") {
    assertExactKeys(raw, ["type", "protocol"])
    validateProtocol(raw.protocol)
    return { type: "shutdown", protocol: SRT_WORKER_PROTOCOL_VERSION }
  }
  throw new Error("Sandbox worker 请求类型无效")
}

export function decodeSandboxWorkerResponse(raw: unknown): SandboxWorkerResponse {
  if (!isRecord(raw) || typeof raw.type !== "string") throw new Error("Sandbox worker 响应无效")
  validateProtocol(raw.protocol)
  if (raw.type === "ready") {
    assertExactKeys(raw, ["type", "protocol"])
    return { type: "ready", protocol: SRT_WORKER_PROTOCOL_VERSION }
  }
  if (raw.type === "result") {
    assertExactKeys(raw, ["type", "protocol", "id", "result", "recycle"])
    if (typeof raw.id !== "string" || !isRecord(raw.result) || typeof raw.recycle !== "boolean") {
      throw new Error("Sandbox worker result 无效")
    }
    const result = raw.result
    assertExactKeys(result, ["exitCode", "signal", "stdout", "stderr", "timedOut", "truncated"])
    if (
      !(result.exitCode === null || (typeof result.exitCode === "number" && Number.isInteger(result.exitCode)))
      || !(result.signal === null || typeof result.signal === "string")
      || typeof result.stdout !== "string"
      || typeof result.stderr !== "string"
      || typeof result.timedOut !== "boolean"
      || typeof result.truncated !== "boolean"
    ) {
      throw new Error("Sandbox worker process result 无效")
    }
    return {
      type: "result",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: raw.id,
      result: result as unknown as ProcessResult,
      recycle: raw.recycle,
    }
  }
  if (raw.type === "error") {
    assertExactKeys(raw, ["type", "protocol", "id", "error", "recycle"])
    if (typeof raw.id !== "string" || !isRecord(raw.error) || typeof raw.recycle !== "boolean") {
      throw new Error("Sandbox worker error 无效")
    }
    assertExactKeys(raw.error, ["code", "message", "status", "phase"])
    if (
      typeof raw.error.code !== "string"
      || typeof raw.error.message !== "string"
      || typeof raw.error.status !== "number"
      || (raw.error.phase !== undefined && !isSandboxWorkerPhase(raw.error.phase))
    ) {
      throw new Error("Sandbox worker error 无效")
    }
    return {
      type: "error",
      protocol: SRT_WORKER_PROTOCOL_VERSION,
      id: raw.id,
      error: raw.error as SandboxWorkerError,
      recycle: raw.recycle,
    }
  }
  throw new Error("Sandbox worker 响应类型无效")
}

export function encodeSandboxWorkerFrame(message: SandboxWorkerRequest | SandboxWorkerResponse): string {
  assertJsonSafe(message)
  const frame = `${JSON.stringify(message)}\n`
  if (Buffer.byteLength(frame, "utf8") > MAX_SANDBOX_WORKER_FRAME_BYTES) {
    throw new Error("Sandbox worker 消息超过 1 MiB")
  }
  return frame
}

export class SandboxWorkerFrameDecoder<T> {
  private buffer = ""
  private readonly stringDecoder = new StringDecoder("utf8")

  constructor(private readonly decode: (raw: unknown) => T) {}

  push(chunk: Buffer | string): T[] {
    this.buffer += typeof chunk === "string" ? chunk : this.stringDecoder.write(chunk)
    const output: T[] = []
    while (true) {
      const newline = this.buffer.indexOf("\n")
      if (newline < 0) break
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      if (Buffer.byteLength(line, "utf8") + 1 > MAX_SANDBOX_WORKER_FRAME_BYTES) {
        throw new Error("Sandbox worker 消息超过 1 MiB")
      }
      output.push(this.decode(JSON.parse(line)))
    }
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_SANDBOX_WORKER_FRAME_BYTES) {
      throw new Error("Sandbox worker 消息超过 1 MiB")
    }
    return output
  }
}

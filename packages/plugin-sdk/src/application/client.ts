/**
 * ApplicationPluginClient —— 插件进程侧的协议客户端。
 *
 * 负责：
 * - plugin/initialize 握手（10 秒超时）；
 * - 发起 plugin→host 请求（serviceCall、kv、credentialUse）与通知（log、progress、viewInvalidate）；
 * - 接收 host→plugin 请求并分发给注册 handler，异步回包；
 * - 响应超时、取消与 generation 固定。
 *
 * transport 由调用方注入（stdio 或内存），便于测试与跨运行时复用。
 */

import { PluginSdkError } from "../errors"
import { toSafeWireError } from "../errors"
import {
  PLUGIN_PROTOCOL,
  PLUGIN_PROTOCOL_VERSION,
  type PluginClientNotificationMethod,
  type PluginClientRequestMethod,
  type PluginMessage,
  type PluginWireError,
} from "../wire/messages"
import { decodeMessage, encodeMessage, toJsonValue } from "../wire/codec"
import type { JsonValue } from "../json-schema"
import type { HostServiceFacade } from "./context"

export const INITIALIZE_TIMEOUT_MS = 10_000
export const REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

export interface PluginTransport {
  /** 向 Host 发送一条单行 JSON 消息。 */
  send(text: string): void
  /** 注册 Host 消息接收回调。 */
  onMessage(handler: (text: string) => void): void
}

export interface PluginRequestContext {
  requestId: string
  method: string
  params: JsonValue | undefined
  generation: string
}

export type PluginRequestHandler = (context: PluginRequestContext) => Promise<JsonValue | undefined> | JsonValue | undefined

export interface ApplicationPluginClientOptions {
  transport: PluginTransport
  pluginId: string
  generation: string
  /** 请求超时（默认 30s）；initialize 固定 10s。 */
  requestTimeoutMs?: number
}

interface PendingRequest {
  resolve: (result: JsonValue | undefined) => void
  reject: (error: PluginSdkError) => void
  timer: ReturnType<typeof setTimeout>
}

export class ApplicationPluginClient implements HostServiceFacade {
  private readonly transport: PluginTransport
  private readonly pluginId: string
  private readonly generation: string
  private readonly requestTimeoutMs: number
  private readonly pending = new Map<string, PendingRequest>()
  private readonly handlers = new Map<string, PluginRequestHandler>()
  private initialized = false
  private disposed = false
  private requestSeq = 0

  constructor(options: ApplicationPluginClientOptions) {
    this.transport = options.transport
    this.pluginId = options.pluginId
    this.generation = options.generation
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.transport.onMessage((text) => {
      try {
        this.handleMessage(text)
      } catch (error) {
        // 解码失败只记录安全诊断；无法回应损坏消息。
        void this.log({ level: "error", message: "收到无法解码的 Host 消息", details: { code: error instanceof PluginSdkError ? error.code : "INTERNAL_ERROR" } })
      }
    })
  }

  /** 注册 host→plugin 请求处理（plugin/toolExecute 等）。同名方法重复注册抛错。 */
  onRequest(method: string, handler: PluginRequestHandler): void {
    if (this.handlers.has(method)) {
      throw new PluginSdkError({ code: "INVALID_REQUEST", message: `重复注册请求处理：${method}` })
    }
    this.handlers.set(method, handler)
  }

  /**
   * 与 Host 的 initialize 握手由 Host 发起（plugin/initialize 是 Host→Plugin
   * 请求）：插件应注册 onRequest("plugin/initialize", handler) 并返回
   * PluginInitializeResult。Host 会在 params.instanceToken 携带握手 token，
   * 插件应与自身环境的 CPX_INSTANCE_TOKEN 比对，不一致必须拒绝。
   * 本方法不主动发送 initialize（方向由 wire 固定）。
   */

  /** 发送 plugin→host 请求并等待响应；超时抛 RPC_TIMEOUT。params 必须是 JSON 可表达值。 */
  request(method: string, params: unknown, timeoutMs?: number): Promise<JsonValue | undefined> {
    return this.sendRequest(method, params, timeoutMs ?? this.requestTimeoutMs)
  }

  private sendRequest(method: string, params: unknown, timeoutMs: number): Promise<JsonValue | undefined> {
    if (this.disposed) throw new PluginSdkError({ code: "ALREADY_DISPOSED", message: "插件已释放" })
    const requestId = this.nextRequestId(method)
    const safeParams = params === undefined ? undefined : toJsonValue(params)
    const message: PluginMessage = {
      protocol: PLUGIN_PROTOCOL,
      version: PLUGIN_PROTOCOL_VERSION,
      pluginId: this.pluginId,
      generation: this.generation,
      kind: "clientRequest",
      requestId,
      method: method as PluginClientRequestMethod,
      ...(safeParams === undefined ? {} : { params: safeParams }),
    }
    return new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new PluginSdkError({ code: "RPC_TIMEOUT", message: `Host 请求超时：${method}`, retryable: true }))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.transport.send(encodeMessage(message))
      } catch (error) {
        this.pending.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof PluginSdkError ? error : new PluginSdkError({ code: "INTERNAL_ERROR", message: "发送消息失败" }))
      }
    })
  }

  /** 发送通知（无需响应）。 */
  notify(kind: "clientNotification", method: string, params: unknown): void {
    if (this.disposed) throw new PluginSdkError({ code: "ALREADY_DISPOSED", message: "插件已释放" })
    const safeParams = params === undefined ? undefined : toJsonValue(params)
    const message: PluginMessage = {
      protocol: PLUGIN_PROTOCOL,
      version: PLUGIN_PROTOCOL_VERSION,
      pluginId: this.pluginId,
      generation: this.generation,
      kind,
      method: method as PluginClientNotificationMethod,
      ...(safeParams === undefined ? {} : { params: safeParams }),
    }
    this.transport.send(encodeMessage(message))
  }

  private nextRequestId(method: string): string {
    this.requestSeq += 1
    return `${this.pluginId}:${this.requestSeq}:${method}`
  }

  private handleMessage(text: string): void {
    const message = decodeMessage(text)
    if (message.pluginId !== this.pluginId) {
      throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息 pluginId 与进程不符" })
    }
    if (message.generation !== this.generation) {
      throw new PluginSdkError({ code: "PROTOCOL_VERSION_UNSUPPORTED", message: "消息 generation 与进程不符", retryable: false })
    }
    switch (message.kind) {
      case "request": {
        const handler = this.handlers.get(message.method)
        if (!handler) {
          this.respond(message.requestId, undefined, { code: "UNKNOWN_METHOD", message: `未知方法：${message.method}`, retryable: false })
          return
        }
        void Promise.resolve()
          .then(() => handler({ requestId: message.requestId, method: message.method, params: message.params, generation: message.generation }))
          .then((result) => this.respond(message.requestId, result, undefined))
          .catch((error) => this.respond(message.requestId, undefined, toSafeWireError(error)))
        return
      }
      case "response": {
        const pending = this.pending.get(message.requestId)
        if (!pending) return // 迟到的响应（超时后）静默丢弃
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
      case "notification":
        return
      case "clientRequest":
      case "clientNotification":
        // Host 不应向插件发送 client 方向消息；忽略并诊断。
        throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "收到反向消息" })
    }
  }

  private respond(requestId: string, result: JsonValue | undefined, error: PluginWireError | undefined): void {
    const message: PluginMessage = {
      protocol: PLUGIN_PROTOCOL,
      version: PLUGIN_PROTOCOL_VERSION,
      pluginId: this.pluginId,
      generation: this.generation,
      kind: "response",
      requestId,
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
    }
    this.transport.send(encodeMessage(message))
  }

  // ── HostServiceFacade ──────────────────────────────────────────────────

  async log(entry: { level: "debug" | "info" | "warn" | "error"; message: string; details?: JsonValue }): Promise<void> {
    this.notify("clientNotification", "host/log", entry as unknown as JsonValue)
  }

  async progress(entry: { toolCallId?: string; message: string; completed?: number; total?: number }): Promise<void> {
    this.notify("clientNotification", "host/progress", entry as unknown as JsonValue)
  }

  async viewInvalidate(input: { viewId: string }): Promise<void> {
    this.notify("clientNotification", "host/viewInvalidate", input as unknown as JsonValue)
  }

  async serviceCall(input: { service: string; method: string; params?: JsonValue; timeoutMs?: number }): Promise<JsonValue> {
    const result = await this.request("host/serviceCall", input as unknown as JsonValue, input.timeoutMs)
    return result as JsonValue
  }

  async kvGet(input: { key: string; scope: "global" | "workspace" }): Promise<JsonValue | null> {
    const result = await this.request("host/kvGet", input as unknown as JsonValue)
    return result as JsonValue | null
  }

  async kvPut(input: { key: string; value: JsonValue; scope: "global" | "workspace" }): Promise<void> {
    await this.request("host/kvPut", input as unknown as JsonValue)
  }

  async kvDelete(input: { key: string; scope: "global" | "workspace" }): Promise<void> {
    await this.request("host/kvDelete", input as unknown as JsonValue)
  }

  async credentialUse(input: { slot: string; purpose: string }): Promise<{ granted: boolean; reference?: string }> {
    const result = await this.request("host/credentialUse", input as unknown as JsonValue)
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw new PluginSdkError({ code: "INVALID_REQUEST", message: "credentialUse 响应非法" })
    }
    return result as unknown as { granted: boolean; reference?: string }
  }

  /** 释放客户端：拒绝新请求并清理 pending（Host 侧进程终止仍由 Supervisor 兜底）。 */
  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new PluginSdkError({ code: "RPC_CANCELLED", message: "客户端已释放", retryable: false }))
    }
    this.pending.clear()
  }
}

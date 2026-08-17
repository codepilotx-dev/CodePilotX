/**
 * Wire codec：canonical JSON、digest 与消息编解码。
 *
 * - canonicalStringify 输出与对象 key 顺序无关的稳定 JSON；
 * - canonicalDigest 基于 canonical JSON 的 sha256；
 * - 编码时拒绝 function、undefined、symbol、BigInt、NaN、循环引用等
 *   非 JSON 类型（WIRE_PAYLOAD_NOT_JSON）；
 * - 单条消息超过 MAX_MESSAGE_BYTES 抛 MESSAGE_TOO_LARGE。
 */

import { createHash } from "node:crypto"
import { PluginSdkError } from "../errors"
import {
  PLUGIN_PROTOCOL,
  PLUGIN_PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  type PluginMessage,
} from "./messages"
import { isJsonValue, type JsonValue } from "../json-schema"

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

/**
 * canonical JSON 序列化：对象 key 按 code unit 升序、无多余空白、
 * 拒绝非 JSON 类型与循环引用。数组顺序保留。
 */
export function canonicalStringify(value: JsonValue, seen = new Set<object>()): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "string":
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) {
        throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "数字必须是有限值" })
      }
      return JSON.stringify(value)
    case "object": {
      if (seen.has(value)) {
        throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "存在循环引用" })
      }
      seen.add(value)
      try {
        if (Array.isArray(value)) {
          const items = value.map((item) => {
            if (!isJsonValue(item)) {
              throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "数组元素不是 JSON 值" })
            }
            return canonicalStringify(item, seen)
          })
          return `[${items.join(",")}]`
        }
        const keys = Object.keys(value).sort()
        const entries: string[] = []
        for (const key of keys) {
          const raw = (value as Record<string, unknown>)[key]
          // undefined 字段不是合法 JSON 值：显式拒绝而不是跳过。
          if (raw === undefined) {
            throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "字段值不能是 undefined" })
          }
          if (!isJsonValue(raw)) {
            throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "字段不是 JSON 值" })
          }
          entries.push(`${JSON.stringify(key)}:${canonicalStringify(raw, seen)}`)
        }
        return `{${entries.join(",")}}`
      } finally {
        seen.delete(value)
      }
    }
    default:
      throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "值不是 JSON 可表达类型" })
  }
}

/** 把任意 unknown 规范化为 JsonValue；非 JSON 类型抛 WIRE_PAYLOAD_NOT_JSON。 */
export function toJsonValue(input: unknown): JsonValue {
  if (!isJsonValue(input)) {
    throw new PluginSdkError({ code: "WIRE_PAYLOAD_NOT_JSON", message: "payload 包含非 JSON 类型" })
  }
  return input
}

/** canonical digest：不受 JSON key 顺序影响的 sha256。输入必须是 JSON 可表达值。 */
export function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(toJsonValue(value)), "utf8").digest("hex")
}

/** 校验消息公共头（协议、版本）。 */
export function assertMessageHeader(input: { protocol?: unknown; version?: unknown }): void {
  if (input.protocol !== PLUGIN_PROTOCOL || input.version !== PLUGIN_PROTOCOL_VERSION) {
    throw new PluginSdkError({
      code: "PROTOCOL_VERSION_UNSUPPORTED",
      message: `协议不兼容：需要 ${PLUGIN_PROTOCOL}@${PLUGIN_PROTOCOL_VERSION}`,
      retryable: false,
    })
  }
}

/** 编码消息为单行 JSON 文本；协议不兼容或超过 1 MiB 抛错。 */
export function encodeMessage(message: PluginMessage): string {
  assertMessageHeader(message)
  if (typeof message.pluginId !== "string" || message.pluginId.length === 0) {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息缺少 pluginId" })
  }
  if (typeof message.generation !== "string" || message.generation.length === 0) {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息缺少 generation" })
  }
  const text = canonicalStringify(message as unknown as JsonValue)
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    throw new PluginSdkError({ code: "MESSAGE_TOO_LARGE", message: `消息超过 ${MAX_MESSAGE_BYTES} 字节上限`, retryable: false })
  }
  return text
}

/** 解码消息文本；非法结构抛 MESSAGE_MALFORMED。 */
export function decodeMessage(text: string): PluginMessage {
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    throw new PluginSdkError({ code: "MESSAGE_TOO_LARGE", message: `消息超过 ${MAX_MESSAGE_BYTES} 字节上限`, retryable: false })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息不是合法 JSON" })
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息必须是 JSON 对象" })
  }
  const record = parsed as Record<string, unknown>
  if (!isJsonValue(parsed)) {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息包含非 JSON 值" })
  }
  if (record.protocol !== PLUGIN_PROTOCOL || record.version !== PLUGIN_PROTOCOL_VERSION) {
    throw new PluginSdkError({
      code: "PROTOCOL_VERSION_UNSUPPORTED",
      message: `协议不兼容：需要 ${PLUGIN_PROTOCOL}@${PLUGIN_PROTOCOL_VERSION}`,
      retryable: false,
    })
  }
  if (typeof record.pluginId !== "string" || typeof record.generation !== "string") {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息缺少 pluginId/generation" })
  }
  const kind = record.kind
  if (kind !== "request" && kind !== "notification" && kind !== "response" && kind !== "clientRequest" && kind !== "clientNotification") {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息 kind 非法" })
  }
  // response 通过 requestId 关联，不需要 method；其余消息必须有 method。
  if (kind !== "response") {
    const method = record.method
    if (typeof method !== "string" || method.length === 0) {
      throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "消息缺少 method" })
    }
  }
  if ((kind === "request" || kind === "response" || kind === "clientRequest") && (typeof record.requestId !== "string" || record.requestId.length === 0)) {
    throw new PluginSdkError({ code: "MESSAGE_MALFORMED", message: "请求消息缺少 requestId" })
  }
  return parsed as unknown as PluginMessage
}

export { hasOwn }

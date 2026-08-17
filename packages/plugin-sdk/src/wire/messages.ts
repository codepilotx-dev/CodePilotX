/**
 * Application Plugin Protocol v1 wire 消息（cpx-plugin-rpc@1）。
 *
 * 传输：stdio JSON-RPC（不开放监听端口）。每条消息携带 protocol version、
 * plugin id、generation 与 request id。单条消息上限 1 MiB。
 *
 * 方向约定：
 * - host→plugin：plugin/initialize、plugin/configChanged、plugin/toolExecute、
 *   plugin/commandExecute、plugin/viewRender、plugin/viewAction、
 *   plugin/serviceCall、plugin/quiesce、plugin/shutdown（request）；
 *   以及通知型消息（无 requestId）。
 * - plugin→host：host/log、host/viewInvalidate、host/progress（通知）；
 *   host/serviceCall、host/kvGet、host/kvPut、host/kvDelete、host/credentialUse（request）。
 */

import type { JsonValue } from "../json-schema"

export const PLUGIN_PROTOCOL = "cpx-plugin-rpc@1" as const
export const PLUGIN_PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 1024 * 1024

/** 安全 wire 错误信封：code + message + retryable；禁止原始 stack。 */
export interface PluginWireError {
  code: string
  message: string
  retryable: boolean
}

export type PluginHostRequestMethod =
  | "plugin/initialize"
  | "plugin/configChanged"
  | "plugin/toolExecute"
  | "plugin/commandExecute"
  | "plugin/viewRender"
  | "plugin/viewAction"
  | "plugin/serviceCall"
  | "plugin/quiesce"
  | "plugin/shutdown"

export type PluginHostNotificationMethod = "plugin/event"

export type PluginClientRequestMethod =
  | "host/serviceCall"
  | "host/kvGet"
  | "host/kvPut"
  | "host/kvDelete"
  | "host/credentialUse"

export type PluginClientNotificationMethod = "host/log" | "host/viewInvalidate" | "host/progress"

/** 全部合法方法名的联合（用于运行时动态方法的安全 cast）。 */
export type PluginMethodName =
  | PluginHostRequestMethod
  | PluginHostNotificationMethod
  | PluginClientRequestMethod
  | PluginClientNotificationMethod

/** 消息公共头。 */
export interface PluginMessageHeader {
  protocol: typeof PLUGIN_PROTOCOL
  version: typeof PLUGIN_PROTOCOL_VERSION
  pluginId: string
  /** 插件 generation id；消息必须携带运行时的固定 generation。 */
  generation: string
}

/** host → plugin 请求（插件进程必须响应）。 */
export interface PluginRequestMessage extends PluginMessageHeader {
  kind: "request"
  requestId: string
  method: PluginHostRequestMethod
  params?: JsonValue
}

/** host → plugin 通知（无需响应）。 */
export interface PluginNotificationMessage extends PluginMessageHeader {
  kind: "notification"
  method: PluginHostNotificationMethod
  params?: JsonValue
}

/** plugin → host 的请求响应。 */
export interface PluginResponseMessage extends PluginMessageHeader {
  kind: "response"
  requestId: string
  result?: JsonValue
  error?: PluginWireError
}

/** plugin → host 请求（host 必须响应）。 */
export interface PluginClientRequestMessage extends PluginMessageHeader {
  kind: "clientRequest"
  requestId: string
  method: PluginClientRequestMethod
  params?: JsonValue
}

/** plugin → host 通知。 */
export interface PluginClientNotificationMessage extends PluginMessageHeader {
  kind: "clientNotification"
  method: PluginClientNotificationMethod
  params?: JsonValue
}

export type PluginMessage =
  | PluginRequestMessage
  | PluginNotificationMessage
  | PluginResponseMessage
  | PluginClientRequestMessage
  | PluginClientNotificationMessage

export const PLUGIN_HOST_REQUEST_METHODS: readonly string[] = [
  "plugin/initialize",
  "plugin/configChanged",
  "plugin/toolExecute",
  "plugin/commandExecute",
  "plugin/viewRender",
  "plugin/viewAction",
  "plugin/serviceCall",
  "plugin/quiesce",
  "plugin/shutdown",
]

export const PLUGIN_CLIENT_REQUEST_METHODS: readonly string[] = [
  "host/serviceCall",
  "host/kvGet",
  "host/kvPut",
  "host/kvDelete",
  "host/credentialUse",
]

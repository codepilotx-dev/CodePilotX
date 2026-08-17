/**
 * Application 插件运行上下文：initialize 时 Host 注入的只读信息与能力门面。
 */

import type { PluginManifestV1 } from "../manifest"
import type { JsonValue } from "../json-schema"

/** initialize 响应中 Host 返回的上下文。 */
export interface PluginInitializeResult {
  /** Host 支持的 application capability 列表（如 "tools.v1"、"services.v1"）。 */
  capabilities: string[]
  /** 插件只读配置（JSON Schema 校验后由 Host 下发）。 */
  config: JsonValue
  /** 插件数据目录（按 plugin id 隔离；进程内可读可写）。 */
  dataDir: string
  /** Host 生成的运行时 generation id。 */
  generation: string
  /** 插件声明中实际被批准的权限 id 列表。 */
  grantedPermissions: string[]
}

export interface PluginLogEntry {
  level: "debug" | "info" | "warn" | "error"
  message: string
  details?: JsonValue
}

export interface PluginProgressEntry {
  /** 与 plugin/toolExecute 的 toolCallId 关联；缺省表示通用进度。 */
  toolCallId?: string
  message: string
  completed?: number
  total?: number
}

export interface PluginCredentialUseInput {
  /** 权限声明中的 credential slot id（settings 贡献 key）。 */
  slot: string
  /** 用途说明（审计用）。 */
  purpose: string
}

export interface PluginCredentialUseResult {
  /** 是否授权使用；credential 值只通过返回的引用读取。 */
  granted: boolean
  /** brokered secret 引用；插件用它在 Host 能力中读取，不跨 wire 传明文。 */
  reference?: string
}

/** 插件进程内可用的 Host 能力门面（由 ApplicationPluginClient 实现）。 */
export interface HostServiceFacade {
  log(entry: PluginLogEntry): Promise<void>
  progress(entry: PluginProgressEntry): Promise<void>
  serviceCall(input: { service: string; method: string; params?: JsonValue; timeoutMs?: number }): Promise<JsonValue>
  kvGet(input: { key: string; scope: "global" | "workspace" }): Promise<JsonValue | null>
  kvPut(input: { key: string; value: JsonValue; scope: "global" | "workspace" }): Promise<void>
  kvDelete(input: { key: string; scope: "global" | "workspace" }): Promise<void>
  viewInvalidate(input: { viewId: string }): Promise<void>
  credentialUse(input: PluginCredentialUseInput): Promise<PluginCredentialUseResult>
}

/** 插件收到的完整运行上下文。 */
export interface ApplicationPluginContext {
  manifest: PluginManifestV1
  initialize: PluginInitializeResult
  host: HostServiceFacade
}

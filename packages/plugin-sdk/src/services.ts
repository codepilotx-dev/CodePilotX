/**
 * Application 插件 service 声明与依赖。
 *
 * - Service key 使用 `publisher.service-name@major`；跨插件只按 key 引用。
 * - 版本范围使用 SemVer range（npm 子集，见 engine.ts）。
 * - Application 插件之间禁止直接 import；I/O 必须是 JSON Schema 可表达的数据。
 */

import { PluginSdkError } from "./errors"
import { parseRange, parseVersion } from "./engine"
import type { JsonSchema } from "./json-schema"
import { isJsonValue } from "./json-schema"

/** 完整 service key：`publisher.service-name@major`。 */
export type ServiceKey = `${string}.${string}@${number}`

export const SERVICE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_.-]*@(0|[1-9][0-9]*)$/
export const SERVICE_METHOD_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/

export interface ServiceMethodSchemaV1 {
  input: JsonSchema
  output: JsonSchema
}

export interface ServiceDeclarationV1 {
  key: ServiceKey
  /** provider 实际版本（严格 SemVer）。 */
  version: string
  description?: string
  /** 是否允许同时存在多个 provider（Host 需显式选择 singleton）。 */
  singleton?: boolean
  methods: Record<string, ServiceMethodSchemaV1>
}

export interface ServiceRequirementsV1 {
  /** key -> provider 版本范围；缺失阻止激活（waiting）。 */
  services?: Record<ServiceKey, string>
  /** key -> provider 版本范围；缺失不阻止启动。 */
  optionalServices?: Record<ServiceKey, string>
}

export function isServiceKey(value: unknown): value is ServiceKey {
  return typeof value === "string" && SERVICE_KEY_PATTERN.test(value)
}

export function validateServiceDeclaration(input: unknown): { ok: true; value: ServiceDeclarationV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_SERVICE_DECLARATION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  const key = record.key
  if (!isServiceKey(key)) errors.push("INVALID_SERVICE_KEY")
  const version = record.version
  if (typeof version !== "string" || !parseVersion(version)) errors.push("INVALID_SERVICE_VERSION")
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 300)) errors.push("INVALID_SERVICE_DESCRIPTION")
  if (record.singleton !== undefined && typeof record.singleton !== "boolean") errors.push("INVALID_SERVICE_SINGLETON")
  const methods = record.methods
  if (typeof methods !== "object" || methods === null || Array.isArray(methods)) {
    errors.push("INVALID_SERVICE_METHODS")
  } else {
    const methodEntries = Object.entries(methods as Record<string, unknown>)
    if (methodEntries.length === 0) {
      errors.push("INVALID_SERVICE_METHODS")
    }
    for (const [methodName, method] of methodEntries) {
      if (!SERVICE_METHOD_NAME_PATTERN.test(methodName)) {
        errors.push("INVALID_SERVICE_METHOD_NAME")
        continue
      }
      if (typeof method !== "object" || method === null || Array.isArray(method)) {
        errors.push("INVALID_SERVICE_METHOD")
        continue
      }
      const m = method as Record<string, unknown>
      if (!isJsonValue(m.input) || typeof m.input !== "object" || m.input === null || Array.isArray(m.input)) errors.push("INVALID_SERVICE_METHOD_INPUT")
      if (!isJsonValue(m.output) || typeof m.output !== "object" || m.output === null || Array.isArray(m.output)) errors.push("INVALID_SERVICE_METHOD_OUTPUT")
    }
  }
  for (const field of Object.keys(record)) {
    if (!["key", "version", "description", "singleton", "methods"].includes(field)) errors.push("UNKNOWN_SERVICE_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as ServiceDeclarationV1 }
}

export function validateServiceRequirements(input: unknown): { ok: true; value: ServiceRequirementsV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_SERVICE_REQUIREMENTS"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  const checkMap = (field: "services" | "optionalServices") => {
    const value = record[field]
    if (value === undefined) return
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push("INVALID_SERVICE_REQUIREMENTS")
      return
    }
    for (const [key, range] of Object.entries(value as Record<string, unknown>)) {
      if (!isServiceKey(key)) {
        errors.push("INVALID_SERVICE_KEY")
        continue
      }
      if (typeof range !== "string" || !parseRange(range)) errors.push("INVALID_SERVICE_VERSION_RANGE")
    }
  }
  checkMap("services")
  checkMap("optionalServices")
  for (const field of Object.keys(record)) {
    if (!["services", "optionalServices"].includes(field)) errors.push("UNKNOWN_SERVICE_REQUIREMENTS_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as ServiceRequirementsV1 }
}

/** 断言版本；非法时抛 PluginSdkError（供 Manifest 校验聚合）。 */
export function assertServiceDeclaration(input: unknown): ServiceDeclarationV1 {
  const result = validateServiceDeclaration(input)
  if (!result.ok) throw new PluginSdkError({ code: "INVALID_MANIFEST", message: "Service 声明非法", details: result.errors })
  return result.value
}

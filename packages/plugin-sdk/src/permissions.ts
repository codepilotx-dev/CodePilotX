/**
 * 插件权限声明（Manifest permissions）。
 *
 * Process permission 只约束 Host broker 能力，不构成 OS 沙箱；插件本体始终
 * 按完全可信本机代码处理。permission id 语义由 Host 权限策略解释，SDK 只
 * 保证结构化、可审计的声明。
 */

import { PluginSdkError } from "./errors"
import type { JsonValue } from "./json-schema"

/** 权限作用域：workspace = 仅当前工作区；global = 全局。 */
export type PluginPermissionScope = "workspace" | "global"

export interface PluginPermissionRequestV1 {
  /** 稳定权限 id，如 "filesystem.read"、"network.request"。 */
  id: string
  /** 面向用户的申请理由。 */
  reason?: string
  scope?: PluginPermissionScope
}

export const PLUGIN_PERMISSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/
export const PLUGIN_PERMISSION_MAX_REASON = 200

/** 校验单个权限声明；非法时返回错误码列表。 */
export function validatePermissionRequest(
  permission: unknown,
): { ok: true; value: PluginPermissionRequestV1 } | { ok: false; errors: string[] } {
  if (typeof permission !== "object" || permission === null || Array.isArray(permission)) {
    return { ok: false, errors: ["INVALID_PERMISSION_REQUEST"] }
  }
  const record = permission as Record<string, unknown>
  const errors: string[] = []
  const id = record.id
  if (typeof id !== "string" || !PLUGIN_PERMISSION_ID_PATTERN.test(id) || id.length > 128) {
    errors.push("INVALID_PERMISSION_ID")
  }
  if (record.reason !== undefined && (typeof record.reason !== "string" || record.reason.length > PLUGIN_PERMISSION_MAX_REASON)) {
    errors.push("INVALID_PERMISSION_REASON")
  }
  if (record.scope !== undefined && record.scope !== "workspace" && record.scope !== "global") {
    errors.push("INVALID_PERMISSION_SCOPE")
  }
  // 拒绝未知字段，保持 ABI 严格。
  for (const key of Object.keys(record)) {
    if (key !== "id" && key !== "reason" && key !== "scope") errors.push("UNKNOWN_PERMISSION_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  const value: PluginPermissionRequestV1 = {
    id: id as string,
    ...(record.reason !== undefined ? { reason: record.reason as string } : {}),
    ...(record.scope !== undefined ? { scope: record.scope as PluginPermissionScope } : {}),
  }
  return { ok: true, value }
}

export function validatePermissions(input: unknown): {
  ok: true
  value: PluginPermissionRequestV1[]
} | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) return { ok: false, errors: ["INVALID_PERMISSIONS"] }
  const errors: string[] = []
  const value: PluginPermissionRequestV1[] = []
  for (const item of input) {
    const result = validatePermissionRequest(item)
    if (result.ok) {
      value.push(result.value)
    } else {
      errors.push(...result.errors)
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value }
}

/** 便捷断言版本：非法时抛 PluginSdkError（用于 Manifest 校验错误聚合）。 */
export function assertPermissions(input: unknown): PluginPermissionRequestV1[] {
  const result = validatePermissions(input)
  if (!result.ok) {
    throw new PluginSdkError({ code: "INVALID_MANIFEST", message: "Manifest permissions 非法", details: result.errors })
  }
  return result.value
}

/** 保持 JsonValue 引用，便于 schema 文档导出（无实际用途，仅类型锚点）。 */
export type PermissionJson = JsonValue

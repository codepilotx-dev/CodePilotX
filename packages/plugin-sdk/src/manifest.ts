/**
 * Plugin Manifest v1 —— 唯一公共 ABI 入口。
 *
 * 固定规则：
 * - Plugin ID 必须是 publisher 命名空间（publisher.id）。
 * - tier/runtime 组合受约束：application 不能声明 system runtime，
 *   system 不能声明 process runtime。
 * - engines.pluginApi 必须与 SDK 的 PLUGIN_API_RANGE 兼容。
 * - files 值必须是文件 sha256（64 位 hex）；键必须是包内相对路径。
 * - 未知 required 贡献由 Host 激活时拒绝；未知 optional 贡献忽略并诊断。
 */

import { PluginSdkError } from "./errors"
import { checkPluginApiCompatibility, parseVersion } from "./engine"
import { isJsonValue } from "./json-schema"
import {
  validateMcpServerContribution,
  validatePromptCommandContribution,
  validateSettingsContribution,
  validateSkillContribution,
  validateToolContribution,
  validateWorkbenchViewContribution,
  type McpServerContributionV1,
  type PromptCommandContributionV1,
  type SettingsContributionV1,
  type SkillContributionV1,
  type ToolContributionV1,
  type WorkbenchViewContributionV1,
} from "./contributions"
import { validatePermissions, type PluginPermissionRequestV1 } from "./permissions"
import {
  validateServiceDeclaration,
  validateServiceRequirements,
  type ServiceDeclarationV1,
  type ServiceRequirementsV1,
} from "./services"
import type { JsonSchema } from "./json-schema"

export const MANIFEST_SCHEMA_VERSION = 1

export type PluginTier = "application" | "system"

export type PluginRuntimeV1 =
  | { kind: "declarative" }
  | { kind: "process"; protocol: "cpx-plugin-rpc@1"; executable: string; args?: string[] }
  | { kind: "system"; entry: string }

export interface PluginManifestV1 {
  schemaVersion: 1
  /** publisher 命名空间 ID。 */
  id: string
  /** 严格 SemVer。 */
  version: string
  displayName: string
  description: string
  publisher: string
  engines: {
    /** 必须匹配 "^1"（当前 SDK pluginApi）。 */
    pluginApi: string
    codepilotx?: string
  }
  tier: PluginTier
  runtime: PluginRuntimeV1
  contributes?: {
    tools?: ToolContributionV1[]
    skills?: SkillContributionV1[]
    mcpServers?: McpServerContributionV1[]
    promptCommands?: PromptCommandContributionV1[]
    settings?: SettingsContributionV1[]
    workbenchViews?: WorkbenchViewContributionV1[]
    services?: ServiceDeclarationV1[]
  }
  requires?: ServiceRequirementsV1
  permissions?: PluginPermissionRequestV1[]
  /** 内联 JSON Schema（Draft-07 子集）。 */
  configSchema?: JsonSchema
  /** 包内相对路径 -> sha256。 */
  files: Record<string, string>
}

export const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/
export const FILE_PATH_PATTERN = /^[A-Za-z0-9_.\-/]+$/
export const MAX_MANIFEST_FILES = 10_000

/** Manifest v1 顶层字段白名单；JSON Schema 一致性测试与未知字段检查共用。 */
export const MANIFEST_TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "id",
  "version",
  "displayName",
  "description",
  "publisher",
  "engines",
  "tier",
  "runtime",
  "contributes",
  "requires",
  "permissions",
  "configSchema",
  "files",
] as const

const validateStringField = (record: Record<string, unknown>, field: string, maxLength: number, error: string): boolean => {
  const value = record[field]
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false
  void error
  return true
}

export interface ManifestValidationError {
  code: string
  message: string
  path: string
}

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifestV1 }
  | { ok: false; errors: ManifestValidationError[] }

const error = (path: string, code: string, message: string): ManifestValidationError => ({ code, message, path })

/** 校验 Manifest；返回结构化诊断（安全错误码，不携带原始值）。 */
export function validateManifest(input: unknown): ManifestValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [error("$", "INVALID_MANIFEST", "Manifest 必须是 JSON 对象")] }
  }
  const record = input as Record<string, unknown>
  const errors: ManifestValidationError[] = []

  if (record.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(error("schemaVersion", "UNSUPPORTED_SCHEMA_VERSION", `不支持的 schemaVersion：${String(record.schemaVersion)}`))
  }
  if (typeof record.id !== "string" || !PLUGIN_ID_PATTERN.test(record.id)) {
    errors.push(error("id", "INVALID_PLUGIN_ID", "Plugin id 必须是 publisher 命名空间（publisher.name）"))
  }
  if (typeof record.version !== "string" || record.version.startsWith("v") || record.version.startsWith("V") || !parseVersion(record.version)) {
    errors.push(error("version", "INVALID_SEMVER", "version 必须是严格 SemVer"))
  }
  if (!validateStringField(record, "displayName", 120, "INVALID_DISPLAY_NAME")) {
    errors.push(error("displayName", "INVALID_MANIFEST", "displayName 必须是非空字符串（≤120 字符）"))
  }
  if (!validateStringField(record, "description", 1_000, "INVALID_DESCRIPTION")) {
    errors.push(error("description", "INVALID_MANIFEST", "description 必须是非空字符串（≤1000 字符）"))
  }
  if (!validateStringField(record, "publisher", 120, "INVALID_PUBLISHER")) {
    errors.push(error("publisher", "INVALID_MANIFEST", "publisher 必须是非空字符串（≤120 字符）"))
  }

  const engines = record.engines
  if (typeof engines !== "object" || engines === null || Array.isArray(engines)) {
    errors.push(error("engines", "INVALID_MANIFEST", "engines 必须是对象"))
  } else {
    const engineRecord = engines as Record<string, unknown>
    if (typeof engineRecord.pluginApi !== "string" || engineRecord.pluginApi.length === 0) {
      errors.push(error("engines.pluginApi", "INVALID_ENGINE_RANGE", "engines.pluginApi 缺失"))
    } else {
      const compatibility = checkPluginApiCompatibility(engineRecord.pluginApi)
      if (!compatibility.compatible) {
        errors.push(error("engines.pluginApi", compatibility.error!.code, compatibility.error!.message))
      }
    }
    if (engineRecord.codepilotx !== undefined && typeof engineRecord.codepilotx !== "string") {
      errors.push(error("engines.codepilotx", "INVALID_ENGINE_RANGE", "engines.codepilotx 必须是字符串 range"))
    }
  }

  const tier = record.tier
  if (tier !== "application" && tier !== "system") {
    errors.push(error("tier", "INVALID_MANIFEST", "tier 必须是 application 或 system"))
  }

  const runtime = record.runtime
  if (typeof runtime !== "object" || runtime === null || Array.isArray(runtime)) {
    errors.push(error("runtime", "INVALID_MANIFEST", "runtime 必须是对象"))
  } else {
    const runtimeRecord = runtime as Record<string, unknown>
    if (runtimeRecord.kind === "declarative") {
      // 合法
    } else if (runtimeRecord.kind === "process") {
      if (runtimeRecord.protocol !== "cpx-plugin-rpc@1") {
        errors.push(error("runtime.protocol", "PROTOCOL_VERSION_UNSUPPORTED", "protocol 必须是 cpx-plugin-rpc@1"))
      }
      if (typeof runtimeRecord.executable !== "string" || runtimeRecord.executable.length === 0 || runtimeRecord.executable.length > 512) {
        errors.push(error("runtime.executable", "INVALID_MANIFEST", "executable 必须是非空字符串"))
      }
      if (runtimeRecord.args !== undefined && (!Array.isArray(runtimeRecord.args) || runtimeRecord.args.some((arg) => typeof arg !== "string"))) {
        errors.push(error("runtime.args", "INVALID_MANIFEST", "args 必须是字符串数组"))
      }
    } else if (runtimeRecord.kind === "system") {
      if (typeof runtimeRecord.entry !== "string" || runtimeRecord.entry.length === 0 || runtimeRecord.entry.length > 512) {
        errors.push(error("runtime.entry", "INVALID_MANIFEST", "system entry 必须是非空字符串"))
      }
    } else {
      errors.push(error("runtime.kind", "INVALID_MANIFEST", "runtime.kind 非法"))
    }
    // tier/runtime 一致性。
    if (tier === "application" && runtimeRecord.kind === "system") {
      errors.push(error("runtime.kind", "TIER_RUNTIME_MISMATCH", "application 插件不能声明 system runtime"))
    }
    if (tier === "system" && (runtimeRecord.kind === "process" || runtimeRecord.kind === "declarative")) {
      errors.push(error("runtime.kind", "TIER_RUNTIME_MISMATCH", "system 插件不能声明 process/declarative runtime"))
    }
  }

  const contributes = record.contributes
  if (contributes !== undefined) {
    if (typeof contributes !== "object" || contributes === null || Array.isArray(contributes)) {
      errors.push(error("contributes", "INVALID_MANIFEST", "contributes 必须是对象"))
    } else {
      const c = contributes as Record<string, unknown>
      const validateList = (field: string, validator: (item: unknown) => { ok: boolean; errors: string[] }) => {
        const value = c[field]
        if (value === undefined) return
        if (!Array.isArray(value)) {
          errors.push(error(`contributes.${field}`, "INVALID_MANIFEST", `${field} 必须是数组`))
          return
        }
        value.forEach((item, index) => {
          const result = validator(item)
          if (!result.ok) errors.push(error(`contributes.${field}[${index}]`, "INVALID_MANIFEST", `${field} 贡献非法：${result.errors.join(";")}`))
        })
      }
      validateList("tools", (item) => {
        const result = validateToolContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("skills", (item) => {
        const result = validateSkillContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("mcpServers", (item) => {
        const result = validateMcpServerContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("promptCommands", (item) => {
        const result = validatePromptCommandContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("settings", (item) => {
        const result = validateSettingsContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("workbenchViews", (item) => {
        const result = validateWorkbenchViewContribution(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      validateList("services", (item) => {
        const result = validateServiceDeclaration(item)
        return { ok: result.ok, errors: result.ok ? [] : result.errors }
      })
      for (const key of Object.keys(c)) {
        if (!["tools", "skills", "mcpServers", "promptCommands", "settings", "workbenchViews", "services"].includes(key)) {
          errors.push(error(`contributes.${key}`, "UNKNOWN_CONTRIBUTION", `未知贡献类型 ${key}`))
        }
      }
    }
  }

  if (record.requires !== undefined) {
    const requirements = validateServiceRequirements(record.requires)
    if (!requirements.ok) {
      errors.push(error("requires", "INVALID_MANIFEST", `requires 非法：${requirements.errors.join(";")}`))
    }
  }

  if (record.permissions !== undefined) {
    const permissions = validatePermissions(record.permissions)
    if (!permissions.ok) {
      errors.push(error("permissions", "INVALID_MANIFEST", `permissions 非法：${permissions.errors.join(";")}`))
    }
  }

  if (record.configSchema !== undefined && !isJsonValue(record.configSchema)) {
    errors.push(error("configSchema", "INVALID_CONFIG_SCHEMA", "configSchema 必须是 JSON Schema 文档"))
  }

  const files = record.files
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    errors.push(error("files", "INVALID_MANIFEST", "files 必须是对象"))
  } else {
    const fileEntries = Object.entries(files as Record<string, unknown>)
    if (fileEntries.length > MAX_MANIFEST_FILES) {
      errors.push(error("files", "INVALID_MANIFEST", `files 条目数超过上限 ${MAX_MANIFEST_FILES}`))
    }
    for (const [path, hash] of fileEntries) {
      if (!FILE_PATH_PATTERN.test(path) || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
        errors.push(error("files", "INVALID_FILE_PATH", "files 键必须是包内相对路径（禁止绝对路径、.. 与反斜杠）"))
        continue
      }
      if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
        errors.push(error("files", "INVALID_FILE_HASH", "files 值必须是 64 位 hex sha256"))
      }
    }
  }

  for (const key of Object.keys(record)) {
    if (!MANIFEST_TOP_LEVEL_FIELDS.includes(key as (typeof MANIFEST_TOP_LEVEL_FIELDS)[number])) {
      errors.push(error(key, "UNKNOWN_MANIFEST_FIELD", `未知字段 ${key}`))
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: record as unknown as PluginManifestV1 }
}

/** 断言版本；非法时抛 PluginSdkError（错误只含安全 code）。 */
export function parseManifest(input: unknown): PluginManifestV1 {
  const result = validateManifest(input)
  if (!result.ok) {
    const first = result.errors[0]!
    throw new PluginSdkError({ code: first.code as never, message: first.message, details: result.errors })
  }
  return result.manifest
}

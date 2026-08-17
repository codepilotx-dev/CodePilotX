/**
 * Application 插件贡献声明（Manifest contributes）。
 *
 * 所有贡献都是声明式数据（JSON 可表达）。process 插件的运行时行为通过
 * Application Plugin Protocol v1 的 host 方法（toolExecute 等）暴露，这里
 * 只声明目录与形状。
 */

import { PluginSdkError } from "./errors"
import type { JsonSchema, JsonValue } from "./json-schema"
import { isJsonValue } from "./json-schema"

// ── Tools ────────────────────────────────────────────────────────────────

/** 插件工具能力声明；与 Host ToolCapabilities 对齐但只读声明。 */
export interface PluginToolCapabilitiesV1 {
  filesystem?: "none" | "read" | "workspace-write" | "host-write"
  network?: "none" | "declared" | "unrestricted"
  process?: boolean
  externalState?: boolean
  userInteraction?: boolean
}

/**
 * 插件工具声明。
 * 注意：approvalStrategy 不允许 "never-review" —— 插件不能绕过 Host 权限链。
 */
export interface ToolContributionV1 {
  /** 暴露给模型的 sdkName；必须与 plugin/<pluginId>/<toolName> 归一化后的名字一致。 */
  name: string
  description: string
  inputSchema: JsonSchema
  approvalStrategy?: "policy" | "always-review"
  visibility?: "eager" | "deferred"
  capabilities?: PluginToolCapabilitiesV1
}

export const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
export const TOOL_DESCRIPTION_MAX = 1_000

// ── Skills ───────────────────────────────────────────────────────────────

/** 插件只声明包内 skill root；资源读取保持既有 containment 与 allowedTools 上限。 */
export interface SkillContributionV1 {
  /** 相对包根的 skill 目录路径（/ 分隔，禁止 .. 与绝对路径）。 */
  root: string
  name?: string
  description?: string
  /** 精确 allowlist；只能收紧 Host 策略。 */
  allowedTools?: string[]
}

// ── MCP ──────────────────────────────────────────────────────────────────

export type McpServerContributionV1 =
  | {
      name: string
      transport: { kind: "stdio"; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
      toolPolicy?: { allow?: string[]; deny?: string[] }
    }
  | {
      name: string
      transport: { kind: "http" | "sse"; url: string }
      toolPolicy?: { allow?: string[]; deny?: string[] }
    }

// ── Prompt Commands ──────────────────────────────────────────────────────

/**
 * 插件 slash command。两种形态二选一（至少一个）：
 * - promptTemplate：向当前模型上下文插入模板；
 * - action：调用插件自身或另一个插件声明的 service。
 * 模板内容按 external/untrusted authority 处理，长度由 Host 限制。
 */
export interface PromptCommandContributionV1 {
  id: string
  title: string
  description?: string
  promptTemplate?: string
  action?: {
    /** 完整 service key（含 @major）。 */
    service: string
    method: string
    params?: JsonValue
  }
}

export const PROMPT_COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const PROMPT_TEMPLATE_MAX = 8_000

// ── Settings ─────────────────────────────────────────────────────────────

export type PluginSettingControlV1 = "string" | "multiline" | "number" | "boolean" | "enum" | "credential"

export interface SettingsContributionV1 {
  /** 设置键；Host 按 plugin id 命名空间隔离存储。 */
  key: string
  title: string
  description?: string
  control: PluginSettingControlV1
  /** boolean/enum 的可选默认值；credential 不允许默认值。 */
  default?: JsonValue
  /** enum 的候选值。 */
  enumValues?: string[]
  /** 敏感值走 Host credential broker，不进入插件配置明文。 */
  sensitive?: boolean
}

export const SETTINGS_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/

// ── Workbench Views ──────────────────────────────────────────────────────

export interface WorkbenchViewContributionV1 {
  id: string
  title: string
  description?: string
  /** 图标名（Host 图标库内）；未知图标回退默认图标。 */
  icon?: string
}

export const VIEW_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

// ── 校验 ────────────────────────────────────────────────────────────────

export function validateToolContribution(input: unknown): { ok: true; value: ToolContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_TOOL_CONTRIBUTION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  const name = record.name
  if (typeof name !== "string" || !TOOL_NAME_PATTERN.test(name)) errors.push("INVALID_TOOL_NAME")
  const description = record.description
  if (typeof description !== "string" || description.length === 0 || description.length > TOOL_DESCRIPTION_MAX) errors.push("INVALID_TOOL_DESCRIPTION")
  if (!isJsonValue(record.inputSchema) || typeof record.inputSchema !== "object" || record.inputSchema === null || Array.isArray(record.inputSchema)) {
    errors.push("INVALID_TOOL_INPUT_SCHEMA")
  }
  if (record.approvalStrategy !== undefined && record.approvalStrategy !== "policy" && record.approvalStrategy !== "always-review") {
    // 显式禁止 never-review：插件不得绕过 Host 权限链。
    errors.push("INVALID_TOOL_APPROVAL_STRATEGY")
  }
  if (record.visibility !== undefined && record.visibility !== "eager" && record.visibility !== "deferred") {
    errors.push("INVALID_TOOL_VISIBILITY")
  }
  if (record.capabilities !== undefined) {
    if (typeof record.capabilities !== "object" || record.capabilities === null || Array.isArray(record.capabilities)) {
      errors.push("INVALID_TOOL_CAPABILITIES")
    } else {
      const caps = record.capabilities as Record<string, unknown>
      if (caps.filesystem !== undefined && !["none", "read", "workspace-write", "host-write"].includes(caps.filesystem as string)) errors.push("INVALID_TOOL_CAPABILITIES")
      if (caps.network !== undefined && !["none", "declared", "unrestricted"].includes(caps.network as string)) errors.push("INVALID_TOOL_CAPABILITIES")
      if (caps.process !== undefined && typeof caps.process !== "boolean") errors.push("INVALID_TOOL_CAPABILITIES")
      if (caps.externalState !== undefined && typeof caps.externalState !== "boolean") errors.push("INVALID_TOOL_CAPABILITIES")
      if (caps.userInteraction !== undefined && typeof caps.userInteraction !== "boolean") errors.push("INVALID_TOOL_CAPABILITIES")
    }
  }
  for (const key of Object.keys(record)) {
    if (!["name", "description", "inputSchema", "approvalStrategy", "visibility", "capabilities"].includes(key)) errors.push("UNKNOWN_TOOL_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  const value: ToolContributionV1 = {
    name: name as string,
    description: description as string,
    inputSchema: record.inputSchema as JsonSchema,
  }
  if (record.approvalStrategy !== undefined) {
    value.approvalStrategy = record.approvalStrategy as "policy" | "always-review"
  }
  if (record.visibility !== undefined) {
    value.visibility = record.visibility as "eager" | "deferred"
  }
  if (record.capabilities !== undefined) {
    value.capabilities = record.capabilities as PluginToolCapabilitiesV1
  }
  return { ok: true, value }
}

const isRelativePackagePath = (value: unknown): value is string =>
  typeof value === "string"
  && value.length > 0
  && !value.startsWith("/")
  && !value.startsWith("\\")
  && !/^[A-Za-z]:/.test(value)
  && !value.split("/").includes("..")

export function validateSkillContribution(input: unknown): { ok: true; value: SkillContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_SKILL_CONTRIBUTION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  if (!isRelativePackagePath(record.root)) errors.push("INVALID_SKILL_ROOT")
  if (record.name !== undefined && (typeof record.name !== "string" || record.name.length === 0 || record.name.length > 128)) errors.push("INVALID_SKILL_NAME")
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 1_000)) errors.push("INVALID_SKILL_DESCRIPTION")
  if (record.allowedTools !== undefined) {
    if (!Array.isArray(record.allowedTools) || record.allowedTools.some((tool) => typeof tool !== "string" || tool.length === 0 || tool.length > 128)) {
      errors.push("INVALID_SKILL_ALLOWED_TOOLS")
    }
  }
  for (const key of Object.keys(record)) {
    if (!["root", "name", "description", "allowedTools"].includes(key)) errors.push("UNKNOWN_SKILL_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  const value: SkillContributionV1 = {
    root: record.root as string,
    ...(record.name !== undefined ? { name: record.name as string } : {}),
    ...(record.description !== undefined ? { description: record.description as string } : {}),
    ...(record.allowedTools !== undefined ? { allowedTools: record.allowedTools as string[] } : {}),
  }
  return { ok: true, value }
}

export function validateMcpServerContribution(input: unknown): { ok: true; value: McpServerContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_MCP_CONTRIBUTION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  const name = record.name
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) errors.push("INVALID_MCP_NAME")
  const transport = record.transport
  if (typeof transport !== "object" || transport === null || Array.isArray(transport)) {
    errors.push("INVALID_MCP_TRANSPORT")
  } else {
    const t = transport as Record<string, unknown>
    if (t.kind === "stdio") {
      if (typeof t.command !== "string" || t.command.length === 0 || t.command.length > 512) errors.push("INVALID_MCP_TRANSPORT")
      if (t.args !== undefined && (!Array.isArray(t.args) || t.args.some((arg) => typeof arg !== "string"))) errors.push("INVALID_MCP_TRANSPORT")
      if (t.cwd !== undefined && typeof t.cwd !== "string") errors.push("INVALID_MCP_TRANSPORT")
      if (t.env !== undefined && (typeof t.env !== "object" || t.env === null || Array.isArray(t.env))) errors.push("INVALID_MCP_TRANSPORT")
    } else if (t.kind === "http" || t.kind === "sse") {
      if (typeof t.url !== "string" || !/^https?:\/\//.test(t.url) || t.url.length > 2_048) errors.push("INVALID_MCP_TRANSPORT")
    } else {
      errors.push("INVALID_MCP_TRANSPORT")
    }
  }
  const toolPolicy = record.toolPolicy
  if (toolPolicy !== undefined) {
    if (typeof toolPolicy !== "object" || toolPolicy === null || Array.isArray(toolPolicy)) {
      errors.push("INVALID_MCP_TOOL_POLICY")
    } else {
      const policy = toolPolicy as Record<string, unknown>
      const checkList = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0)
      if (policy.allow !== undefined && !checkList(policy.allow)) errors.push("INVALID_MCP_TOOL_POLICY")
      if (policy.deny !== undefined && !checkList(policy.deny)) errors.push("INVALID_MCP_TOOL_POLICY")
    }
  }
  for (const key of Object.keys(record)) {
    if (!["name", "transport", "toolPolicy"].includes(key)) errors.push("UNKNOWN_MCP_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as McpServerContributionV1 }
}

export function validatePromptCommandContribution(input: unknown): { ok: true; value: PromptCommandContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_PROMPT_COMMAND"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  if (typeof record.id !== "string" || !PROMPT_COMMAND_ID_PATTERN.test(record.id)) errors.push("INVALID_PROMPT_COMMAND_ID")
  if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > 80) errors.push("INVALID_PROMPT_COMMAND_TITLE")
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 300)) errors.push("INVALID_PROMPT_COMMAND_DESCRIPTION")
  const hasTemplate = typeof record.promptTemplate === "string" && record.promptTemplate.length > 0 && record.promptTemplate.length <= PROMPT_TEMPLATE_MAX
  if (record.promptTemplate !== undefined && !hasTemplate) errors.push("INVALID_PROMPT_COMMAND_TEMPLATE")
  let actionValid = false
  if (record.action !== undefined) {
    const action = record.action as Record<string, unknown>
    if (typeof action !== "object" || action === null || Array.isArray(action)) {
      errors.push("INVALID_PROMPT_COMMAND_ACTION")
    } else {
      if (typeof action.service !== "string" || !action.service.includes(".")) errors.push("INVALID_PROMPT_COMMAND_ACTION")
      if (typeof action.method !== "string" || action.method.length === 0) errors.push("INVALID_PROMPT_COMMAND_ACTION")
      if (action.params !== undefined && !isJsonValue(action.params)) errors.push("INVALID_PROMPT_COMMAND_ACTION")
      actionValid = true
    }
  }
  if (!hasTemplate && !actionValid) errors.push("PROMPT_COMMAND_REQUIRES_TEMPLATE_OR_ACTION")
  for (const key of Object.keys(record)) {
    if (!["id", "title", "description", "promptTemplate", "action"].includes(key)) errors.push("UNKNOWN_PROMPT_COMMAND_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as PromptCommandContributionV1 }
}

export function validateSettingsContribution(input: unknown): { ok: true; value: SettingsContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_SETTINGS_CONTRIBUTION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  if (typeof record.key !== "string" || !SETTINGS_KEY_PATTERN.test(record.key)) errors.push("INVALID_SETTINGS_KEY")
  if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > 80) errors.push("INVALID_SETTINGS_TITLE")
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 300)) errors.push("INVALID_SETTINGS_DESCRIPTION")
  const control = record.control
  if (typeof control !== "string" || !["string", "multiline", "number", "boolean", "enum", "credential"].includes(control)) {
    errors.push("INVALID_SETTINGS_CONTROL")
  }
  if (record.default !== undefined && !isJsonValue(record.default)) errors.push("INVALID_SETTINGS_DEFAULT")
  if (record.enumValues !== undefined) {
    if (!Array.isArray(record.enumValues) || record.enumValues.length === 0 || record.enumValues.some((item) => typeof item !== "string")) {
      errors.push("INVALID_SETTINGS_ENUM")
    }
  }
  if (record.sensitive !== undefined && typeof record.sensitive !== "boolean") errors.push("INVALID_SETTINGS_SENSITIVE")
  if (control === "credential" && record.default !== undefined) errors.push("INVALID_SETTINGS_CREDENTIAL_DEFAULT")
  if (control === "enum" && record.enumValues === undefined) errors.push("INVALID_SETTINGS_ENUM_REQUIRED")
  for (const key of Object.keys(record)) {
    if (!["key", "title", "description", "control", "default", "enumValues", "sensitive"].includes(key)) errors.push("UNKNOWN_SETTINGS_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as SettingsContributionV1 }
}

export function validateWorkbenchViewContribution(input: unknown): { ok: true; value: WorkbenchViewContributionV1 } | { ok: false; errors: string[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["INVALID_VIEW_CONTRIBUTION"] }
  const record = input as Record<string, unknown>
  const errors: string[] = []
  if (typeof record.id !== "string" || !VIEW_ID_PATTERN.test(record.id)) errors.push("INVALID_VIEW_ID")
  if (typeof record.title !== "string" || record.title.length === 0 || record.title.length > 80) errors.push("INVALID_VIEW_TITLE")
  if (record.description !== undefined && (typeof record.description !== "string" || record.description.length > 300)) errors.push("INVALID_VIEW_DESCRIPTION")
  if (record.icon !== undefined && (typeof record.icon !== "string" || record.icon.length === 0 || record.icon.length > 64)) errors.push("INVALID_VIEW_ICON")
  for (const key of Object.keys(record)) {
    if (!["id", "title", "description", "icon"].includes(key)) errors.push("UNKNOWN_VIEW_FIELD")
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: record as unknown as WorkbenchViewContributionV1 }
}

/** 断言版本；非法时抛 PluginSdkError（供 Manifest 校验聚合）。 */
export function assertToolContribution(input: unknown): ToolContributionV1 {
  const result = validateToolContribution(input)
  if (!result.ok) throw new PluginSdkError({ code: "INVALID_MANIFEST", message: "Tool 贡献非法", details: result.errors })
  return result.value
}

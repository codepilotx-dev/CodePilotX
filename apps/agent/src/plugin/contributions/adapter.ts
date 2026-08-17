/**
 * 插件贡献适配器：把 active 插件的声明贡献接入 Agent 运行时。
 *
 * - Tools：转换为 ToolDefinition，经 RuntimeContributionBuilders 在快照冻结前
 *   注册 → 继续走 ToolCatalog → ToolExposurePlan → ToolExecutor →
 *   PermissionDecisionEngine 统一管线；执行体只转发 plugin/toolExecute，
 *   插件永远拿不到其他工具的真实 execute。
 * - KV / serviceCall / credentialUse：Host broker 处理器（supervisor 注册）。
 * - MCP：转换为现有 MCP declaration（OAuth/allow-deny/审批/lease 复用现有机制）。
 * - Skills：声明包内 skill root（读取 containment 由 SkillService 保证）。
 * - Prompt Commands / Settings / Workbench Views：贡献目录查询（PR 6 UI 消费）。
 */

import { dirname, isAbsolute, join } from "node:path"
import { z } from "zod"
import Ajv from "ajv"
import type { PluginManifestV1 } from "@codepilotx/plugin-sdk"
import { PluginRepository, type StoredPluginPackage } from "../../storage/repositories/plugin-repository"
import type { PluginRuntimeManager } from "../runtime/manager"
import type { ToolDefinition, ToolOrigin } from "../../tool/ToolRegistry"
import type { RuntimeContributionBuilders } from "../../runtime/RuntimeContribution"
import { AgentError } from "../../domain"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"

export interface PluginToolContributionV1 {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  approvalStrategy?: "policy" | "always-review"
  visibility?: "eager" | "deferred"
  capabilities?: {
    filesystem?: "none" | "read" | "workspace-write" | "host-write"
    network?: "none" | "declared" | "unrestricted"
    process?: boolean
    externalState?: boolean
    userInteraction?: boolean
  }
}

export interface PluginPromptCommandV1 {
  id: string
  title: string
  description?: string
  promptTemplate?: string
  action?: { service: string; method: string; params?: unknown }
}

export interface PluginSettingV1 {
  key: string
  title: string
  description?: string
  control: "string" | "multiline" | "number" | "boolean" | "enum" | "credential"
  default?: unknown
  enumValues?: string[]
  sensitive?: boolean
}

export interface PluginViewV1 {
  id: string
  title: string
  description?: string
  icon?: string
}

export interface PluginMcpV1 {
  name: string
  transport:
    | { kind: "stdio"; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
    | { kind: "http" | "sse"; url: string }
  toolPolicy?: { allow?: string[]; deny?: string[] }
}

export interface PluginSkillV1 {
  root: string
  name?: string
  description?: string
  allowedTools?: string[]
}

export interface PluginContributionList {
  tools: Array<{ pluginId: string; tool: PluginToolContributionV1 }>
  skills: Array<{ pluginId: string; skill: PluginSkillV1 }>
  mcpServers: Array<{ pluginId: string; server: PluginMcpV1 }>
  promptCommands: Array<{ pluginId: string; command: PluginPromptCommandV1 }>
  settings: Array<{ pluginId: string; setting: PluginSettingV1 }>
  workbenchViews: Array<{ pluginId: string; view: PluginViewV1 }>
}

export type BrokerRespond = (result: unknown, error?: { code: string; message: string; retryable: boolean }) => void
export type BrokerHandler = (method: string, params: unknown, respond: BrokerRespond) => void

export interface PluginMcpDeclaration {
  name: string
  pluginId: string
  declaration: {
    name: string
    scope: "user"
    enabled: true
    transport:
      | { type: "stdio"; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
      | { type: "http"; url: string }
    required: false
    enabledTools?: string[]
    disabledTools?: string[]
    defaultToolsApprovalMode?: "auto" | "prompt" | "writes" | "approve"
  }
}

const allModes = ["chat", "plan"] as const
const allProfiles = ["main", "default", "explorer", "worker"] as const

const ajv = new Ajv({ strict: false, allErrors: true })

/** 插件工具 sdkName：`plugin.<pluginId>.<toolName>`。 */
export const pluginToolSdkName = (pluginId: string, toolName: string) => `plugin.${pluginId}.${toolName}`

export class PluginContributionAdapter {
  private readonly repo: PluginRepository

  constructor(
    private readonly options: {
      db: AgentDatabase
      manager: PluginRuntimeManager
    },
  ) {
    this.repo = new PluginRepository(options.db)
  }

  // ── turn 级工具注册（快照冻结前调用） ─────────────────────────────────

  registerTurnContributions(builders: RuntimeContributionBuilders): void {
    for (const { plugin, manifest } of this.options.manager.activePlugins()) {
      for (const tool of manifest.contributes?.tools ?? []) {
        builders.addToolDefinition(this.toolDefinition(plugin, tool as unknown as PluginToolContributionV1))
      }
    }
  }

  // ── 贡献目录（实时查询） ──────────────────────────────────────────────

  contributionList(): PluginContributionList {
    const result: PluginContributionList = {
      tools: [],
      skills: [],
      mcpServers: [],
      promptCommands: [],
      settings: [],
      workbenchViews: [],
    }
    for (const { plugin, manifest } of this.options.manager.activePlugins()) {
      for (const tool of manifest.contributes?.tools ?? []) {
        result.tools.push({ pluginId: plugin.pluginId, tool: tool as unknown as PluginToolContributionV1 })
      }
      for (const skill of manifest.contributes?.skills ?? []) {
        result.skills.push({ pluginId: plugin.pluginId, skill: skill as unknown as PluginSkillV1 })
      }
      for (const server of manifest.contributes?.mcpServers ?? []) {
        result.mcpServers.push({ pluginId: plugin.pluginId, server: server as unknown as PluginMcpV1 })
      }
      for (const command of manifest.contributes?.promptCommands ?? []) {
        result.promptCommands.push({ pluginId: plugin.pluginId, command: command as unknown as PluginPromptCommandV1 })
      }
      for (const setting of manifest.contributes?.settings ?? []) {
        result.settings.push({ pluginId: plugin.pluginId, setting: setting as unknown as PluginSettingV1 })
      }
      for (const view of manifest.contributes?.workbenchViews ?? []) {
        result.workbenchViews.push({ pluginId: plugin.pluginId, view: view as unknown as PluginViewV1 })
      }
    }
    return result
  }

  /** 插件命令触发器：`plugin:<pluginId>:<commandId>`。 */
  commandTrigger(pluginId: string, commandId: string): string {
    return `plugin:${pluginId}:${commandId}`
  }

  /** 插件命令触发器列表（合并时 builtin 触发器优先，冲突产生诊断）。 */
  commandTriggers(): Array<{ trigger: string; pluginId: string; command: PluginPromptCommandV1 }> {
    return this.contributionList().promptCommands.map(({ pluginId, command }) => ({
      trigger: this.commandTrigger(pluginId, command.id),
      pluginId,
      command,
    }))
  }

  /** 执行插件命令：promptTemplate 在 host 展开（可含 {args}）；action 转发 service。 */
  async executeCommand(input: { pluginId: string; commandId: string; args?: string }): Promise<{ promptTemplate?: string; actionResult?: unknown }> {    const command = this.contributionList().promptCommands.find(
      (entry) => entry.pluginId === input.pluginId && entry.command.id === input.commandId,
    )?.command
    if (!command) {
      throw new AgentError("PLUGIN_NOT_FOUND", `插件命令 ${input.pluginId}:${input.commandId} 不存在`, 404)
    }
    if (command.promptTemplate !== undefined && command.promptTemplate.length > 0) {
      const args = input.args ?? ""
      const template = command.promptTemplate.includes("{args}")
        ? command.promptTemplate.replaceAll("{args}", args)
        : args
          ? `${command.promptTemplate}\n\n${args}`
          : command.promptTemplate
      if (template.length > 8_000) {
        throw new AgentError("PLUGIN_MANIFEST_INVALID", "命令模板展开后超过 8000 字符上限", 400)
      }
      return { promptTemplate: template }
    }
    if (command.action) {
      const provider = this.options.manager.serviceProvider(command.action.service)
      if (!provider) {
        throw new AgentError("PLUGIN_NOT_FOUND", `命令依赖的服务 ${command.action.service} 不可用`, 503)
      }
      const actionResult = await this.options.manager.call(provider, "plugin/serviceCall", {
        service: command.action.service,
        method: command.action.method,
        params: command.action.params ?? {},
      }, { timeoutMs: 30_000 })
      return { actionResult }
    }
    return {}
  }

  /** 渲染插件视图（转发 plugin/viewRender；节点由 Host renderer 白名单渲染）。 */
  async renderView(input: { pluginId: string; viewId: string; instanceId: string }): Promise<{ nodes: unknown[] }> {
    const result = await this.options.manager.call(input.pluginId, "plugin/viewRender", input, { timeoutMs: 30_000 })
    const nodes = (result as { nodes?: unknown[] } | null)?.nodes
    if (!Array.isArray(nodes)) {
      throw new AgentError("PLUGIN_INSTALL_FAILED", "插件视图渲染结果缺少 nodes", 502)
    }
    return { nodes }
  }

  /** 插件视图动作（转发 plugin/viewAction）。 */
  async viewAction(input: { pluginId: string; viewId: string; instanceId: string; actionId: string; params?: unknown }): Promise<{ ok: true }> {
    await this.options.manager.call(input.pluginId, "plugin/viewAction", input, { timeoutMs: 30_000 })
    return { ok: true }
  }

  // ── MCP 声明（转换为现有 declaration） ────────────────────────────────

  mcpDeclarations(): PluginMcpDeclaration[] {
    const declarations: PluginMcpDeclaration[] = []
    for (const { pluginId, server } of this.contributionList().mcpServers) {
      const name = `${pluginId}.${server.name}`
      if (server.transport.kind === "stdio") {
        declarations.push({
          name,
          pluginId,
          declaration: {
            name,
            scope: "user",
            enabled: true,
            transport: {
              type: "stdio",
              command: server.transport.command,
              ...(server.transport.args ? { args: server.transport.args } : {}),
              ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
              ...(server.transport.env ? { env: server.transport.env } : {}),
            },
            required: false,
            ...(server.toolPolicy?.allow ? { enabledTools: server.toolPolicy.allow } : {}),
            ...(server.toolPolicy?.deny ? { disabledTools: server.toolPolicy.deny } : {}),
            defaultToolsApprovalMode: "writes",
          },
        })
      } else {
        declarations.push({
          name,
          pluginId,
          declaration: {
            name,
            scope: "user",
            enabled: true,
            transport: { type: "http", url: server.transport.url },
            required: false,
            ...(server.toolPolicy?.allow ? { enabledTools: server.toolPolicy.allow } : {}),
            ...(server.toolPolicy?.deny ? { disabledTools: server.toolPolicy.deny } : {}),
            defaultToolsApprovalMode: "writes",
          },
        })
      }
    }
    return declarations
  }

  // ── Skill roots（containment = 包根） ─────────────────────────────────

  skillBases(): Array<{
    containmentRoot: string
    skillsRoot: string
    origin: "plugin"
    format: "codepilotx"
    pluginId: string
  }> {
    const bases: Array<{
      containmentRoot: string
      skillsRoot: string
      origin: "plugin"
      format: "codepilotx"
      pluginId: string
    }> = []
    for (const { plugin, manifest } of this.options.manager.activePlugins()) {
      for (const skill of manifest.contributes?.skills ?? []) {
        const absoluteRoot = isAbsolute(skill.root) ? plugin.installedPath : join(plugin.installedPath, skill.root)
        // SkillService 的 base.skillsRoot 是“skill 集合根”（每个子目录是一个 skill）；
        // 插件声明 root 指向单个 skill 目录（含 SKILL.md），取其父目录作为集合根。
        bases.push({
          containmentRoot: plugin.installedPath,
          skillsRoot: dirname(absoluteRoot),
          origin: "plugin",
          format: "codepilotx",
          pluginId: plugin.pluginId,
        })
      }
    }
    return bases
  }

  // ── 工具定义构建 ──────────────────────────────────────────────────────

  private toolDefinition(plugin: StoredPluginPackage, raw: PluginToolContributionV1): ToolDefinition {
    const sdkName = pluginToolSdkName(plugin.pluginId, raw.name)
    let validate: ReturnType<Ajv["compile"]>
    try {
      validate = ajv.compile(raw.inputSchema)
    } catch {
      throw new AgentError("PLUGIN_MANIFEST_INVALID", `插件工具 ${raw.name} 的 inputSchema 非法`, 400)
    }
    const capabilities = raw.capabilities ?? {}
    // 未知工具默认可能产生 external state（无法证明无副作用）。
    const externalState = capabilities.externalState ?? true
    const filesystem = capabilities.filesystem ?? "none"
    const network = capabilities.network ?? "none"
    const process = capabilities.process ?? false
    const userInteraction = capabilities.userInteraction ?? false
    const origin: ToolOrigin = {
      kind: "plugin",
      pluginId: plugin.pluginId,
      rawToolName: raw.name,
      generation: plugin.digest.slice(0, 12),
    }
    return {
      sdkName,
      name: sdkName,
      description: raw.description,
      schema: z.record(z.string(), z.unknown()).superRefine((value, context) => {
        if (validate(value)) return
        for (const error of validate.errors ?? []) {
          context.addIssue({
            code: "custom",
            message: `${error.instancePath || "/"} ${error.message || "参数无效"}`,
          })
        }
      }),
      inputSchema: raw.inputSchema,
      origin,
      capabilities: {
        filesystem,
        network,
        process,
        externalState,
        userInteraction,
      },
      allowedModes: allModes,
      allowedProfiles: allProfiles,
      approvalStrategy: raw.approvalStrategy ?? "policy",
      visibility: raw.visibility ?? "deferred",
      executionMode: externalState ? "sequential" : "parallel",
      execute: async (input, context) => {
        const result = await this.options.manager.call(plugin.pluginId, "plugin/toolExecute", {
          toolCallID: context.invocation?.toolCallID ?? null,
          toolName: raw.name,
          input,
        }, { timeoutMs: 30_000, signal: context.signal })
        return result
      },
    }
  }
}

/** 供 SkillService 合并使用的 plugin origin 常量。 */
export const PLUGIN_SKILL_ORIGIN = "plugin" as const

/** 供外部引用的 manifest 形状（类型锚点）。 */
export type PluginManifestForContribution = PluginManifestV1

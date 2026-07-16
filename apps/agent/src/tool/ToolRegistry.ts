import { z, type ZodType } from "zod"
import { AgentError, type SubagentProfile, type TaskMode } from "../domain"
import { type ApplyPatchInput, WorkspaceService } from "../workspace/WorkspaceService"
import type { PermissionConfig, SandboxMode } from "@codepilotx/shared/thread"
import type { Model } from "@codepilotx/model-schema"

export type ToolCapabilities = {
  filesystem: "none" | "read" | "workspace-write" | "host-write"
  network: "none" | "declared" | "unrestricted"
  process: boolean
  externalState: boolean
  userInteraction: boolean
}

export type ApprovalStrategy = "policy" | "always-review" | "never-review"
export type PromptFactory = string | ((context: ToolContext) => string)

export interface ToolCatalogEntry<Input = unknown> {
  sdkName: string
  /** Transitional internal alias. It is always identical to sdkName. */
  name: string
  schema: ZodType<Input>
  description: PromptFactory
  capabilities: ToolCapabilities
  allowedModes: readonly TaskMode[]
  allowedProfiles: readonly SubagentProfile[]
  approvalStrategy: ApprovalStrategy
  inputSchema: Record<string, unknown>
}

export interface ToolContext {
  signal: AbortSignal
  taskMode: TaskMode
  profile?: SubagentProfile
  workspace: WorkspaceService
  permissionConfig: PermissionConfig
  model: Model.Ref
}

export interface ToolDefinition<Input = unknown, Output = unknown> extends ToolCatalogEntry<Input> {
  execute(input: Input, context: ToolContext): Promise<Output>
}

const allModes = ["chat", "plan"] as const
const allProfiles = ["main", "default", "explorer", "worker"] as const
const noCapabilities = (): ToolCapabilities => ({ filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false })
const jsonObject = (properties: Record<string, unknown>, required?: string[]) => ({ type: "object", properties, ...(required ? { required } : {}) })

const builtinTools = (): ToolDefinition<any, unknown>[] => [
  {
    sdkName: "workspace_list", name: "workspace.list", description: "列出当前项目工作区内的目录内容。路径相对于项目根目录。",
    schema: z.object({ path: z.string().optional() }), inputSchema: jsonObject({ path: { type: "string" } }),
    capabilities: { ...noCapabilities(), filesystem: "read" }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy",
    execute: async (input, context) => context.workspace.list(input.path ?? "."),
  },
  {
    sdkName: "workspace_read", name: "workspace.read", description: "以 UTF-8 分段读取当前项目工作区内的文本文件。offset 为零基行号。",
    schema: z.object({ path: z.string().min(1), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(10_000).optional() }),
    inputSchema: jsonObject({ path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, ["path"]),
    capabilities: { ...noCapabilities(), filesystem: "read" }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy",
    execute: async (input, context) => context.workspace.read(input.path, input.offset, input.limit),
  },
  {
    sdkName: "workspace_search", name: "workspace.search", description: "在当前项目工作区中搜索文件名和 UTF-8 文本",
    schema: z.object({ path: z.string().optional(), query: z.string().min(1) }), inputSchema: jsonObject({ path: { type: "string" }, query: { type: "string" } }, ["query"]),
    capabilities: { ...noCapabilities(), filesystem: "read", process: true }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "policy",
    execute: async (input, context) => context.workspace.search(input.path ?? ".", input.query, context.signal),
  },
  {
    sdkName: "apply_patch", name: "apply_patch", description: "直接且原子地更新、创建或删除一个工作区文件",
    schema: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("update"), path: z.string().min(1), before: z.string(), after: z.string() }),
      z.object({ operation: z.literal("create"), path: z.string().min(1), content: z.string() }),
      z.object({ operation: z.literal("delete"), path: z.string().min(1), expectedSha256: z.string().min(1) }),
    ]),
    inputSchema: jsonObject({ operation: { enum: ["update", "create", "delete"] }, path: { type: "string" }, before: { type: "string" }, after: { type: "string" }, content: { type: "string" }, expectedSha256: { type: "string" } }, ["operation", "path"]),
    capabilities: { ...noCapabilities(), filesystem: "workspace-write", externalState: true }, allowedModes: ["chat"], allowedProfiles: ["main", "default", "worker"], approvalStrategy: "policy",
    execute: async (input: ApplyPatchInput, context) => context.workspace.applyPatch(input),
  },
  {
    sdkName: "question.ask", name: "question.ask", description: "向用户提出必须回答的问题",
    schema: z.object({ question: z.string().min(1), options: z.array(z.string()).optional() }), inputSchema: jsonObject({ question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, ["question"]),
    capabilities: { ...noCapabilities(), userInteraction: true }, allowedModes: allModes, allowedProfiles: ["main", "default"], approvalStrategy: "policy",
    execute: async (input) => ({ question: input.question, options: input.options ?? [] }),
  },
  {
    sdkName: "request_permissions", name: "request_permissions", description: "为当前工具调用或当前 turn 请求临时路径/网络权限；sandbox 失败时携带 escalationToken 请求一次性 host 执行",
    schema: z.object({ scope: z.enum(["tool-call", "turn"]), readPaths: z.array(z.string()).optional(), writePaths: z.array(z.string()).optional(), networkDomains: z.array(z.string()).optional(), escalationToken: z.string().uuid().optional(), justification: z.string().min(1) }),
    inputSchema: jsonObject({ scope: { enum: ["tool-call", "turn"] }, readPaths: { type: "array", items: { type: "string" } }, writePaths: { type: "array", items: { type: "string" } }, networkDomains: { type: "array", items: { type: "string" } }, escalationToken: { type: "string", format: "uuid" }, justification: { type: "string" } }, ["scope", "justification"]),
    capabilities: { ...noCapabilities(), userInteraction: true }, allowedModes: allModes, allowedProfiles: allProfiles, approvalStrategy: "always-review",
    // PermissionDecisionEngine and ApprovalService authorize this definition
    // before execution. Returning the normalized scope lets the orchestrator
    // apply it transiently without mutating thread defaults.
    execute: async (input) => ({ granted: true, ...input }),
  },
  {
    sdkName: "shell", name: "shell", description: "在统一审批和沙箱边界后执行 PowerShell 命令",
    schema: z.object({ command: z.string().min(1).max(32_000), cwd: z.string().optional(), timeoutMs: z.number().positive().max(600_000).optional(), additionalPermissions: z.object({ readPaths: z.array(z.string()).optional(), writePaths: z.array(z.string()).optional(), networkDomains: z.array(z.string()).optional() }).optional(), justification: z.string().optional() }),
    inputSchema: jsonObject({ command: { type: "string", maxLength: 32_000 }, cwd: { type: "string" }, timeoutMs: { type: "number", maximum: 600_000 }, additionalPermissions: { type: "object", properties: { readPaths: { type: "array", items: { type: "string" } }, writePaths: { type: "array", items: { type: "string" } }, networkDomains: { type: "array", items: { type: "string" } } } }, justification: { type: "string" } }, ["command"]),
    capabilities: { filesystem: "host-write", network: "declared", process: true, externalState: true, userInteraction: false }, allowedModes: allModes, allowedProfiles: ["main", "default", "worker"], approvalStrategy: "policy",
    execute: async () => { throw new AgentError("SHELL_EXECUTOR_REQUIRED", "Shell 必须经过统一执行器", 500) },
  },
]

export const toolMayMutate = (tool: ToolCatalogEntry) => tool.capabilities.filesystem === "workspace-write" || tool.capabilities.filesystem === "host-write" || tool.capabilities.externalState
// Shell remains visible in read-only and is constrained by the generated SRT policy.
// Typed workspace writers have no sandbox layer of their own and must be hidden/denied.
export const toolAllowedInSandbox = (tool: ToolCatalogEntry, mode: SandboxMode) => mode !== "read-only" || tool.capabilities.filesystem !== "workspace-write"

export class ToolCatalog {
  private readonly tools = new Map<string, ToolDefinition<any, unknown>>()
  private readonly sdkNames = new Map<string, string>()

  constructor(definitions: ToolDefinition<any, unknown>[] = builtinTools()) {
    for (const definition of definitions) this.register(definition)
  }

  register(tool: ToolDefinition<any, unknown>) {
    if (!tool.sdkName || !tool.name || !tool.schema || !tool.execute || !tool.capabilities) throw new AgentError("INVALID_TOOL_DEFINITION", "工具定义不完整", 500)
    if (this.tools.has(tool.name) || this.sdkNames.has(tool.sdkName) || this.tools.has(tool.sdkName) || this.sdkNames.has(tool.name)) {
      throw new AgentError("TOOL_ALREADY_REGISTERED", `工具 ${tool.name}/${tool.sdkName} 的模型名或执行名已注册`, 409)
    }
    const frozen = Object.freeze({ ...tool, allowedModes: [...tool.allowedModes], allowedProfiles: [...tool.allowedProfiles], capabilities: Object.freeze({ ...tool.capabilities }) })
    this.tools.set(tool.name, frozen)
    this.sdkNames.set(tool.sdkName, tool.name)
  }

  list(mode?: TaskMode, sandboxMode: SandboxMode = "workspace-write", profile: SubagentProfile = "main") {
    return [...this.tools.values()].filter((tool) => (!mode || tool.allowedModes.includes(mode)) && tool.allowedProfiles.includes(profile) && toolAllowedInSandbox(tool, sandboxMode))
  }

  get(name: string) {
    const tool = this.tools.get(name) ?? this.tools.get(this.sdkNames.get(name) ?? "")
    if (!tool) throw new AgentError("TOOL_NOT_FOUND", `工具 ${name} 不存在`, 404)
    return tool
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name)
    if (!tool.allowedModes.includes(context.taskMode)) throw new AgentError("TOOL_NOT_ALLOWED_IN_MODE", `工具 ${name} 不允许在 ${context.taskMode} 模式执行`, 403)
    if (!tool.allowedProfiles.includes(context.profile ?? "main")) throw new AgentError("TOOL_NOT_ALLOWED_FOR_PROFILE", `工具 ${name} 不允许当前 Agent profile 使用`, 403)
    if (!toolAllowedInSandbox(tool, context.permissionConfig.sandboxMode)) throw new AgentError("TOOL_NOT_ALLOWED_IN_SANDBOX", `工具 ${name} 不允许在 ${context.permissionConfig.sandboxMode} 沙箱执行`, 403)
    if (name === "question.ask") throw new AgentError("QUESTION_MODE_DENIED", "问题卡片由会话服务处理", 403)
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) throw new AgentError("INVALID_TOOL_INPUT", parsed.error.message, 400)
    return tool.execute(parsed.data, context)
  }
}

const compatibilityToolNames: Record<string, string> = {
  read: "workspace_read",
  glob: "workspace_list",
  grep: "workspace_search",
  bash: "shell",
  edit: "apply_patch",
  write: "apply_patch",
  askuserquestion: "request_user_input",
}

const normalizedAllowedTool = (value: string) => compatibilityToolNames[value.trim().toLowerCase()] ?? value.trim().toLowerCase().replaceAll(".", "_")

export const allowedToolNameMatches = (name: string, allowedTools: readonly string[]) => {
  const expected = normalizedAllowedTool(name)
  return allowedTools.some((candidate) => normalizedAllowedTool(candidate) === expected)
}

export const toolNameMatches = (tool: Pick<ToolCatalogEntry, "name" | "sdkName">, allowedTools: readonly string[]) =>
  allowedToolNameMatches(tool.name, allowedTools) || allowedToolNameMatches(tool.sdkName, allowedTools)

/** @deprecated Use ToolCatalog. */
export class ToolRegistry extends ToolCatalog {}

import { AgentError, type TaskMode } from "../domain"
import { type ApplyPatchInput, WorkspaceService } from "../workspace/WorkspaceService"
import type { PermissionConfig } from "@codepilotx/shared/thread"
import type { Model } from "@codepilotx/model-schema"

export interface ToolContext {
  signal: AbortSignal
  taskMode: TaskMode
  workspace: WorkspaceService
  permissionConfig: PermissionConfig
  model: Model.Ref
}

export interface ToolDefinition {
  name: string
  description: string
  sideEffect: boolean
  inputSchema: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<unknown>
}

const stringInput = (input: Record<string, unknown>, key: string, allowEmpty = false) => {
  const value = input[key]
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new AgentError("INVALID_TOOL_INPUT", `${key} 必须是${allowEmpty ? "字符串" : "非空字符串"}`, 400)
  return value
}

/**
 * Tool definitions operate only through a selected WorkspaceService. Shell
 * execution remains delegated to ToolExecutor's permission and sandbox gates.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  constructor() {
    this.registerReadOnlyTools()
    this.registerWriteTools()
    this.register({
      name: "question.ask",
      description: "向用户提出必须回答的问题",
      sideEffect: false,
      inputSchema: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, required: ["question"] },
      execute: async (input) => ({ question: stringInput(input, "question"), options: Array.isArray(input.options) ? input.options : [] }),
    })
    this.register({
      name: "shell",
      description: "在经过审核和权限边界后执行 PowerShell 命令",
      sideEffect: true,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeoutMs: { type: "number" },
          additionalPermissions: {
            type: "object",
            properties: {
              readPaths: { type: "array", items: { type: "string" } },
              writePaths: { type: "array", items: { type: "string" } },
              networkDomains: { type: "array", items: { type: "string" } },
            },
          },
          justification: { type: "string" },
        },
        required: ["command"],
      },
      execute: async () => {
        throw new AgentError("SHELL_EXECUTOR_REQUIRED", "Shell 必须经过统一执行器", 500)
      },
    })
  }

  private registerReadOnlyTools() {
    this.register({
      name: "workspace.list",
      description: "列出当前项目工作区内的目录内容",
      sideEffect: false,
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      execute: async (input, context) => context.workspace.list(typeof input.path === "string" ? input.path : "."),
    })
    this.register({
      name: "workspace.read",
      description: "以 UTF-8 读取当前项目工作区内的文本文件",
      sideEffect: false,
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (input, context) => context.workspace.read(stringInput(input, "path")),
    })
    this.register({
      name: "workspace.search",
      description: "在当前项目工作区中搜索文件名和 UTF-8 文本",
      sideEffect: false,
      inputSchema: { type: "object", properties: { path: { type: "string" }, query: { type: "string" } }, required: ["query"] },
      execute: async (input, context) => context.workspace.search(typeof input.path === "string" ? input.path : ".", stringInput(input, "query"), context.signal),
    })
  }

  private registerWriteTools() {
    this.register({
      name: "apply_patch",
      description: "直接且原子地更新、创建或删除一个工作区文件",
      sideEffect: true,
      inputSchema: { type: "object", properties: { operation: { enum: ["update", "create", "delete"] }, path: { type: "string" }, before: { type: "string" }, after: { type: "string" }, content: { type: "string" }, expectedSha256: { type: "string" } }, required: ["operation", "path"] },
      execute: async (input, context) => {
        const type = input.operation
        if (type !== "update" && type !== "create" && type !== "delete") throw new AgentError("INVALID_TOOL_INPUT", "operation 必须是 update、create 或 delete", 400)
        const path = stringInput(input, "path")
        const patch: ApplyPatchInput = type === "update"
          ? { operation: type, path, before: stringInput(input, "before"), after: stringInput(input, "after", true) }
          : type === "create"
            ? { operation: type, path, content: stringInput(input, "content", true) }
            : { operation: type, path, expectedSha256: stringInput(input, "expectedSha256") }
        return context.workspace.applyPatch(patch)
      },
    })
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  list(taskMode: TaskMode) {
    return [...this.tools.values()].filter((tool) => taskMode === "plan" ? tool.name !== "question.ask" : tool.name !== "question.ask")
  }

  get(name: string) {
    const tool = this.tools.get(name)
    if (!tool) throw new AgentError("TOOL_NOT_FOUND", `工具 ${name} 不存在`, 404)
    return tool
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext) {
    const tool = this.get(name)
    if (name === "question.ask") throw new AgentError("QUESTION_MODE_DENIED", "问题卡片由会话服务处理", 403)
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    return tool.execute(input, context)
  }
}

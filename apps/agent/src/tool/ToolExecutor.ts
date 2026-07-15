import { AgentError, type PermissionDecision, type TaskMode, type ToolInvocation } from "../domain"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import type { ToolRegistry } from "./ToolRegistry"
import { DEFAULT_PERMISSION_CONFIG, type PermissionConfig, type ShellInput } from "@codepilotx/shared/thread"
import { Model, Provider } from "@codepilotx/model-schema"
import { createSessionTemp, runHostCommand, type ProcessResult, type SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import { generateSandboxPolicy } from "../sandbox/SandboxPolicy"
import { rm } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

export interface ToolExecutionContext {
  threadID: string
  turnID: string
  agentID?: string
  taskMode: TaskMode
  signal: AbortSignal
  workspace: WorkspaceService
  permissionConfig?: PermissionConfig
  model?: Model.Ref
  taskSummary?: string
}

export interface ToolExecutorOptions {
  dataDir: string
  sandbox: SandboxRuntimeAdapter
  authorizeShell: (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>
  recordToolCall?: (invocation: ToolInvocation, status: "running" | "completed" | "error" | "interrupted", output?: unknown, error?: string | null, startedAt?: number) => void
  helperPath?: string | null
}

/** The sole host-capability entrypoint. Later stages add approval and SRT gates here. */
export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry, private readonly options?: ToolExecutorOptions) {}

  async execute<T = unknown>(name: string, input: Record<string, unknown>, context: ToolExecutionContext): Promise<T> {
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const definition = this.registry.get(name)
    if (name === "shell") return await this.executeShell(input, context) as T
    if (name === "apply_patch") {
      if (context.taskMode === "plan") throw new AgentError("WRITE_NOT_ALLOWED_IN_PLAN", "计划模式禁止修改工作区", 403)
      return await this.executeRegistered<T>(name, input, context)
    }
    if (definition.sideEffect) {
      throw new AgentError("SIDE_EFFECT_TOOLS_DISABLED", "当前阶段尚未启用副作用工具", 403)
    }
    return this.executeRegistered<T>(name, input, context)
  }

  private executeRegistered<T>(name: string, input: Record<string, unknown>, context: ToolExecutionContext) {
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    return this.registry.execute(name, input, {
      signal: context.signal,
      taskMode: context.taskMode,
      workspace: context.workspace,
      permissionConfig,
      model,
    }) as Promise<T>
  }

  private async executeShell(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ProcessResult> {
    if (!this.options) throw new AgentError("SHELL_EXECUTOR_REQUIRED", "Shell 执行器未配置", 500)
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    const shell = this.parseShellInput(input)
    if (context.taskMode === "plan") throw new AgentError("SHELL_NOT_ALLOWED_IN_PLAN", "计划模式禁止执行 Shell", 403)
    const cwd = shell.cwd ? (isAbsolute(shell.cwd) ? resolve(shell.cwd) : resolve(context.workspace.rootPath, shell.cwd)) : context.workspace.rootPath
    if (permissionConfig.sandboxMode !== "danger-full-access") {
      const relativePath = relative(context.workspace.rootPath, cwd)
      const outsideWorkspace = relativePath.startsWith("..") || isAbsolute(relativePath)
      if (outsideWorkspace && !(shell.additionalPermissions?.readPaths ?? []).some((path) => resolve(path) === cwd || resolve(context.workspace.rootPath, path) === cwd)) {
        throw new AgentError("SHELL_CWD_PERMISSION_REQUIRED", "工作区外 cwd 必须在 additionalPermissions.readPaths 中声明", 403)
      }
    }
    const invocation: ToolInvocation = {
      id: crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name: "shell",
      input: {
        ...shell as unknown as Record<string, unknown>,
        ...(context.taskSummary ? { taskSummary: context.taskSummary.slice(0, 4_000) } : {}),
      },
      permissionConfig,
      model,
      taskMode: context.taskMode,
    }
    const startedAt = Date.now()
    this.options.recordToolCall?.(invocation, "running", null, null, startedAt)
    try {
      const decision = await this.options.authorizeShell(invocation, context.signal)
      if (decision.decision !== "allow") throw new AgentError("SHELL_PERMISSION_DENIED", decision.reason, 403, decision)
      if (permissionConfig.sandboxMode === "danger-full-access") {
        const result = await runHostCommand(shell.command, cwd, shell.timeoutMs, context.signal)
        this.options.recordToolCall?.(invocation, "completed", result, null, startedAt)
        return result
      }
      const sessionTemp = createSessionTemp()
      try {
        const policy = generateSandboxPolicy({
          workspace: context.workspace.rootPath,
          sessionTemp,
          dataDir: this.options.dataDir,
          permissionConfig,
          ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}),
          ...(this.options.helperPath ? { helperPath: this.options.helperPath } : {}),
        })
        const result = await this.options.sandbox.run({ command: shell.command, cwd, ...(shell.timeoutMs === undefined ? {} : { timeoutMs: shell.timeoutMs }), config: policy.config, signal: context.signal })
        this.options.recordToolCall?.(invocation, "completed", result, null, startedAt)
        return result
      } finally {
        await rm(sessionTemp, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (cause) {
      this.options.recordToolCall?.(invocation, context.signal.aborted ? "interrupted" : "error", null, cause instanceof Error ? cause.message : String(cause), startedAt)
      throw cause
    }
  }

  private parseShellInput(input: Record<string, unknown>): ShellInput {
    if (typeof input.command !== "string" || !input.command.trim()) throw new AgentError("INVALID_TOOL_INPUT", "command 必须是非空字符串", 400)
    const additional = input.additionalPermissions
    if (additional !== undefined && (!additional || typeof additional !== "object" || Array.isArray(additional))) throw new AgentError("INVALID_TOOL_INPUT", "additionalPermissions 参数无效", 400)
    const value = additional as Record<string, unknown> | undefined
    const list = (name: string) => {
      const candidate = value?.[name]
      if (candidate === undefined) return undefined
      if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string" || !item.trim())) throw new AgentError("INVALID_TOOL_INPUT", `${name} 必须是字符串数组`, 400)
      return candidate
    }
    const timeoutMs = input.timeoutMs === undefined ? undefined : Number(input.timeoutMs)
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new AgentError("INVALID_TIMEOUT", "Shell 超时时间必须是正数", 400)
    return {
      command: input.command,
      ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(value ? {
        additionalPermissions: {
          ...(list("readPaths") ? { readPaths: list("readPaths") } : {}),
          ...(list("writePaths") ? { writePaths: list("writePaths") } : {}),
          ...(list("networkDomains") ? { networkDomains: list("networkDomains") } : {}),
        },
      } : {}),
      ...(typeof input.justification === "string" ? { justification: input.justification } : {}),
    }
  }
}

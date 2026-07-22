import { AgentError, type PermissionDecision, type SubagentProfile, type TaskMode, type ToolInvocation } from "../domain"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import { toolNameMatches, type ToolRegistry } from "./ToolRegistry"
import { DEFAULT_PERMISSION_CONFIG, type PermissionConfig, type ShellInput } from "@codepilotx/shared/thread"
import { Model, Provider } from "@codepilotx/model-schema"
import { createSessionTemp, runHostCommand, type ProcessResult, type SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import { generateSandboxPolicy } from "../sandbox/SandboxPolicy"
import { rm } from "node:fs/promises"
import { realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { PermissionDecisionEngine } from "../permission/PermissionDecisionEngine"
import { analyzeShellRisk } from "../security/ShellRiskClassifier"
import { secretScrubber } from "../security/SecretScrubber"

export interface ToolExecutionContext {
  threadID: string
  turnID: string
  agentID?: string
  profile?: SubagentProfile
  taskMode: TaskMode
  signal: AbortSignal
  workspace: WorkspaceService
  /** Default process cwd. It must remain inside workspace.rootPath. */
  defaultCwd?: string
  permissionConfig?: PermissionConfig
  model?: Model.Ref
  taskSummary?: string
  skipHooks?: boolean
  hookDepth?: number
  /** Agents SDK tool-call identity used by durable approval interruptions. */
  toolCallID?: string
  /** Set only after a validated durable checkpoint has been claimed. */
  approvedToolCallID?: string
  /** Runs normalization, hard-deny, hooks and review without executing the tool. */
  authorizationOnly?: boolean
  /** Optional active Skill ceiling. It can only remove tools from the effective policy. */
  allowedTools?: readonly string[]
}

export interface ToolExecutorOptions {
  dataDir: string
  sandbox: SandboxRuntimeAdapter
  authorizeShell: (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>
  recordToolCall?: (invocation: ToolInvocation, status: "running" | "completed" | "error" | "interrupted", output?: unknown, error?: string | null, startedAt?: number) => void
  helperPath?: string | null
  hooks?: {
    run(event: "pre_tool_use" | "post_tool_use" | "post_tool_error", evidence: unknown, context?: { threadID?: string; turnID?: string; toolCallID?: string; toolName?: string; workspaceRoot?: string }): Promise<Array<{ result: { decision: "continue" | "ask" | "deny"; reason?: string; narrowedInput?: Record<string, unknown> } }>>
  }
  prepareSandboxEscalation?: (invocation: ToolInvocation, failure: string) => { token: string }
  claimSandboxEscalation?: (token: string, scope: { threadID: string; turnID: string; agentID: string }) => { token: string; invocation: ToolInvocation; invocationHash: string; failure: string } | null
  completeSandboxEscalation?: (token: string, output: unknown) => void
  runHost?: typeof runHostCommand
}

/** The sole host-capability entrypoint. Later stages add approval and SRT gates here. */
export class ToolExecutor {
  private readonly decisions = new PermissionDecisionEngine()
  constructor(private readonly registry: ToolRegistry, private readonly options?: ToolExecutorOptions) {}

  definition(name: string) {
    return this.registry.get(name)
  }

  async previewApproval(name: string, input: Record<string, unknown>, context: ToolExecutionContext, toolCallID: string) {
    return this.execute<PermissionDecision>(name, input, { ...context, toolCallID, authorizationOnly: true })
  }

  async execute<T = unknown>(name: string, input: Record<string, unknown>, context: ToolExecutionContext): Promise<T> {
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const definition = this.registry.get(name)
    if (context.allowedTools && !toolNameMatches(definition, context.allowedTools)) throw new AgentError("SKILL_TOOL_NOT_ALLOWED", `当前 Skill 不允许使用工具 ${definition.sdkName}`, 403)
    const parsed = definition.schema.safeParse(input)
    if (!parsed.success) throw new AgentError("INVALID_TOOL_INPUT", parsed.error.message, 400)
    const profile = context.profile ?? "main"
    if (!definition.allowedProfiles.includes(profile)) throw new AgentError("TOOL_NOT_ALLOWED_FOR_PROFILE", `工具 ${name} 不允许 ${profile} profile 使用`, 403)
    const normalized = parsed.data as Record<string, unknown>
    if (name === "shell") return await this.executeShell(normalized, context) as T
    return this.executeRegistered<T>(name, normalized, context)
  }

  private async executeRegistered<T>(name: string, input: Record<string, unknown>, context: ToolExecutionContext) {
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    const relativeToolPath = typeof input.path === "string" ? input.path.replaceAll("\\", "/").toLowerCase() : ""
    const sensitiveEnvironment = /^\.env(?:\..+)?$/.test(relativeToolPath) && !/^\.env\.(?:example|template)$/.test(relativeToolPath)
    const protectedGitWrite = name === "apply_patch" && (relativeToolPath === ".git/config" || relativeToolPath.startsWith(".git/hooks/"))
    const policyInput = sensitiveEnvironment || protectedGitWrite ? { ...input, __ruleRequiresApproval: true } : input
    const invocation: ToolInvocation = { id: context.toolCallID ?? crypto.randomUUID(), threadID: context.threadID, turnID: context.turnID, agentID: context.agentID ?? context.turnID, name, input: policyInput, permissionConfig, model, taskMode: context.taskMode, ...(context.authorizationOnly ? { durableApproval: true } : {}) }
    const resolved = this.decisions.evaluate(invocation, this.registry.get(name))
    if (resolved.action === "deny") throw new AgentError("TOOL_PERMISSION_DENIED", resolved.reason, 403, resolved)
    const resumedApproval = context.approvedToolCallID === invocation.id
    const hookResults = context.skipHooks || resumedApproval ? [] : await this.options?.hooks?.run("pre_tool_use", { input, resolved }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: name, workspaceRoot: context.workspace.rootPath }) ?? []
    const denied = hookResults.find(({ result }) => result.decision === "deny")
    if (denied) throw new AgentError("HOOK_DENIED", denied.result.reason ?? "PreToolUse Hook 拒绝执行", 403)
    const narrowed = hookResults.map(({ result }) => result.narrowedInput).filter((value): value is Record<string, unknown> => Boolean(value)).at(-1)
    if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
      if ((context.hookDepth ?? 0) >= 2) throw new AgentError("HOOK_REWRITE_LIMIT", "Hook 重写工具输入次数过多", 409)
      return this.execute<T>(name, { ...input, ...narrowed }, { ...context, hookDepth: (context.hookDepth ?? 0) + 1 })
    }
    const hookAsked = hookResults.some(({ result }) => result.decision === "ask")
    if (hookAsked) invocation.input = { ...invocation.input, __hookRequiresApproval: true }
    let authorization: PermissionDecision = { decision: "allow", risk: resolved.risk, reason: "统一权限策略允许" }
    if ((resolved.action === "review" || hookAsked) && !resumedApproval) {
      if (!this.options) throw new AgentError("TOOL_REVIEW_REQUIRED", "工具需要审批但执行器未配置审批服务", 403)
      authorization = await this.options.authorizeShell(secretScrubber.scrub(invocation), context.signal)
    }
    if (context.authorizationOnly) return authorization as T
    if (authorization.decision !== "allow") throw new AgentError("TOOL_PERMISSION_DENIED", authorization.reason, 403, authorization)
    const startedAt = Date.now()
    const auditInvocation = secretScrubber.scrub(invocation)
    this.options?.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
    try {
      const output = await this.registry.execute(name, input, { signal: context.signal, taskMode: context.taskMode, profile: context.profile ?? "main", workspace: context.workspace, permissionConfig, model })
      const safeOutput = secretScrubber.scrub(output)
      this.options?.recordToolCall?.(auditInvocation, "completed", safeOutput, null, startedAt)
      if (!context.skipHooks) await this.options?.hooks?.run("post_tool_use", { input, output: safeOutput }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: name, workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
      return output as T
    } catch (cause) {
      const error = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))
      this.options?.recordToolCall?.(auditInvocation, context.signal.aborted ? "interrupted" : "error", null, error, startedAt)
      if (!context.skipHooks) await this.options?.hooks?.run("post_tool_error", { input, error }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: name, workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
      throw cause
    }
  }

  private async executeShell(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ProcessResult | PermissionDecision> {
    if (!this.options) throw new AgentError("SHELL_EXECUTOR_REQUIRED", "Shell 执行器未配置", 500)
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    const parsedShell = this.parseShellInput(input)
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const additionalPermissions = parsedShell.additionalPermissions ? {
      ...(parsedShell.additionalPermissions.readPaths ? { readPaths: await Promise.all(parsedShell.additionalPermissions.readPaths.map((path) => this.canonicalPath(workspaceRoot, path, false))) } : {}),
      ...(parsedShell.additionalPermissions.writePaths ? { writePaths: await Promise.all(parsedShell.additionalPermissions.writePaths.map((path) => this.canonicalPath(workspaceRoot, path, true))) } : {}),
      ...(parsedShell.additionalPermissions.networkDomains ? { networkDomains: [...new Set(parsedShell.additionalPermissions.networkDomains.map((domain) => domain.trim().toLowerCase()))] } : {}),
    } : undefined
    const shell: ShellInput = { ...parsedShell, ...(additionalPermissions ? { additionalPermissions } : {}) }
    const requestedCwd = shell.cwd
      ? (isAbsolute(shell.cwd) ? resolve(shell.cwd) : resolve(context.defaultCwd ?? workspaceRoot, shell.cwd))
      : resolve(context.defaultCwd ?? workspaceRoot)
    const cwd = await realpath(requestedCwd).catch(() => { throw new AgentError("SHELL_CWD_NOT_FOUND", "Shell cwd 不存在或无法解析", 400) })
    if (permissionConfig.sandboxMode !== "danger-full-access") {
      const relativePath = relative(workspaceRoot, cwd)
      const outsideWorkspace = relativePath.startsWith("..") || isAbsolute(relativePath)
      if (outsideWorkspace && !(shell.additionalPermissions?.readPaths ?? []).some((path) => path === cwd || cwd.startsWith(path + "\\"))) {
        throw new AgentError("SHELL_CWD_PERMISSION_REQUIRED", "工作区外 cwd 必须在 additionalPermissions.readPaths 中声明", 403)
      }
    }
    const invocation: ToolInvocation = {
      id: context.toolCallID ?? crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name: "shell",
      input: {
        ...shell as unknown as Record<string, unknown>,
        cwd,
        ...(context.taskSummary ? { taskSummary: context.taskSummary.slice(0, 4_000) } : {}),
      },
      permissionConfig,
      model,
      taskMode: context.taskMode,
      ...(context.authorizationOnly ? { durableApproval: true } : {}),
    }
    try {
      const staticRisk = analyzeShellRisk({ command: shell.command, cwd, ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}), ...(shell.justification ? { justification: shell.justification } : {}), ...(context.taskSummary ? { taskSummary: context.taskSummary } : {}) })
      if (staticRisk.hardDenied) throw new AgentError("SHELL_HARD_DENY", staticRisk.reason, 403, staticRisk)
      const resumedApproval = context.approvedToolCallID === invocation.id
      const hookResults = context.skipHooks || resumedApproval ? [] : await this.options.hooks?.run("pre_tool_use", { input: invocation.input, staticRisk }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: "shell", workspaceRoot: context.workspace.rootPath }) ?? []
      const denied = hookResults.find(({ result }) => result.decision === "deny")
      if (denied) throw new AgentError("HOOK_DENIED", denied.result.reason ?? "PreToolUse Hook 拒绝执行", 403)
      const narrowed = hookResults.map(({ result }) => result.narrowedInput).filter((value): value is Record<string, unknown> => Boolean(value)).at(-1)
      if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
        if ((context.hookDepth ?? 0) >= 2) throw new AgentError("HOOK_REWRITE_LIMIT", "Hook 重写 Shell 输入次数过多", 409)
        return this.executeShell({ ...input, ...narrowed }, { ...context, hookDepth: (context.hookDepth ?? 0) + 1 })
      }
      if (hookResults.some(({ result }) => result.decision === "ask")) invocation.input = { ...invocation.input, __hookRequiresApproval: true }
      const decision = resumedApproval
        ? { decision: "allow", risk: staticRisk.risk, reason: "已恢复并校验一次性审批" } satisfies PermissionDecision
        : await this.options.authorizeShell(secretScrubber.scrub(invocation), context.signal)
      if (context.authorizationOnly) return decision
      if (decision.decision !== "allow") throw new AgentError("SHELL_PERMISSION_DENIED", decision.reason, 403, decision)
      const startedAt = Date.now()
      const auditInvocation = secretScrubber.scrub(invocation)
      this.options.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
      if (permissionConfig.sandboxMode === "danger-full-access") {
        const result = await (this.options.runHost ?? runHostCommand)(shell.command, cwd, shell.timeoutMs, context.signal)
        const safeResult = secretScrubber.scrub(result)
        this.options.recordToolCall?.(auditInvocation, "completed", safeResult, null, startedAt)
        if (!context.skipHooks) await this.options.hooks?.run("post_tool_use", { input: invocation.input, output: safeResult }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: "shell", workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
        return result
      }
      const sessionTemp = createSessionTemp()
      try {
        const policy = generateSandboxPolicy({
          workspace: workspaceRoot,
          sessionTemp,
          dataDir: this.options.dataDir,
          permissionConfig,
          ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}),
          ...(this.options.helperPath ? { helperPath: this.options.helperPath } : {}),
        })
        let result: ProcessResult
        try {
          result = await this.options.sandbox.run({ command: shell.command, cwd, ...(shell.timeoutMs === undefined ? {} : { timeoutMs: shell.timeoutMs }), config: policy.config, signal: context.signal })
        } catch (sandboxCause) {
          if (permissionConfig.approvalPolicy !== "on-failure") throw sandboxCause
          if (!this.options.prepareSandboxEscalation) throw sandboxCause
          const failure = sandboxCause instanceof Error ? sandboxCause.message : String(sandboxCause)
          const escalation = this.options.prepareSandboxEscalation(invocation, failure)
          result = {
            exitCode: 126, signal: null, stdout: "", timedOut: false, truncated: false,
            stderr: `SANDBOX_ESCALATION_REQUIRED ${JSON.stringify({ escalationToken: escalation.token, action: "call request_permissions", justification: "sandbox execution failed; request one-time host execution" })}`,
          }
        }
        const safeResult = secretScrubber.scrub(result)
        this.options.recordToolCall?.(auditInvocation, "completed", safeResult, null, startedAt)
        if (!context.skipHooks) await this.options.hooks?.run("post_tool_use", { input: invocation.input, output: safeResult }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: "shell", workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
        return result
      } finally {
        await rm(sessionTemp, { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (cause) {
      if (!context.authorizationOnly) {
        const startedAt = Date.now()
        this.options.recordToolCall?.(secretScrubber.scrub(invocation), context.signal.aborted ? "interrupted" : "error", null, secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)), startedAt)
      }
      if (!context.skipHooks && !context.authorizationOnly) await this.options.hooks?.run("post_tool_error", { input: invocation.input, error: secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)) }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: "shell", workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
      throw cause
    }
  }

  async executeSandboxEscalation(token: string, context: ToolExecutionContext): Promise<ProcessResult> {
    if (!this.options?.claimSandboxEscalation || !this.options.completeSandboxEscalation) throw new AgentError("SANDBOX_ESCALATION_UNAVAILABLE", "Sandbox escalation 服务未配置", 503)
    const agentID = context.agentID ?? context.turnID
    const escalation = this.options.claimSandboxEscalation(token, { threadID: context.threadID, turnID: context.turnID, agentID })
    if (!escalation) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation 不存在、已消费、被篡改或作用域不匹配", 409)
    const input = escalation.invocation.input
    if (escalation.invocation.name !== "shell" || typeof input.command !== "string" || typeof input.cwd !== "string") throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation invocation 无效", 409)
    const shell = this.parseShellInput(input)
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const cwd = await realpath(input.cwd).catch(() => { throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation cwd 已失效", 409) })
    if (cwd !== input.cwd) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation cwd 规范路径不匹配", 409)
    const normalizedPermissions = shell.additionalPermissions ? {
      ...(shell.additionalPermissions.readPaths ? { readPaths: await Promise.all(shell.additionalPermissions.readPaths.map((path) => this.canonicalPath(workspaceRoot, path, false))) } : {}),
      ...(shell.additionalPermissions.writePaths ? { writePaths: await Promise.all(shell.additionalPermissions.writePaths.map((path) => this.canonicalPath(workspaceRoot, path, true))) } : {}),
      ...(shell.additionalPermissions.networkDomains ? { networkDomains: [...new Set(shell.additionalPermissions.networkDomains.map((domain) => domain.trim().toLowerCase()))] } : {}),
    } : undefined
    if (JSON.stringify(normalizedPermissions ?? {}) !== JSON.stringify(shell.additionalPermissions ?? {})) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation permissions 已变化", 409)
    const relativeCwd = relative(workspaceRoot, cwd)
    if ((relativeCwd.startsWith("..") || isAbsolute(relativeCwd)) && !(shell.additionalPermissions?.readPaths ?? []).some((path) => path === cwd || cwd.startsWith(path + "\\"))) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation cwd 不在已审批路径内", 409)
    const staticRisk = analyzeShellRisk({ command: shell.command, cwd, ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}), justification: "一次性 sandbox failure escalation" })
    if (staticRisk.hardDenied) throw new AgentError("SHELL_HARD_DENY", staticRisk.reason, 403, staticRisk)
    const auditInvocation = secretScrubber.scrub({ ...escalation.invocation, id: crypto.randomUUID(), name: "shell.host-escalation", input: { ...input, escalationToken: token, failureSummary: escalation.failure } })
    const startedAt = Date.now()
    this.options.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
    try {
      const result = await (this.options.runHost ?? runHostCommand)(shell.command, cwd, shell.timeoutMs, context.signal)
      this.options.completeSandboxEscalation(token, result)
      this.options.recordToolCall?.(auditInvocation, "completed", secretScrubber.scrub(result), null, startedAt)
      return result
    } catch (cause) {
      const error = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))
      this.options.completeSandboxEscalation(token, { error })
      this.options.recordToolCall?.(auditInvocation, context.signal.aborted ? "interrupted" : "error", null, error, startedAt)
      throw cause
    }
  }

  private parseShellInput(input: Record<string, unknown>): ShellInput {
    if (typeof input.command !== "string" || !input.command.trim()) throw new AgentError("INVALID_TOOL_INPUT", "command 必须是非空字符串", 400)
    if (input.command.length > 32_000) throw new AgentError("COMMAND_TOO_LONG", "Shell 命令超过 32000 字符，拒绝审核和执行", 413)
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
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000)) throw new AgentError("INVALID_TIMEOUT", "Shell 超时时间必须在 1 到 600000 毫秒之间", 400)
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

  private async canonicalPath(workspaceRoot: string, value: string, allowMissingLeaf: boolean) {
    const absolute = isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value)
    if (!allowMissingLeaf) return realpath(absolute).catch(() => { throw new AgentError("PERMISSION_PATH_NOT_FOUND", `申请读取的路径不存在：${value}`, 400) })
    try { return await realpath(absolute) } catch {
      const parent = await realpath(dirname(absolute)).catch(() => { throw new AgentError("PERMISSION_PATH_NOT_FOUND", `申请写入路径的父目录不存在：${value}`, 400) })
      return resolve(parent, absolute.slice(dirname(absolute).length + 1))
    }
  }
}

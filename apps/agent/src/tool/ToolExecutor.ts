import { AgentError, type PermissionDecision, type SubagentProfile, type TaskMode, type ToolAuthorizationScope, type ToolInvocation } from "../domain"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import {
  toolNameMatches,
  type ToolCatalog,
  type ToolFileSnapshots,
  type ToolInputInspection,
  type ToolProgress,
  type ToolRegistry,
} from "./ToolRegistry"
import { createToolExposurePlan, type ToolExposureInput } from "./ToolExposurePlan"
import { DEFAULT_PERMISSION_CONFIG, type AdditionalPermissions, type PermissionConfig, type PermissionGrantScope, type ShellInput } from "@codepilotx/shared/thread"
import { Model, Provider } from "@codepilotx/model-schema"
import { runHostCommand, type ProcessResult, type SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import { generateSandboxPolicy, pathContains } from "../sandbox/SandboxPolicy"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { PermissionDecisionEngine, hasRequestedPermissions, requestedPermissions } from "../permission/PermissionDecisionEngine"
import { resolveEffectivePermissionConfig } from "../permission/EffectivePermissionConfig"
import { PermissionGrantStore } from "../permission/PermissionGrantStore"
import { analyzeShellRisk } from "../security/ShellRiskClassifier"
import { secretScrubber } from "../security/SecretScrubber"
import { resolveManagedTool, resolveToolingEnvironment, runToolProcess, toolingPathOverride, type ToolingEnvironmentResolver, type ToolingResolver, type ToolProcessRunner } from "./ToolingRuntime"
import type { ManagedToolID, ToolingResolution } from "./ToolingManager"
import { applyEditText } from "./Edit/applyEditText"

const RUNTIME_COMMANDS: Readonly<Record<string, ManagedToolID>> = {
  node: "nodejs", npm: "nodejs", npx: "nodejs", corepack: "nodejs",
  python: "python", python3: "python", pip: "python", pip3: "python",
}

/** 仅在 shell 命令片段的起始位置识别需要注入的运行时。 */
export function shellRuntimeDependencies(command: string): ManagedToolID[] {
  const dependencies = new Set<ManagedToolID>()
  const segments: string[] = []
  let start = 0
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!
    if (escaped) { escaped = false; continue }
    if (character === "\\" || character === "`") { escaped = true; continue }
    if (quote) { if (character === quote) quote = null; continue }
    if (character === "'" || character === '"') { quote = character; continue }
    if ("|;&\r\n(){}".includes(character)) { segments.push(command.slice(start, index)); start = index + 1 }
  }
  segments.push(command.slice(start))
  for (const segment of segments) {
    const candidate = segment.trim().replace(/^sudo\s+/i, "")
    const raw = /^(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(candidate)?.slice(1).find(Boolean)
    if (!raw || raw.includes("/") || raw.includes("\\") || /^[a-z]:/i.test(raw)) continue
    const dependency = RUNTIME_COMMANDS[raw.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, "")]
    if (dependency) dependencies.add(dependency)
  }
  return [...dependencies]
}

const managedToolReadPaths = (id: ManagedToolID, resolution: ToolingResolution | undefined): string[] => {
  if (!resolution?.available || resolution.source !== "managed") return []
  const executableDirectory = dirname(resolution.path)
  if (id === "python") return [executableDirectory, join(executableDirectory, "Scripts")]
  if (id === "git-bash") return [dirname(executableDirectory)]
  return [executableDirectory]
}

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
  /** Host-derived scope fingerprint bound to the claimed approval. */
  approvedAuthorizationFingerprint?: string
  /** Runs normalization, hard-deny, hooks and review without executing the tool. */
  authorizationOnly?: boolean
  /** Optional active Skill ceiling. It can only remove tools from the effective policy. */
  allowedTools?: readonly string[]
  onProgress?: (progress: ToolProgress) => void
  /** Immutable tool catalog captured for this turn. */
  toolCatalog?: ToolCatalog
}

export interface ToolExecutorOptions {
  dataDir: string
  userConfigPath?: string
  validateConfigDocument?: (text: string, scope: "user" | "project") => void
  sandbox: SandboxRuntimeAdapter
  authorizeShell: (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>
  recordToolCall?: (invocation: ToolInvocation, status: "running" | "completed" | "error" | "interrupted", output?: unknown, error?: string | null, startedAt?: number) => void
  completedToolCall?: (toolCallID: string) => { name: string; input: Record<string, unknown>; output: unknown } | null
  helperPath?: string | null
  hooks?: {
    run(event: "pre_tool_use" | "post_tool_use" | "post_tool_error", evidence: unknown, context?: { threadID?: string; turnID?: string; toolCallID?: string; toolName?: string; workspaceRoot?: string }): Promise<Array<{ result: { decision: "continue" | "ask" | "deny"; reason?: string; narrowedInput?: Record<string, unknown> } }>>
  }
  prepareSandboxEscalation?: (invocation: ToolInvocation, failure: string) => { token: string }
  claimSandboxEscalation?: (token: string, scope: { threadID: string; turnID: string; agentID: string }) => { token: string; invocation: ToolInvocation; invocationHash: string; failure: string } | null
  completeSandboxEscalation?: (token: string, output: unknown) => void
  runHost?: typeof runHostCommand
  resolveTooling?: ToolingResolver
  resolveToolingEnvironment?: ToolingEnvironmentResolver
  runToolProcess?: ToolProcessRunner
  fileSaved?: (input: { workspaceRoot: string; filePath: string; content: string }) => Promise<void>
  permissionGrants?: PermissionGrantStore
}

/** The sole host-capability entrypoint. Later stages add approval and SRT gates here. */
export class ToolExecutor {
  private readonly decisions = new PermissionDecisionEngine()
  readonly permissionGrants: PermissionGrantStore
  private readonly readSnapshots = new Map<string, { mtimeMs: number; sha256: string }>()
  private sandboxDisposed = false
  constructor(private readonly registry: ToolRegistry, private readonly options?: ToolExecutorOptions) {
    this.permissionGrants = options?.permissionGrants ?? new PermissionGrantStore()
  }

  definition(name: string, catalog: ToolCatalog = this.registry) {
    return catalog.get(name)
  }

  exposurePlan(input: ToolExposureInput, catalog: ToolCatalog = this.registry) {
    return createToolExposurePlan(catalog, input)
  }

  deferredDefinitions(input: ToolExposureInput, catalog: ToolCatalog = this.registry) {
    return this.exposurePlan(input, catalog).deferred.map((name) => catalog.get(name))
  }

  async previewApproval(name: string, input: Record<string, unknown>, context: ToolExecutionContext, toolCallID: string) {
    return this.execute<PermissionDecision>(name, input, { ...context, toolCallID, authorizationOnly: true })
  }

  async execute<T = unknown>(name: string, input: Record<string, unknown>, context: ToolExecutionContext): Promise<T> {
    if (context.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    context = {
      ...context,
      permissionConfig: resolveEffectivePermissionConfig(
        context.taskMode,
        context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG,
      ),
    }
    const catalog = context.toolCatalog ?? this.registry
    const definition = catalog.get(name)
    if (context.allowedTools && !toolNameMatches(definition, context.allowedTools)) throw new AgentError("SKILL_TOOL_NOT_ALLOWED", `当前 Skill 不允许使用工具 ${definition.sdkName}`, 403)
    const parsed = definition.schema.safeParse(input)
    if (!parsed.success) throw new AgentError("INVALID_TOOL_INPUT", parsed.error.message, 400)
    const canonicalName = definition.sdkName
    const parsedInput = parsed.data as Record<string, unknown>
    const normalized = canonicalName === "Bash" || canonicalName === "PowerShell"
      ? {
          command: parsedInput.command,
          ...(parsedInput.cwd === undefined ? {} : { cwd: parsedInput.cwd }),
          ...(parsedInput.timeout === undefined ? {} : { timeoutMs: parsedInput.timeout }),
          ...(parsedInput.description === undefined ? {} : { justification: parsedInput.description }),
          ...(parsedInput.additionalPermissions === undefined ? {} : { additionalPermissions: parsedInput.additionalPermissions }),
        }
      : canonicalName === "request_permissions"
        ? await this.normalizePermissionRequest(parsedInput, context)
        : parsedInput
    if (context.taskMode === "plan" && canonicalName === "request_permissions") {
      throw new AgentError("TOOL_NOT_ALLOWED_IN_MODE", "Plan 模式禁止请求或提升权限", 403)
    }
    if (context.toolCallID && !context.authorizationOnly) {
      const completed = this.options?.completedToolCall?.(context.toolCallID)
      if (completed) {
        const storedInput = Object.fromEntries(Object.keys(normalized).map((key) => [key, completed.input[key]]))
        if (completed.name !== canonicalName || JSON.stringify(storedInput) !== JSON.stringify(normalized)) {
          throw new AgentError("TOOL_CALL_ID_CONFLICT", "toolCallId 已被不同的工具调用使用", 409)
        }
        return completed.output as T
      }
    }
    const profile = context.profile ?? "main"
    if (!definition.allowedProfiles.includes(profile)) throw new AgentError("TOOL_NOT_ALLOWED_FOR_PROFILE", `工具 ${canonicalName} 不允许 ${profile} profile 使用`, 403)
    if (canonicalName === "Bash" || canonicalName === "PowerShell") {
      const progress = definition.progress?.(parsed.data, {
        signal: context.signal,
        taskMode: context.taskMode,
        profile,
        workspace: context.workspace,
        permissionConfig: context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG,
        model: context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") }),
        ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      })
      if (progress) context.onProgress?.(progress)
      return await this.executeShell(canonicalName, normalized, context, catalog) as T
    }
    return this.executeRegistered<T>(canonicalName, normalized, context, catalog)
  }

  private async executeRegistered<T>(name: string, input: Record<string, unknown>, context: ToolExecutionContext, catalog: ToolCatalog) {
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    if (this.options?.userConfigPath) {
      context.workspace.grantEditorAlias("@codepilotx/config.toml", this.options.userConfigPath)
    }
    const definition = catalog.get(name)
    const fileSnapshots = this.fileSnapshots(context)
    const inspection = definition.inspectInput
      ? this.validateToolInputInspection(await definition.inspectInput(input, {
          signal: context.signal,
          taskMode: context.taskMode,
          profile: context.profile ?? "main",
          workspace: context.workspace,
          permissionConfig,
          model,
          fileSnapshots,
          ...(context.onProgress ? { onProgress: context.onProgress } : {}),
        }))
      : undefined
    for (const configWrite of inspection?.configWrites ?? []) {
      this.options?.validateConfigDocument?.(configWrite.content, configWrite.scope)
    }
    const authorizationScope = inspection?.authorizationScope
    const pathValue = typeof input.file_path === "string" ? input.file_path : input.path
    const relativeToolPath = typeof pathValue === "string" ? pathValue.replaceAll("\\", "/").toLowerCase() : ""
    if (
      typeof pathValue === "string"
      && pathValue === "@codepilotx/config.toml"
      && this.options?.userConfigPath
    ) {
      context.workspace.grantEditorAlias("@codepilotx/config.toml", this.options.userConfigPath)
    }
    const sensitiveEnvironment = /^\.env(?:\..+)?$/.test(relativeToolPath) && !/^\.env\.(?:example|template)$/.test(relativeToolPath)
    const protectedGitWrite = (name === "Write" || name === "Edit") && (relativeToolPath === ".git/config" || relativeToolPath.startsWith(".git/hooks/"))
    const protectedConfigWrite = (name === "Write" || name === "Edit")
      && (relativeToolPath === ".codepilotx/config.toml" || relativeToolPath === "@codepilotx/config.toml")
    if (protectedConfigWrite && this.options?.validateConfigDocument) {
      let nextContent = typeof input.content === "string" ? input.content : undefined
      if (name === "Edit") {
        const current = await context.workspace.readEditorFile(String(pathValue))
        const before = typeof input.old_string === "string" ? input.old_string : ""
        const after = typeof input.new_string === "string" ? input.new_string : ""
        nextContent = applyEditText(current.content, before, after, input.replace_all === true)
      }
      if (nextContent !== undefined) {
        this.options.validateConfigDocument(
          nextContent,
          relativeToolPath.startsWith("@") ? "user" : "project",
        )
      }
    }
    const policyInput = sensitiveEnvironment || protectedGitWrite || protectedConfigWrite || authorizationScope?.ruleRequiresApproval
      ? { ...input, __ruleRequiresApproval: true }
      : input
    const invocation: ToolInvocation = {
      id: context.toolCallID ?? crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name,
      input: policyInput,
      permissionConfig,
      model,
      taskMode: context.taskMode,
      ...(authorizationScope ? { authorizationScope } : {}),
      ...(context.authorizationOnly ? { durableApproval: true } : {}),
    }
    const resolved = this.decisions.evaluate(invocation, definition)
    if (resolved.action === "deny") throw new AgentError("TOOL_PERMISSION_DENIED", resolved.reason, 403, resolved)
    const resumedApproval = context.approvedToolCallID === invocation.id
    if (
      resumedApproval
      && invocation.authorizationScope?.fingerprint !== context.approvedAuthorizationFingerprint
    ) {
      throw new AgentError("APPROVAL_SCOPE_CHANGED", "工具输入或受影响文件范围已变化，需要重新审批", 409)
    }
    const hookResults = context.skipHooks || resumedApproval ? [] : await this.options?.hooks?.run("pre_tool_use", {
      input,
      resolved,
      ...(authorizationScope ? { authorizationScope } : {}),
    }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: name, workspaceRoot: context.workspace.rootPath }) ?? []
    const denied = hookResults.find(({ result }) => result.decision === "deny")
    if (denied) throw new AgentError("HOOK_DENIED", denied.result.reason ?? "PreToolUse Hook 拒绝执行", 403)
    const narrowed = hookResults.map(({ result }) => result.narrowedInput).filter((value): value is Record<string, unknown> => Boolean(value)).at(-1)
    if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
      if ((context.hookDepth ?? 0) >= 2) throw new AgentError("HOOK_REWRITE_LIMIT", "Hook 重写工具输入次数过多", 409)
      return this.execute<T>(name, { ...input, ...narrowed }, { ...context, hookDepth: (context.hookDepth ?? 0) + 1 })
    }
    const hookAsked = hookResults.some(({ result }) => result.decision === "ask")
    if (hookAsked) invocation.input = { ...invocation.input, __hookRequiresApproval: true }
    const grant = !resumedApproval && !hookAsked && resolved.action === "review"
      ? this.permissionGrantFor(invocation, definition, !context.authorizationOnly)
      : null
    let authorization: PermissionDecision = {
      decision: "allow",
      risk: resolved.risk,
      reason: grant ? `已使用 ${grant.scope} 临时权限` : "统一权限策略允许",
    }
    if ((resolved.action === "review" || hookAsked) && !resumedApproval && !grant) {
      if (!this.options) throw new AgentError("TOOL_REVIEW_REQUIRED", "工具需要审批但执行器未配置审批服务", 403)
      authorization = await this.options.authorizeShell(secretScrubber.scrub(invocation), context.signal)
    }
    if (context.authorizationOnly) {
      return {
        ...authorization,
        ...(authorizationScope ? { authorizationFingerprint: authorizationScope.fingerprint } : {}),
      } as T
    }
    if (authorization.decision !== "allow") throw new AgentError("TOOL_PERMISSION_DENIED", authorization.reason, 403, authorization)
    const startedAt = Date.now()
    const auditInvocation = secretScrubber.scrub(invocation)
    this.options?.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
    try {
      const filePath = typeof input.file_path === "string" ? input.file_path : null
      const snapshotKey = await this.snapshotKey(context, filePath)
      const deferredTools = this.deferredDefinitions({
        taskMode: context.taskMode,
        sandboxMode: permissionConfig.sandboxMode,
        profile: context.profile ?? "main",
        ...(context.allowedTools ? { allowedTools: context.allowedTools } : {}),
      }, catalog)
      for (const configWrite of inspection?.configWrites ?? []) {
        this.options?.validateConfigDocument?.(configWrite.content, configWrite.scope)
      }
      let output = await catalog.execute(name, input, {
        signal: context.signal,
        taskMode: context.taskMode,
        profile: context.profile ?? "main",
        workspace: context.workspace,
        permissionConfig,
        model,
        deferredTools,
        fileSnapshots,
        ...(authorizationScope ? { authorizationScope } : {}),
        resolveTooling: this.options?.resolveTooling ?? resolveManagedTool,
        runToolProcess: this.options?.runToolProcess ?? runToolProcess,
        invocation: {
          threadID: context.threadID,
          turnID: context.turnID,
          agentID: context.agentID ?? context.turnID,
          toolCallID: invocation.id,
        },
        ...(snapshotKey && this.readSnapshots.has(snapshotKey) ? { readSnapshot: this.readSnapshots.get(snapshotKey)! } : {}),
        ...(this.options?.fileSaved ? { fileSaved: (saved) => this.options!.fileSaved!({ workspaceRoot: context.workspace.rootPath, ...saved }) } : {}),
        ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      })
      if (name === "request_permissions") {
        const grantResult = await this.applyPermissionGrant({
          scope: input.scope,
          requestedPermissions: input,
          grantedPermissions: input,
        }, context)
        const escalation = typeof input.escalationToken === "string"
          ? await this.executeSandboxEscalation(input.escalationToken, context)
          : undefined
        output = {
          ...(output && typeof output === "object" ? output : {}),
          grant: grantResult,
          ...(escalation ? { escalation } : {}),
        }
      }
      if (filePath && ["Read", "Write", "Edit"].includes(name)) {
        const savedSnapshotKey = await this.snapshotKey(context, filePath)
        const revision = (output as { snapshot?: { mtimeMs: number; sha256: string }; revision?: { mtimeMs: number; sha256: string } }).snapshot ?? (output as { revision?: { mtimeMs: number; sha256: string } }).revision
          ?? (await context.workspace.readEditorFile(String(input.file_path))).revision
        if (savedSnapshotKey) this.readSnapshots.set(savedSnapshotKey, revision)
      }
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

  private async executeShell(shellTool: "Bash" | "PowerShell", input: Record<string, unknown>, context: ToolExecutionContext, catalog: ToolCatalog): Promise<ProcessResult | PermissionDecision> {
    const options = this.options
    if (!options) throw new AgentError("SHELL_EXECUTOR_REQUIRED", "Shell 执行器未配置", 500)
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model = context.model ?? Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
    const parsedShell = this.parseShellInput(input)
    if (
      context.taskMode === "plan"
      && (
        (parsedShell.additionalPermissions?.writePaths?.length ?? 0) > 0
        || (parsedShell.additionalPermissions?.networkDomains?.length ?? 0) > 0
      )
    ) {
      throw new AgentError("PLAN_READ_ONLY_PERMISSION_DENIED", "Plan 模式的 Shell 只允许申请额外读取路径", 403)
    }
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
      const outsideWorkspace = !context.workspace.containsPath(cwd)
      if (outsideWorkspace && !(shell.additionalPermissions?.readPaths ?? []).some((path) => pathContains(path, cwd))) {
        throw new AgentError("SHELL_CWD_PERMISSION_REQUIRED", "工作区外 cwd 必须在 additionalPermissions.readPaths 中声明", 403)
      }
    }
    const invocation: ToolInvocation = {
      id: context.toolCallID ?? crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name: shellTool,
      input: {
        ...shell as unknown as Record<string, unknown>,
        __shellTool: shellTool,
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
      const hookResults = context.skipHooks || resumedApproval ? [] : await this.options.hooks?.run("pre_tool_use", { input: invocation.input, staticRisk }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: shellTool, workspaceRoot: context.workspace.rootPath }) ?? []
      const denied = hookResults.find(({ result }) => result.decision === "deny")
      if (denied) throw new AgentError("HOOK_DENIED", denied.result.reason ?? "PreToolUse Hook 拒绝执行", 403)
      const narrowed = hookResults.map(({ result }) => result.narrowedInput).filter((value): value is Record<string, unknown> => Boolean(value)).at(-1)
      if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
        if ((context.hookDepth ?? 0) >= 2) throw new AgentError("HOOK_REWRITE_LIMIT", "Hook 重写 Shell 输入次数过多", 409)
        return this.executeShell(shellTool, { ...input, ...narrowed }, { ...context, hookDepth: (context.hookDepth ?? 0) + 1 }, catalog)
      }
      if (hookResults.some(({ result }) => result.decision === "ask")) invocation.input = { ...invocation.input, __hookRequiresApproval: true }
      const grant = resumedApproval
        ? null
        : this.permissionGrantFor(invocation, catalog.get(shellTool), !context.authorizationOnly)
      const decision = resumedApproval
        ? { decision: "allow", risk: staticRisk.risk, reason: "已恢复并校验一次性审批" } satisfies PermissionDecision
        : grant
          ? { decision: "allow", risk: staticRisk.risk, reason: `已使用 ${grant.scope} 临时权限` } satisfies PermissionDecision
          : await this.options.authorizeShell(secretScrubber.scrub(invocation), context.signal)
      if (context.authorizationOnly) return decision
      if (decision.decision !== "allow") throw new AgentError("SHELL_PERMISSION_DENIED", decision.reason, 403, decision)
      const runtime = await this.commandForShell(shellTool, parsedShell.command, context.signal)
      const startedAt = Date.now()
      const auditInvocation = secretScrubber.scrub(invocation)
      this.options.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
      if (permissionConfig.sandboxMode === "danger-full-access") {
        const result = await (this.options.runHost ?? runHostCommand)(runtime.command, cwd, shell.timeoutMs, context.signal, runtime.env)
        const safeResult = secretScrubber.scrub(result)
        this.options.recordToolCall?.(auditInvocation, "completed", safeResult, null, startedAt)
        if (!context.skipHooks) await this.options.hooks?.run("post_tool_use", { input: invocation.input, output: safeResult }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: shellTool, workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
        return result
      }
      return await this.withSandboxTemp(async (sessionTemp) => {
        const policy = generateSandboxPolicy({
          workspace: workspaceRoot,
          workspaceRoots: context.workspace.roots,
          writableWorkspaceRoots: context.workspace.writableRoots,
          sessionTemp,
          dataDir: options.dataDir,
          permissionConfig,
          ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}),
          ...(options.helperPath ? { helperPath: options.helperPath } : {}),
          trustedReadPaths: runtime.trustedReadPaths,
        })
        let result: ProcessResult
        try {
          result = await options.sandbox.run({
            command: runtime.command,
            cwd,
            env: runtime.env,
            ...(shell.timeoutMs === undefined ? {} : { timeoutMs: shell.timeoutMs }),
            config: policy.config,
            signal: context.signal,
          })
        } catch (sandboxCause) {
          if (permissionConfig.approvalPolicy !== "on-failure") throw sandboxCause
          if (!options.prepareSandboxEscalation) throw sandboxCause
          const failure = sandboxCause instanceof Error ? sandboxCause.message : String(sandboxCause)
          const escalation = options.prepareSandboxEscalation(invocation, failure)
          result = {
            exitCode: 126, signal: null, stdout: "", timedOut: false, truncated: false,
            stderr: `SANDBOX_ESCALATION_REQUIRED ${JSON.stringify({ escalationToken: escalation.token, action: "call request_permissions", justification: "sandbox execution failed; request one-time host execution" })}`,
          }
        }
        const safeResult = secretScrubber.scrub(result)
        options.recordToolCall?.(auditInvocation, "completed", safeResult, null, startedAt)
        if (!context.skipHooks) await options.hooks?.run("post_tool_use", { input: invocation.input, output: safeResult }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: shellTool, workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
        return result
      })
    } catch (cause) {
      if (!context.authorizationOnly) {
        const startedAt = Date.now()
        this.options.recordToolCall?.(secretScrubber.scrub(invocation), context.signal.aborted ? "interrupted" : "error", null, secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)), startedAt)
      }
      if (!context.skipHooks && !context.authorizationOnly) await this.options.hooks?.run("post_tool_error", { input: invocation.input, error: secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)) }, { threadID: context.threadID, turnID: context.turnID, toolCallID: invocation.id, toolName: shellTool, workspaceRoot: context.workspace.rootPath }).catch(() => undefined)
      throw cause
    }
  }

  async applyPermissionGrant(input: {
    scope: unknown
    requestedPermissions: Record<string, unknown>
    grantedPermissions: Record<string, unknown>
  }, context: ToolExecutionContext) {
    if (context.taskMode === "plan") throw new AgentError("TOOL_NOT_ALLOWED_IN_MODE", "Plan 模式禁止请求或提升权限", 403)
    if (!["tool-call", "turn", "session"].includes(String(input.scope))) {
      throw new AgentError("INVALID_TOOL_INPUT", "权限 scope 无效", 400)
    }
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const requested = await this.normalizeAdditionalPermissions(input.requestedPermissions, workspaceRoot)
    const granted = await this.normalizeAdditionalPermissions(input.grantedPermissions, workspaceRoot)
    const grant = this.permissionGrants.grant({
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      scope: input.scope as PermissionGrantScope,
      requested,
      granted,
    })
    return grant
      ? { granted: true, grantId: grant.id, scope: grant.scope, permissions: grant.permissions }
      : { granted: false, scope: input.scope, permissions: { readPaths: [], writePaths: [], networkDomains: [] } }
  }

  clearTurnPermissionGrants(threadID: string, turnID: string) {
    this.permissionGrants.clearTurn(threadID, turnID)
  }

  clearThreadPermissionGrants(threadID: string) {
    this.permissionGrants.clearThread(threadID)
  }

  async executeSandboxEscalation(token: string, context: ToolExecutionContext): Promise<ProcessResult> {
    if (context.taskMode === "plan") throw new AgentError("TOOL_NOT_ALLOWED_IN_MODE", "Plan 模式禁止宿主执行升级", 403)
    if (!this.options?.claimSandboxEscalation || !this.options.completeSandboxEscalation) throw new AgentError("SANDBOX_ESCALATION_UNAVAILABLE", "Sandbox escalation 服务未配置", 503)
    const agentID = context.agentID ?? context.turnID
    const escalation = this.options.claimSandboxEscalation(token, { threadID: context.threadID, turnID: context.turnID, agentID })
    if (!escalation) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation 不存在、已消费、被篡改或作用域不匹配", 409)
    const input = escalation.invocation.input
    if (!["Bash", "PowerShell"].includes(escalation.invocation.name) || typeof input.command !== "string" || typeof input.cwd !== "string") throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation invocation 无效", 409)
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
    if (!context.workspace.containsPath(cwd) && !(shell.additionalPermissions?.readPaths ?? []).some((path) => pathContains(path, cwd))) throw new AgentError("SANDBOX_ESCALATION_INVALID", "Sandbox escalation cwd 不在已审批路径内", 409)
    const staticRisk = analyzeShellRisk({ command: shell.command, cwd, ...(shell.additionalPermissions ? { additionalPermissions: shell.additionalPermissions } : {}), justification: "一次性 sandbox failure escalation" })
    if (staticRisk.hardDenied) throw new AgentError("SHELL_HARD_DENY", staticRisk.reason, 403, staticRisk)
    const auditInvocation = secretScrubber.scrub({ ...escalation.invocation, id: crypto.randomUUID(), name: "shell.host-escalation", input: { ...input, escalationToken: token, failureSummary: escalation.failure } })
    const startedAt = Date.now()
    this.options.recordToolCall?.(auditInvocation, "running", null, null, startedAt)
    try {
      const runtime = await this.commandForShell(escalation.invocation.name as "Bash" | "PowerShell", shell.command, context.signal)
      const result = await (this.options.runHost ?? runHostCommand)(runtime.command, cwd, shell.timeoutMs, context.signal, runtime.env)
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

  private async snapshotKey(context: ToolExecutionContext, path: string | null) {
    if (!path) return null
    let normalized: string
    try {
      normalized = await context.workspace.resolveEditorFilePath(path)
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === "WORKSPACE_PATH_NOT_FOUND") return null
      throw cause
    }
    normalized = normalized.replaceAll("\\", "/")
    return `${context.threadID}:${context.agentID ?? context.turnID}:${process.platform === "win32" ? normalized.toLowerCase() : normalized}`
  }

  private fileSnapshots(context: ToolExecutionContext): ToolFileSnapshots {
    return {
      get: async (path) => {
        const key = await this.snapshotKey(context, path)
        return key ? this.readSnapshots.get(key) : undefined
      },
      set: async (path, revision) => {
        const key = await this.snapshotKey(context, path)
        if (key) this.readSnapshots.set(key, revision)
      },
      invalidate: async (paths) => {
        for (const path of paths) {
          const key = await this.snapshotKey(context, path)
          if (key) this.readSnapshots.delete(key)
        }
      },
    }
  }

  private validateToolInputInspection(value: ToolInputInspection): ToolInputInspection {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AgentError("INVALID_TOOL_INSPECTION", "工具输入检查结果无效", 500)
    }
    const scope = value.authorizationScope as ToolAuthorizationScope | undefined
    if (
      !scope
      || typeof scope !== "object"
      || !Array.isArray(scope.affectedPaths)
      || scope.affectedPaths.length === 0
      || scope.affectedPaths.length > 256
      || !/^[a-f0-9]{64}$/.test(scope.fingerprint)
      || typeof scope.ruleRequiresApproval !== "boolean"
    ) {
      throw new AgentError("INVALID_TOOL_INSPECTION", "工具授权范围无效", 500)
    }
    const affectedPaths = scope.affectedPaths.map((affected) => {
      if (
        !affected
        || typeof affected !== "object"
        || typeof affected.path !== "string"
        || !affected.path.trim()
        || affected.path.length > 1_024
        || /[\0\r\n]/.test(affected.path)
        || (affected.operation !== "create" && affected.operation !== "update")
      ) {
        throw new AgentError("INVALID_TOOL_INSPECTION", "工具授权路径无效", 500)
      }
      return { path: affected.path, operation: affected.operation }
    })
    const pathKeys = affectedPaths.map(({ path }) => process.platform === "win32" ? path.toLowerCase() : path)
    if (new Set(pathKeys).size !== pathKeys.length) {
      throw new AgentError("INVALID_TOOL_INSPECTION", "工具授权路径重复", 500)
    }
    const reviewSummary = scope.reviewSummary
    if (reviewSummary) {
      const values = [
        reviewSummary.fileCount,
        reviewSummary.hunkCount,
        reviewSummary.additions,
        reviewSummary.deletions,
      ]
      if (
        values.some((item) => !Number.isSafeInteger(item) || item < 0)
        || reviewSummary.fileCount !== affectedPaths.length
      ) {
        throw new AgentError("INVALID_TOOL_INSPECTION", "工具变更摘要无效", 500)
      }
    }
    if (value.configWrites !== undefined && !Array.isArray(value.configWrites)) {
      throw new AgentError("INVALID_TOOL_INSPECTION", "配置写入检查结果无效", 500)
    }
    const configWrites = value.configWrites?.map((write) => {
      const pathKey = typeof write?.path === "string"
        ? (process.platform === "win32" ? write.path.toLowerCase() : write.path)
        : ""
      if (
        !write
        || typeof write.path !== "string"
        || !write.path.trim()
        || write.path.length > 1_024
        || /[\0\r\n]/.test(write.path)
        || typeof write.content !== "string"
        || (write.scope !== "user" && write.scope !== "project")
        || !pathKeys.includes(pathKey)
      ) {
        throw new AgentError("INVALID_TOOL_INSPECTION", "配置写入检查结果无效", 500)
      }
      return { path: write.path, content: write.content, scope: write.scope }
    })
    return {
      authorizationScope: {
        affectedPaths,
        fingerprint: scope.fingerprint,
        ruleRequiresApproval: scope.ruleRequiresApproval,
        ...(reviewSummary ? { reviewSummary: { ...reviewSummary } } : {}),
      },
      ...(configWrites ? { configWrites } : {}),
    }
  }

  async dispose(): Promise<void> {
    if (this.sandboxDisposed) return
    this.sandboxDisposed = true
    await this.options?.sandbox.dispose()
  }

  private async withSandboxTemp<T>(operation: (sessionTemp: string) => Promise<T>): Promise<T> {
    if (this.sandboxDisposed) throw new AgentError("SHELL_EXECUTOR_DISPOSED", "Shell 执行器已关闭", 503)
    const sessionTemp = await mkdtemp(join(tmpdir(), "codepilotx-sandbox-"))
    try {
      return await operation(sessionTemp)
    } finally {
      // A command may already have produced side effects. Cleanup failure must
      // not turn a successful command into a retryable tool failure.
      await rm(sessionTemp, { recursive: true, force: true }).catch(() => undefined)
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

  private permissionGrantFor(
    invocation: ToolInvocation,
    tool: ReturnType<ToolCatalog["get"]>,
    consumeToolCall: boolean,
  ) {
    if (!hasRequestedPermissions(invocation.input)) return null
    const requestedDecision = this.decisions.evaluate(invocation, tool)
    if (requestedDecision.action !== "review") return null
    const baselineInput = { ...invocation.input }
    delete baselineInput.additionalPermissions
    const baseline = this.decisions.evaluate({ ...invocation, input: baselineInput }, tool)
    if (baseline.action !== "allow") return null
    return this.permissionGrants.authorize({
      threadID: invocation.threadID,
      turnID: invocation.turnID,
      agentID: invocation.agentID,
      requested: requestedPermissions(invocation.input),
      consumeToolCall,
    })
  }

  private async normalizePermissionRequest(input: Record<string, unknown>, context: ToolExecutionContext) {
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const permissions = await this.normalizeAdditionalPermissions(input, workspaceRoot)
    return {
      scope: input.scope,
      ...permissions,
      ...(typeof input.escalationToken === "string" ? { escalationToken: input.escalationToken } : {}),
      justification: input.justification,
    }
  }

  private async normalizeAdditionalPermissions(input: Record<string, unknown>, workspaceRoot: string): Promise<AdditionalPermissions> {
    const strings = (name: "readPaths" | "writePaths" | "networkDomains") => {
      const value = input[name]
      if (value === undefined) return []
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
        throw new AgentError("INVALID_TOOL_INPUT", `${name} 必须是非空字符串数组`, 400)
      }
      return [...new Set(value.map((item) => String(item).trim()))]
    }
    const readPaths = await Promise.all(strings("readPaths").map((path) => this.canonicalPath(workspaceRoot, path, false)))
    const writePaths = await Promise.all(strings("writePaths").map((path) => this.canonicalPath(workspaceRoot, path, true)))
    const networkDomains = strings("networkDomains").map((domain) => {
      const normalized = domain.toLowerCase().replace(/\.$/, "")
      if (
        normalized === "localhost"
        || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)
      ) return normalized
      throw new AgentError("INVALID_TOOL_INPUT", `networkDomains 包含无效域名：${domain}`, 400)
    })
    return {
      ...(readPaths.length ? { readPaths } : {}),
      ...(writePaths.length ? { writePaths } : {}),
      ...(networkDomains.length ? { networkDomains } : {}),
    }
  }

  private async commandForShell(shellTool: "Bash" | "PowerShell", command: string, signal: AbortSignal) {
    const required = shellRuntimeDependencies(command)
    const environment = required.length > 0
      ? await (this.options?.resolveToolingEnvironment ?? resolveToolingEnvironment)(required, { signal })
      : { pathEntries: [] as readonly string[], resolutions: new Map<ManagedToolID, ToolingResolution>() }
    for (const id of required) {
      const resolution = environment.resolutions.get(id)
      if (!resolution?.available) {
        throw new AgentError("RUNTIME_DEPENDENCY_UNAVAILABLE", resolution?.reason ?? `${id} 运行环境不可用`, 503, {
          toolingID: id,
          reason: resolution?.code ?? "TOOLING_UNAVAILABLE",
        })
      }
    }
    const env = toolingPathOverride(environment.pathEntries)
    const trustedReadPaths = required.flatMap((id) => managedToolReadPaths(id, environment.resolutions.get(id)))
    if (process.platform === "win32" && shellTool === "Bash") {
      const resolution = await (this.options?.resolveTooling ?? resolveManagedTool)("git-bash", { signal })
      if (!resolution.available) throw new AgentError("BASH_RUNTIME_UNAVAILABLE", resolution.reason, 503, { toolingID: "git-bash", reason: resolution.code })
      const executable = resolution.path.replaceAll("'", "''")
      return {
        command: `& '${executable}' -lc '${command.replaceAll("'", "''")}'`,
        env,
        trustedReadPaths: [...trustedReadPaths, ...managedToolReadPaths("git-bash", resolution)],
      }
    }
    if (process.platform !== "win32" && shellTool === "PowerShell") {
      return { command: `pwsh -NoProfile -NonInteractive -Command '${command.replaceAll("'", "'\\''")}'`, env, trustedReadPaths }
    }
    return { command, env, trustedReadPaths }
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

import { isGranularApprovalPolicy } from "@codepilotx/shared/thread"
import type { PermissionDecision, ToolInvocation } from "../domain"
import type { ToolCatalogEntry } from "../tool/ToolRegistry"
import { toolAllowedForFileAccess, toolAllowedInTaskMode } from "../tool/ToolRegistry"
import { resolveEffectivePermissionConfig } from "./EffectivePermissionConfig"
import { executionPolicyFromV4, type EffectiveExecutionPolicy, type FileAccessProfile } from "./ExecutionPolicy"

export interface RequestedPermissions { readPaths: string[]; writePaths: string[]; networkDomains: string[] }
export interface ResolvedExecutionPolicy extends EffectiveExecutionPolicy {
  requested: RequestedPermissions
  networkAllowed: boolean
}
export type ResolvedPermissionDecision =
  | { action: "allow"; sandbox: ResolvedExecutionPolicy; decision: "allow"; risk: PermissionDecision["risk"]; reason: string }
  | { action: "review"; reviewer: "user" | "auto_review"; sandbox: ResolvedExecutionPolicy; decision: "ask"; risk: PermissionDecision["risk"]; reason: string }
  | { action: "deny"; reason: string; decision: "deny"; risk: PermissionDecision["risk"] }

export const requestedPermissions = (input: Record<string, unknown>): RequestedPermissions => {
  const raw = input.additionalPermissions ?? (input.scope ? input : undefined)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { readPaths: [], writePaths: [], networkDomains: [] }
  const value = raw as Record<string, unknown>
  const list = (key: string) => Array.isArray(value[key]) ? value[key].filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
  return { readPaths: list("readPaths"), writePaths: list("writePaths"), networkDomains: list("networkDomains") }
}

export const hasRequestedPermissions = (input: Record<string, unknown>) => Object.values(requestedPermissions(input)).some((items) => items.length > 0)

const riskFor = (invocation: ToolInvocation, tool: ToolCatalogEntry, fileAccess: FileAccessProfile): PermissionDecision["risk"] => {
  const requested = requestedPermissions(invocation.input)
  if (fileAccess === "full-access" || tool.capabilities.filesystem === "host-write") return "critical"
  if (requested.writePaths.length || tool.capabilities.filesystem === "workspace-write" || tool.capabilities.externalState) return "high"
  if (requested.networkDomains.length || tool.capabilities.process) return "medium"
  return "low"
}

const approvalCapability = (invocation: ToolInvocation, tool: ToolCatalogEntry) => {
  if (tool.sdkName === "request_permissions") return "requestPermissions" as const
  if (invocation.input.__skillScript === true) return "skillApproval" as const
  if (tool.origin?.kind === "mcp") return "mcpTools" as const
  if (invocation.input.__ruleRequiresApproval === true) return "rules" as const
  if (tool.capabilities.process || tool.capabilities.filesystem === "host-write") return "sandboxApproval" as const
  return "rules" as const
}

const hardGatedCapability = (invocation: ToolInvocation, tool: ToolCatalogEntry) => {
  if (tool.sdkName === "request_permissions") return "requestPermissions" as const
  if (invocation.input.__skillScript === true) return "skillApproval" as const
  if (tool.origin?.kind === "mcp") return "mcpTools" as const
  return null
}

/** Pure permission truth source used by prompting, exposure, approval and execution. */
export class PermissionDecisionEngine {
  evaluate(invocation: ToolInvocation, tool: ToolCatalogEntry): ResolvedPermissionDecision {
    invocation = {
      ...invocation,
      permissionConfig: resolveEffectivePermissionConfig(
        invocation.taskMode,
        invocation.permissionConfig,
      ),
    }
    const executionPolicy = executionPolicyFromV4(invocation.permissionConfig)
    const risk = riskFor(invocation, tool, executionPolicy.fileAccess)
    const deny = (reason: string): ResolvedPermissionDecision => ({ action: "deny", decision: "deny", risk, reason })
    if (!toolAllowedInTaskMode(tool, invocation.taskMode)) return deny(`工具 ${tool.sdkName} 不允许在 ${invocation.taskMode} 模式执行`)
    if (invocation.taskMode === "plan" && tool.sdkName === "request_permissions") return deny("Plan 模式禁止请求或提升权限")
    if (!toolAllowedForFileAccess(tool, executionPolicy.fileAccess)) return deny(`${executionPolicy.fileAccess} 文件访问范围禁止 ${tool.capabilities.filesystem} 能力`)
    const requested = requestedPermissions(invocation.input)
    if (executionPolicy.fileAccess === "read-only" && requested.writePaths.length) return deny("只读文件访问范围禁止写入路径")
    if (invocation.taskMode === "plan" && requested.networkDomains.length) return deny("Plan 模式禁止 Shell 网络权限")
    // The durable checkpoint field remains named `sandbox` for v4/SQLite
    // compatibility. Its value is the centrally interpreted execution policy.
    const sandbox: ResolvedExecutionPolicy = {
      ...executionPolicy,
      requested,
      networkAllowed: requested.networkDomains.length > 0,
    }
    const allow = (reason: string): ResolvedPermissionDecision => ({ action: "allow", sandbox, decision: "allow", risk, reason })
    const review = (reason: string): ResolvedPermissionDecision => ({ action: "review", reviewer: invocation.permissionConfig.approvalsReviewer, sandbox, decision: "ask", risk, reason })
    const policy = invocation.permissionConfig.approvalPolicy
    // Capability switches are hard gates, not merely instructions about who
    // reviews a request. They must run before always-review can create one.
    const hardCapability = hardGatedCapability(invocation, tool)
    if (isGranularApprovalPolicy(policy) && hardCapability) {
      return policy[hardCapability]
        ? review(`granular 策略要求审批 ${hardCapability} capability`)
        : deny(`granular 策略禁止 ${hardCapability} capability`)
    }
    if (tool.approvalStrategy === "never-review") return allow("工具声明为无需审批")
    if (tool.approvalStrategy === "always-review") return invocation.permissionConfig.approvalPolicy === "never" ? deny("never 策略禁止等待审批") : review("工具始终需要审批")

    // sandboxMode remains only as the v4/SQLite compatibility field. It maps
    // to structured file access and never claims an OS boundary for Shell.
    const mutatingMcpTool = tool.origin?.kind === "mcp" && tool.capabilities.externalState
    const elevated = hasRequestedPermissions(invocation.input) || invocation.authorizationScope?.ruleRequiresApproval === true || invocation.input.__hookRequiresApproval === true || invocation.input.__ruleRequiresApproval === true || mutatingMcpTool
    if (isGranularApprovalPolicy(policy)) return policy[approvalCapability(invocation, tool)] ? review("细粒度策略要求审批") : elevated ? deny("细粒度策略禁止此权限请求") : allow("细粒度策略允许当前文件访问范围内执行")
    if (policy === "untrusted") return tool.capabilities.filesystem === "read" && !tool.capabilities.process && !elevated ? allow("可信纯读取操作") : review("untrusted 策略要求审批非纯读取操作")
    if (policy === "on-failure") return elevated ? review("额外权限需要审批") : allow("按当前文件访问范围直接执行")
    if (policy === "on-request") return elevated ? review("额外路径、网络或规则要求审批") : allow("当前文件访问范围内执行")
    return elevated ? deny("never 策略禁止权限提升") : allow("never 策略按当前文件访问范围执行")
  }
}

import type { SubagentProfile, TaskMode } from "../domain"
import type { SandboxMode } from "@codepilotx/shared/thread"
import type { ToolCatalog } from "./ToolRegistry"

export const PI_LIFECYCLE_TOOLS = [
  "skill_list", "skill_read", "project_source_list", "project_source_read",
  "request_user_input", "request_permissions", "update_plan",
  "spawn_agents", "wait_agents", "send_agent", "stop_agent",
  "finalize_result",
] as const

export interface ToolExposureInput {
  taskMode: TaskMode
  sandboxMode: SandboxMode
  profile?: SubagentProfile
  hasSkillService?: boolean
  hasProjectSources?: boolean
  defaultModeRequestUserInput?: boolean
  delegationEnabled?: boolean
  allowedTools?: readonly string[]
  activeDeferredTools?: readonly string[]
}

export interface ToolExposurePlan {
  eager: readonly string[]
  deferred: readonly string[]
  exposed: readonly string[]
  allows(name: string): boolean
}

/** Single source of truth for prompt composition and Pi runtime exposure. */
export function createToolExposurePlan(catalog: ToolCatalog, input: ToolExposureInput): ToolExposurePlan {
  const profile = input.profile ?? "main"
  const sandboxMode = input.taskMode === "plan" ? "read-only" : input.sandboxMode
  const definitions = catalog.list(input.taskMode, sandboxMode, profile)
  const eager = definitions.filter((tool) => tool.visibility === "eager").map((tool) => tool.sdkName)
  const deferredCandidates = definitions.filter((tool) => tool.visibility === "deferred").map((tool) => tool.sdkName)
  const lifecycle: string[] = []
  if (input.hasSkillService) lifecycle.push("skill_list", "skill_read")
  if (input.hasProjectSources) lifecycle.push("project_source_list", "project_source_read")
  if (profile !== "main") lifecycle.push("finalize_result")
  else {
    if (input.taskMode === "plan" || input.defaultModeRequestUserInput) lifecycle.push("request_user_input")
    if (input.taskMode === "chat") {
      // Chat 主 Agent 可选用结构化交付收尾；Plan 继续以 <proposed_plan> 交付。
      lifecycle.push("request_permissions", "update_plan", "finalize_result")
    }
    if (input.delegationEnabled !== false) lifecycle.push("spawn_agents", "wait_agents", "send_agent", "stop_agent")
  }

  const allowlist = input.allowedTools ? new Set(input.allowedTools) : null
  const deferred = deferredCandidates.filter((name) => !allowlist || allowlist.has(name))
  const activeDeferred = new Set(input.activeDeferredTools ?? [])
  const contextuallyActiveDeferred = deferredCandidates.filter((name) => (
    activeDeferred.has(name) && (!allowlist || allowlist.has(name))
  ))
  const explicitlyAllowedDeferred = allowlist
    ? deferredCandidates.filter((name) => allowlist.has(name))
    : []
  // 子 Agent 无论 allowlist 收紧都必须能够收尾提交；主 Agent 的 finalize_result
  // 与其他生命周期工具一样服从 Skill allowlist。
  const finalizers = new Set(["finalize_result"])
  const lifecycleExemption = profile !== "main" ? (name: string) => finalizers.has(name) : () => false
  const exposed = [...new Set([
    ...eager,
    ...contextuallyActiveDeferred,
    ...explicitlyAllowedDeferred,
    ...lifecycle,
  ])].filter((name) => !allowlist || allowlist.has(name) || lifecycleExemption(name))
  const exposedSet = new Set(exposed)
  return { eager: eager.filter((name) => exposedSet.has(name)), deferred, exposed, allows: (name) => exposedSet.has(name) }
}

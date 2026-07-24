import type { SubagentProfile, TaskMode } from "../domain"
import type { SandboxMode } from "@codepilotx/shared/thread"
import type { ToolCatalog } from "./ToolRegistry"

export const PI_LIFECYCLE_TOOLS = [
  "skill_list", "skill_read", "request_user_input", "request_permissions",
  "spawn_agents", "wait_agents", "send_agent", "stop_agent",
  "finalize_plan", "finalize_result",
] as const

export interface ToolExposureInput {
  taskMode: TaskMode
  sandboxMode: SandboxMode
  profile?: SubagentProfile
  hasSkillService?: boolean
  continueFromPlan?: boolean
  defaultModeRequestUserInput?: boolean
  allowedTools?: readonly string[]
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
  const definitions = catalog.list(input.taskMode, input.sandboxMode, profile)
  const eager = definitions.filter((tool) => tool.visibility === "eager").map((tool) => tool.sdkName)
  const deferredCandidates = definitions.filter((tool) => tool.visibility === "deferred").map((tool) => tool.sdkName)
  const lifecycle: string[] = []
  if (input.hasSkillService) lifecycle.push("skill_list", "skill_read")
  if (profile !== "main") lifecycle.push("finalize_result")
  else {
    if ((input.taskMode === "plan" && !input.continueFromPlan) || input.defaultModeRequestUserInput) lifecycle.push("request_user_input")
    lifecycle.push("request_permissions", "spawn_agents", "wait_agents", "send_agent", "stop_agent")
  }
  if (input.taskMode === "plan" && !input.continueFromPlan) lifecycle.push("finalize_plan")

  const allowlist = input.allowedTools ? new Set(input.allowedTools) : null
  const deferred = deferredCandidates.filter((name) => !allowlist || allowlist.has(name))
  const finalizers = new Set(["finalize_plan", "finalize_result"])
  const exposed = [...eager, ...lifecycle].filter((name) => !allowlist || allowlist.has(name) || finalizers.has(name))
  const exposedSet = new Set(exposed)
  return { eager: eager.filter((name) => exposedSet.has(name)), deferred, exposed, allows: (name) => exposedSet.has(name) }
}

import { describe, expect, test } from "bun:test"
import { createToolExposurePlan } from "../src/tool/ToolExposurePlan"
import { ToolCatalog } from "../src/tool/ToolRegistry"
import type { SubagentProfile, TaskMode } from "../src/domain"

const exposure = (input: {
  taskMode: TaskMode
  profile?: SubagentProfile
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access"
  allowedTools?: readonly string[]
}) => createToolExposurePlan(new ToolCatalog(), {
  taskMode: input.taskMode,
  sandboxMode: input.sandboxMode ?? "workspace-write",
  ...(input.profile ? { profile: input.profile } : {}),
  ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
})

describe("ToolExposurePlan finalize_result exposure", () => {
  test("Chat 主 Agent 暴露 finalize_result 结构化交付工具", () => {
    const plan = exposure({ taskMode: "chat", profile: "main" })
    expect(plan.allows("finalize_result")).toBe(true)
    expect(plan.allows("update_plan")).toBe(true)
    expect(plan.allows("request_permissions")).toBe(true)
    expect(plan.exposed).toContain("finalize_result")
  })

  test("Plan 主 Agent 不暴露 finalize_result，继续以 <proposed_plan> 交付", () => {
    const plan = exposure({ taskMode: "plan", profile: "main" })
    expect(plan.allows("finalize_result")).toBe(false)
    expect(plan.allows("update_plan")).toBe(false)
    expect(plan.allows("request_permissions")).toBe(false)
  })

  test("子 Agent 各 profile 暴露 finalize_result，但不暴露主 Agent 生命周期工具", () => {
    for (const profile of ["default", "explorer", "worker"] as const) {
      const plan = exposure({ taskMode: "chat", profile })
      expect(plan.allows("finalize_result")).toBe(true)
      expect(plan.allows("update_plan")).toBe(false)
      expect(plan.allows("request_permissions")).toBe(false)
      expect(plan.allows("spawn_agents")).toBe(false)
    }
  })

  test("主 Agent 的 finalize_result 服从 Skill allowlist，子 Agent 的收尾工具不被剥离", () => {
    const main = exposure({
      taskMode: "chat",
      profile: "main",
      allowedTools: ["Read"],
    })
    expect(main.allows("Read")).toBe(true)
    expect(main.allows("finalize_result")).toBe(false)
    const subagent = exposure({
      taskMode: "chat",
      profile: "default",
      allowedTools: ["Read"],
    })
    expect(subagent.allows("Read")).toBe(true)
    expect(subagent.allows("finalize_result")).toBe(true)
  })
})

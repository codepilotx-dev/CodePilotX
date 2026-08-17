import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import { PermissionDecisionEngine, type PermissionPolicyOverride } from "../src/permission/PermissionDecisionEngine"
import type { ToolCatalogEntry } from "../src/tool/ToolRegistry"
import type { ToolInvocation } from "../src/domain"

const invocation = (overrides: Partial<ToolInvocation> = {}): ToolInvocation => ({
  id: "call:1",
  threadID: "thread:1",
  turnID: "turn:1",
  agentID: "agent:1",
  name: "Read",
  input: {},
  model: { providerID: "fixture", id: "model" } as never,
  taskMode: "chat",
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  ...overrides,
})

const tool: ToolCatalogEntry = {
  sdkName: "Read",
  schema: z.object({}),
  inputSchema: {},
  description: "读取",
  capabilities: { filesystem: "read", network: "none", process: false, externalState: false, userInteraction: false },
  allowedModes: ["chat", "plan"],
  allowedProfiles: ["main", "default", "explorer", "worker"],
  approvalStrategy: "policy",
  visibility: "eager",
  executionMode: "parallel",
}

const withOverride = (decide: PermissionPolicyOverride["decide"]) =>
  new PermissionDecisionEngine({
    policyOverride: () => ({ decide }),
  })

describe("System permission-policy provider（PR 8B）", () => {
  test("默认策略：无 provider 时行为完全不变（on-request 基础读取放行）", () => {
    const engine = new PermissionDecisionEngine()
    const result = engine.evaluate(invocation(), tool)
    expect(result.action).toBe("allow")
  })

  test("provider deny 映射为 deny，checkpoint shape 固定", () => {
    const engine = withOverride(() => ({ decision: "deny" as const, reason: "fixture deny" }))
    const result = engine.evaluate(invocation(), tool)
    expect(result).toMatchObject({ action: "deny", decision: "deny", reason: "fixture deny" })
    expect(result.risk).toBeDefined()
  })

  test("provider review 映射为 review + reviewer", () => {
    const engine = withOverride(() => ({ decision: "review" as const, reason: "fixture review" }))
    const result = engine.evaluate(invocation(), tool)
    if (result.action !== "review") throw new Error("期望 review")
    expect(result.reviewer).toBe("user")
    expect(result.sandbox).toBeDefined()
  })

  test("provider allow 映射为 allow + sandbox（v4 字段保持）", () => {
    const engine = withOverride(() => ({ decision: "allow" as const }))
    const result = engine.evaluate(invocation(), tool)
    if (result.action !== "allow") throw new Error("期望 allow")
    expect(result.sandbox?.fileAccess).toBe("workspace-write")
  })

  test("provider 抛错 fail-closed 转入 review", () => {
    const engine = withOverride(() => {
      throw new Error("boom")
    })
    const result = engine.evaluate(invocation(), tool)
    expect(result.action).toBe("review")
    expect(result.reason).toContain("异常")
  })

  test("provider 按工具名决策（可改变默认审批语义）", () => {
    const engine = withOverride((input) => input.toolName === "Read"
      ? { decision: "deny" as const, reason: "fixture: Read blocked" }
      : { decision: "allow" as const })
    const denied = engine.evaluate(invocation(), tool)
    expect(denied.action).toBe("deny")
    const otherTool = { ...tool, sdkName: "Glob" }
    const allowed = engine.evaluate(invocation({ name: "Glob" }), otherTool)
    expect(allowed.action).toBe("allow")
  })
})

import { describe, expect, test } from "bun:test"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import type { AgentDatabase } from "../src/storage/Database"
import type { ToolInvocation } from "../src/domain"
import { ApprovalService } from "../src/permission/ApprovalService"
import { ReviewerService } from "../src/permission/ReviewerService"
import { ToolRegistry } from "../src/tool/ToolRegistry"

const reviewer = (getSetting: AgentDatabase["getSetting"], providers: ProviderRuntime = {} as ProviderRuntime) => new ReviewerService({ getSetting } as AgentDatabase, providers)

describe("Shell ReviewerService", () => {
  test("静态灾难级命令在没有审核模型时也直接拒绝", async () => {
    const service = reviewer(() => null)
    const result = await service.reviewShell({ command: "format C:" }, new AbortController().signal)
    expect(result).toMatchObject({ decision: "deny", risk: "critical", requestedScopeValid: true })
    expect(result.categories).toContain("destructive")
  })

  test("审核模型未配置时普通 Shell fail-closed", async () => {
    const service = reviewer(() => null)
    const result = await service.reviewShell({ command: "npm test" }, new AbortController().signal)
    expect(result).toMatchObject({ decision: "deny", risk: "high", requestedScopeValid: true })
    expect(result.reason).toContain("审核模型")
  })

  test("旧 review 调用保持 PermissionDecision 兼容，并对 Shell 审核异常拒绝", async () => {
    const service = reviewer(() => null)
    const invocation = {
      id: "tool-1",
      threadID: "thread-1",
      turnID: "turn-1",
      name: "shell.execute",
      input: { command: "npm test" },
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
      taskMode: "chat",
    } as unknown as ToolInvocation
    await expect(service.review(invocation, new AbortController().signal)).resolves.toMatchObject({ decision: "deny", risk: "high" })
  })

  test("ApprovalService 在 Shell 审核器缺失时 fail-closed", async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: "shell",
      description: "test shell",
      sideEffect: true,
      inputSchema: { type: "object" },
      execute: async () => "must-not-run",
    })
    const approvals = new ApprovalService({} as AgentDatabase, {} as never, tools)
    const result = await approvals.authorize({
      id: "tool-2",
      threadID: "thread-1",
      turnID: "turn-1",
      name: "shell",
      input: { command: "npm test" },
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      taskMode: "chat",
    } as unknown as ToolInvocation, new AbortController().signal)
    expect(result).toMatchObject({ decision: "deny", risk: "critical" })
  })

  test("Full access 审核异常直接拒绝且不进入人工审批", async () => {
    const tools = new ToolRegistry()
    tools.register({ name: "shell", description: "test shell", sideEffect: true, inputSchema: { type: "object" }, execute: async () => "must-not-run" })
    const approvals = new ApprovalService({} as AgentDatabase, {} as never, tools, async () => {
      throw new Error("reviewer timeout")
    })
    const result = await approvals.authorize({
      id: "tool-full",
      threadID: "thread-1",
      turnID: "turn-1",
      name: "shell",
      input: { command: "Write-Output blocked" },
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review" },
      taskMode: "chat",
    } as unknown as ToolInvocation, new AbortController().signal)
    expect(result).toMatchObject({ decision: "deny", risk: "critical" })
  })
})

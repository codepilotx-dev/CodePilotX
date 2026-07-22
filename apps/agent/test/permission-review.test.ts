import { describe, expect, test } from "bun:test"
import type { AgentDatabase } from "../src/storage/Database"
import type { ToolInvocation } from "../src/domain"
import { ReviewerService } from "../src/permission/ReviewerService"
import type { PiModelService } from "../src/provider/pi"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { PermissionDecisionEngine } from "../src/permission/PermissionDecisionEngine"

const reviewer = (getSetting: AgentDatabase["getSetting"], providers: PiModelService = {} as PiModelService) => new ReviewerService({ getSetting } as AgentDatabase, providers)

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

  test("on-request 对基础 sandbox Shell 直接执行，仅权限提升进入审核", () => {
    const tools = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    const base = {
      id: "tool-2",
      threadID: "thread-1",
      turnID: "turn-1",
      agentID: "agent-1",
      name: "shell",
      input: { command: "npm test" },
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      taskMode: "chat",
    } as unknown as ToolInvocation
    expect(engine.evaluate(base, tools.get("PowerShell"))).toMatchObject({ action: "allow" })
    expect(engine.evaluate({ ...base, input: { command: "npm test", additionalPermissions: { networkDomains: ["npmjs.org"] } } }, tools.get("PowerShell"))).toMatchObject({ action: "review", reviewer: "user" })
  })

  test("never 不重复审批已选择的 full access，但拒绝动态提升", () => {
    const tools = new ToolRegistry()
    const engine = new PermissionDecisionEngine()
    const invocation = {
      id: "tool-full",
      threadID: "thread-1",
      turnID: "turn-1",
      agentID: "agent-1",
      name: "shell",
      input: { command: "Write-Output blocked" },
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review" },
      taskMode: "chat",
    } as unknown as ToolInvocation
    expect(engine.evaluate(invocation, tools.get("PowerShell"))).toMatchObject({ action: "allow", risk: "critical" })
    expect(engine.evaluate({ ...invocation, input: { command: "x", additionalPermissions: { writePaths: ["C:\\outside"] } } }, tools.get("PowerShell"))).toMatchObject({ action: "deny" })
  })
})

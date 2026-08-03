import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Model, Provider } from "@codepilotx/model-schema"
import type { ToolInvocation } from "../src/domain"
import { ApprovalService } from "../src/permission/ApprovalService"
import { PermissionDecisionEngine } from "../src/permission/PermissionDecisionEngine"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { pausedSubagentStatus } from "../src/subagent/SubagentService"

const paths: string[] = []
const databases: AgentDatabase[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true }).catch(() => undefined)))
})

const setup = (db: AgentDatabase) => {
  const thread = db.createThread()
  const input = { content: "执行命令", model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "untrusted", approvalsReviewer: "user" }, strategy: "queue", taskMode: "chat" } as const
  const turn = db.createTurn(thread.id, input)
  db.claimTurnExecution(turn.turnID)
  return { thread, turn, input }
}

describe("可恢复审批 checkpoint", () => {
  test("子 Agent permission pause 不会被覆盖为 waiting_question", () => {
    expect(pausedSubagentStatus("permission")).toBe("waiting_permission")
    expect(pausedSubagentStatus("clarification")).toBe("waiting_question")
  })
  test("没有 SDK RunState 所有权的直接调用不会创建孤儿 checkpoint", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    const decision = await service.authorize({ id: "direct-tool", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "npm publish" }, permissionConfig: input.permissionConfig, model: input.model, taskMode: "chat" }, new AbortController().signal)
    expect(decision.decision).toBe("ask")
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM approval_requests").get()).toEqual({ count: 0 })
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM approval_checkpoints").get()).toEqual({ count: 0 })
  })

  test("多路径审批只向 Guardian 和人工请求投影安全范围，checkpoint 保留恢复输入", async () => {
    const path = join(tmpdir(), `codepilotx-approval-scope-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    let guardianInvocation: ToolInvocation | undefined
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
      async (invocation) => {
        guardianInvocation = invocation
        return { decision: "ask", risk: "high", reason: "需要人工确认" }
      },
    )
    const authorizationScope = {
      affectedPaths: [
        { path: "src/a.ts", operation: "update" as const },
        { path: "src/b.ts", operation: "create" as const },
      ],
      fingerprint: "a".repeat(64),
      ruleRequiresApproval: true,
      reviewSummary: {
        fileCount: 2,
        hunkCount: 3,
        additions: 8,
        deletions: 2,
      },
    }
    const invocation: ToolInvocation = {
      id: "scoped-tool",
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: "Write",
      input: { patch: "raw-patch-body", __ruleRequiresApproval: true },
      permissionConfig: { ...input.permissionConfig, approvalsReviewer: "auto_review" },
      model: input.model,
      taskMode: "chat",
      authorizationScope,
      durableApproval: true,
    }
    expect(await service.authorize(invocation, new AbortController().signal)).toMatchObject({
      decision: "ask",
    })
    expect(guardianInvocation?.input).toEqual({
      patchHash: authorizationScope.fingerprint,
      affectedPaths: authorizationScope.affectedPaths,
      summary: authorizationScope.reviewSummary,
    })
    const stored = db.approvalCheckpointForToolCall(invocation.id)
    expect(stored?.payload.invocation.input.patch).toBe("raw-patch-body")
    await service.attachRunState(
      invocation.id,
      JSON.stringify({ version: 1 }),
      { name: invocation.name, callId: invocation.id },
    )
    const eventRow = db.sqlite.query(
      "SELECT params FROM events WHERE method = 'approval/requested' AND turn_id = ?",
    ).get(turn.turnID) as { params: string }
    const eventParams = JSON.parse(eventRow.params)
    expect(eventParams).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(eventRow.params).not.toContain("raw-patch-body")
    const requestRow = db.sqlite.query(
      "SELECT request_payload FROM approval_requests WHERE tool_call_id = ?",
    ).get(invocation.id) as { request_payload: string }
    expect(JSON.parse(requestRow.request_payload)).toMatchObject({
      affectedPaths: authorizationScope.affectedPaths,
      reviewSummary: authorizationScope.reviewSummary,
    })
    expect(requestRow.request_payload).not.toContain("raw-patch-body")
  })

  test("审批跨重启加载、响应并且只能 claim 一次", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = { id: "tool-1", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "api_key=super-secret; npm test" }, permissionConfig: input.permissionConfig, model: input.model, taskMode: "chat" }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get("PowerShell"))
    if (resolved.action !== "review") throw new Error("测试需要 review 决策")
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(invocation, { decision: "ask", risk: "high", reason: "需要确认" }, resolved)
    service.persist(prepared)
    expect(service.load(prepared.approvalID)?.status).toBe("preparing")
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'").get()).toEqual({ count: 0 })
    await expect(service.respond(prepared.approvalID, "allow")).rejects.toMatchObject({ code: "APPROVAL_NOT_READY" })
    await service.attachRunState("tool-1", JSON.stringify({ version: 1, command: "npm test" }), { name: "PowerShell", callId: "tool-1" })
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'approval/requested'").get()).toEqual({ count: 1 })
    expect(service.load(prepared.approvalID)?.payload.invocation.input.command).toContain("<redacted>")
    expect(service.load(prepared.approvalID)?.payload.runState).not.toContain("super-secret")
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    expect(service.load(prepared.approvalID)?.status).toBe("pending")
    db.sqlite.exec(`CREATE TRIGGER fail_resolved_outbox BEFORE INSERT ON events WHEN NEW.method = 'interaction/resolved' BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END`)
    await expect(service.respond(prepared.approvalID, "allow")).rejects.toThrow("outbox unavailable")
    expect(service.load(prepared.approvalID)?.status).toBe("pending")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_permission" })
    expect(db.sqlite.query("SELECT status FROM agent_executions WHERE id = ?").get(turn.agentID)).toEqual({ status: "waiting_permission" })
    db.sqlite.exec("DROP TRIGGER fail_resolved_outbox")
    await service.respond(prepared.approvalID, "allow")
    const resolvedEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?").get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: { kind: "approval", decision: "allow-once" },
      resolvedAt: expect.any(Number),
    })
    const claimed = service.claimResume(turn.turnID)
    expect(claimed).toMatchObject({ status: "claimed", decision: "allow", toolCallID: "tool-1" })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test("旧 pending 审批没有 checkpoint 时 fail-closed", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    db.sqlite.query(`INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`).run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, "waiting_permission")
    db.updateAgentStatus(turn.agentID, "waiting_permission")
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    db.sqlite.exec(`CREATE TRIGGER fail_cancelled_outbox BEFORE INSERT ON events WHEN NEW.method = 'approval/cancelled' BEGIN SELECT RAISE(ABORT, 'cancel outbox unavailable'); END`)
    await expect(service.respond("legacy", "allow")).rejects.toThrow("cancel outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get()).toEqual({ status: "pending" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_permission" })
    db.sqlite.exec("DROP TRIGGER fail_cancelled_outbox")
    await expect(service.respond("legacy", "allow")).rejects.toMatchObject({ code: "APPROVAL_CHECKPOINT_MISSING" })
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'legacy'").get()).toEqual({ status: "cancelled" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "interrupted" })
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?").get(turn.turnID)).toEqual({ method: "approval/cancelled" })
    const cancelledEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?").get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: "legacy",
      reason: "审批缺少可恢复 checkpoint",
      cancelledAt: expect.any(Number),
    })
  })

  test("重启扫描会取消不完整审批并写入 durable event", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    db.sqlite.query(`INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, created_at) VALUES ('restart-legacy', ?, ?, ?, 'tool-old', 'high', 'legacy', 'pending', '{"version":1}', ?)`).run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.updateTurnStatus(turn.turnID, "waiting_permission")
    db.updateAgentStatus(turn.agentID, "waiting_permission")
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'restart-legacy'").get()).toEqual({ status: "cancelled" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "interrupted" })
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?").get(turn.turnID)).toEqual({ method: "approval/cancelled" })
    const cancelledEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?").get(turn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: "restart-legacy",
      reason: "审批缺少完整且可恢复的 SDK checkpoint，已安全取消",
      cancelledAt: expect.any(Number),
    })
  })

  test("deny 跨重启恢复且只能 claim 一次", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const invocation: ToolInvocation = { id: "tool-deny", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "npm publish" }, permissionConfig: input.permissionConfig, model: input.model, taskMode: "chat", durableApproval: true }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get("PowerShell"))
    if (resolved.action !== "review") throw new Error("测试需要 review 决策")
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const prepared = service.prepare(invocation, { decision: "ask", risk: "high", reason: "需要确认" }, resolved)
    service.persist(prepared)
    await service.attachRunState("tool-deny", JSON.stringify({ version: 1 }), { name: "PowerShell", callId: "tool-deny" })
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    await service.respond(prepared.approvalID, "deny", "  Authorization: Bearer abc.def.ghi\n请改用只读命令  ")
    expect(service.claimResume(turn.turnID)).toMatchObject({
      status: "claimed",
      decision: "deny",
      toolCallID: "tool-deny",
      payload: { resolution: { decision: "deny", feedback: "Authorization: <redacted>\n请改用只读命令" } },
    })
    expect(service.claimResume(turn.turnID)).toBeNull()
  })

  test("checkpoint 内容被篡改时拒绝响应并中断恢复", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = { id: "tool-tampered", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "npm test" }, permissionConfig: input.permissionConfig, model: input.model, taskMode: "chat" }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get("PowerShell"))
    if (resolved.action !== "review") throw new Error("测试需要 review 决策")
    const prepared = service.prepare(invocation, { decision: "ask", risk: "high", reason: "需要确认" }, resolved)
    service.persist(prepared)
    db.sqlite.query("UPDATE approval_checkpoints SET payload = json_set(payload, '$.invocation.input.command', 'changed') WHERE approval_id = ?").run(prepared.approvalID)
    await expect(service.respond(prepared.approvalID, "allow")).rejects.toMatchObject({ code: "APPROVAL_CHECKPOINT_INVALID" })
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = ?").get(prepared.approvalID)).toEqual({ status: "cancelled" })
  })

  test("动态权限请求携带真实风险，resolved 事件携带原始交互 ID", async () => {
    const path = join(tmpdir(), `codepilotx-permission-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    const invocation: ToolInvocation = {
      id: "permission-call",
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: "request_permissions",
      input: {
        scope: "turn",
        readPaths: ["C:\\workspace\\docs"],
        writePaths: ["C:\\workspace\\out"],
        networkDomains: ["api.example.com"],
        justification: "需要读取文档并写入产物",
      },
      permissionConfig: input.permissionConfig,
      model: input.model,
      taskMode: "chat",
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, new ToolRegistry().get("request_permissions"))
    if (resolved.action !== "review") throw new Error("测试需要 review 决策")
    const prepared = service.prepare(invocation, { decision: "ask", risk: "critical", reason: "需要额外权限" }, resolved)
    service.persist(prepared)
    await service.attachRunState("permission-call", JSON.stringify({ version: 1 }), { name: "request_permissions", callId: "permission-call" })

    const requestedEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'permission/requested' AND turn_id = ?").get(turn.turnID) as { params: string }
    const requestedParams = JSON.parse(requestedEvent.params)
    expect(requestedParams).toMatchObject({
      interactionId: prepared.approvalID,
      kind: "permission",
      requestedScope: "turn",
      allowedScopes: ["tool-call", "turn"],
      risk: "critical",
      requestedPermissions: {
        readPaths: ["C:\\workspace\\docs"],
        writePaths: ["C:\\workspace\\out"],
        networkDomains: ["api.example.com"],
      },
    })

    await service.respondPermission(prepared.approvalID, "allow", { scope: "tool-call", grantedPermissions: { readPaths: ["C:\\workspace\\docs"] } })
    const resolvedEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?").get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      interactionId: prepared.approvalID,
      result: {
        kind: "permission",
        decision: "grant",
        scope: "tool-call",
        grantedPermissions: { readPaths: ["C:\\workspace\\docs"] },
      },
      resolvedAt: expect.any(Number),
    })
    expect(service.permissionGrantResolution(db.getApprovalCheckpoint(prepared.approvalID)!)).toEqual({
      scope: "tool-call",
      grantedPermissions: { readPaths: ["C:\\workspace\\docs"] },
    })
  })

  test("sandbox escalation token 跨重启保持且只能 claim 一次", async () => {
    const path = join(tmpdir(), `codepilotx-escalation-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn, input } = setup(db)
    let service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    const invocation: ToolInvocation = { id: "shell-failed", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "Write-Output once", cwd: tmpdir() }, permissionConfig: { ...input.permissionConfig, approvalPolicy: "on-failure" }, model: input.model, taskMode: "chat" }
    const escalation = service.prepareSandboxEscalation(invocation, "sandbox denied")
    const permissionInput = { scope: "tool-call", escalationToken: escalation.token, justification: "sandbox failed" }
    const parsed = new ToolRegistry().get("request_permissions").schema.parse(permissionInput) as typeof permissionInput
    expect(parsed.escalationToken).toBe(escalation.token)
    const permissionInvocation: ToolInvocation = { ...invocation, id: "permission-call", name: "request_permissions", input: parsed, durableApproval: true }
    const resolved = new PermissionDecisionEngine().evaluate(permissionInvocation, new ToolRegistry().get("request_permissions"))
    if (resolved.action !== "review") throw new Error("escalation request 必须进入 SDK approval")
    const prepared = service.prepare(permissionInvocation, { decision: "ask", risk: "high", reason: "host escalation" }, resolved)
    expect(prepared.checkpoint.invocation.input.escalationToken).toBe(escalation.token)
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    expect(service.claimSandboxEscalation(escalation.token, { threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID })?.invocation.input.command).toBe("Write-Output once")
    expect(service.claimSandboxEscalation(escalation.token, { threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID })).toBeNull()
    databases.pop()
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe("cancelled")
  })

  test("sandbox escalation 持久化内容被篡改时 fail closed", async () => {
    const path = join(tmpdir(), `codepilotx-escalation-tamper-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), new ToolRegistry())
    const invocation: ToolInvocation = { id: "shell-tampered", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "Write-Output safe", cwd: tmpdir() }, permissionConfig: { ...input.permissionConfig, approvalPolicy: "on-failure" }, model: input.model, taskMode: "chat" }
    const escalation = service.prepareSandboxEscalation(invocation, "sandbox denied")
    db.sqlite.query("UPDATE sandbox_escalations SET invocation = json_set(invocation, '$.input.command', 'Remove-Item dangerous') WHERE token = ?").run(escalation.token)
    expect(service.claimSandboxEscalation(escalation.token, { threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID })).toBeNull()
    expect(db.getSandboxEscalation(escalation.token)?.status).toBe("cancelled")
  })

  test("Hook trust 等待 checkpoint 跨重启保留", async () => {
    const path = join(tmpdir(), `codepilotx-hook-trust-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const { thread, turn } = setup(db)
    const pending = db.ensureHookTrustRequest({ threadID: thread.id, turnID: turn.turnID, workspacePath: "F:\\repo", configPath: "F:\\repo\\.codepilotx\\hooks.json", configHash: "hash", auditSummary: { hooks: [] } })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe("waiting_hook_trust")
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_permission" })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe("waiting_hook_trust")
    const resolved = db.resolveHookTrustRequest(pending.request.id, "block")
    expect(resolved.resumed).toHaveLength(1)
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "queued" })
  })

  test("同一 Hook hash 的并发 turn 复用请求但各收到一次 durable 事件", () => {
    const path = join(tmpdir(), `codepilotx-hook-trust-waiters-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const first = setup(db)
    const secondThread = db.createThread()
    const second = db.createTurn(secondThread.id, first.input)
    db.claimTurnExecution(second.turnID)
    const trust = { workspacePath: "F:\\repo", configPath: "F:\\repo\\.codepilotx\\hooks.json", configHash: "same-hash", auditSummary: { hooks: [] } }
    const initial = db.ensureHookTrustRequest({ ...trust, threadID: first.thread.id, turnID: first.turn.turnID })
    const reused = db.ensureHookTrustRequest({ ...trust, threadID: secondThread.id, turnID: second.turnID })
    expect(reused.request.id).toBe(initial.request.id)
    const reusedEvent = db.sqlite.query("SELECT params FROM events WHERE thread_id = ? AND method = 'hook/trust/requested'").get(secondThread.id) as { params: string }
    expect(JSON.parse(reusedEvent.params)).toMatchObject({ reused: true })
    expect(db.ensureHookTrustRequest({ ...trust, threadID: secondThread.id, turnID: second.turnID }).event).toBeNull()
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'hook/trust/requested'").get()).toEqual({ count: 2 })
    expect(db.resolveHookTrustRequest(initial.request.id, "allow").resumed).toHaveLength(2)
  })

  test("Turn 在 preparing 阶段停止会持久取消审批", async () => {
    const path = join(tmpdir(), `codepilotx-approval-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn, input } = setup(db)
    const tools = new ToolRegistry()
    const service = new ApprovalService(db, await Effect.runPromise(EventHub.make), tools)
    const invocation: ToolInvocation = { id: "tool-stop", threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, name: "PowerShell", input: { command: "npm publish" }, permissionConfig: input.permissionConfig, model: input.model, taskMode: "chat", durableApproval: true }
    const resolved = new PermissionDecisionEngine().evaluate(invocation, tools.get("PowerShell"))
    if (resolved.action !== "review") throw new Error("测试需要 review 决策")
    const prepared = service.prepare(invocation, { decision: "ask", risk: "high", reason: "需要确认" }, resolved)
    service.persist(prepared)
    service.cancelTurn(turn.turnID)
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = ?").get(prepared.approvalID)).toEqual({ status: "cancelled" })
  })

  test("副作用 prompt recovery 持久中断后可重新排队", async () => {
    const path = join(tmpdir(), `codepilotx-recovery-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const { thread, turn } = setup(db)
    const persisted = db.interruptForSideEffectRecovery({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      payload: { kind: "side-effect-prompt-recovery", attemptOrdinal: 2, completed: [{ toolCallID: "call-1", tool: "shell", summary: "done" }], error: "context too long" },
    })
    expect(persisted.events.map(({ method }) => method).sort()).toEqual(["agent/upserted", "context/recoveryRequired", "turn/interrupted"])
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'context/recoveryRequired' AND turn_id = ?").get(turn.turnID)).toEqual({ method: "context/recoveryRequired" })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.payload.kind).toBe("side-effect-prompt-recovery")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "interrupted" })
    expect(db.queueSideEffectRecovery(turn.turnID)).toBe(true)
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "queued" })
  })
})

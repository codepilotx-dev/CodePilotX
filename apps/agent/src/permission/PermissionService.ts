import { Effect } from "effect"
import { AgentError, type PermissionDecision, type ToolInvocation } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ToolRegistry } from "../tool/ToolRegistry"

export type Reviewer = (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>

interface PendingPermission {
  resolve: (decision: "allow" | "deny") => void
  reject: (reason: unknown) => void
  runID: string
}

export class PermissionService {
  private readonly pending = new Map<string, PendingPermission>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly tools: ToolRegistry,
    private readonly reviewer: Reviewer | null = null,
  ) {}

  private async emit(sessionID: string, type: string, payload: unknown) {
    const event = this.db.insertEvent(sessionID, type, payload)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async authorize(invocation: ToolInvocation, signal: AbortSignal): Promise<PermissionDecision> {
    const tool = this.tools.get(invocation.name)
    if (invocation.taskMode === "plan" && tool.sideEffect) return { decision: "deny", risk: "high", reason: "计划模式禁止副作用工具" }
    if (invocation.permissionMode === "full") {
      await this.emit(invocation.sessionID, "permission.audited", { toolCallID: invocation.id, decision: "allow", mode: "full" })
      return { decision: "allow", risk: tool.sideEffect ? "high" : "low", reason: "完全访问：按当前 Windows 用户权限执行并记录审计" }
    }
    if (invocation.permissionMode === "review" && this.reviewer) {
      try {
        const reviewed = await this.reviewer(invocation, signal)
        await this.emit(invocation.sessionID, "permission.reviewed", { toolCallID: invocation.id, ...reviewed })
        if (reviewed.decision !== "ask") return reviewed
        return this.waitForHuman(invocation, reviewed, signal)
      } catch (cause) {
        return this.waitForHuman(invocation, { decision: "ask", risk: "high", reason: `自动 AI 审查不可用：${cause instanceof Error ? cause.message : String(cause)}` }, signal)
      }
    }
    return this.waitForHuman(invocation, {
      decision: "ask",
      risk: tool.sideEffect ? "high" : "low",
      reason: invocation.permissionMode === "review" ? "未配置独立审查模型，已转人工确认" : "每次确认模式",
    }, signal)
  }

  private async waitForHuman(invocation: ToolInvocation, review: PermissionDecision, signal: AbortSignal): Promise<PermissionDecision> {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    this.db.transaction(() => {
      this.db.run(`INSERT INTO permission_requests (id, session_id, run_id, tool_call_id, risk, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, id, invocation.sessionID, invocation.runID, invocation.id, review.risk, review.reason, createdAt)
      this.db.updateRunStatus(invocation.runID, "waiting_permission")
    })
    await this.emit(invocation.sessionID, "permission.requested", { id, runID: invocation.runID, toolCallID: invocation.id, tool: invocation.name, input: invocation.input, risk: review.risk, reason: review.reason, createdAt })
    return new Promise<PermissionDecision>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
      }
      signal.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        runID: invocation.runID,
        resolve: (decision) => {
          signal.removeEventListener("abort", abort)
          resolve({ decision, risk: review.risk, reason: decision === "allow" ? "用户允许一次" : "用户拒绝" })
        },
        reject,
      })
    })
  }

  async reply(id: string, decision: "allow" | "deny") {
    const row = this.db.sqlite.query("SELECT session_id, run_id, status FROM permission_requests WHERE id = ?").get(id) as { session_id: string; run_id: string; status: string } | null
    if (!row) throw new AgentError("PERMISSION_NOT_FOUND", "权限请求不存在", 404)
    if (row.status !== "pending") throw new AgentError("PERMISSION_ALREADY_RESOLVED", "权限请求已经处理", 409)
    this.db.transaction(() => {
      this.db.run("UPDATE permission_requests SET status = 'resolved', reply = ?, resolved_at = ? WHERE id = ?", decision, Date.now(), id)
      this.db.updateRunStatus(row.run_id, "running")
    })
    await this.emit(row.session_id, "permission.resolved", { id, decision, runID: row.run_id })
    const pending = this.pending.get(id)
    if (pending) {
      this.pending.delete(id)
      pending.resolve(decision)
    }
  }

  cancelRun(runID: string) {
    for (const [id, pending] of this.pending) {
      if (pending.runID !== runID) continue
      this.pending.delete(id)
      pending.reject(new AgentError("RUN_ABORTED", "任务已停止", 499))
    }
  }
}

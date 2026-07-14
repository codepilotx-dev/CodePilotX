import { Effect } from "effect"
import { AgentError, type PermissionDecision, type ToolInvocation } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ToolRegistry } from "../tool/ToolRegistry"

export type Reviewer = (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>

interface PendingApproval {
  resolve: (decision: "allow" | "deny") => void
  reject: (reason: unknown) => void
  turnID: string
}

export class ApprovalService {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly tools: ToolRegistry,
    private readonly reviewer: Reviewer | null = null,
  ) {}

  private async emit(threadID: string, turnID: string, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async authorize(invocation: ToolInvocation, signal: AbortSignal): Promise<PermissionDecision> {
    const tool = this.tools.get(invocation.name)
    if (invocation.taskMode === "plan" && tool.sideEffect) return { decision: "deny", risk: "high", reason: "计划模式禁止副作用工具" }
    if (invocation.permissionMode === "full") {
      await this.emit(invocation.threadID, invocation.turnID, "serverRequest/resolved", { itemId: invocation.id, turnId: invocation.turnID, kind: "approval", decision: "allow", mode: "full" })
      return { decision: "allow", risk: tool.sideEffect ? "high" : "low", reason: "完全访问：按当前 Windows 用户权限执行并记录审计" }
    }
    if (invocation.permissionMode === "review" && this.reviewer) {
      try {
        const reviewed = await this.reviewer(invocation, signal)
        await this.emit(invocation.threadID, invocation.turnID, "serverRequest/resolved", { itemId: invocation.id, turnId: invocation.turnID, kind: "approval-review", ...reviewed })
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
      this.db.run(`INSERT INTO approval_requests (id, thread_id, turn_id, tool_call_id, risk, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, id, invocation.threadID, invocation.turnID, invocation.id, review.risk, review.reason, createdAt)
      this.db.updateTurnStatus(invocation.turnID, "waiting_permission")
    })
    await this.emit(invocation.threadID, invocation.turnID, "approval/requested", { id, turnId: invocation.turnID, itemId: invocation.id, toolCallID: invocation.id, tool: invocation.name, input: invocation.input, risk: review.risk, reason: review.reason, createdAt })
    return new Promise<PermissionDecision>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        reject(new AgentError("TURN_ABORTED", "任务已停止", 499))
      }
      signal.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        turnID: invocation.turnID,
        resolve: (decision) => {
          signal.removeEventListener("abort", abort)
          resolve({ decision, risk: review.risk, reason: decision === "allow" ? "用户允许一次" : "用户拒绝" })
        },
        reject,
      })
    })
  }

  async respond(id: string, decision: "allow" | "deny") {
    const row = this.db.sqlite.query("SELECT thread_id, turn_id, status FROM approval_requests WHERE id = ?").get(id) as { thread_id: string; turn_id: string; status: string } | null
    if (!row) throw new AgentError("APPROVAL_NOT_FOUND", "审批请求不存在", 404)
    if (row.status !== "pending") throw new AgentError("APPROVAL_ALREADY_RESOLVED", "审批请求已经处理", 409)
    this.db.transaction(() => {
      this.db.run("UPDATE approval_requests SET status = 'resolved', reply = ?, resolved_at = ? WHERE id = ?", decision, Date.now(), id)
      this.db.updateTurnStatus(row.turn_id, "running")
    })
    await this.emit(row.thread_id, row.turn_id, "serverRequest/resolved", { id, turnId: row.turn_id, kind: "approval", decision })
    const pending = this.pending.get(id)
    if (pending) {
      this.pending.delete(id)
      pending.resolve(decision)
    }
  }

  cancelTurn(turnID: string) {
    for (const [id, pending] of this.pending) {
      if (pending.turnID !== turnID) continue
      this.pending.delete(id)
      pending.reject(new AgentError("TURN_ABORTED", "任务已停止", 499))
    }
  }
}

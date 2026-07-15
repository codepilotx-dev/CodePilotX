import { Effect } from "effect"
import { AgentError, type PermissionDecision, type ToolInvocation } from "../domain"
import { isShellInvocation } from "./shellInvocation"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ToolRegistry } from "../tool/ToolRegistry"

const requestedPermissions = (input: Record<string, unknown>) => {
  const value = input.additionalPermissions
  if (!value || typeof value !== "object" || Array.isArray(value)) return { readPaths: [], writePaths: [], networkDomains: [] }
  const permissions = value as Record<string, unknown>
  const list = (name: string) => Array.isArray(permissions[name]) ? permissions[name].filter((item): item is string => typeof item === "string") : []
  return { readPaths: list("readPaths"), writePaths: list("writePaths"), networkDomains: list("networkDomains") }
}

const hasRequestedPermissions = (input: Record<string, unknown>) => {
  const permissions = requestedPermissions(input)
  return permissions.readPaths.length > 0 || permissions.writePaths.length > 0 || permissions.networkDomains.length > 0
}

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
    const shell = isShellInvocation(invocation)
    const fullAccess = invocation.permissionConfig.sandboxMode === "danger-full-access"
    const autoReview = invocation.permissionConfig.approvalsReviewer === "auto_review"
    if ((shell || fullAccess || autoReview) && this.reviewer) {
      try {
        const reviewed = await this.reviewer(invocation, signal)
        await this.emit(invocation.threadID, invocation.turnID, "serverRequest/resolved", { itemId: invocation.id, turnId: invocation.turnID, kind: "approval-review", ...reviewed })
        if (fullAccess && reviewed.decision === "ask") return { ...reviewed, decision: "deny", reason: "完全访问不等待人工确认：审核结果不确定，已拒绝" }
        if (reviewed.decision !== "ask") {
          const defaultExtraAccess = shell
            && invocation.permissionConfig.approvalPolicy === "on-request"
            && invocation.permissionConfig.approvalsReviewer === "user"
            && hasRequestedPermissions(invocation.input)
          if (!defaultExtraAccess) return reviewed
          return this.waitForHuman(invocation, { ...reviewed, decision: "ask", reason: "Default permissions 下的额外访问需要用户确认" }, signal)
        }
        return this.waitForHuman(invocation, reviewed, signal)
      } catch (cause) {
        if (fullAccess || shell) return { decision: "deny", risk: "critical", reason: `自动 AI 审查不可用，命令已拒绝：${cause instanceof Error ? cause.message : String(cause)}` }
        return this.waitForHuman(invocation, { decision: "ask", risk: "high", reason: `自动 AI 审查不可用：${cause instanceof Error ? cause.message : String(cause)}` }, signal)
      }
    }
    if (fullAccess || shell) return { decision: "deny", risk: "critical", reason: "Shell 审核器不可用，命令已拒绝" }
    return this.waitForHuman(invocation, {
      decision: "ask",
      risk: tool.sideEffect ? "high" : "low",
      reason: autoReview ? "未配置独立审查模型，已转人工确认" : "需要用户确认",
    }, signal)
  }

  private async waitForHuman(invocation: ToolInvocation, review: PermissionDecision, signal: AbortSignal): Promise<PermissionDecision> {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const permissions = requestedPermissions(invocation.input)
    const payload = JSON.stringify({ version: 1, command: invocation.input.command ?? null, cwd: invocation.input.cwd ?? null, requestedPermissions: permissions })
    const reviewPayload = review.review ? JSON.stringify(review.review) : null
    this.db.transaction(() => {
      this.db.run(`INSERT INTO approval_requests (id, thread_id, turn_id, tool_call_id, risk, reason, status, request_payload, review_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, id, invocation.threadID, invocation.turnID, invocation.id, review.risk, review.reason, payload, reviewPayload, createdAt)
      this.db.updateTurnStatus(invocation.turnID, "waiting_permission")
    })
    await this.emit(invocation.threadID, invocation.turnID, "approval/requested", { id, turnId: invocation.turnID, itemId: invocation.id, toolCallID: invocation.id, tool: invocation.name, input: invocation.input, requestedPermissions: permissions, review: review.review ?? null, risk: review.risk, reason: review.reason, createdAt })
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

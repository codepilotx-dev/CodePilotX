import { Effect } from "effect"
import { createHash } from "node:crypto"
import { AgentError, type PermissionDecision, type ToolInvocation } from "../domain"
import type { AgentDatabase, ApprovalCheckpointPayload, StoredApprovalCheckpoint } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import type { ToolRegistry } from "../tool/ToolRegistry"
import { PermissionDecisionEngine, requestedPermissions, type ResolvedPermissionDecision } from "./PermissionDecisionEngine"
import { secretScrubber } from "../security/SecretScrubber"

export type Reviewer = (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>

export type PreparedApprovalCheckpoint = {
  approvalID: string
  invocation: ToolInvocation
  review: PermissionDecision
  requestPayload: Record<string, unknown>
  checkpoint: ApprovalCheckpointPayload
  version: 1
  createdAt: number
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  return JSON.stringify(value)
}

const checkpointHash = (payload: Omit<ApprovalCheckpointPayload, "invocationHash" | "resolution" | "claimedAt">, version: number) => createHash("sha256").update(stable({ ...payload, version }), "utf8").digest("hex")
const sandboxEscalationHash = (invocation: ToolInvocation, failure: string) => createHash("sha256").update(stable({ invocation, failure }), "utf8").digest("hex")

export class ApprovalService {
  private readonly decisions = new PermissionDecisionEngine()
  private agentStatusHandler?: (agentID: string, status: "waiting_permission" | "running") => void

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly tools: ToolRegistry,
    private readonly reviewer: Reviewer | null = null,
  ) {}

  setAgentStatusHandler(handler: (agentID: string, status: "waiting_permission" | "running") => void) {
    this.agentStatusHandler = handler
  }

  private async emit(threadID: string, turnID: string, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async authorize(invocation: ToolInvocation, signal: AbortSignal): Promise<PermissionDecision> {
    const tool = this.tools.get(invocation.name)
    const resolved = this.decisions.evaluate(invocation, tool)
    const safeInvocation = secretScrubber.scrub(invocation)
    if (resolved.action !== "review") return { decision: resolved.decision, risk: resolved.risk, reason: resolved.reason }
    if (resolved.reviewer === "auto_review" && this.reviewer) {
      try {
        const reviewed = await this.reviewer(safeInvocation, signal)
        await this.emit(invocation.threadID, invocation.turnID, "serverRequest/resolved", { itemId: invocation.id, turnId: invocation.turnID, kind: "approval-review", ...reviewed })
        if (reviewed.decision !== "ask") return reviewed
        return this.checkpointForHuman(safeInvocation, reviewed, resolved)
      } catch (cause) {
        if (invocation.permissionConfig.approvalPolicy === "never") return { decision: "deny", risk: resolved.risk, reason: `Guardian 不可用，已拒绝：${secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))}` }
        const review = { decision: "ask", risk: resolved.risk, reason: `Guardian 不可用，转人工确认：${secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))}` } satisfies PermissionDecision
        return this.checkpointForHuman(safeInvocation, review, resolved)
      }
    }
    if (resolved.reviewer === "auto_review" && invocation.permissionConfig.approvalPolicy === "never") return { decision: "deny", risk: resolved.risk, reason: "未配置独立 Guardian，never 策略下拒绝" }
    const review = { decision: "ask", risk: resolved.risk, reason: resolved.reviewer === "auto_review" ? "未配置独立 Guardian，转人工确认" : resolved.reason } satisfies PermissionDecision
    return this.checkpointForHuman(safeInvocation, review, resolved)
  }

  prepare(invocation: ToolInvocation, review: PermissionDecision, resolved: Extract<ResolvedPermissionDecision, { action: "review" }>): PreparedApprovalCheckpoint {
    const safeInvocation = secretScrubber.scrub(invocation)
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const base = { kind: "tool-approval" as const, invocation: safeInvocation, permissionSnapshot: safeInvocation.permissionConfig, sandbox: resolved.sandbox as unknown as Record<string, unknown>, reviewer: resolved.reviewer, review: secretScrubber.scrub(review) as unknown as Record<string, unknown> }
    const checkpoint: ApprovalCheckpointPayload = { ...base, invocationHash: checkpointHash(base, 1) }
    return { approvalID: id, invocation: safeInvocation, review, requestPayload: { version: 1, command: safeInvocation.input.command ?? null, cwd: safeInvocation.input.cwd ?? null, requestedPermissions: requestedPermissions(safeInvocation.input) }, checkpoint, version: 1, createdAt }
  }

  persist(prepared: PreparedApprovalCheckpoint) {
    return this.db.persistApprovalCheckpoint({ approvalID: prepared.approvalID, invocation: prepared.invocation, risk: prepared.review.risk, reason: prepared.review.reason, requestPayload: prepared.requestPayload, reviewPayload: prepared.review.review ? secretScrubber.scrub(prepared.review.review) as unknown as Record<string, unknown> : null, checkpoint: prepared.checkpoint, version: prepared.version, createdAt: prepared.createdAt })
  }

  load(id: string) {
    const checkpoint = this.db.getApprovalCheckpoint(id)
    if (!checkpoint) return null
    const { invocationHash: _hash, resolution: _resolution, claimedAt: _claimedAt, ...base } = checkpoint.payload
    if (checkpoint.version !== 1 || checkpoint.payload.kind !== "tool-approval" || checkpoint.payload.invocationHash !== checkpointHash(base, checkpoint.version)) throw new AgentError("APPROVAL_CHECKPOINT_INVALID", "审批 checkpoint 无效或已被篡改", 409)
    return checkpoint
  }

  async attachRunState(toolCallID: string, state: string, interruption: unknown) {
    const stored = this.db.approvalCheckpointForToolCall(toolCallID)
    if (!stored) throw new AgentError("APPROVAL_CHECKPOINT_MISSING", "工具审批没有对应的 durable request", 409)
    this.load(stored.approvalID)
    let scrubbedState: string
    try { scrubbedState = secretScrubber.assertSafeOpaqueState(state) } catch {
      this.db.invalidateApprovalCheckpoint(stored.approvalID, "RunState 包含无法安全脱敏的凭据")
      throw new AgentError("APPROVAL_RUN_STATE_SECRET_DENIED", "审批 RunState 包含无法安全脱敏的凭据，已拒绝持久化", 403)
    }
    const safeInterruption = secretScrubber.scrub(interruption)
    const { invocationHash: _hash, resolution: _resolution, claimedAt: _claimedAt, ...base } = stored.payload
    const nextBase = { ...base, runState: scrubbedState, interruption: safeInterruption }
    const payload: ApprovalCheckpointPayload = { ...nextBase, invocationHash: checkpointHash(nextBase, stored.version) }
    const invocation = payload.invocation
    const requestedParams = {
      id: stored.approvalID, turnId: stored.turnID, itemId: stored.toolCallID, toolCallID: stored.toolCallID,
      tool: invocation.name, input: invocation.input, requestedPermissions: requestedPermissions(invocation.input),
      review: payload.review.review ?? null, risk: stored.risk, reason: stored.reason, createdAt: stored.createdAt,
    }
    const { checkpoint, events } = this.db.activateApprovalCheckpoint(stored.approvalID, payload, requestedParams)
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
    this.agentStatusHandler?.(checkpoint.agentID, "waiting_permission")
    return checkpoint
  }

  private async checkpointForHuman(invocation: ToolInvocation, review: PermissionDecision, resolved: Extract<ResolvedPermissionDecision, { action: "review" }>): Promise<PermissionDecision> {
    // Direct host calls (for example command Hooks) do not own an SDK RunState and
    // therefore cannot create a checkpoint that could ever be resumed safely.
    if (!invocation.durableApproval) return { ...review, decision: "ask", reason: review.reason }
    const existing = this.db.approvalCheckpointForToolCall(invocation.id)
    if (existing) return { ...review, decision: "ask", reason: review.reason }
    const prepared = this.prepare(invocation, review, resolved)
    this.persist(prepared)
    return { ...review, decision: "ask", reason: review.reason }
  }

  async respond(id: string, decision: "allow" | "deny", feedback?: string) {
    try { this.load(id) } catch (cause) {
      const invalidated = this.db.invalidateApprovalCheckpoint(id, "审批 checkpoint 校验失败")
      for (const event of invalidated?.events ?? []) await Effect.runPromise(this.hub.publish(event))
      throw cause
    }
    const safeFeedback = feedback?.trim()
      ? secretScrubber.scrubText(feedback.trim().slice(0, 4_000))
      : undefined
    const result = this.db.resolveApprovalCheckpoint(id, decision, safeFeedback)
    if (result.state === "missing") throw new AgentError("APPROVAL_NOT_FOUND", "审批请求不存在", 404)
    if (result.state === "not-ready") throw new AgentError("APPROVAL_NOT_READY", "审批 RunState 尚未完整落盘", 409)
    if (result.state === "already-resolved") throw new AgentError("APPROVAL_ALREADY_RESOLVED", "审批请求已经处理", 409)
    if (result.state === "invalid-checkpoint") {
      for (const event of result.events) await Effect.runPromise(this.hub.publish(event))
      throw new AgentError("APPROVAL_CHECKPOINT_MISSING", "旧审批缺少可恢复 checkpoint，已安全取消", 409)
    }
    if (result.state !== "resolved") throw new AgentError("APPROVAL_CHECKPOINT_INVALID", "审批 checkpoint 状态无效", 409)
    const checkpoint = result.checkpoint
    for (const event of result.events) await Effect.runPromise(this.hub.publish(event))
    return checkpoint
  }

  claimResume(turnID: string): StoredApprovalCheckpoint | null {
    const candidate = this.db.sqlite.query("SELECT id FROM approval_requests WHERE turn_id = ? AND status = 'resolved' ORDER BY resolved_at, created_at LIMIT 1").get(turnID) as { id: string } | null
    if (!candidate) return null
    try {
      const loaded = this.load(candidate.id)
      if (!loaded?.payload.runState || loaded.payload.interruption === undefined || !loaded.payload.resolution) {
        throw new AgentError("APPROVAL_CHECKPOINT_INCOMPLETE", "审批 checkpoint 缺少 RunState 或 interruption", 409)
      }
    } catch (cause) {
      this.db.invalidateApprovalCheckpoint(candidate.id, "审批 checkpoint 校验失败")
      throw cause
    }
    return this.db.claimResolvedApproval(turnID)
  }

  cancelTurn(turnID: string) {
    this.db.cancelApprovalsForTurn(turnID)
  }

  prepareSandboxEscalation(invocation: ToolInvocation, failure: string) {
    const safe = secretScrubber.scrub(invocation)
    if (stable(safe.input) !== stable(invocation.input)) throw new AgentError("SANDBOX_ESCALATION_SECRET_DENIED", "包含凭据的命令不能持久化为 host escalation", 403)
    const token = crypto.randomUUID()
    const safeFailure = secretScrubber.scrubText(failure).slice(0, 2_000)
    return this.db.createSandboxEscalation({ token, threadID: invocation.threadID, turnID: invocation.turnID, agentID: invocation.agentID, toolCallID: invocation.id, invocation: safe, invocationHash: sandboxEscalationHash(safe, safeFailure), failure: safeFailure })
  }

  claimSandboxEscalation(token: string, scope: { threadID: string; turnID: string; agentID: string }) {
    const stored = this.db.getSandboxEscalation(token)
    if (!stored || stored.invocationHash !== sandboxEscalationHash(stored.invocation, stored.failure)) {
      if (stored) this.db.cancelSandboxEscalation(token, "Sandbox escalation 完整性校验失败")
      return null
    }
    return this.db.claimSandboxEscalation(token, scope)
  }

  completeSandboxEscalation(token: string, output: unknown) {
    this.db.completeSandboxEscalation(token, secretScrubber.scrub(output))
  }
}

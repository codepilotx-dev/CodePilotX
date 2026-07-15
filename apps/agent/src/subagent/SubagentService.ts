import type { LanguageModel } from "ai"
import type { Model } from "@codepilotx/model-schema"
import type { PermissionConfig, SubagentProfile, SubagentResult } from "@codepilotx/shared/thread"
import { Effect } from "effect"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import { AgentError } from "../domain"
import { SafeBoundaryInterrupt, type AgentOrchestrator, type DelegationController, type PendingApproval, type PlanCheckpoint } from "../orchestration/AgentOrchestrator"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "../session/QuestionService"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import { WorkspaceService } from "../workspace/WorkspaceService"
import { SubagentRepository, type SpawnSubagentInput } from "./SubagentRepository"
import type { AttachmentService } from "./AttachmentService"

const terminal = new Set(["completed", "failed", "stopped", "interrupted"])

export interface SubagentWorkspaceProvider {
  prepare(taskID: string, rootPath: string, mode: "shared" | "worktree"): Promise<{ rootPath: string; baselineRef: string | null }>
  finalize(taskID: string): Promise<unknown>
  diff(taskID: string): Promise<unknown>
  apply(taskID: string): Promise<unknown>
  discard(taskID: string): Promise<unknown>
  restore(taskID: string): Promise<unknown>
}

type RootContext = {
  threadID: string
  turnID: string
  agentID: string
  taskMode: "chat" | "plan"
  continueFromPlan: boolean
  model: Model.Ref
  permissionConfig: PermissionConfig
  workspaceRoot: string
}

export class SubagentService {
  readonly repository: SubagentRepository
  private readonly controllers = new Map<string, AbortController>()
  private scheduling = false

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly providers: ProviderRuntime,
    private readonly approvals: ApprovalService,
    private readonly questions: QuestionService,
    private readonly orchestrator: AgentOrchestrator,
    private readonly attachments: AttachmentService,
    private readonly workspaces?: SubagentWorkspaceProvider,
  ) {
    this.repository = new SubagentRepository(db)
    approvals.setAgentStatusHandler((agentID, status) => { void this.onApprovalStatus(agentID, status) })
    queueMicrotask(() => {
      void this.schedule()
      void this.resumeSatisfiedParents()
    })
  }

  private async onApprovalStatus(agentID: string, status: "waiting_permission" | "running") {
    const execution = this.db.getAgentExecution(agentID)
    if (!execution?.subagentRunID) return
    const run = status === "waiting_permission" ? this.repository.setWaiting(execution.subagentRunID, "waiting_permission") : this.repository.setRunning(execution.subagentRunID)
    if (!run) return
    const task = this.repository.task(run.taskId)
    if (task) await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task, run, childThreadId: task.childThreadId })
  }

  delegationFor(root: RootContext): DelegationController {
    return {
      spawn: ({ agents }) => this.spawn(root, agents),
      wait: (input) => this.wait(input.runIDs, input.mode),
      isWaitSatisfied: (input) => Promise.resolve(this.isWaitSatisfied(input.runIDs, input.mode)),
      send: (input) => this.send(input.taskID, input.message, crypto.randomUUID()),
      stop: (input) => this.stop(input.taskID, crypto.randomUUID()),
    }
  }

  list(parentThreadID: string) {
    return this.repository.projectionForThread(parentThreadID)
  }

  read(taskID: string) {
    const task = this.repository.task(taskID)
    if (!task) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
    return { task, currentRun: task.currentRun }
  }

  async worktreeDiff(taskID: string) {
    const task = this.requireTask(taskID)
    if (task.workspace.mode !== "worktree" || !this.workspaces) throw new AgentError("WORKTREE_UNAVAILABLE", "该子 Agent 没有隔离 worktree", 409)
    return this.workspaces.diff(taskID)
  }

  async worktreeApply(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, "worktree-apply", () => this.requireWorkspaces().apply(taskID))
  }

  async worktreeDiscard(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, "worktree-discard", () => this.requireWorkspaces().discard(taskID))
  }

  async workspaceRestore(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, "workspace-restore", () => this.requireWorkspaces().restore(taskID))
  }

  private requireTask(taskID: string) {
    const task = this.repository.task(taskID)
    if (!task) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
    return task
  }

  private requireWorkspaces() {
    if (!this.workspaces) throw new AgentError("WORKTREE_UNAVAILABLE", "子 Agent workspace 服务未配置", 409)
    return this.workspaces
  }

  private async workspaceMutation(taskID: string, requestID: string, action: string, operation: () => Promise<unknown>) {
    const task = this.requireTask(taskID)
    const replay = this.replayControl(requestID, taskID, action)
    if (replay.hit) return replay.value
    const existing = this.repository.createControl({ requestID, taskID, ...(task.currentRun ? { runID: task.currentRun.id } : {}), action })
    if (existing.status === "applied") return existing.result == null ? null : JSON.parse(String(existing.result))
    if (existing.status === "failed") throw new AgentError("SUBAGENT_CONTROL_FAILED", String(existing.error ?? "操作失败"), 409)
    try {
      const result = await operation()
      this.repository.completeControl(requestID, result)
      await this.emit(task.parentThreadId, task.parentTurnId, "subagent/workspaceUpdated", { taskId: task.id, workspace: this.repository.task(task.id)?.workspace, result })
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      this.repository.completeControl(requestID, null, message)
      throw cause
    }
  }

  private replayControl(requestID: string, taskID: string, action: string): { hit: boolean; value?: unknown } {
    const control = this.repository.control(requestID)
    if (!control) return { hit: false }
    if (control.task_id !== taskID || control.action !== action) throw new AgentError("REQUEST_ID_REUSED", "requestId 已被其他子 Agent 操作使用", 409)
    if (control.status === "failed") throw new AgentError("SUBAGENT_CONTROL_FAILED", String(control.error ?? "操作失败"), 409)
    if (control.status === "applied") return { hit: true, value: control.result == null ? null : JSON.parse(String(control.result)) }
    throw new AgentError("SUBAGENT_CONTROL_IN_PROGRESS", "该 requestId 对应操作仍在执行", 409)
  }

  private async publish(events: Array<{ id: number; threadId: string | null; turnId: string | null; method: string; params: unknown; createdAt: number }>) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  private async emit(threadID: string, turnID: string | null, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
  }

  async spawn(root: RootContext, agents: Array<{ name?: string; profile: "default" | "explorer" | "worker"; task: string; workspaceMode?: "shared" | "worktree"; model?: Model.Ref }>) {
    if (root.taskMode === "plan" && !root.continueFromPlan && agents.some((agent) => agent.profile !== "explorer")) {
      throw new AgentError("PLAN_SUBAGENT_RESTRICTED", "Plan 确认前只能创建 Explorer", 409)
    }
    const parent = this.db.getAgentExecution(root.agentID)
    if (!parent || parent.depth !== 0) throw new AgentError("SUBAGENT_DEPTH_EXCEEDED", "子 Agent 不能继续创建子 Agent", 409)
    const created = []
    const generated = new Map<string, number>()
    const existingCounts = new Map<string, number>()
    for (const requested of agents) {
      const profile = requested.profile as Exclude<SubagentProfile, "main">
      const model = requested.model ?? root.model
      await this.resolveModel(model)
      const existing = existingCounts.get(profile) ?? (this.db.sqlite.query("SELECT COUNT(*) AS count FROM subagent_tasks WHERE parent_agent_id = ? AND profile = ?").get(root.agentID, profile) as { count: number }).count
      existingCounts.set(profile, existing)
      const generatedIndex = (generated.get(profile) ?? 0) + 1
      generated.set(profile, generatedIndex)
      const displayName = requested.name?.trim() || `${profile === "explorer" ? "Explorer" : profile === "worker" ? "Worker" : "Agent"} ${existing + generatedIndex}`
      const input: SpawnSubagentInput = {
        parentThreadID: root.threadID, parentTurnID: root.turnID, parentAgentID: root.agentID,
        displayName, profile, task: requested.task.trim(), model,
        permissionCeiling: root.permissionConfig, workspaceMode: requested.workspaceMode ?? "shared", workspaceRoot: root.workspaceRoot,
      }
      const row = this.repository.create(input)
      await this.publish(row.events)
      created.push({ taskId: row.task.id, runId: row.run.id, childThreadId: row.task.childThreadId, displayName, profile })
    }
    void this.schedule()
    return { agents: created }
  }

  isWaitSatisfied(runIDs: string[], mode: "all" | "any") {
    const states = runIDs.map((id) => this.repository.run(id)).filter(Boolean)
    if (states.length !== runIDs.length) throw new AgentError("SUBAGENT_NOT_FOUND", "等待目标不存在", 404)
    return mode === "all" ? states.every((run) => terminal.has(run!.status)) : states.some((run) => terminal.has(run!.status))
  }

  async wait(runIDs: string[], mode: "all" | "any") {
    if (!this.isWaitSatisfied(runIDs, mode)) throw new AgentError("SUBAGENTS_NOT_READY", "子 Agent 尚未满足等待条件", 409)
    return { mode, runs: runIDs.map((id) => this.repository.run(id)) }
  }

  async checkpointWait(threadID: string, turnID: string, agentID: string, approval: PendingApproval) {
    const runIDs = approval.runIDs ?? []
    const mode = approval.waitMode ?? "all"
    this.db.saveAgentTurnCheckpoint({
      agentID, turnID, threadID, state: "waiting_subagents",
      payload: { state: approval.checkpoint.state, interruption: approval.checkpoint.interruption, runIDs, mode }, version: 1,
    })
    this.db.updateTurnStatus(turnID, "waiting_subagents")
    const agent = this.db.updateAgentStatus(agentID, "waiting_subagents")
    await this.emit(threadID, turnID, "agent/upserted", { agent })
    await this.emit(threadID, turnID, "turn/statusChanged", { turnId: turnID, rootAgentId: agentID, status: "waiting-subagents", runIds: runIDs, mode })
  }

  resolvedWaitCheckpoint(turnID: string): PlanCheckpoint | null {
    const checkpoint = this.db.getAgentTurnCheckpoint(turnID)
    if (checkpoint?.state !== "waiting_subagents") return null
    const runIDs = Array.isArray(checkpoint.payload.runIDs) ? checkpoint.payload.runIDs.filter((value): value is string => typeof value === "string") : []
    const mode = checkpoint.payload.mode === "any" ? "any" : "all"
    if (!this.isWaitSatisfied(runIDs, mode)) return null
    if (typeof checkpoint.payload.state !== "string" || checkpoint.payload.interruption === undefined) return null
    return { state: checkpoint.payload.state, interruption: checkpoint.payload.interruption, answer: null }
  }

  async send(taskID: string, message: string, requestID: string, options: { model?: Model.Ref; permissionConfig?: PermissionConfig; attachmentIDs?: string[] } = {}) {
    const replay = this.replayControl(requestID, taskID, "send")
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
    const run = task.currentRun
    if (options.model) await this.resolveModel(options.model)
    const permission = options.permissionConfig ?? run.permissionConfig
    this.assertPermissionCeiling(run.permissionConfig, permission)
    await this.validateAttachments(options.attachmentIDs ?? [], options.model ?? run.model)
    this.repository.createControl({ requestID, taskID, runID: run.id, action: "send", payload: { message, ...options, permissionConfig: permission } })
    if (terminal.has(run.status)) {
      const next = this.repository.continueTask({ taskID, message, ...(options.model ? { model: options.model } : {}), permission, sameRun: false })
      await this.bindAttachments(next.agent.turnID, options.attachmentIDs ?? [])
      const response = { disposition: "follow-up" as const, run: next.run }
      this.repository.completeControl(requestID, response)
      await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: next.task, run: next.run })
      void this.schedule()
      return response
    }
    if (["queued", "preparing", "waiting-question", "waiting-permission"].includes(run.status)) {
      const latest = this.db.sqlite.query("SELECT turn_id FROM agent_executions WHERE subagent_run_id = ? ORDER BY run_sequence DESC LIMIT 1").get(run.id) as { turn_id: string } | null
      if (latest) {
        this.approvals.cancelTurn(latest.turn_id)
        this.questions.cancelTurn(latest.turn_id)
        this.db.run("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status = 'pending'", Date.now(), latest.turn_id)
      }
      const continued = this.repository.continueTask({ taskID, message, ...(options.model ? { model: options.model } : {}), permission, sameRun: true })
      await this.bindAttachments(continued.agent.turnID, options.attachmentIDs ?? [])
      const response = { disposition: "steering" as const, run: continued.run }
      this.repository.completeControl(requestID, response)
      await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: continued.task, run: continued.run })
      void this.schedule()
      return response
    }
    this.repository.markSteering(run.id)
    await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: this.repository.task(taskID), run: this.repository.run(run.id) })
    return { disposition: "steering", run: this.repository.run(run.id) }
  }

  async retry(taskID: string, requestID: string) {
    const replay = this.replayControl(requestID, taskID, "retry")
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun || !["failed", "stopped", "interrupted"].includes(task.currentRun.status)) throw new AgentError("SUBAGENT_NOT_RETRYABLE", "当前子 Agent 状态不能重试", 409)
    this.repository.createControl({ requestID, taskID, runID: task.currentRun.id, action: "retry" })
    const next = this.repository.continueTask({ taskID, message: task.task, sameRun: false })
    this.repository.completeControl(requestID, next)
    await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: next.task, run: next.run })
    void this.schedule()
    return next
  }

  async stop(taskID: string, requestID: string) {
    const replay = this.replayControl(requestID, taskID, "stop")
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
    const run = task.currentRun
    this.repository.createControl({ requestID, taskID, runID: run.id, action: "stop" })
    if (terminal.has(run.status)) {
      const result = { task, run }
      this.repository.completeControl(requestID, result)
      return result
    }
    this.controllers.get(run.id)?.abort()
    const execution = this.db.sqlite.query("SELECT turn_id FROM agent_executions WHERE subagent_run_id = ? ORDER BY run_sequence DESC LIMIT 1").get(run.id) as { turn_id: string } | null
    if (execution) {
      this.approvals.cancelTurn(execution.turn_id)
      this.questions.cancelTurn(execution.turn_id)
      this.db.run("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status = 'pending'", Date.now(), execution.turn_id)
    }
    const finished = this.repository.finish(run.id, "stopped", null, "用户停止了子 Agent")
    this.repository.completeControl(requestID, finished)
    if (finished) await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", finished)
    await this.resumeSatisfiedParents()
    void this.schedule()
    return finished
  }

  async stopChildrenForParent(parentAgentID: string) {
    const rows = this.db.sqlite.query("SELECT id FROM subagent_tasks WHERE parent_agent_id = ? AND status NOT IN ('completed', 'failed', 'stopped', 'interrupted')").all(parentAgentID) as Array<{ id: string }>
    for (const row of rows) await this.stop(row.id, crypto.randomUUID())
  }

  async schedule() {
    if (this.scheduling) return
    this.scheduling = true
    try {
      for (const runID of this.repository.queuedRunIDs()) {
        const claim = this.repository.claim(runID)
        if (!claim || "queued" in claim) continue
        void this.execute(claim.task.id, runID, claim.agent.id)
      }
    } finally {
      this.scheduling = false
    }
  }

  private async execute(taskID: string, runID: string, agentID: string) {
    const task = this.repository.task(taskID)
    const run = this.repository.run(runID)
    const agent = this.db.getAgentExecution(agentID)
    if (!task || !run || !agent) return
    const controller = new AbortController()
    let isolationPrepared = false
    this.controllers.set(runID, controller)
    await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task, run })
    await this.emit(task.childThreadId, agent.turnID, "agent/upserted", { agent })
    await this.emit(task.childThreadId, agent.turnID, "turn/started", { turnId: agent.turnID, rootAgentId: agent.id, startedAt: Date.now() })
    try {
      const rootPath = task.workspace.rootPath
      if (!rootPath) throw new AgentError("WORKSPACE_REQUIRED", "子 Agent 没有工作区", 409)
      const sourceIsGit = await this.isGitWorkspace(rootPath)
      const needsWritableBaseline = task.profile !== "explorer" && run.permissionConfig.sandboxMode !== "read-only" && sourceIsGit
      const needsIsolation = task.workspace.mode === "worktree" || needsWritableBaseline
      const prepared = this.workspaces && needsIsolation ? await this.workspaces.prepare(task.id, rootPath, task.workspace.mode) : { rootPath, baselineRef: null }
      isolationPrepared = prepared.baselineRef !== null
      if (task.workspace.mode === "worktree" && !this.workspaces) throw new AgentError("WORKTREE_UNAVAILABLE", "worktree 服务未配置", 409)
      const workspace = await WorkspaceService.open(prepared.rootPath)
      const permissionConfig = await this.isGitWorkspace(workspace.rootPath)
        ? run.permissionConfig
        : { ...run.permissionConfig, sandboxMode: "read-only" as const }
      const input = this.db.getTurnInput(agent.turnID)
      if (!input) throw new Error(`Subagent turn ${agent.turnID} 没有输入`)
      const checkpoint = this.questions.claimResolvedCheckpoint(agent.turnID)
      const result = await this.orchestrator.run({
        threadID: task.childThreadId, turnID: agent.turnID, agentID: agent.id, sessionID: agent.sessionID,
        profile: task.profile, depth: 1, content: input.content, taskMode: "chat", fallbackModel: run.model,
        permissionConfig, signal: controller.signal, workspace,
        attachments: await this.agentAttachments(input.id),
        ...(checkpoint ? { resume: checkpoint.approval } : {}),
        resolveModel: async (fallback) => this.languageModel(fallback),
        pause: async (approval) => { await this.questions.checkpoint(task.childThreadId, agent.turnID, agent.id, approval) },
        checkSafeBoundary: async () => {
          return this.repository.pendingControls(runID).some((control) => control.action === "send")
        },
      })
      if (result.status === "paused") {
        this.repository.setWaiting(runID, "waiting_question")
        await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: this.repository.task(taskID), run: this.repository.run(runID) })
        return
      }
      const steer = this.repository.pendingControls(runID).find((control) => control.action === "send")
      if (steer) {
        const payload = JSON.parse(steer.payload) as { message?: unknown; model?: Model.Ref; permissionConfig?: PermissionConfig; attachmentIDs?: string[] }
        const continued = this.repository.continueTask({ taskID, message: typeof payload.message === "string" ? payload.message : "继续", ...(payload.model ? { model: payload.model } : {}), ...(payload.permissionConfig ? { permission: payload.permissionConfig } : {}), sameRun: true })
        await this.bindAttachments(continued.agent.turnID, payload.attachmentIDs ?? [])
        this.repository.completeControl(steer.id, { agentId: continued.agent.id })
        await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: continued.task, run: continued.run })
        void this.schedule()
        return
      }
      const structured: SubagentResult = (result.status === "completed" ? result.result : undefined) ?? { outcome: "succeeded", summary: result.output, findings: [], changedFiles: [], validation: [], risks: [], references: [] }
      if (isolationPrepared) await this.workspaces?.finalize(taskID)
      const finished = this.repository.finish(runID, "completed", structured, null)
      if (finished) await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", finished)
      await this.emit(task.childThreadId, agent.turnID, "turn/completed", { turnId: agent.turnID, rootAgentId: agent.id, finishedAt: Date.now() })
    } catch (cause) {
      const steer = this.repository.pendingControls(runID).find((control) => control.action === "send")
      if (cause instanceof SafeBoundaryInterrupt && steer) {
        const payload = JSON.parse(steer.payload) as { message?: unknown; model?: Model.Ref; permissionConfig?: PermissionConfig; attachmentIDs?: string[] }
        const continued = this.repository.continueTask({ taskID, message: typeof payload.message === "string" ? payload.message : "继续", ...(payload.model ? { model: payload.model } : {}), ...(payload.permissionConfig ? { permission: payload.permissionConfig } : {}), sameRun: true })
        await this.bindAttachments(continued.agent.turnID, payload.attachmentIDs ?? [])
        this.repository.completeControl(steer.id, { agentId: continued.agent.id })
        await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", { task: continued.task, run: continued.run })
        void this.schedule()
        return
      }
      if (!controller.signal.aborted) {
        const error = cause instanceof Error ? cause.message : String(cause)
        if (isolationPrepared) await this.workspaces?.finalize(taskID).catch(() => undefined)
        const finished = this.repository.finish(runID, "failed", null, error)
        if (finished) await this.emit(task.parentThreadId, task.parentTurnId, "subagent/updated", finished)
        await this.emit(task.childThreadId, agent.turnID, "turn/failed", { turnId: agent.turnID, rootAgentId: agent.id, message: error, finishedAt: Date.now() })
      }
    } finally {
      this.controllers.delete(runID)
      await this.resumeSatisfiedParents()
      void this.schedule()
    }
  }

  async resumeTurn(threadID: string, turnID: string) {
    const row = this.db.sqlite.query("SELECT subagent_run_id, id FROM agent_executions WHERE turn_id = ?").get(turnID) as { subagent_run_id: string | null; id: string } | null
    if (!row?.subagent_run_id) return
    this.db.updateTurnStatus(turnID, "queued")
    this.db.updateAgentStatus(row.id, "queued")
    this.db.run("UPDATE subagent_runs SET status = 'queued', updated_at = ? WHERE id = ?", Date.now(), row.subagent_run_id)
    void this.schedule()
  }

  private async resumeSatisfiedParents() {
    const rows = this.db.sqlite.query("SELECT agent_id, turn_id, thread_id, payload FROM agent_checkpoints WHERE state = 'waiting_subagents'").all() as Array<{ agent_id: string; turn_id: string; thread_id: string; payload: string }>
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      const runIDs = Array.isArray(payload.runIDs) ? payload.runIDs.filter((value): value is string => typeof value === "string") : []
      const mode = payload.mode === "any" ? "any" : "all"
      if (!this.isWaitSatisfied(runIDs, mode)) continue
      this.db.updateTurnStatus(row.turn_id, "queued")
      const agent = this.db.updateAgentStatus(row.agent_id, "queued")
      await this.emit(row.thread_id, row.turn_id, "agent/upserted", { agent })
      await this.emit(row.thread_id, row.turn_id, "turn/statusChanged", { turnId: row.turn_id, status: "queued", resumedFrom: "waiting-subagents" })
      this.parentResumeHandler?.(row.thread_id, row.turn_id)
    }
  }

  private parentResumeHandler?: (threadID: string, turnID: string) => void

  setParentResumeHandler(handler: (threadID: string, turnID: string) => void) {
    this.parentResumeHandler = handler
  }

  private async resolveModel(ref: Model.Ref) {
    try { return await this.providers.resolve(ref) } catch (cause) { throw new AgentError("MODEL_UNAVAILABLE", "子 Agent 模型不可用", 409, cause) }
  }

  private async languageModel(ref: Model.Ref): Promise<{ ref: Model.Ref; model: LanguageModel }> {
    const resolved = await this.resolveModel(ref)
    return { ref, model: await this.providers.getLanguage(ref) as LanguageModel }
  }

  private assertPermissionCeiling(ceiling: PermissionConfig, requested: PermissionConfig) {
    const sandboxRank = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 } as const
    const approvalRank = { untrusted: 0, "on-request": 1, "never": 2 } as const
    const reviewerRank = { user: 0, auto_review: 1 } as const
    if (sandboxRank[requested.sandboxMode] > sandboxRank[ceiling.sandboxMode] || approvalRank[requested.approvalPolicy] > approvalRank[ceiling.approvalPolicy] || reviewerRank[requested.approvalsReviewer] > reviewerRank[ceiling.approvalsReviewer]) {
      throw new AgentError("PERMISSION_CEILING_EXCEEDED", "子 Agent 权限只能保持或收紧", 403)
    }
  }

  private async validateAttachments(ids: string[], model: Model.Ref) {
    if (!ids.length) return
    if (ids.length > 8 || new Set(ids).size !== ids.length) throw new AgentError("ATTACHMENT_COUNT_LIMIT", "每个 Turn 最多包含 8 个不重复附件", 413)
    const values = await Promise.all(ids.map((id) => this.attachments.read(id)))
    if (values.some((value) => value.record.binding !== null)) throw new AgentError("ATTACHMENT_ALREADY_BOUND", "附件已绑定到其他 Turn", 409)
    if (values.some((value) => value.record.kind === "image")) {
      const info = await this.resolveModel(model)
      if (!info.capabilities.input.includes("image")) throw new AgentError("MODEL_IMAGE_UNSUPPORTED", "当前模型不支持图片输入", 409)
    }
  }

  private async bindAttachments(turnID: string, ids: string[]) {
    if (!ids.length) return
    const input = this.db.sqlite.query("SELECT id FROM inputs WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1").get(turnID) as { id: string } | null
    if (!input) throw new AgentError("INPUT_NOT_FOUND", "子 Agent 输入不存在", 404)
    await this.attachments.bind(ids, { type: "input", id: input.id })
  }

  private async agentAttachments(inputID: string) {
    const records = await this.attachments.listByBinding({ type: "input", id: inputID })
    return Promise.all(records.map(async (record) => {
      const value = await this.attachments.read(record.id)
      return record.kind === "text"
        ? { kind: "text" as const, name: record.name, text: new TextDecoder("utf-8", { fatal: true }).decode(value.data) }
        : { kind: "image" as const, name: record.name, mediaType: record.mimeType, base64: Buffer.from(value.data).toString("base64") }
    }))
  }

  private async isGitWorkspace(rootPath: string) {
    const process = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd: rootPath, stdin: "ignore", stdout: "ignore", stderr: "ignore" })
    return await process.exited === 0
  }
}

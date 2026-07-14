import { Effect } from "effect"
import { AgentError, type SubmitMessage, type ToolInvocation } from "../domain"
import type { AdapterRegistry } from "../provider/AdapterRegistry"
import type { ModelCatalog } from "../provider/ModelCatalog"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ToolRegistry } from "../tool/ToolRegistry"
import type { PermissionService } from "../permission/PermissionService"
import type { LLMService } from "../llm/LLMService"
import type { SessionProcessor } from "./SessionProcessor"
import type { QuestionService } from "./QuestionService"
import type { AgentOrchestrator, AgentRole } from "../orchestration/AgentOrchestrator"
import { WorkspaceService, type ProposalDraft } from "../workspace/WorkspaceService"

export class SessionService {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly catalog: ModelCatalog,
    private readonly adapters: AdapterRegistry,
    private readonly llm: LLMService,
    private readonly processor: SessionProcessor,
    private readonly tools: ToolRegistry,
    private readonly permissions: PermissionService,
    private readonly questions: QuestionService,
    private readonly orchestrator: AgentOrchestrator,
  ) {
    this.questions.setResumeHandler((sessionID, runID) => { void this.executeRun(sessionID, runID) })
    queueMicrotask(() => this.resumeQueuedRuns())
  }

  private resumeQueuedRuns() {
    const rows = this.db.sqlite.query(`
      SELECT r.id, r.session_id
      FROM runs AS r
      WHERE r.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM runs AS active
          WHERE active.session_id = r.session_id
            AND active.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_plan_confirmation')
        )
      ORDER BY r.created_at
    `).all() as Array<{ id: string; session_id: string }>
    const sessions = new Set<string>()
    for (const row of rows) {
      if (sessions.has(row.session_id)) continue
      sessions.add(row.session_id)
      void this.executeRun(row.session_id, row.id)
    }
  }

  private async emit(sessionID: string, type: string, payload: unknown) {
    const event = this.db.insertEvent(sessionID, type, payload)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  create(title?: string, projectID?: string) {
    return this.db.createSession(title, projectID)
  }

  get(sessionID: string) {
    const session = this.db.getSession(sessionID)
    if (!session) throw new AgentError("SESSION_NOT_FOUND", "会话不存在", 404)
    return session
  }

  async submit(sessionID: string, input: SubmitMessage) {
    this.get(sessionID)
    if (!input.content.trim()) throw new AgentError("EMPTY_MESSAGE", "消息不能为空", 400)
    if (!this.db.sessionProjectID(sessionID)) throw new AgentError("PROJECT_REQUIRED", "请先选择项目后再开始任务", 409)
    const model = this.catalog.getModel(input.model.providerID, input.model.modelID)
    if (input.taskMode !== "plan" && !model.capabilities.tools) {
      await this.emit(sessionID, "model.tools-unavailable", { model: input.model, message: "该模型不支持工具调用，开发阶段只能给出文字建议，无法生成结构化提议" })
    }
    const active = this.db.activeRun(sessionID)
    if (active && input.strategy === "guide" && active.status !== "waiting_question") {
      const guide = this.db.appendGuide(sessionID, active.id, input)
      await Effect.runPromise(this.hub.publish(guide.event))
      if (active.status === "waiting_plan_confirmation") {
        this.db.setRunWorkflowState(active.id, { status: "queued", currentStage: "planner", canContinueFromPlan: false })
        void this.executeRun(sessionID, active.id)
      }
      return { disposition: "guide" as const, runID: active.id, inputID: guide.inputID }
    }
    const created = this.db.createRun(sessionID, input, active ? "queued" : "queued")
    await Effect.runPromise(this.hub.publish(created.event))
    if (!active) void this.executeRun(sessionID, created.runID)
    return { disposition: active ? "queued" as const : "started" as const, runID: created.runID, inputID: created.inputID }
  }

  private async executeTool(invocation: ToolInvocation, signal: AbortSignal) {
    const startedAt = Date.now()
    this.db.run(`INSERT INTO tool_calls (id, session_id, run_id, tool_name, input, status, started_at) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT(id) DO NOTHING`, invocation.id, invocation.sessionID, invocation.runID, invocation.name, JSON.stringify(invocation.input), startedAt)
    const permission = await this.permissions.authorize(invocation, signal)
    if (permission.decision !== "allow") {
      this.db.run("UPDATE tool_calls SET status = 'error', error = ?, finished_at = ? WHERE id = ?", permission.reason, Date.now(), invocation.id)
      throw new AgentError("TOOL_PERMISSION_DENIED", permission.reason, 403)
    }
    this.db.run("UPDATE tool_calls SET status = 'running', started_at = ? WHERE id = ?", Date.now(), invocation.id)
    await this.emit(invocation.sessionID, "tool.running", { id: invocation.id, runID: invocation.runID, name: invocation.name, input: invocation.input })
    try {
      const output = invocation.name === "question.ask"
        ? await this.questions.ask(invocation.sessionID, invocation.runID, invocation.input, signal)
        : await this.tools.execute(invocation.name, invocation.input, { signal, taskMode: invocation.taskMode })
      this.db.run("UPDATE tool_calls SET status = 'completed', output = ?, finished_at = ? WHERE id = ?", JSON.stringify(output ?? null), Date.now(), invocation.id)
      await this.recordPatch(invocation, output)
      await this.emit(invocation.sessionID, "tool.completed", { id: invocation.id, runID: invocation.runID, name: invocation.name, output })
      return output
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      this.db.run("UPDATE tool_calls SET status = 'error', error = ?, finished_at = ? WHERE id = ?", message, Date.now(), invocation.id)
      await this.emit(invocation.sessionID, "tool.error", { id: invocation.id, runID: invocation.runID, name: invocation.name, error: message })
      throw cause
    }
  }

  private async recordPatch(invocation: ToolInvocation, output: unknown) {
    if (!invocation.name.startsWith("filesystem.") || !["filesystem.write", "filesystem.patch"].includes(invocation.name)) return
    const result = output && typeof output === "object" ? output as Record<string, unknown> : {}
    if (typeof result.path !== "string") return
    const id = crypto.randomUUID()
    const additions = typeof result.additions === "number" ? result.additions : 0
    const deletions = typeof result.deletions === "number" ? result.deletions : 0
    const createdAt = Date.now()
    const files = [{ path: result.path, additions, deletions }]
    this.db.transaction(() => {
      this.db.run("INSERT INTO patches (id, session_id, run_id, files, additions, deletions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, invocation.sessionID, invocation.runID, JSON.stringify(files), additions, deletions, createdAt)
      this.db.upsertPart(invocation.sessionID, { id, runID: invocation.runID, type: "patch", status: "completed", data: { files, additions, deletions }, createdAt, updatedAt: createdAt })
    })
    await this.emit(invocation.sessionID, "part.updated", this.db.getPart(id))
  }

  private async executeRun(sessionID: string, runID: string) {
    const input = this.db.getRunInput(runID)
    if (!input) return
    const checkpoint = this.questions.claimResolvedCheckpoint(runID)
    const storedCheckpoint = this.db.getAgentRunCheckpoint(runID)
    const continueFromPlan = storedCheckpoint?.state === "ready" && storedCheckpoint.payload.planDecision === "continue"
    const controller = new AbortController()
    this.controllers.set(runID, controller)
    if (checkpoint) this.db.updateRunStatus(runID, "running")
    else this.db.startRun(runID)
    await this.emit(sessionID, checkpoint ? "run.resumed" : "run.started", { runID, startedAt: Date.now(), input, ...(checkpoint ? { checkpointID: checkpoint.id } : {}) })
    try {
      let activeModel = input.model
      let content = input.content
      const mailbox = this.db.takeGuideMailbox(runID)
      if (mailbox.length) {
        const latest = mailbox.at(-1)
        if (latest) {
          activeModel = latest.model
        }
        content += `\n\n用户补充要求：\n${mailbox.map((item) => item.content).join("\n")}`
        await this.emit(sessionID, "run.guide-consumed", { runID, inputs: mailbox, safeBoundary: "before-model" })
      }
      const projectID = this.db.sessionProjectID(sessionID)
      if (!projectID) throw new AgentError("PROJECT_REQUIRED", "当前会话未选择项目", 409)
      const project = this.db.getProject(projectID)
      if (!project) throw new AgentError("PROJECT_NOT_FOUND", "当前项目不存在", 404)
      const workspace = await WorkspaceService.open(project.rootPath)
      const saveProposal = async (draft: ProposalDraft, role: AgentRole) => {
        const proposalRole = role === "assistant" ? "developer" : role
        const title = draft.type === "patch" ? `补丁提议：${draft.payload.path}` : `命令提议：${draft.payload.command}`
        return this.db.createProposal({
          runID,
          projectID,
          role: proposalRole,
          kind: draft.type,
          title,
          payload: draft.payload,
          review: null,
        })
      }
      const result = await this.orchestrator.run({
        sessionID,
        runID,
        content,
        taskMode: input.taskMode,
        fallbackModel: activeModel,
        signal: controller.signal,
        workspace,
        ...(checkpoint ? { resume: checkpoint.approval } : {}),
        ...(continueFromPlan ? { continueFromPlan: true, plan: this.db.currentPlan(runID) ?? "" } : {}),
        resolveModel: async (role, fallback) => {
          if (role === "assistant") {
            const resolved = this.catalog.getModel(fallback.providerID, fallback.modelID)
            return { ref: fallback, model: await Effect.runPromise(this.adapters.resolve(resolved)) }
          }
          const ref = this.db.resolveProjectModel(projectID, role, fallback) ?? fallback
          const resolved = this.catalog.getModel(ref.providerID, ref.modelID)
          return { ref, model: await Effect.runPromise(this.adapters.resolve(resolved)) }
        },
        saveProposal,
        pause: async (approval) => { await this.questions.checkpoint(sessionID, runID, approval) },
      })
      if (controller.signal.aborted) return
      if (result.status === "paused") return
      if (result.status === "plan-ready") {
        this.db.waitForPlanConfirmation({ runID, sessionID, stage: "planner", payload: { plan: result.plan }, version: 1 })
        await this.emit(sessionID, "run.plan-ready", { runID, plan: result.plan })
        return
      }
      this.db.deleteAgentRunCheckpoint(runID)
      this.db.updateRunStatus(runID, "completed")
      await this.emit(sessionID, "run.completed", { runID, finishedAt: Date.now() })
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : String(cause)
      this.db.updateRunStatus(runID, "failed")
      await this.emit(sessionID, "run.failed", { runID, message, finishedAt: Date.now() })
    } finally {
      this.controllers.delete(runID)
      if (!this.db.activeRun(sessionID)) {
        const next = this.db.nextQueuedRun(sessionID)
        if (next) void this.executeRun(sessionID, next.id)
      }
    }
  }

  async stop(sessionID: string) {
    const active = this.db.activeRun(sessionID)
    if (!active) throw new AgentError("NO_ACTIVE_RUN", "当前没有运行中的任务", 409)
    this.controllers.get(active.id)?.abort()
    this.permissions.cancelRun(active.id)
    this.questions.cancelRun(active.id)
    this.db.transaction(() => {
      this.db.updateRunStatus(active.id, "interrupted")
      this.db.run("UPDATE parts SET status = 'interrupted', updated_at = ? WHERE run_id = ? AND status IN ('pending', 'running')", Date.now(), active.id)
      this.db.run("UPDATE permission_requests SET status = 'cancelled', resolved_at = ? WHERE run_id = ? AND status = 'pending'", Date.now(), active.id)
      this.db.run("UPDATE questions SET status = 'cancelled', resolved_at = ? WHERE run_id = ? AND status = 'pending'", Date.now(), active.id)
    })
    await this.emit(sessionID, "run.interrupted", { runID: active.id, finishedAt: Date.now() })
  }

  resumeRun(sessionID: string, runID: string) {
    const active = this.db.activeRun(sessionID)
    if (active && active.id !== runID) return
    void this.executeRun(sessionID, runID)
  }

  async decidePlan(runID: string, decision: "continue" | "reject") {
    const result = this.db.decidePlan(runID, decision)
    if (!result) return null
    await this.emit(result.sessionID, "run.plan-decision", result)
    if (decision === "continue") this.resumeRun(result.sessionID, result.runID)
    return result
  }
}

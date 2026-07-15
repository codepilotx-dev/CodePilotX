import { Effect } from "effect"
import type { LanguageModel } from "ai"
import { Model } from "@codepilotx/model-schema"
import type { ThreadSettings } from "@codepilotx/shared/thread"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import { AgentError, type SubmitMessage } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "./QuestionService"
import type { AgentOrchestrator, AgentRole } from "../orchestration/AgentOrchestrator"
import { WorkspaceService, type ProposalDraft } from "../workspace/WorkspaceService"

export class ThreadService {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly providers: ProviderRuntime,
    private readonly approvals: ApprovalService,
    private readonly questions: QuestionService,
    private readonly orchestrator: AgentOrchestrator,
  ) {
    this.questions.setResumeHandler((threadID, turnID) => { void this.executeTurn(threadID, turnID) })
    queueMicrotask(() => this.resumeQueuedTurns())
  }

  private resumeQueuedTurns() {
    const rows = this.db.sqlite.query(`
      SELECT r.id, r.thread_id
      FROM turns AS r
      WHERE r.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM turns AS active
          WHERE active.thread_id = r.thread_id
            AND active.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_plan_confirmation')
        )
      ORDER BY r.created_at
    `).all() as Array<{ id: string; thread_id: string }>
    const threads = new Set<string>()
    for (const row of rows) {
      if (threads.has(row.thread_id)) continue
      threads.add(row.thread_id)
      void this.executeTurn(row.thread_id, row.id)
    }
  }

  private async emit(threadID: string, turnID: string | null, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  create(title?: string, projectID?: string, settings?: ThreadSettings) {
    return this.db.createThread(title, projectID, settings)
  }

  get(threadID: string) {
    const thread = this.db.getThread(threadID)
    if (!thread) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    return thread
  }

  async submit(threadID: string, input: SubmitMessage) {
    this.get(threadID)
    if (!input.content.trim()) throw new AgentError("EMPTY_MESSAGE", "消息不能为空", 400)
    if (!this.db.threadProjectID(threadID)) throw new AgentError("PROJECT_REQUIRED", "请先选择项目后再开始任务", 409)
    const model = await this.resolveAvailableModel([input.model])
    if (input.taskMode !== "plan" && !model.capabilities.tools) {
      await this.emit(threadID, null, "turn/statusChanged", { state: "model-tools-unavailable", model: input.model, message: "该模型不支持工具调用，开发阶段只能给出文字建议，无法生成结构化提议" })
    }
    const active = this.db.activeTurn(threadID)
    if (active && input.strategy === "guide" && active.status !== "waiting_question") {
      const guide = this.db.appendGuide(threadID, active.id, input)
      if (guide.settingsEvent) await Effect.runPromise(this.hub.publish(guide.settingsEvent))
      await Effect.runPromise(this.hub.publish(guide.event))
      if (active.status === "waiting_plan_confirmation") {
        this.db.setTurnWorkflowState(active.id, { status: "queued", currentStage: "planner", canContinueFromPlan: false })
        void this.executeTurn(threadID, active.id)
      }
      return { disposition: "guide" as const, turnID: active.id, inputID: guide.inputID }
    }
    const created = this.db.createTurn(threadID, input, "queued")
    if (created.settingsEvent) await Effect.runPromise(this.hub.publish(created.settingsEvent))
    await Effect.runPromise(this.hub.publish(created.event))
    if (!active) void this.executeTurn(threadID, created.turnID)
    return { disposition: active ? "queued" as const : "started" as const, turnID: created.turnID, inputID: created.inputID }
  }

  private async executeTurn(threadID: string, turnID: string) {
    const input = this.db.getTurnInput(turnID)
    if (!input) return
    const checkpoint = this.questions.claimResolvedCheckpoint(turnID)
    const storedCheckpoint = this.db.getAgentTurnCheckpoint(turnID)
    const continueFromPlan = storedCheckpoint?.state === "ready" && storedCheckpoint.payload.planDecision === "continue"
    const controller = new AbortController()
    this.controllers.set(turnID, controller)
    if (checkpoint) this.db.updateTurnStatus(turnID, "running")
    else this.db.startTurn(turnID)
    await this.emit(threadID, turnID, "turn/started", { turnId: turnID, startedAt: Date.now(), input, ...(checkpoint ? { checkpointID: checkpoint.id, resumed: true } : {}) })
    try {
      let activeModel = input.model
      let content = input.content
      const mailbox = this.db.takeGuideMailbox(turnID)
      if (mailbox.length) {
        const latest = mailbox.at(-1)
        if (latest) {
          activeModel = latest.model
        }
        content += `\n\n用户补充要求：\n${mailbox.map((item) => item.content).join("\n")}`
        await this.emit(threadID, turnID, "queue/updated", { turnId: turnID, inputs: mailbox, action: "guide-consumed", safeBoundary: "before-model" })
      }
      const projectID = this.db.threadProjectID(threadID)
      if (!projectID) throw new AgentError("PROJECT_REQUIRED", "当前会话未选择项目", 409)
      const project = this.db.getProject(projectID)
      if (!project) throw new AgentError("PROJECT_NOT_FOUND", "当前项目不存在", 404)
      const workspace = await WorkspaceService.open(project.rootPath)
      const saveProposal = async (draft: ProposalDraft, role: AgentRole) => {
        const proposalRole = role === "assistant" ? "developer" : role
        const title = draft.type === "patch" ? `补丁提议：${draft.payload.path}` : `命令提议：${draft.payload.command}`
        return this.db.createProposal({
          turnID,
          projectID,
          role: proposalRole,
          kind: draft.type,
          title,
          payload: draft.payload,
          review: null,
        })
      }
      const result = await this.orchestrator.run({
        threadID,
        turnID,
        content,
        taskMode: input.taskMode,
        permissionConfig: input.permissionConfig,
        fallbackModel: activeModel,
        signal: controller.signal,
        workspace,
        ...(checkpoint ? { resume: checkpoint.approval } : {}),
        ...(continueFromPlan ? { continueFromPlan: true, plan: this.db.currentPlan(turnID) ?? "" } : {}),
        resolveModel: async (role, fallback) => {
          const projectModels = this.db.getProjectSettings(projectID)
          const roleModel = role === "planner"
            ? projectModels.plannerModel
            : role === "developer"
              ? projectModels.developerModel
              : role === "reviewer"
                ? projectModels.reviewerModel
                : fallback
          const globalDefault = this.db.getSetting<Model.Ref>("defaultModel")
          const ref = await this.resolveAvailableModel([
            roleModel,
            projectModels.defaultModel,
            globalDefault,
            fallback,
          ])
          const selected = Model.Ref.make({ providerID: ref.providerID, id: ref.id, ...(ref.request.variant ? { variant: Model.VariantID.make(ref.request.variant) } : {}) })
          return { ref: selected, model: await this.providers.getLanguage(selected) as LanguageModel }
        },
        saveProposal,
        pause: async (approval) => { await this.questions.checkpoint(threadID, turnID, approval) },
      })
      if (controller.signal.aborted) return
      if (result.status === "paused") return
      if (result.status === "plan-ready") {
        this.db.waitForPlanConfirmation({ turnID, threadID, stage: "planner", payload: { plan: result.plan }, version: 1 })
        await this.emit(threadID, turnID, "plan/ready", { turnId: turnID, plan: result.plan })
        return
      }
      this.db.deleteAgentTurnCheckpoint(turnID)
      this.db.updateTurnStatus(turnID, "completed")
      await this.emit(threadID, turnID, "turn/completed", { turnId: turnID, finishedAt: Date.now() })
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : String(cause)
      this.db.updateTurnStatus(turnID, "failed")
      await this.emit(threadID, turnID, "turn/failed", { turnId: turnID, message, finishedAt: Date.now() })
    } finally {
      this.controllers.delete(turnID)
      if (!this.db.activeTurn(threadID)) {
        const next = this.db.nextQueuedTurn(threadID)
        if (next) void this.executeTurn(threadID, next.id)
      }
    }
  }

  private async resolveAvailableModel(candidates: ReadonlyArray<Model.Ref | null | undefined>) {
    const seen = new Set<string>()
    let lastError: unknown
    for (const candidate of candidates) {
      if (!candidate) continue
      const key = `${candidate.providerID}/${candidate.id}/${candidate.variant ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        return await this.providers.resolve(candidate)
      } catch (cause) {
        lastError = cause
      }
    }
    for (const model of await this.providers.models()) {
      try {
        return await this.providers.resolve({ providerID: model.providerID, id: model.id })
      } catch (cause) {
        lastError = cause
      }
    }
    throw new AgentError("MODEL_UNAVAILABLE", "没有可用的模型，请先连接 Provider 或调整项目模型设置", 409, lastError)
  }

  async stop(threadID: string) {
    const active = this.db.activeTurn(threadID)
    if (!active) throw new AgentError("NO_ACTIVE_TURN", "当前没有运行中的 Turn", 409)
    this.controllers.get(active.id)?.abort()
    this.approvals.cancelTurn(active.id)
    this.questions.cancelTurn(active.id)
    this.db.transaction(() => {
      this.db.updateTurnStatus(active.id, "interrupted")
      this.db.run("UPDATE items SET status = 'interrupted', updated_at = ? WHERE turn_id = ? AND status IN ('pending', 'running')", Date.now(), active.id)
      this.db.run("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status = 'pending'", Date.now(), active.id)
      this.db.run("UPDATE question_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status = 'pending'", Date.now(), active.id)
    })
    await this.emit(threadID, active.id, "turn/interrupted", { turnId: active.id, finishedAt: Date.now() })
  }

  resumeTurn(threadID: string, turnID: string) {
    const active = this.db.activeTurn(threadID)
    if (active && active.id !== turnID) return
    void this.executeTurn(threadID, turnID)
  }

  async submitPlanDecision(turnID: string, decision: "continue" | "reject") {
    const result = this.db.decidePlan(turnID, decision)
    if (!result) return null
    await this.emit(result.threadID, result.turnID, "plan/decision", { ...result, threadId: result.threadID, turnId: result.turnID })
    if (decision === "continue") this.resumeTurn(result.threadID, result.turnID)
    return result
  }
}

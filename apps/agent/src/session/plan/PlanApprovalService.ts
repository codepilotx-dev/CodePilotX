import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { RpcParams, RpcResult } from "@codepilotx/agent-protocol"
import type { PlanApproval } from "@codepilotx/shared/thread"
import { AgentError } from "../../domain"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import type { EventHub } from "../../storage/events/EventHub"
import type { ThreadService } from "../ThreadService"

export class PlanApprovalService {
  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub, private readonly threads: Pick<ThreadService, "withPlanAdmission">) {}

  read(threadId: string): PlanApproval | null {
    this.db.repositories.planApprovals.requireThread(threadId)
    this.db.repositories.planApprovals.recover(threadId)
    return this.db.repositories.planApprovals.pending(threadId)
  }

  async respond(params: RpcParams<"planApproval/respond">): Promise<RpcResult<"planApproval/respond">> {
    const { threadId, approvalId, expectedVersion, operationId, response } = params
    this.db.repositories.planApprovals.requireThread(threadId, true)
    const feedback = response.action === "feedback" ? response.feedback.trim() : null
    if (feedback !== null && !feedback) throw new AgentError("INVALID_REQUEST", "计划修改意见不能为空", 400)
    const model = response.action === "close" ? undefined : response.model
    const fingerprint = createHash("sha256").update(JSON.stringify({ threadId, approvalId, expectedVersion, action: response.action, feedback, model: model ? { providerID: model.providerID, id: model.id, variant: model.variant ?? null } : null })).digest("hex")
    const repository = this.db.repositories.planApprovals
    return this.threads.withPlanAdmission(threadId, async (start, assertIdle) => {
      const duplicate = repository.duplicate(operationId, fingerprint)
      if (duplicate) return { approval: duplicate, disposition: "duplicate" }
      assertIdle()
      repository.recover(threadId)
      const approval = repository.assertCurrent(threadId, approvalId, expectedVersion)
      const resolve = () => {
        const current = repository.assertCurrent(threadId, approvalId, expectedVersion)
        if (current.markdown !== approval.markdown) throw new AgentError("CONFLICT", "计划内容已变化，请刷新后重试", 409)
        repository.resolve(approvalId, expectedVersion, response.action === "implement" ? "implemented" : response.action === "feedback" ? "feedback" : "closed", operationId, fingerprint)
      }
      if (response.action === "close") {
        const event = this.db.transaction(() => {
          resolve()
          const updated = this.db.updateThreadSettings(threadId, { taskMode: "chat" })
          // Also notify when the setting already matches: the approval itself still changed.
          return updated.event ?? this.db.insertEvent(threadId, null, "thread/settings/updated", { threadId, settings: updated.settings })
        })
        await Effect.runPromise(this.hub.publish(event))
      } else {
        const source = this.db.getTurnInput(approval.turnId)
        const settings = this.db.getThreadSettings(threadId)
        if (!source || !settings) throw new AgentError("CONFLICT", "计划执行上下文不可用", 409)
        await start({
          content: response.action === "implement"
            ? `请实施以下已批准的计划：\n\n${approval.markdown}`
            : `请根据以下修改意见继续调查并更新计划，不要实施：\n\n${feedback}\n\n原计划：\n${approval.markdown}`,
          model: model ?? source.model,
          permissionConfig: settings.permissionConfig,
          taskMode: response.action === "implement" ? "chat" : "plan",
          strategy: "start",
        }, crypto.randomUUID(), {
          beforeCreate: () => {
            if (JSON.stringify(this.db.getThreadSettings(threadId)?.permissionConfig) !== JSON.stringify(settings.permissionConfig)) throw new AgentError("CONFLICT", "权限设置已变化，请刷新后重试", 409)
            resolve()
          },
          afterCreate: (turnId) => repository.linkTurn(approvalId, turnId),
        })
      }
      return { approval: repository.get(approvalId)!, disposition: "applied" }
    })
  }
}

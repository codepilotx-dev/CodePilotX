import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import { TaskContextRepository } from "../storage/repositories/task-context-repository"

/** 任务上下文领域门面；持久化与事务 SQL 由独立 repository 承担。 */
export class TaskContextService {
  private readonly repository: TaskContextRepository
  constructor(db: AgentDatabase, hub?: EventHub, now: () => number = Date.now) {
    this.repository = new TaskContextRepository(db, hub, now)
  }
  resolveTaskForThread(...args: Parameters<TaskContextRepository["resolveTaskForThread"]>) { return this.repository.resolveTaskForThread(...args) }
  read(...args: Parameters<TaskContextRepository["read"]>) { return this.repository.read(...args) }
  readForThread(...args: Parameters<TaskContextRepository["readForThread"]>) { return this.repository.readForThread(...args) }
  publish(...args: Parameters<TaskContextRepository["publish"]>) { return this.repository.publish(...args) }
  broadcast(...args: Parameters<TaskContextRepository["broadcast"]>) { return this.repository.broadcast(...args) }
  captureEvidence(...args: Parameters<TaskContextRepository["captureEvidence"]>) { return this.repository.captureEvidence(...args) }
  captureAndBroadcast(...args: Parameters<TaskContextRepository["captureAndBroadcast"]>) { return this.repository.captureAndBroadcast(...args) }
  rollupTaskCompletion(...args: Parameters<TaskContextRepository["rollupTaskCompletion"]>) { return this.repository.rollupTaskCompletion(...args) }
  backfillThread(...args: Parameters<TaskContextRepository["backfillThread"]>) { return this.repository.backfillThread(...args) }
  setFrozen(...args: Parameters<TaskContextRepository["setFrozen"]>) { return this.repository.setFrozen(...args) }
  createProposal(...args: Parameters<TaskContextRepository["createProposal"]>) { return this.repository.createProposal(...args) }
  proposal(...args: Parameters<TaskContextRepository["proposal"]>) { return this.repository.proposal(...args) }
  applyProposal(...args: Parameters<TaskContextRepository["applyProposal"]>) { return this.repository.applyProposal(...args) }
  discardProposal(...args: Parameters<TaskContextRepository["discardProposal"]>) { return this.repository.discardProposal(...args) }
  promotionStatus(...args: Parameters<TaskContextRepository["promotionStatus"]>) { return this.repository.promotionStatus(...args) }
  snapshot(...args: Parameters<TaskContextRepository["snapshot"]>) { return this.repository.snapshot(...args) }
  promptForThread(...args: Parameters<TaskContextRepository["promptForThread"]>) { return this.repository.promptForThread(...args) }
  setPromotionDrain(...args: Parameters<TaskContextRepository["setPromotionDrain"]>) { return this.repository.setPromotionDrain(...args) }
}

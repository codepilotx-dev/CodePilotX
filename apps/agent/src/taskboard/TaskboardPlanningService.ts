import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { TaskboardPriority, TaskboardWorkflowStatus } from "@codepilotx/shared/taskboard"
import type { EventEnvelope } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import type {
  PlanningApplyItem,
  TaskboardPlanningRepository,
} from "../storage/repositories/taskboard-planning-repository"

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")

export class TaskboardPlanningService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly repository: TaskboardPlanningRepository,
    private readonly now: () => number = Date.now,
  ) {}

  roots(input: Parameters<TaskboardPlanningRepository["listRoots"]>[0] = {}) {
    return this.repository.listRoots(input)
  }

  read(taskId: string) { return { snapshot: this.repository.read(taskId) } }

  private async operation<T>(input: {
    operationId: string
    taskId: string
    method: string
    request: unknown
    mutate: (timestamp: number) => T
    auxiliaryEvents?: (value: T, timestamp: number, projectId: string, originalRootTaskId: string) => EventEnvelope[]
    allowArchived?: boolean
  }): Promise<T> {
    const requestHash = digest(input.request)
    const prior = this.repository.taskboard.getTaskboardOperation(input.operationId)
    if (prior?.status === "completed") {
      this.repository.taskboard.beginTaskboardOperation({
        operationId: input.operationId,
        projectId: prior.projectId,
        taskId: prior.taskId,
        method: input.method,
        requestHash,
      })
      return prior.result as T
    }
    if (!input.allowArchived) this.repository.assertTaskPlanningMutable(input.taskId)
    const projectId = this.repository.projectIdForTask(input.taskId)
    const committed = this.db.transaction(() => {
      const existing = this.repository.taskboard.beginTaskboardOperation({
        operationId: input.operationId,
        projectId,
        taskId: input.taskId,
        method: input.method,
        requestHash,
      })
      if (existing.status === "completed") return { value: existing.result as T, event: null, auxiliaryEvents: [] as EventEnvelope[], replay: true }
      const timestamp = this.now()
      const rootTaskId = this.repository.rootTaskId(input.taskId)
      const value = input.mutate(timestamp)
      const event = this.repository.insertPlanningChanged({
        projectId,
        rootTaskId,
        changedTaskId: input.taskId,
        changedAt: timestamp,
      })
      const auxiliaryEvents = input.auxiliaryEvents?.(value, timestamp, projectId, rootTaskId) ?? []
      this.repository.taskboard.completeTaskboardOperation(input.operationId, value, timestamp)
      return { value, event, auxiliaryEvents, replay: false }
    })
    if (!committed.replay) {
      await Effect.runPromise(this.hub.publish(committed.event!))
      for (const event of committed.auxiliaryEvents) await Effect.runPromise(this.hub.publish(event))
    }
    return committed.value
  }

  apply(input: {
    parentTaskId: string
    expectedVersion: number
    operationId: string
    items: readonly PlanningApplyItem[]
    dependencies?: readonly { dependentClientId: string; prerequisiteClientId: string }[]
  }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.parentTaskId,
      method: "taskboard/planning/apply",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.apply({ ...input, timestamp }) }),
    })
  }

  updateStep(input: {
    operationId: string
    itemId: string
    expectedVersion: number
    patch: { title?: string; description?: string; status?: "todo" | "done" | "skipped"; skipReason?: string | null }
  }) {
    const taskId = this.repository.parentTaskIdForItem(input.itemId)
    return this.operation({
      operationId: input.operationId,
      taskId,
      method: "taskboard/planning/step/update",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.updateStep({ ...input, timestamp }) }),
    })
  }

  promoteStep(input: {
    operationId: string
    itemId: string
    expectedVersion: number
    task: {
      status?: TaskboardWorkflowStatus
      priority?: TaskboardPriority
      labelIds?: readonly string[]
      startDate?: string | null
      dueDate?: string | null
    }
  }) {
    const taskId = this.repository.parentTaskIdForItem(input.itemId)
    return this.operation({
      operationId: input.operationId,
      taskId,
      method: "taskboard/planning/step/promote",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.promoteStep({ ...input, timestamp }) }),
    })
  }

  reorder(input: { operationId: string; itemId: string; expectedVersion: number; beforeItemId?: string | null; afterItemId?: string | null }) {
    const taskId = this.repository.parentTaskIdForItem(input.itemId)
    return this.operation({
      operationId: input.operationId,
      taskId,
      method: "taskboard/planning/item/reorder",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.reorder({ ...input, timestamp }) }),
    })
  }

  reparent(input: {
    operationId: string
    childTaskId: string
    expectedVersion: number
    parentTaskId: string | null
    beforeItemId?: string | null
    afterItemId?: string | null
  }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.childTaskId,
      method: "taskboard/planning/child/reparent",
      request: input,
      mutate: (timestamp) => this.repository.reparent({ ...input, timestamp }),
      auxiliaryEvents: (_value, timestamp, projectId, originalRootTaskId) => {
        const newRootTaskId = this.repository.rootTaskId(input.childTaskId)
        return newRootTaskId === originalRootTaskId ? [] : [this.repository.insertPlanningChanged({
          projectId,
          rootTaskId: newRootTaskId,
          changedTaskId: input.childTaskId,
          changedAt: timestamp,
        })]
      },
    })
  }

  setDependencies(input: { operationId: string; itemId: string; expectedVersion: number; prerequisiteItemIds: readonly string[] }) {
    const taskId = this.repository.parentTaskIdForItem(input.itemId)
    return this.operation({
      operationId: input.operationId,
      taskId,
      method: "taskboard/planning/dependencies/set",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.setDependencies({ ...input, timestamp }) }),
    })
  }

  createBlocker(input: {
    operationId: string
    taskId: string
    planItemId?: string | null
    reason: string
    sourceThreadId?: string | null
    sourceTurnId?: string | null
  }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.taskId,
      method: "taskboard/planning/blocker/create",
      request: input,
      mutate: (timestamp) => ({ blocker: this.repository.createBlocker({ ...input, timestamp }) }),
    })
  }

  resolveBlocker(input: { operationId: string; blockerId: string; expectedVersion: number; resolution: string }) {
    const taskId = this.repository.taskIdForBlocker(input.blockerId)
    return this.operation({
      operationId: input.operationId,
      taskId,
      method: "taskboard/planning/blocker/resolve",
      request: input,
      mutate: (timestamp) => ({ blocker: this.repository.resolveBlocker({ ...input, timestamp }) }),
    })
  }

  markRead(input: { operationId: string; taskId: string; itemId?: string; expectedReadyNotifiedAt?: number }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.taskId,
      method: "taskboard/planning/attention/mark-read",
      request: input,
      mutate: (timestamp) => ({ snapshot: this.repository.markRead({ ...input, timestamp }) }),
    })
  }

  archiveTree(input: { operationId: string; rootTaskId: string; expectedVersion: number; includeLinkedThreads?: boolean }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.rootTaskId,
      method: "taskboard/planning/archive-tree",
      request: input,
      mutate: (timestamp) => this.repository.archiveTree({ ...input, timestamp }),
      auxiliaryEvents: (value, timestamp, projectId) => this.repository.insertArchiveEvents({
        projectId,
        rootTaskId: input.rootTaskId,
        taskIds: value.taskIds,
        includeLinkedThreads: input.includeLinkedThreads ?? false,
        timestamp,
      }),
    })
  }

  restoreTree(input: { operationId: string; rootTaskId: string }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.rootTaskId,
      method: "taskboard/planning/restore-tree",
      request: input,
      mutate: (timestamp) => this.repository.restoreTree({ ...input, timestamp }),
      allowArchived: true,
      auxiliaryEvents: (value, timestamp, projectId) => this.repository.insertRestoreEvents({ projectId, taskIds: value.taskIds, timestamp }),
    })
  }

  deleteTree(input: { operationId: string; rootTaskId: string }) {
    return this.operation({
      operationId: input.operationId,
      taskId: input.rootTaskId,
      method: "taskboard/planning/delete-tree",
      request: input,
      mutate: (timestamp) => this.repository.deleteTree(input.rootTaskId, timestamp),
      allowArchived: true,
      auxiliaryEvents: (value, timestamp, projectId) => this.repository.insertDeleteEvents({ projectId, taskIds: value.deletedTaskIds, timestamp }),
    })
  }
}

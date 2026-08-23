import { createHash, randomUUID } from "node:crypto"
import { Effect } from "effect"
import type {
  TaskboardPriority,
  TaskboardStatus,
  TaskboardTaskDetails,
  TaskboardThreadRole,
  TaskboardWorkflowStatus,
  TaskboardWorkflowTransitionAction,
} from "@codepilotx/shared/taskboard"
import {
  TASKBOARD_COMMENT_MAX_LENGTH,
  TASKBOARD_DESCRIPTION_MAX_LENGTH,
  TASKBOARD_LABELS_PER_TASK_MAX,
  TASKBOARD_LABEL_MAX_LENGTH,
  TASKBOARD_TITLE_MAX_LENGTH,
  normalizeTaskboardLabelName,
} from "@codepilotx/shared/taskboard"
import { AgentError, type EventEnvelope } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import type { TaskboardRepository } from "../storage/repositories/taskboard-repository"
import type { TaskboardPlanningRepository } from "../storage/repositories/taskboard-planning-repository"
import type { TaskContextService } from "../task-context/TaskContextService"

export const TASKBOARD_EXECUTION_TOOLS = [
  "taskboard_read",
  "taskboard_update",
  "taskboard_comment",
  "taskboard_transition",
] as const

export const taskboardExecutionInstruction = (
  projectName: string,
  number: number,
  title: string,
) => `你正在执行任务 ${projectName} #${number}：${title}\n请先调用 taskboard_read，读取任务详情和当前版本，然后再开始修改。验证完成后，用 taskboard_transition 的 submit_review 动作和交付说明原子提交验收；遇到无法继续的阻碍时，用 report_blocked 动作和阻碍原因报告；不要将任务标记为已完成。`

export type TaskboardMutationActor = {
  kind: "user" | "agent" | "system"
  sourceThreadId: string | null
}

type ChangedResource = "task" | "comment" | "label" | "thread_link" | "start"
type ChangedAction = "created" | "updated" | "archived" | "restored" | "deleted"

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")

export class TaskboardService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly repository: TaskboardRepository,
    private readonly taskContext?: TaskContextService,
    private readonly now: () => number = Date.now,
    private readonly planning?: TaskboardPlanningRepository,
  ) {}

  primaryExecutionContext(threadId: string) {
    const link = this.repository.taskLinkForThread(threadId)
    if (!link || link.role !== "primary") return null
    const task = this.repository.readWorkflowTask(link.taskId)
    if (!task || task.task.archivedAt !== null) return null
    const projectName = this.db.getProject(task.task.projectId)?.name ?? "项目"
    return {
      instruction: taskboardExecutionInstruction(projectName, task.task.number, task.task.title),
      activeTools: TASKBOARD_EXECUTION_TOOLS,
    }
  }

  private project(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new AgentError("PROJECT_REMOVED", "项目已被移除，任务只能只读访问", 409)
    return project
  }

  private details(taskId: string) {
    const task = this.repository.readTask(taskId)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    return task
  }

  private async operation<T>(input: {
    operationId: string
    projectId: string
    taskId: string | null
    method: string
    request: unknown
    resource: ChangedResource
    action: ChangedAction
    workflow?: { resource: "workflow" | "attention" | "thread"; action: "created" | "updated" | "deleted" }
    planningStatusChanged?: boolean
    mutate: (timestamp: number) => T
  }): Promise<T> {
    const requestHash = digest(input.request)
    const committed = this.db.transaction(() => {
      const existing = this.repository.beginTaskboardOperation({
        operationId: input.operationId,
        projectId: input.projectId,
        taskId: input.taskId,
        method: input.method,
        requestHash,
      })
      if (existing.status === "completed") return { value: existing.result as T, event: null, replay: true }
      const timestamp = this.now()
      const value = input.mutate(timestamp)
      const event = this.repository.insertTaskboardChanged({
        projectId: input.projectId,
        taskId: input.taskId,
        resource: input.resource,
        action: input.action,
        changedAt: timestamp,
      })
      const workflowEvent = input.workflow && input.taskId
        ? this.repository.insertTaskboardWorkflowChanged({ projectId: input.projectId, taskId: input.taskId, ...input.workflow, changedAt: timestamp })
        : null
      const planningEvent = input.planningStatusChanged && input.taskId
        ? this.planning?.refreshAfterTaskStatus(input.taskId, timestamp) ?? null
        : null
      this.repository.completeTaskboardOperation(input.operationId, value, timestamp)
      return { value, event, workflowEvent, planningEvent, replay: false }
    })
    if (!committed.replay) {
      await Effect.runPromise(this.hub.publish(committed.event!))
      if (committed.workflowEvent) await Effect.runPromise(this.hub.publish(committed.workflowEvent))
      if (committed.planningEvent) await Effect.runPromise(this.hub.publish(committed.planningEvent))
    }
    return committed.value
  }

  list(input: Parameters<TaskboardRepository["listTasks"]>[0] = {}) {
    if (input.projectId) this.project(input.projectId)
    const page = this.repository.listTasks({ ...input, limit: Math.min(500, Math.max(1, input.limit ?? 200)) })
    return input.projectId ? page : { ...page, tasks: page.tasks.filter((task) => Boolean(this.db.getProject(task.projectId))) }
  }

  read(taskId: string) { return this.details(taskId) }

  listWorkflow(input: Parameters<TaskboardRepository["listWorkflowTasks"]>[0] = {}) {
    if (input.projectId) this.project(input.projectId)
    const page = this.repository.listWorkflowTasks({ ...input, limit: Math.min(500, Math.max(1, input.limit ?? 200)) })
    return input.projectId ? page : { ...page, tasks: page.tasks.filter((task) => Boolean(this.db.getProject(task.projectId))) }
  }

  readWorkflow(taskId: string) {
    const task = this.repository.readWorkflowTask(taskId)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    return task
  }

  listWorkflowThreadCandidates(input: Parameters<TaskboardRepository["listWorkflowThreadCandidates"]>[0]) {
    this.project(input.projectId)
    return this.repository.listWorkflowThreadCandidates(input)
  }

  findWorkflowByThread(input: Parameters<TaskboardRepository["findWorkflowByThread"]>[0]) {
    if (input.projectId) this.project(input.projectId)
    return { lookup: this.repository.findWorkflowByThread(input) }
  }

  async createWorkflow(input: {
    operationId: string; projectId: string; title: string; description?: string
    status?: TaskboardWorkflowStatus; priority?: TaskboardPriority; labelIds?: readonly string[]
    startDate?: string | null; dueDate?: string | null
    threadLinks?: readonly { threadId: string; role: TaskboardThreadRole }[]
  }) {
    this.project(input.projectId)
    const taskId = randomUUID()
    const request = {
      ...input,
      status: input.status ?? "backlog" as const,
      title: this.title(input.title),
      description: this.description(input.description),
      labelIds: this.labelIds(input.labelIds) ?? [],
    }
    return this.operation({ operationId: input.operationId, projectId: input.projectId, taskId, method: "taskboard/workflow/create", request, resource: "task", action: "created", workflow: { resource: "workflow", action: "created" }, mutate: (timestamp) => {
      const task = this.repository.createWorkflowTask({ ...request, createdAt: timestamp })
      this.repository.recordActivity({ taskId: task.task.id, kind: "task_created", actor: "user", createdAt: timestamp })
      if (request.threadLinks?.length) this.repository.recordActivity({ taskId: task.task.id, kind: "thread_linked", actor: "user", data: { links: request.threadLinks }, createdAt: timestamp })
      return task
    } })
  }

  async updateWorkflow(input: {
    operationId: string; taskId: string; expectedVersion: number
    patch: { title?: string; description?: string; priority?: TaskboardPriority; labelIds?: readonly string[]; startDate?: string | null; dueDate?: string | null }
  }) {
    const current = this.readWorkflow(input.taskId)
    this.project(current.task.projectId)
    const patch = {
      ...(input.patch.title === undefined ? {} : { title: this.title(input.patch.title) }),
      ...(input.patch.description === undefined ? {} : { description: this.description(input.patch.description) }),
      ...(input.patch.priority === undefined ? {} : { priority: input.patch.priority }),
      ...(input.patch.labelIds === undefined ? {} : { labelIds: this.labelIds(input.patch.labelIds)! }),
      ...(input.patch.startDate === undefined ? {} : { startDate: input.patch.startDate }),
      ...(input.patch.dueDate === undefined ? {} : { dueDate: input.patch.dueDate }),
    }
    if (!Object.keys(patch).length) throw new AgentError("INVALID_REQUEST", "任务更新缺少字段", 400)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/workflow/update", request: { ...input, patch }, resource: "task", action: "updated", workflow: { resource: "workflow", action: "updated" }, mutate: (timestamp) => {
      const task = this.repository.updateWorkflowTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, patch, updatedAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "task_updated", actor: "user", data: { fields: Object.keys(patch) }, createdAt: timestamp })
      return task
    } })
  }

  async moveWorkflow(input: { operationId: string; taskId: string; expectedVersion: number; status: TaskboardWorkflowStatus; beforeTaskId?: string | null; afterTaskId?: string | null; note?: string }) {
    const current = this.readWorkflow(input.taskId)
    this.project(current.task.projectId)
    if (input.status === "blocked" && input.note === undefined) throw new AgentError("INVALID_REQUEST", "移动到阻塞状态必须填写说明", 400)
    const task = await this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/workflow/move", request: input, resource: "task", action: "updated", workflow: { resource: "workflow", action: "updated" }, planningStatusChanged: true, mutate: (timestamp) => {
      const task = this.repository.moveWorkflowTask({ ...input, ...(input.note === undefined ? {} : { note: this.comment(input.note) }), updatedAt: timestamp })
      this.repository.recordActivity({
        taskId: input.taskId,
        kind: "task_moved",
        actor: "user",
        data: { field: "status", before: current.task.status, after: input.status, workflowAction: "manual_move" },
        createdAt: timestamp,
      })
      return task
    } })
    if (input.status === "done" || input.status === "canceled") await this.freezeContext(input.taskId, false)
    else await this.unfreezeContext(input.taskId)
    return task
  }

  async transitionWorkflow(input: { operationId: string; taskId: string; expectedVersion: number; action: TaskboardWorkflowTransitionAction; note?: string; sourceThreadId?: string }) {
    return this.performWorkflowTransition({ ...input, actor: { kind: "user", sourceThreadId: null } })
  }

  private async performWorkflowTransition(input: { operationId: string; taskId: string; expectedVersion: number; action: TaskboardWorkflowTransitionAction; note?: string; actor: TaskboardMutationActor }) {
    const current = this.readWorkflow(input.taskId)
    this.project(current.task.projectId)
    if ((input.action === "submit_review" || input.action === "report_blocked" || input.action === "return_work") && input.note === undefined) {
      throw new AgentError("INVALID_REQUEST", "该状态转换必须填写说明", 400)
    }
    const transition = this.workflowTransition(current.task.status, input.action)
    const task = await this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/workflow/transition", request: input, resource: "task", action: "updated", workflow: { resource: "workflow", action: "updated" }, planningStatusChanged: true, mutate: (timestamp) => {
      const task = this.repository.transitionWorkflowTask({
        taskId: input.taskId, expectedVersion: input.expectedVersion, status: transition.status,
        workflowAction: input.action,
        actor: input.actor.kind,
        attentionReason: transition.reason,
        ...(input.note === undefined ? {} : { note: this.comment(input.note) }),
        ...(input.actor.sourceThreadId === null ? {} : { sourceThreadId: input.actor.sourceThreadId }),
        updatedAt: timestamp,
      })
      if (input.action === "report_blocked" && input.note !== undefined) {
        this.planning?.createBlocker({
          taskId: input.taskId,
          reason: this.comment(input.note),
          sourceThreadId: input.actor.sourceThreadId,
          timestamp,
        })
      }
      return task
    } })
    if (input.action === "accept") {
      const rollup = this.taskContext?.rollupTaskCompletion(input.taskId, input.actor.sourceThreadId)
      if (rollup) await this.taskContext?.broadcast(rollup.event)
      await this.freezeContext(input.taskId, true)
    } else if (input.action === "cancel") await this.freezeContext(input.taskId, false)
    else if (input.action === "return_work") await this.unfreezeContext(input.taskId)
    return task
  }

  async markWorkflowRead(input: { operationId: string; taskId: string; expectedUnreadAt?: number }) {
    const current = this.readWorkflow(input.taskId)
    this.project(current.task.projectId)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/workflow/mark-read", request: input, resource: "task", action: "updated", workflow: { resource: "attention", action: "updated" }, mutate: (timestamp) => this.repository.markWorkflowTaskRead({ taskId: input.taskId, ...(input.expectedUnreadAt === undefined ? {} : { expectedUnreadAt: input.expectedUnreadAt }), readAt: timestamp }) })
  }

  async linkWorkflowThreads(input: { operationId: string; taskId: string; expectedVersion: number; links: readonly { threadId: string; role: TaskboardThreadRole }[] }) {
    const current = this.readWorkflow(input.taskId)
    this.project(current.task.projectId)
    const task = await this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/workflow/link-threads", request: input, resource: "thread_link", action: "updated", workflow: { resource: "thread", action: "updated" }, mutate: (timestamp) => {
      const task = this.repository.linkWorkflowThreads({ ...input, updatedAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "thread_linked", actor: "user", data: { links: input.links }, createdAt: timestamp })
      return task
    } })
    for (const link of input.links) await this.taskContext?.backfillThread(link.threadId)
    return task
  }

  private workflowTransition(status: TaskboardWorkflowStatus, action: TaskboardWorkflowTransitionAction): { status: TaskboardWorkflowStatus; reason: "review_requested" | "blocked" | null } {
    const target = action === "submit_review" ? "in_review"
      : action === "report_blocked" ? "blocked"
        : action === "return_work" ? "todo"
          : action === "accept" ? "done"
            : action === "cancel" ? "canceled"
              : null
    if (!target) throw new AgentError("INVALID_REQUEST", "manual_move 请使用 workflow/move", 400)
    const allowed = action === "submit_review" ? status === "in_progress"
      : action === "report_blocked" ? status === "todo" || status === "in_progress" || status === "in_review"
        : action === "return_work" ? status === "blocked" || status === "in_review"
          : action === "accept" ? status === "in_review"
            : status !== "done" && status !== "canceled"
    if (!allowed) throw new AgentError("INVALID_REQUEST", `不能从 ${status} 执行 ${action}`, 409)
    return { status: target, reason: target === "in_review" ? "review_requested" : target === "blocked" ? "blocked" : null }
  }

  async create(input: {
    projectId: string
    title: string
    description?: string
    status?: TaskboardStatus
    priority?: TaskboardPriority
    labelIds?: readonly string[]
    operationId: string
    actor: TaskboardMutationActor
  }) {
    this.project(input.projectId)
    if (input.actor.kind === "agent" && input.status !== undefined && input.status !== "backlog") {
      throw new AgentError("PERMISSION_DENIED", "Agent 只能创建待立项任务", 403)
    }
    const taskId = randomUUID()
    const title = this.title(input.title)
    const description = this.description(input.description)
    const status = input.actor.kind === "agent" ? "backlog" : input.status ?? "backlog"
    const priority = input.priority ?? "none"
    const labelIds = this.labelIds(input.labelIds) ?? []
    return this.operation({
      operationId: input.operationId,
      projectId: input.projectId,
      taskId,
      method: "taskboard/task/create",
      request: { projectId: input.projectId, title, description, status, priority, labelIds, actor: input.actor },
      resource: "task",
      action: "created",
      mutate: (timestamp) => {
        const task = this.repository.createTask({ id: taskId, projectId: input.projectId, title, description, status, priority, labelIds, createdAt: timestamp })
        this.repository.recordActivity({ taskId, kind: "task_created", actor: input.actor.kind, sourceThreadId: input.actor.sourceThreadId, createdAt: timestamp })
        return task
      },
    })
  }

  async update(input: {
    taskId: string
    patch: { title?: string; description?: string; status?: TaskboardStatus; priority?: TaskboardPriority; labelIds?: readonly string[] }
    expectedVersion: number
    operationId: string
    actor: TaskboardMutationActor
  }) {
    const current = this.details(input.taskId)
    this.project(current.task.projectId)
    this.assertUpdateAllowed(current, input.actor, input.patch.status)
    const patch: Parameters<TaskboardRepository["updateTask"]>[0]["patch"] = {
      ...(input.patch.title === undefined ? {} : { title: this.title(input.patch.title) }),
      ...(input.patch.description === undefined ? {} : { description: this.description(input.patch.description) }),
      ...(input.patch.status === undefined ? {} : { status: input.patch.status }),
      ...(input.patch.priority === undefined ? {} : { priority: input.patch.priority }),
      ...(input.patch.labelIds === undefined ? {} : { labelIds: this.labelIds(input.patch.labelIds)! }),
    }
    if (Object.keys(patch).length === 0) throw new AgentError("INVALID_REQUEST", "任务更新缺少字段", 400)
    return this.operation({
      operationId: input.operationId,
      projectId: current.task.projectId,
      taskId: input.taskId,
      method: "taskboard/task/update",
      request: { taskId: input.taskId, patch, expectedVersion: input.expectedVersion, actor: input.actor },
      resource: "task",
      action: "updated",
      mutate: (timestamp) => {
        const task = this.repository.updateTask({ taskId: input.taskId, patch, expectedVersion: input.expectedVersion, updatedAt: timestamp })
        this.repository.recordActivity({ taskId: input.taskId, kind: "task_updated", actor: input.actor.kind, sourceThreadId: input.actor.sourceThreadId, data: { fields: Object.keys(patch) }, createdAt: timestamp })
        return task
      },
    })
  }

  async move(input: { taskId: string; status: TaskboardStatus; beforeTaskId?: string | null; afterTaskId?: string | null; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.details(input.taskId)
    this.project(current.task.projectId)
    if (input.actor.kind !== "user") throw new AgentError("PERMISSION_DENIED", "Agent 不能直接重排任务", 403)
    const task = await this.operation({
      operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId,
      method: "taskboard/task/move", request: input, resource: "task", action: "updated",
      mutate: (timestamp) => {
        const task = this.repository.moveTask({ ...input, updatedAt: timestamp })
        this.repository.recordActivity({ taskId: input.taskId, kind: "task_moved", actor: "user", data: { status: input.status }, createdAt: timestamp })
        return task
      },
    })
    if (input.status === "done") await this.freezeContext(input.taskId, false)
    else await this.unfreezeContext(input.taskId)
    return task
  }

  async archive(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    const task = await this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/archive", request: input, resource: "task", action: "archived", workflow: { resource: "attention", action: "updated" }, mutate: (timestamp) => {
      const task = this.repository.archiveTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, archivedAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "task_archived", actor: "user", createdAt: timestamp })
      return task
    } })
    await this.freezeContext(input.taskId, false)
    return task
  }

  async restore(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    const task = await this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/restore", request: input, resource: "task", action: "restored", workflow: { resource: "workflow", action: "updated" }, mutate: (timestamp) => {
      const task = this.repository.restoreTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, restoredAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "task_restored", actor: "user", createdAt: timestamp })
      return task
    } })
    await this.unfreezeContext(input.taskId)
    return task
  }

  private async freezeContext(taskId: string, promote: boolean) { if (this.taskContext) { const result = this.taskContext.setFrozen(taskId, true, promote); await this.taskContext.broadcast(result.event) } }
  private async unfreezeContext(taskId: string) { if (this.taskContext) { const result = this.taskContext.setFrozen(taskId, false); await this.taskContext.broadcast(result.event) } }

  async delete(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/delete", request: input, resource: "task", action: "deleted", workflow: { resource: "workflow", action: "deleted" }, mutate: () => {
      this.repository.deleteTask({ taskId: input.taskId, expectedVersion: input.expectedVersion })
      return { deleted: true as const, taskId: input.taskId }
    } })
  }

  async linkThread(input: { taskId: string; threadId: string; role: TaskboardThreadRole; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    this.assertThreadProject(input.threadId, current.task.projectId)
    const task = await this.threadMutation("link", "thread_linked", input, current)
    await this.taskContext?.backfillThread(input.threadId)
    return task
  }

  async unlinkThread(input: { taskId: string; threadId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    return this.threadMutation("unlink", "thread_unlinked", input, current)
  }

  async setPrimaryThread(input: { taskId: string; threadId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    this.assertThreadProject(input.threadId, current.task.projectId)
    return this.threadMutation("set-primary", "primary_changed", input, current)
  }

  private threadMutation(
    kind: "link" | "unlink" | "set-primary",
    activity: "thread_linked" | "thread_unlinked" | "primary_changed",
    input: { taskId: string; threadId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor; role?: TaskboardThreadRole },
    current: TaskboardTaskDetails,
  ) {
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: `taskboard/thread/${kind}`, request: input, resource: "thread_link", action: "updated", mutate: (timestamp) => {
      const task = kind === "link"
        ? this.repository.linkThread({ taskId: input.taskId, threadId: input.threadId, role: input.role!, expectedVersion: input.expectedVersion, linkedAt: timestamp })
        : kind === "unlink"
          ? this.repository.unlinkThread({ taskId: input.taskId, threadId: input.threadId, expectedVersion: input.expectedVersion, updatedAt: timestamp })
          : this.repository.setPrimaryThread({ taskId: input.taskId, threadId: input.threadId, expectedVersion: input.expectedVersion, updatedAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: activity, actor: "user", data: { threadId: input.threadId }, createdAt: timestamp })
      return task
    } })
  }

  async createComment(input: { taskId: string; body: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.details(input.taskId)
    this.project(current.task.projectId)
    if (current.task.version !== input.expectedVersion) throw new AgentError("CONFLICT", "任务已在其他窗口更新", 409)
    if (input.actor.kind === "agent") this.assertLinked(input.taskId, input.actor.sourceThreadId)
    const body = this.comment(input.body)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/comment/create", request: { ...input, body }, resource: "comment", action: "created", ...(input.actor.kind === "agent" ? { workflow: { resource: "attention" as const, action: "updated" as const } } : {}), mutate: (timestamp) => {
      if (this.details(input.taskId).task.version !== input.expectedVersion) throw new AgentError("CONFLICT", "任务已在其他窗口更新", 409)
      const comment = this.repository.createComment({ taskId: input.taskId, body, author: input.actor.kind === "agent" ? "agent" : "user", sourceThreadId: input.actor.sourceThreadId, expectedTaskVersion: input.expectedVersion, createdAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "comment_created", actor: input.actor.kind, sourceThreadId: input.actor.sourceThreadId, data: { commentId: comment.id }, createdAt: timestamp })
      return { task: this.details(input.taskId), comment }
    } })
  }

  async updateComment(input: { commentId: string; body: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    if (input.actor.kind !== "user") throw new AgentError("PERMISSION_DENIED", "Agent 不能编辑已有评论", 403)
    const existing = this.repository.readComment(input.commentId)
    if (!existing) throw new AgentError("TASKBOARD_COMMENT_NOT_FOUND", "评论不存在", 404)
    const task = this.assertUserMutableTask(existing.taskId, input.actor)
    const body = this.comment(input.body)
    return this.operation({ operationId: input.operationId, projectId: task.task.projectId, taskId: existing.taskId, method: "taskboard/comment/update", request: { ...input, body }, resource: "comment", action: "updated", mutate: (timestamp) => {
      const comment = this.repository.updateComment({ commentId: input.commentId, body, expectedVersion: input.expectedVersion, updatedAt: timestamp })
      this.repository.recordActivity({ taskId: existing.taskId, kind: "comment_updated", actor: "user", data: { commentId: input.commentId }, createdAt: timestamp })
      return { task: this.details(existing.taskId), comment }
    } })
  }

  async deleteComment(input: { commentId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    if (input.actor.kind !== "user") throw new AgentError("PERMISSION_DENIED", "Agent 不能删除评论", 403)
    const existing = this.repository.readComment(input.commentId)
    if (!existing) throw new AgentError("TASKBOARD_COMMENT_NOT_FOUND", "评论不存在", 404)
    const task = this.assertUserMutableTask(existing.taskId, input.actor)
    return this.operation({ operationId: input.operationId, projectId: task.task.projectId, taskId: existing.taskId, method: "taskboard/comment/delete", request: input, resource: "comment", action: "deleted", mutate: (timestamp) => {
      const comment = this.repository.deleteComment({ commentId: input.commentId, expectedVersion: input.expectedVersion, deletedAt: timestamp })
      this.repository.recordActivity({ taskId: existing.taskId, kind: "comment_deleted", actor: "user", data: { commentId: input.commentId }, createdAt: timestamp })
      return { task: this.details(existing.taskId), comment }
    } })
  }

  listLabels(projectId: string) { this.project(projectId); return { labels: this.repository.listLabels(projectId) } }

  async createLabel(input: { projectId: string; name: string; operationId: string; actor: TaskboardMutationActor }) {
    this.assertUser(input.actor); this.project(input.projectId)
    const name = this.labelName(input.name)
    return { label: await this.operation({ operationId: input.operationId, projectId: input.projectId, taskId: null, method: "taskboard/label/create", request: { ...input, name }, resource: "label", action: "created", mutate: (timestamp) => this.repository.createLabel({ projectId: input.projectId, name, normalizedName: normalizeTaskboardLabelName(name), createdAt: timestamp }) }) }
  }

  async updateLabel(input: { labelId: string; name: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    this.assertUser(input.actor)
    const existing = this.repository.readLabel(input.labelId)
    if (!existing) throw new AgentError("TASKBOARD_LABEL_NOT_FOUND", "标签不存在", 404)
    this.project(existing.projectId)
    const name = this.labelName(input.name)
    return { label: await this.operation({ operationId: input.operationId, projectId: existing.projectId, taskId: null, method: "taskboard/label/update", request: { ...input, name }, resource: "label", action: "updated", mutate: (timestamp) => this.repository.updateLabel({ labelId: input.labelId, name, normalizedName: normalizeTaskboardLabelName(name), expectedVersion: input.expectedVersion, updatedAt: timestamp }) }) }
  }

  async deleteLabel(input: { labelId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    this.assertUser(input.actor)
    const existing = this.repository.readLabel(input.labelId)
    if (!existing) throw new AgentError("TASKBOARD_LABEL_NOT_FOUND", "标签不存在", 404)
    this.project(existing.projectId)
    return this.operation({ operationId: input.operationId, projectId: existing.projectId, taskId: null, method: "taskboard/label/delete", request: input, resource: "label", action: "deleted", mutate: () => { this.repository.deleteLabel({ labelId: input.labelId, expectedVersion: input.expectedVersion }); return { deleted: true as const, labelId: input.labelId } } })
  }

  agentRead(input: { threadId: string; taskId?: string }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    this.assertThreadProject(input.threadId, task.task.projectId)
    return Promise.resolve({ task })
  }

  agentCreate(input: { threadId: string; operationId: string; title: string; description?: string; priority?: TaskboardPriority; labelIds?: readonly string[] }) {
    const projectId = this.db.threadProjectID(input.threadId)
    if (!projectId) throw new AgentError("PROJECT_NOT_FOUND", "当前执行对话未绑定项目", 404)
    return this.create({ ...input, projectId, status: "backlog", actor: { kind: "agent", sourceThreadId: input.threadId } }).then((task) => ({ task }))
  }

  agentCurrentTaskId(threadId: string) {
    return this.taskForThread(threadId).task.id
  }

  async agentLinkCurrent(input: { threadId: string; operationId: string; taskId: string; expectedVersion: number }) {
    const target = this.readWorkflow(input.taskId)
    this.assertThreadProject(input.threadId, target.task.projectId)
    const lookup = this.repository.findWorkflowByThread({ threadId: input.threadId, projectId: target.task.projectId })
    if (lookup.taskId && lookup.taskId !== input.taskId) {
      throw new AgentError("TASKBOARD_THREAD_ALREADY_LINKED", "当前会话已经关联其他任务", 409)
    }
    const task = lookup.taskId === input.taskId
      ? target
      : await this.linkWorkflowThreads({
          operationId: input.operationId,
          taskId: input.taskId,
          expectedVersion: input.expectedVersion,
          links: [
            ...target.threads.map(({ threadId, role }) => ({ threadId, role })),
            {
              threadId: input.threadId,
              role: target.threads.some(({ role }) => role === "primary") ? "supporting" as const : "primary" as const,
            },
          ],
        })
    const context = this.taskContext?.readForThread(input.threadId, { includeAncestors: true, includeEvidence: true }) ?? null
    return { task, context }
  }

  async agentUpdate(input: { threadId: string; operationId: string; taskId?: string; expectedVersion: number; title?: string; description?: string; priority?: TaskboardPriority; labelIds?: readonly string[] }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    const { threadId, taskId: _taskId, expectedVersion, operationId, ...patch } = input
    return { task: await this.update({ taskId: task.task.id, patch, expectedVersion, operationId, actor: { kind: "agent", sourceThreadId: threadId } }) }
  }

  async agentComment(input: { threadId: string; operationId: string; taskId?: string; expectedVersion: number; body: string }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    return this.createComment({ taskId: task.task.id, body: input.body, expectedVersion: input.expectedVersion, operationId: input.operationId, actor: { kind: "agent", sourceThreadId: input.threadId } })
  }

  async agentTransition(input: { threadId: string; operationId: string; taskId?: string; expectedVersion: number; action: "submit_review" | "report_blocked"; note: string }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    this.assertThreadProject(input.threadId, task.task.projectId)
    return { task: await this.performWorkflowTransition({
      operationId: input.operationId,
      taskId: task.task.id,
      expectedVersion: input.expectedVersion,
      action: input.action,
      note: input.note,
      actor: { kind: "agent", sourceThreadId: input.threadId },
    }) }
  }

  /** Called inside ThreadService's existing admission transaction. */
  admitPrimaryThread(threadId: string): readonly EventEnvelope[] {
    const link = this.repository.taskLinkForThread(threadId)
    if (!link) return []
    const task = this.repository.readTask(link.taskId)
    if (!task || !this.db.getProject(task.task.projectId)) return []
    const result = this.repository.advancePrimaryTaskForFirstTurn(threadId, this.now())
    return result ? [result.event, result.workflowEvent] : []
  }

  private taskForThread(threadId: string) {
    const link = this.repository.taskLinkForThread(threadId)
    if (!link) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "当前执行对话未关联任务", 404)
    return this.details(link.taskId)
  }

  private assertUpdateAllowed(current: TaskboardTaskDetails, actor: TaskboardMutationActor, nextStatus?: TaskboardStatus) {
    if (nextStatus === "done" && actor.kind !== "user") throw new AgentError("PERMISSION_DENIED", "只有用户可以将任务标记为已完成", 403)
    if (actor.kind !== "agent") return
    const role = this.assertLinked(current.task.id, actor.sourceThreadId)
    if (role !== "primary") throw new AgentError("PERMISSION_DENIED", "辅助对话只能读取任务和追加评论", 403)
    if (nextStatus === undefined || nextStatus === current.task.status) return
    const allowed = (current.task.status === "backlog" || current.task.status === "todo") ? nextStatus === "in_progress" : current.task.status === "in_progress" && nextStatus === "in_review"
    if (!allowed) throw new AgentError("PERMISSION_DENIED", "Agent 不允许执行该任务状态转换", 403)
  }

  private assertLinked(taskId: string, threadId: string | null) {
    if (!threadId) throw new AgentError("TASKBOARD_CONTEXT_REQUIRED", "任务操作缺少来源对话", 403)
    const link = this.repository.taskLinkForThread(threadId)
    if (!link || link.taskId !== taskId) throw new AgentError("PERMISSION_DENIED", "当前执行对话未关联该任务", 403)
    return link.role
  }

  private assertUserMutableTask(taskId: string, actor: TaskboardMutationActor) {
    this.assertUser(actor)
    const task = this.details(taskId); this.project(task.task.projectId); return task
  }
  private assertUser(actor: TaskboardMutationActor) { if (actor.kind !== "user") throw new AgentError("PERMISSION_DENIED", "该任务操作仅允许用户执行", 403) }
  private assertThreadProject(threadId: string, projectId: string) {
    const actual = this.db.threadProjectID(threadId)
    if (!actual) throw new AgentError("THREAD_NOT_FOUND", "执行对话不存在或未绑定项目", 404)
    if (actual !== projectId) throw new AgentError("CONFLICT", "执行对话与任务不属于同一项目", 409)
  }
  private title(value: string) { const title = value.trim(); if (!title || title.length > TASKBOARD_TITLE_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "任务标题长度无效", 400); return title }
  private description(value = "") { if (value.length > TASKBOARD_DESCRIPTION_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "任务描述过长", 400); return value }
  private comment(value: string) { const body = value.trim(); if (!body || body.length > TASKBOARD_COMMENT_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "评论内容长度无效", 400); return body }
  private labelIds(values?: readonly string[]) { if (!values) return undefined; if (values.length > TASKBOARD_LABELS_PER_TASK_MAX || new Set(values).size !== values.length) throw new AgentError("INVALID_REQUEST", "任务标签数量无效", 400); return [...values] }
  private labelName(raw: string) { const name = raw.trim().normalize("NFKC"); if (!name || name.length > TASKBOARD_LABEL_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "标签名称长度无效", 400); return name }
}

import { createHash, randomUUID } from "node:crypto"
import { Effect } from "effect"
import type {
  TaskboardPriority,
  TaskboardStatus,
  TaskboardTaskDetails,
  TaskboardThreadRole,
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
    private readonly now: () => number = Date.now,
  ) {}

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
      this.repository.completeTaskboardOperation(input.operationId, value, timestamp)
      return { value, event, replay: false }
    })
    if (!committed.replay) await Effect.runPromise(this.hub.publish(committed.event!))
    return committed.value
  }

  list(input: Parameters<TaskboardRepository["listTasks"]>[0] = {}) {
    if (input.projectId) this.project(input.projectId)
    const page = this.repository.listTasks({ ...input, limit: Math.min(500, Math.max(1, input.limit ?? 200)) })
    return input.projectId ? page : { ...page, tasks: page.tasks.filter((task) => Boolean(this.db.getProject(task.projectId))) }
  }

  read(taskId: string) { return this.details(taskId) }

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
      throw new AgentError("PERMISSION_DENIED", "Agent 只能创建待整理任务", 403)
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
    return this.operation({
      operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId,
      method: "taskboard/task/move", request: input, resource: "task", action: "updated",
      mutate: (timestamp) => {
        const task = this.repository.moveTask({ ...input, updatedAt: timestamp })
        this.repository.recordActivity({ taskId: input.taskId, kind: "task_moved", actor: "user", data: { status: input.status }, createdAt: timestamp })
        return task
      },
    })
  }

  async archive(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/archive", request: input, resource: "task", action: "archived", mutate: (timestamp) => {
      const task = this.repository.archiveTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, archivedAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "task_archived", actor: "user", createdAt: timestamp })
      return task
    } })
  }

  async restore(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/restore", request: input, resource: "task", action: "restored", mutate: (timestamp) => {
      const task = this.repository.restoreTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, restoredAt: timestamp })
      this.repository.recordActivity({ taskId: input.taskId, kind: "task_restored", actor: "user", createdAt: timestamp })
      return task
    } })
  }

  async delete(input: { taskId: string; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/task/delete", request: input, resource: "task", action: "deleted", mutate: () => {
      this.repository.deleteTask({ taskId: input.taskId, expectedVersion: input.expectedVersion })
      return { deleted: true as const, taskId: input.taskId }
    } })
  }

  async linkThread(input: { taskId: string; threadId: string; role: TaskboardThreadRole; expectedVersion: number; operationId: string; actor: TaskboardMutationActor }) {
    const current = this.assertUserMutableTask(input.taskId, input.actor)
    this.assertThreadProject(input.threadId, current.task.projectId)
    return this.threadMutation("link", "thread_linked", input, current)
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
    return this.operation({ operationId: input.operationId, projectId: current.task.projectId, taskId: input.taskId, method: "taskboard/comment/create", request: { ...input, body }, resource: "comment", action: "created", mutate: (timestamp) => {
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

  async agentUpdate(input: { threadId: string; operationId: string; taskId?: string; expectedVersion: number; title?: string; description?: string; priority?: TaskboardPriority; status?: "in_progress" | "in_review"; labelIds?: readonly string[] }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    const { threadId, taskId: _taskId, expectedVersion, operationId, ...patch } = input
    try {
      return { task: await this.update({ taskId: task.task.id, patch, expectedVersion, operationId, actor: { kind: "agent", sourceThreadId: threadId } }) }
    } catch (cause) {
      if (!(cause instanceof AgentError) || cause.code !== "CONFLICT") throw cause
      const refreshed = this.details(task.task.id)
      return { task: await this.update({ taskId: task.task.id, patch, expectedVersion: refreshed.task.version, operationId: `${operationId}:retry`, actor: { kind: "agent", sourceThreadId: threadId } }) }
    }
  }

  async agentComment(input: { threadId: string; operationId: string; taskId?: string; expectedVersion: number; body: string }) {
    const task = input.taskId ? this.details(input.taskId) : this.taskForThread(input.threadId)
    try {
      return await this.createComment({ taskId: task.task.id, body: input.body, expectedVersion: input.expectedVersion, operationId: input.operationId, actor: { kind: "agent", sourceThreadId: input.threadId } })
    } catch (cause) {
      if (!(cause instanceof AgentError) || cause.code !== "CONFLICT") throw cause
      const refreshed = this.details(task.task.id)
      return this.createComment({ taskId: task.task.id, body: input.body, expectedVersion: refreshed.task.version, operationId: `${input.operationId}:retry`, actor: { kind: "agent", sourceThreadId: input.threadId } })
    }
  }

  /** Called inside ThreadService's existing admission transaction. */
  admitPrimaryThread(threadId: string): EventEnvelope | null {
    const link = this.repository.taskLinkForThread(threadId)
    if (!link) return null
    const task = this.repository.readTask(link.taskId)
    if (!task || !this.db.getProject(task.task.projectId)) return null
    return this.repository.advancePrimaryTaskForFirstTurn(threadId, this.now())?.event ?? null
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

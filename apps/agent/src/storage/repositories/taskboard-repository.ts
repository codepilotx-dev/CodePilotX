// Adapted from dashi-taskboard commit 9b2aeb5; modified for CodePilotX.
import type {
  TaskboardActivity,
  TaskboardActivityKind,
  TaskboardActor,
  TaskboardComment,
  TaskboardLabel,
  TaskboardPriority,
  TaskboardStatus,
  TaskboardTask,
  TaskboardTaskDetails,
  TaskboardTaskSummary,
  TaskboardThreadLink,
  TaskboardThreadRole,
  TaskboardWorktreeStatus,
  TaskboardWorkflowAttention,
  TaskboardWorkflowAttentionReason,
  TaskboardWorkflowDatePreset,
  TaskboardWorkflowSort,
  TaskboardWorkflowStatus,
  TaskboardWorkflowTask,
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
  TaskboardWorkflowThreadCandidate,
  TaskboardWorkflowThreadLookup,
  TurnStatus,
} from "@codepilotx/shared"
import {
  TASKBOARD_POSITION_GAP,
  taskboardAttentionFromTurnStatus,
} from "@codepilotx/shared/taskboard"
import type {
  TaskboardStartExecution,
  TaskboardStartOperation,
} from "@codepilotx/agent-protocol/taskboard"
import { AgentError, type EventEnvelope } from "../../domain"
import { ReviewRepositoryDatabase } from "./review-repository"

type TaskRow = {
  id: string
  project_id: string
  number: number
  title: string
  description: string
  status: TaskboardStatus
  priority: TaskboardPriority
  position: number
  version: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

type LabelRow = {
  id: string
  project_id: string
  name: string
  normalized_name: string
  version: number
  created_at: number
  updated_at: number
}

type CommentRow = {
  id: string
  task_id: string
  body: string
  author: "user" | "agent"
  source_thread_id: string | null
  version: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

type ActivityRow = {
  id: string
  task_id: string
  kind: TaskboardActivityKind
  actor: TaskboardActor
  source_thread_id: string | null
  data: string
  created_at: number
}

type StartOperationRow = {
  operation_id: string
  task_id: string
  project_id: string
  thread_id: string | null
  worktree_id: string | null
  request_hash: string
  execution: string
  status: TaskboardStartOperation["status"]
  step: TaskboardStartOperation["step"]
  revision: number
  error_code: string | null
  warnings: string
  startup_instruction: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

type WorkflowRow = {
  status: TaskboardWorkflowStatus
  position: number
  start_date: string | null
  due_date: string | null
  unread: number
  unread_at: number | null
  read_at: number | null
  reason: TaskboardWorkflowAttentionReason | null
}

export type TaskboardWorkflowListInput = Omit<TaskboardListInput, "statuses"> & {
  statuses?: readonly TaskboardWorkflowStatus[]
  unread?: boolean
  datePreset?: TaskboardWorkflowDatePreset
  sort?: TaskboardWorkflowSort
  today?: string
}

export type TaskboardListInput = {
  projectId?: string
  statuses?: readonly TaskboardStatus[]
  priorities?: readonly TaskboardPriority[]
  labelIds?: readonly string[]
  query?: string
  archived?: boolean
  cursor?: string
  limit?: number
}

export type TaskboardOperation = {
  operationId: string
  projectId: string
  taskId: string | null
  method: string
  requestHash: string
  status: "pending" | "completed"
  result: unknown | null
  createdAt: number
  updatedAt: number
}

const now = () => Date.now()
const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T

const taskNotFound = () => new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
const conflict = () => new AgentError("CONFLICT", "任务已在其他窗口更新", 409)
const legacyStatus = (status: TaskboardWorkflowStatus): TaskboardStatus => {
  if (status === "blocked") return "in_progress"
  if (status === "canceled") return "done"
  return status
}
const wireTurnStatus = (status: string | null): TurnStatus | null => {
  if (status === null) return null
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_subagents") return "waiting-subagents"
  return status as TurnStatus
}

export class TaskboardRepositoryDatabase extends ReviewRepositoryDatabase {
  private mapLabel(row: LabelRow): TaskboardLabel {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      normalizedName: row.normalized_name,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private labelsForTask(taskId: string): TaskboardLabel[] {
    const rows = this.sqlite.query(`
      SELECT l.id, l.project_id, l.name, l.normalized_name, l.version, l.created_at, l.updated_at
      FROM taskboard_labels l
      JOIN taskboard_task_labels tl ON tl.label_id = l.id
      WHERE tl.task_id = ?
      ORDER BY l.normalized_name, l.id
    `).all(taskId) as LabelRow[]
    return rows.map((row) => this.mapLabel(row))
  }

  private mapTask(row: TaskRow): TaskboardTask {
    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      position: row.position,
      version: row.version,
      labels: this.labelsForTask(row.id),
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private taskRow(taskId: string): TaskRow | null {
    return this.sqlite.query(`
      SELECT id, project_id, number, title, description, status, priority, position,
             version, archived_at, created_at, updated_at
      FROM taskboard_tasks WHERE id = ?
    `).get(taskId) as TaskRow | null
  }

  private workflowRow(taskId: string): WorkflowRow | null {
    return this.sqlite.query(`
      SELECT w.status, w.position, w.start_date, w.due_date,
             COALESCE(a.unread, 0) AS unread, a.unread_at, a.read_at, a.reason
      FROM taskboard_task_workflows w
      LEFT JOIN taskboard_task_attention a ON a.task_id = w.task_id
      WHERE w.task_id = ?
    `).get(taskId) as WorkflowRow | null
  }

  private workflowTask(task: TaskboardTask): TaskboardWorkflowTask {
    const workflow = this.workflowRow(task.id)
    const attention: TaskboardWorkflowAttention = {
      unread: workflow?.unread === 1,
      unreadAt: workflow?.unread_at ?? null,
      readAt: workflow?.read_at ?? null,
      reason: workflow?.reason ?? null,
    }
    return {
      ...task,
      status: workflow?.status ?? task.status,
      position: workflow?.position ?? task.position,
      startDate: workflow?.start_date ?? null,
      dueDate: workflow?.due_date ?? null,
      attention,
    }
  }

  listThreadLinks(taskId: string): TaskboardThreadLink[] {
    const rows = this.sqlite.query(`
      SELECT l.task_id, l.thread_id, l.role, l.version, l.linked_at,
             t.title, t.git_branch, t.updated_at AS thread_updated_at,
             b.kind AS execution_kind, b.worktree_id,
             w.status AS worktree_status, w.branch_name AS worktree_branch,
             (
               SELECT status FROM turns
               WHERE thread_id = t.id
               ORDER BY created_at DESC, id DESC LIMIT 1
             ) AS latest_turn_status
             ,EXISTS (
               SELECT 1 FROM turns AS plan_turn
               WHERE plan_turn.thread_id = t.id
                 AND plan_turn.status = 'completed'
                 AND plan_turn.id = (
                   SELECT u.id FROM turns AS u
                   WHERE u.thread_id = t.id
                   ORDER BY u.created_at DESC, u.id DESC LIMIT 1
                 )
                 AND EXISTS (
                   SELECT 1 FROM items AS plan_item
                   WHERE plan_item.turn_id = plan_turn.id
                     AND plan_item.type = 'plan'
                     AND plan_item.status NOT IN ('pending', 'running', 'interrupted')
                 )
             ) AS pending_plan_approval
             ,(
               SELECT created_at FROM turns
               WHERE thread_id = t.id
               ORDER BY created_at DESC, id DESC LIMIT 1
             ) AS latest_turn_created_at
      FROM taskboard_task_threads l
      JOIN threads t ON t.id = l.thread_id
      LEFT JOIN thread_execution_bindings b ON b.thread_id = t.id
      LEFT JOIN managed_worktrees w ON w.id = b.worktree_id
      WHERE l.task_id = ?
      ORDER BY CASE l.role WHEN 'primary' THEN 0 ELSE 1 END, l.linked_at DESC, l.thread_id
    `).all(taskId) as Array<{
      task_id: string
      thread_id: string
      role: TaskboardThreadRole
      version: number
      linked_at: number
      title: string
      git_branch: string | null
      thread_updated_at: number
      execution_kind: "local" | "worktree" | null
      worktree_id: string | null
      worktree_status: TaskboardWorktreeStatus | null
      worktree_branch: string | null
      latest_turn_status: string | null
      pending_plan_approval: number
      latest_turn_created_at: number | null
    }>
    const projected = rows.map((row) => {
      const latestTurnStatus = wireTurnStatus(row.latest_turn_status)
      const pendingPlanApproval = row.pending_plan_approval === 1
      const execution: TaskboardThreadLink["execution"] = row.execution_kind === "worktree" && row.worktree_id && row.worktree_status
        ? {
            kind: "worktree",
            worktreeId: row.worktree_id,
            branchName: row.worktree_branch ?? row.git_branch,
            status: row.worktree_status,
          }
        : { kind: "local", branchName: row.git_branch }
      const link: TaskboardThreadLink = {
          taskId: row.task_id,
          threadId: row.thread_id,
          role: row.role,
          title: row.title,
          latestTurnStatus,
          pendingPlanApproval,
          attention: taskboardAttentionFromTurnStatus(latestTurnStatus, pendingPlanApproval),
          execution,
          version: row.version,
          linkedAt: row.linked_at,
        }
      return {
        link,
        recentActivityAt: Math.max(row.thread_updated_at, row.latest_turn_created_at ?? 0),
      }
    })
    projected.sort((left, right) => {
      if (left.link.role !== right.link.role) return left.link.role === "primary" ? -1 : 1
      if (left.link.role === "supporting") {
        const leftActive = left.link.attention === "running" || left.link.attention === "needs_input"
        const rightActive = right.link.attention === "running" || right.link.attention === "needs_input"
        if (leftActive !== rightActive) return leftActive ? -1 : 1
      }
      if (left.recentActivityAt !== right.recentActivityAt) return right.recentActivityAt - left.recentActivityAt
      if (left.link.linkedAt !== right.link.linkedAt) return right.link.linkedAt - left.link.linkedAt
      return left.link.threadId.localeCompare(right.link.threadId)
    })
    return projected.map(({ link }) => link)
  }

  private mapComment(row: CommentRow): TaskboardComment {
    return {
      id: row.id,
      taskId: row.task_id,
      body: row.body,
      author: row.author,
      sourceThreadId: row.source_thread_id,
      version: row.version,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  readComment(commentId: string): TaskboardComment | null {
    const row = this.sqlite.query(`
      SELECT id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at
      FROM taskboard_comments WHERE id = ?
    `).get(commentId) as CommentRow | null
    return row ? this.mapComment(row) : null
  }

  private mapActivity(row: ActivityRow): TaskboardActivity {
    return {
      id: row.id,
      taskId: row.task_id,
      kind: row.kind,
      actor: row.actor,
      sourceThreadId: row.source_thread_id,
      data: parse<Record<string, unknown>>(row.data) as TaskboardActivity["data"],
      createdAt: row.created_at,
    }
  }

  readTask(taskId: string): TaskboardTaskDetails | null {
    const row = this.taskRow(taskId)
    if (!row) return null
    const comments = this.sqlite.query(`
      SELECT id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at
      FROM taskboard_comments WHERE task_id = ? ORDER BY created_at, id
    `).all(taskId) as CommentRow[]
    const activities = this.sqlite.query(`
      SELECT id, task_id, kind, actor, source_thread_id, data, created_at
      FROM taskboard_activities WHERE task_id = ? ORDER BY created_at, id
    `).all(taskId) as ActivityRow[]
    return {
      task: this.mapTask(row),
      threads: this.listThreadLinks(taskId),
      comments: comments.map((comment) => this.mapComment(comment)),
      activities: activities.map((activity) => this.mapActivity(activity)),
    }
  }

  readWorkflowTask(taskId: string): TaskboardWorkflowTaskDetails | null {
    const details = this.readTask(taskId)
    return details
      ? { ...details, task: this.workflowTask(details.task) }
      : null
  }

  assertTaskVersion(taskId: string, expectedVersion: number): TaskboardTask {
    const row = this.taskRow(taskId)
    if (!row) throw taskNotFound()
    if (row.version !== expectedVersion) throw conflict()
    return this.mapTask(row)
  }

  listTasks(input: TaskboardListInput = {}): { tasks: TaskboardTaskSummary[]; nextCursor: string | null } {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500))
    const cursorOffset = input.cursor?.startsWith("offset:") ? Number(input.cursor.slice(7)) : 0
    const offset = Number.isSafeInteger(cursorOffset) && cursorOffset >= 0 ? cursorOffset : 0
    const clauses: string[] = [input.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"]
    const args: Array<string | number> = []
    if (input.projectId) {
      clauses.push("t.project_id = ?")
      args.push(input.projectId)
    } else {
      const projectIds = (this.profileSqlite.query("SELECT id FROM projects WHERE removed_at IS NULL").all() as Array<{ id: string }>).map(({ id }) => id)
      if (projectIds.length === 0) return { tasks: [], nextCursor: null }
      clauses.push(`t.project_id IN (${projectIds.map(() => "?").join(",")})`)
      args.push(...projectIds)
    }
    if (input.statuses?.length) {
      clauses.push(`t.status IN (${input.statuses.map(() => "?").join(",")})`)
      args.push(...input.statuses)
    }
    if (input.priorities?.length) {
      clauses.push(`t.priority IN (${input.priorities.map(() => "?").join(",")})`)
      args.push(...input.priorities)
    }
    if (input.query?.trim()) {
      clauses.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')")
      const escaped = input.query.trim().replace(/[\\%_]/g, "\\$&")
      args.push(`%${escaped}%`, `%${escaped}%`)
    }
    for (const labelId of input.labelIds ?? []) {
      clauses.push("EXISTS (SELECT 1 FROM taskboard_task_labels f WHERE f.task_id = t.id AND f.label_id = ?)")
      args.push(labelId)
    }
    const rows = this.sqlite.query(`
      SELECT t.id, t.project_id, t.number, t.title, t.description, t.status, t.priority,
             t.position, t.version, t.archived_at, t.created_at, t.updated_at
      FROM taskboard_tasks t
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.project_id, t.status, t.position, t.id
      LIMIT ? OFFSET ?
    `).all(...args, limit + 1, offset) as TaskRow[]
    const page = rows.slice(0, limit)
    return {
      tasks: page.map((row) => ({ ...this.mapTask(row), threads: this.listThreadLinks(row.id) })),
      nextCursor: rows.length > limit ? `offset:${offset + limit}` : null,
    }
  }

  private allocateTaskNumber(projectId: string, timestamp: number): number {
    const row = this.sqlite.query("SELECT next_number FROM taskboard_project_sequences WHERE project_id = ?").get(projectId) as { next_number: number } | null
    if (!row) {
      this.sqlite.query("INSERT INTO taskboard_project_sequences (project_id, next_number, updated_at) VALUES (?, 2, ?)").run(projectId, timestamp)
      return 1
    }
    this.sqlite.query("UPDATE taskboard_project_sequences SET next_number = next_number + 1, updated_at = ? WHERE project_id = ?").run(timestamp, projectId)
    return row.next_number
  }

  private replaceTaskLabels(taskId: string, projectId: string, labelIds: readonly string[], timestamp: number) {
    const unique = [...new Set(labelIds)]
    if (unique.length > 20) throw new AgentError("INVALID_REQUEST", "每个任务最多包含 20 个标签", 400)
    if (unique.length > 0) {
      const rows = this.sqlite.query(`SELECT id FROM taskboard_labels WHERE project_id = ? AND id IN (${unique.map(() => "?").join(",")})`).all(projectId, ...unique) as Array<{ id: string }>
      if (rows.length !== unique.length) throw new AgentError("TASKBOARD_LABEL_NOT_FOUND", "标签不存在或不属于当前项目", 404)
    }
    this.sqlite.query("DELETE FROM taskboard_task_labels WHERE task_id = ?").run(taskId)
    for (const labelId of unique) {
      this.sqlite.query("INSERT INTO taskboard_task_labels (task_id, label_id, created_at) VALUES (?, ?, ?)").run(taskId, labelId, timestamp)
    }
  }

  createTask(input: {
    id?: string
    projectId: string
    title: string
    description?: string
    status?: TaskboardStatus
    priority?: TaskboardPriority
    labelIds?: readonly string[]
    createdAt?: number
  }): TaskboardTaskDetails {
    return this.transaction(() => {
      const timestamp = input.createdAt ?? now()
      const id = input.id ?? crypto.randomUUID()
      const status = input.status ?? "backlog"
      const position = ((this.sqlite.query("SELECT MAX(position) AS position FROM taskboard_tasks WHERE project_id = ? AND status = ? AND archived_at IS NULL").get(input.projectId, status) as { position: number | null }).position ?? 0) + TASKBOARD_POSITION_GAP
      const number = this.allocateTaskNumber(input.projectId, timestamp)
      this.sqlite.query(`
        INSERT INTO taskboard_tasks (
          id, project_id, number, title, description, status, priority, position,
          version, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
      `).run(id, input.projectId, number, input.title, input.description ?? "", status, input.priority ?? "none", position, timestamp, timestamp)
      this.replaceTaskLabels(id, input.projectId, input.labelIds ?? [], timestamp)
      this.sqlite.query(`INSERT OR IGNORE INTO taskboard_task_workflows (task_id, status, start_date, due_date, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?)`).run(id, status, timestamp, timestamp)
      this.sqlite.query(`INSERT OR IGNORE INTO taskboard_task_attention (task_id, unread, unread_at, read_at, reason, updated_at) VALUES (?, 0, NULL, NULL, NULL, ?)`).run(id, timestamp)
      return this.readTask(id)!
    })
  }

  updateTask(input: {
    taskId: string
    expectedVersion: number
    patch: Partial<Pick<TaskboardTask, "title" | "description" | "status" | "priority">> & { labelIds?: readonly string[] }
    updatedAt?: number
  }): TaskboardTaskDetails {
    return this.transaction(() => {
      const current = this.taskRow(input.taskId)
      if (!current) throw taskNotFound()
      const timestamp = input.updatedAt ?? now()
      const result = this.sqlite.query(`
        UPDATE taskboard_tasks SET
          title = ?, description = ?, status = ?, priority = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(
        input.patch.title ?? current.title,
        input.patch.description ?? current.description,
        input.patch.status ?? current.status,
        input.patch.priority ?? current.priority,
        timestamp,
        input.taskId,
        input.expectedVersion,
      )
      if (result.changes === 0) throw conflict()
      if (input.patch.labelIds) this.replaceTaskLabels(input.taskId, current.project_id, input.patch.labelIds, timestamp)
      if (input.patch.status) {
        this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, updated_at = ? WHERE task_id = ?").run(input.patch.status, timestamp, input.taskId)
      }
      return this.readTask(input.taskId)!
    })
  }

  moveTask(input: {
    taskId: string
    status: TaskboardStatus
    beforeTaskId?: string | null
    afterTaskId?: string | null
    expectedVersion: number
    updatedAt?: number
  }): TaskboardTaskDetails {
    return this.transaction(() => {
      const current = this.taskRow(input.taskId)
      if (!current) throw taskNotFound()
      if (current.version !== input.expectedVersion) throw conflict()
      const timestamp = input.updatedAt ?? now()
      const peers = this.sqlite.query(`
        SELECT id, position FROM taskboard_tasks
        WHERE project_id = ? AND status = ? AND archived_at IS NULL AND id <> ?
        ORDER BY position, id
      `).all(current.project_id, input.status, input.taskId) as Array<{ id: string; position: number }>
      let insertion = peers.length
      if (input.afterTaskId) {
        insertion = peers.findIndex(({ id }) => id === input.afterTaskId)
        if (insertion < 0) throw new AgentError("INVALID_REQUEST", "afterTaskId 不属于目标列", 400)
      } else if (input.beforeTaskId) {
        const before = peers.findIndex(({ id }) => id === input.beforeTaskId)
        if (before < 0) throw new AgentError("INVALID_REQUEST", "beforeTaskId 不属于目标列", 400)
        insertion = before + 1
      }
      if (input.beforeTaskId && input.afterTaskId) {
        const before = peers.findIndex(({ id }) => id === input.beforeTaskId)
        const after = peers.findIndex(({ id }) => id === input.afterTaskId)
        if (before < 0 || after < 0 || before + 1 !== after) throw new AgentError("INVALID_REQUEST", "移动锚点不相邻", 400)
        insertion = after
      }
      const previous = insertion > 0 ? peers[insertion - 1]!.position : 0
      const next = insertion < peers.length ? peers[insertion]!.position : previous + TASKBOARD_POSITION_GAP * 2
      if (next - previous > 1) {
        const position = Math.floor((previous + next) / 2)
        const result = this.sqlite.query(`
          UPDATE taskboard_tasks SET status = ?, position = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
        `).run(input.status, position, timestamp, input.taskId, input.expectedVersion)
        if (result.changes === 0) throw conflict()
      } else {
        const ordered = peers.map(({ id }) => id)
        ordered.splice(insertion, 0, input.taskId)
        for (let index = 0; index < ordered.length; index += 1) {
          const id = ordered[index]!
          this.sqlite.query(`
            UPDATE taskboard_tasks SET status = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ?
          `).run(input.status, (index + 1) * TASKBOARD_POSITION_GAP, timestamp, id)
        }
      }
      this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, updated_at = ? WHERE task_id = ?").run(input.status, timestamp, input.taskId)
      return this.readTask(input.taskId)!
    })
  }

  private setArchived(taskId: string, expectedVersion: number, archivedAt: number | null): TaskboardTaskDetails {
    return this.transaction(() => {
      const result = this.sqlite.query(`
        UPDATE taskboard_tasks SET archived_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(archivedAt, archivedAt ?? now(), taskId, expectedVersion)
      if (result.changes === 0) {
        if (!this.taskRow(taskId)) throw taskNotFound()
        throw conflict()
      }
      if (archivedAt !== null) {
        this.sqlite.query("UPDATE taskboard_task_attention SET unread = 0, unread_at = NULL, read_at = MAX(COALESCE(read_at, 0), ?), reason = NULL, updated_at = ? WHERE task_id = ?")
          .run(archivedAt, archivedAt, taskId)
      }
      return this.readTask(taskId)!
    })
  }

  archiveTask(input: { taskId: string; expectedVersion: number; archivedAt?: number }): TaskboardTaskDetails {
    return this.setArchived(input.taskId, input.expectedVersion, input.archivedAt ?? now())
  }

  restoreTask(input: { taskId: string; expectedVersion: number; restoredAt?: number }): TaskboardTaskDetails {
    return this.transaction(() => {
      const timestamp = input.restoredAt ?? now()
      const result = this.sqlite.query(`UPDATE taskboard_tasks SET archived_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND archived_at IS NOT NULL`).run(timestamp, input.taskId, input.expectedVersion)
      if (result.changes === 0) {
        if (!this.taskRow(input.taskId)) throw taskNotFound()
        throw conflict()
      }
      return this.readTask(input.taskId)!
    })
  }

  deleteTask(input: { taskId: string; expectedVersion: number }): boolean {
    return this.transaction(() => {
      const row = this.taskRow(input.taskId)
      if (!row) throw taskNotFound()
      if (row.archived_at === null) throw new AgentError("INVALID_REQUEST", "只有已归档任务可以永久删除", 400)
      if (row.version !== input.expectedVersion) throw conflict()
      return this.sqlite.query("DELETE FROM taskboard_tasks WHERE id = ? AND version = ? AND archived_at IS NOT NULL").run(input.taskId, input.expectedVersion).changes > 0
    })
  }

  listLabels(projectId: string): TaskboardLabel[] {
    return (this.sqlite.query(`SELECT id, project_id, name, normalized_name, version, created_at, updated_at FROM taskboard_labels WHERE project_id = ? ORDER BY normalized_name, id`).all(projectId) as LabelRow[]).map((row) => this.mapLabel(row))
  }

  readLabel(labelId: string): TaskboardLabel | null {
    const row = this.sqlite.query(`SELECT id, project_id, name, normalized_name, version, created_at, updated_at FROM taskboard_labels WHERE id = ?`).get(labelId) as LabelRow | null
    return row ? this.mapLabel(row) : null
  }

  createLabel(input: { id?: string; projectId: string; name: string; normalizedName: string; createdAt?: number }): TaskboardLabel {
    const timestamp = input.createdAt ?? now()
    const id = input.id ?? crypto.randomUUID()
    this.sqlite.query(`INSERT INTO taskboard_labels (id, project_id, name, normalized_name, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(id, input.projectId, input.name, input.normalizedName, timestamp, timestamp)
    return this.mapLabel(this.sqlite.query(`SELECT id, project_id, name, normalized_name, version, created_at, updated_at FROM taskboard_labels WHERE id = ?`).get(id) as LabelRow)
  }

  updateLabel(input: { labelId: string; name: string; normalizedName: string; expectedVersion: number; updatedAt?: number }): TaskboardLabel {
    const timestamp = input.updatedAt ?? now()
    const result = this.sqlite.query(`UPDATE taskboard_labels SET name = ?, normalized_name = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).run(input.name, input.normalizedName, timestamp, input.labelId, input.expectedVersion)
    if (result.changes === 0) {
      if (!this.sqlite.query("SELECT 1 FROM taskboard_labels WHERE id = ?").get(input.labelId)) throw new AgentError("TASKBOARD_LABEL_NOT_FOUND", "标签不存在", 404)
      throw conflict()
    }
    return this.mapLabel(this.sqlite.query(`SELECT id, project_id, name, normalized_name, version, created_at, updated_at FROM taskboard_labels WHERE id = ?`).get(input.labelId) as LabelRow)
  }

  deleteLabel(input: { labelId: string; expectedVersion: number }): boolean {
    const result = this.sqlite.query("DELETE FROM taskboard_labels WHERE id = ? AND version = ?").run(input.labelId, input.expectedVersion)
    if (result.changes > 0) return true
    if (!this.sqlite.query("SELECT 1 FROM taskboard_labels WHERE id = ?").get(input.labelId)) throw new AgentError("TASKBOARD_LABEL_NOT_FOUND", "标签不存在", 404)
    throw conflict()
  }

  createComment(input: { id?: string; taskId: string; body: string; author: "user" | "agent"; sourceThreadId?: string | null; expectedTaskVersion?: number; createdAt?: number }): TaskboardComment {
    if (input.expectedTaskVersion === undefined) {
      if (!this.taskRow(input.taskId)) throw taskNotFound()
    } else {
      this.assertTaskVersion(input.taskId, input.expectedTaskVersion)
    }
    const timestamp = input.createdAt ?? now()
    const id = input.id ?? crypto.randomUUID()
    this.sqlite.query(`INSERT INTO taskboard_comments (id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)`).run(id, input.taskId, input.body, input.author, input.sourceThreadId ?? null, timestamp, timestamp)
    if (input.author === "agent") {
      this.sqlite.query("UPDATE taskboard_task_attention SET unread = 1, unread_at = MAX(COALESCE(unread_at, 0), ?), reason = 'agent_comment', updated_at = ? WHERE task_id = ?").run(timestamp, timestamp, input.taskId)
    }
    return this.mapComment(this.sqlite.query(`SELECT id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at FROM taskboard_comments WHERE id = ?`).get(id) as CommentRow)
  }

  updateComment(input: { commentId: string; body: string; expectedVersion: number; updatedAt?: number }): TaskboardComment {
    const timestamp = input.updatedAt ?? now()
    const result = this.sqlite.query(`UPDATE taskboard_comments SET body = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`).run(input.body, timestamp, input.commentId, input.expectedVersion)
    if (result.changes === 0) {
      if (!this.sqlite.query("SELECT 1 FROM taskboard_comments WHERE id = ?").get(input.commentId)) throw new AgentError("TASKBOARD_COMMENT_NOT_FOUND", "评论不存在", 404)
      throw conflict()
    }
    return this.mapComment(this.sqlite.query(`SELECT id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at FROM taskboard_comments WHERE id = ?`).get(input.commentId) as CommentRow)
  }

  deleteComment(input: { commentId: string; expectedVersion: number; deletedAt?: number }): TaskboardComment {
    const timestamp = input.deletedAt ?? now()
    const result = this.sqlite.query(`UPDATE taskboard_comments SET body = '', deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND deleted_at IS NULL`).run(timestamp, timestamp, input.commentId, input.expectedVersion)
    if (result.changes === 0) {
      if (!this.sqlite.query("SELECT 1 FROM taskboard_comments WHERE id = ?").get(input.commentId)) throw new AgentError("TASKBOARD_COMMENT_NOT_FOUND", "评论不存在", 404)
      throw conflict()
    }
    return this.mapComment(this.sqlite.query(`SELECT id, task_id, body, author, source_thread_id, version, deleted_at, created_at, updated_at FROM taskboard_comments WHERE id = ?`).get(input.commentId) as CommentRow)
  }

  taskLinkForThread(threadId: string): TaskboardThreadLink | null {
    const row = this.sqlite.query("SELECT task_id FROM taskboard_task_threads WHERE thread_id = ?").get(threadId) as { task_id: string } | null
    return row ? this.listThreadLinks(row.task_id).find((link) => link.threadId === threadId) ?? null : null
  }

  linkThread(input: { taskId: string; threadId: string; role: TaskboardThreadRole; expectedVersion?: number; linkedAt?: number }): TaskboardTaskDetails {
    return this.transaction(() => {
      const task = this.taskRow(input.taskId)
      if (!task) throw taskNotFound()
      if (input.expectedVersion !== undefined && task.version !== input.expectedVersion) throw conflict()
      const thread = this.sqlite.query("SELECT project_id FROM threads WHERE id = ?").get(input.threadId) as { project_id: string | null } | null
      if (!thread) throw new AgentError("THREAD_NOT_FOUND", "对话不存在", 404)
      if (thread.project_id !== task.project_id) throw new AgentError("INVALID_REQUEST", "任务与对话不属于同一项目", 409)
      const existing = this.sqlite.query("SELECT task_id FROM taskboard_task_threads WHERE thread_id = ?").get(input.threadId) as { task_id: string } | null
      if (existing) {
        if (existing.task_id === input.taskId) return this.readTask(input.taskId)!
        throw new AgentError("TASKBOARD_THREAD_ALREADY_LINKED", "该对话已关联其他任务", 409)
      }
      if (input.role === "primary" && this.sqlite.query("SELECT 1 FROM taskboard_task_threads WHERE task_id = ? AND role = 'primary'").get(input.taskId)) {
        throw new AgentError("TASKBOARD_PRIMARY_EXISTS", "任务已经有主执行对话", 409)
      }
      const timestamp = input.linkedAt ?? now()
      this.sqlite.query(`INSERT INTO taskboard_task_threads (task_id, thread_id, role, version, linked_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`).run(input.taskId, input.threadId, input.role, timestamp, timestamp)
      this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
      return this.readTask(input.taskId)!
    })
  }

  linkPrimaryThread(input: { taskId: string; threadId: string; expectedVersion?: number; linkedAt?: number }) {
    return this.linkThread({ ...input, role: "primary" })
  }

  unlinkThread(input: { taskId: string; threadId: string; expectedVersion: number; updatedAt?: number }): TaskboardTaskDetails {
    return this.transaction(() => {
      const task = this.taskRow(input.taskId)
      if (!task) throw taskNotFound()
      if (task.version !== input.expectedVersion) throw conflict()
      const result = this.sqlite.query("DELETE FROM taskboard_task_threads WHERE task_id = ? AND thread_id = ?").run(input.taskId, input.threadId)
      if (result.changes === 0) throw new AgentError("INVALID_REQUEST", "任务未关联该对话", 404)
      const timestamp = input.updatedAt ?? now()
      this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
      return this.readTask(input.taskId)!
    })
  }

  setPrimaryThread(input: { taskId: string; threadId: string; expectedVersion: number; updatedAt?: number }): TaskboardTaskDetails {
    return this.transaction(() => {
      const task = this.taskRow(input.taskId)
      if (!task) throw taskNotFound()
      if (task.version !== input.expectedVersion) throw conflict()
      const target = this.sqlite.query("SELECT role FROM taskboard_task_threads WHERE task_id = ? AND thread_id = ?").get(input.taskId, input.threadId) as { role: TaskboardThreadRole } | null
      if (!target) throw new AgentError("INVALID_REQUEST", "任务未关联该对话", 404)
      if (target.role === "primary") return this.readTask(input.taskId)!
      const timestamp = input.updatedAt ?? now()
      this.sqlite.query("UPDATE taskboard_task_threads SET role = 'supporting', version = version + 1, updated_at = ? WHERE task_id = ? AND role = 'primary'").run(timestamp, input.taskId)
      this.sqlite.query("UPDATE taskboard_task_threads SET role = 'primary', version = version + 1, updated_at = ? WHERE task_id = ? AND thread_id = ?").run(timestamp, input.taskId, input.threadId)
      this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
      return this.readTask(input.taskId)!
    })
  }

  prepareWorkflowStart(input: { taskId: string; expectedVersion: number; mode: "continue_primary" | "new_primary"; authorizeBacklog?: boolean; updatedAt?: number }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const task = this.taskRow(input.taskId)
      if (!task) throw taskNotFound()
      if (task.version !== input.expectedVersion) throw conflict()
      const workflow = this.workflowRow(input.taskId)
      if (!workflow) throw taskNotFound()
      if (workflow.status === "backlog" && !input.authorizeBacklog) throw new AgentError("PERMISSION_DENIED", "开始待立项任务前需要用户授权", 403)
      if (workflow.status === "done" || workflow.status === "canceled") throw new AgentError("INVALID_REQUEST", "已结束任务不能开始执行", 409)
      const primary = this.sqlite.query("SELECT thread_id FROM taskboard_task_threads WHERE task_id = ? AND role = 'primary'").get(input.taskId) as { thread_id: string } | null
      if (input.mode === "continue_primary" && !primary) throw new AgentError("INVALID_REQUEST", "任务没有可继续的主对话", 409)
      const primaryActive = primary
        ? Boolean(this.sqlite.query("SELECT 1 FROM turns WHERE thread_id = ? AND status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents') LIMIT 1").get(primary.thread_id))
        : false
      const timestamp = input.updatedAt ?? now()
      if (input.mode === "new_primary" && primary && !primaryActive) {
        this.sqlite.query("UPDATE taskboard_task_threads SET role = 'supporting', version = version + 1, updated_at = ? WHERE task_id = ? AND role = 'primary'").run(timestamp, input.taskId)
      }
      if (workflow.status === "backlog") {
        this.sqlite.query("UPDATE taskboard_tasks SET status = 'todo', version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
        this.sqlite.query("UPDATE taskboard_task_workflows SET status = 'todo', updated_at = ? WHERE task_id = ?").run(timestamp, input.taskId)
      } else if (input.mode === "new_primary" && primary && !primaryActive) {
        this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
      }
      return this.readWorkflowTask(input.taskId)!
    })
  }

  recordActivity(input: { taskId: string; kind: TaskboardActivityKind; actor: TaskboardActor; sourceThreadId?: string | null; data?: Record<string, unknown>; createdAt?: number }): TaskboardActivity {
    const timestamp = input.createdAt ?? now()
    const id = crypto.randomUUID()
    this.sqlite.query(`INSERT INTO taskboard_activities (id, task_id, kind, actor, source_thread_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, input.taskId, input.kind, input.actor, input.sourceThreadId ?? null, stringify(input.data ?? {}), timestamp)
    return { id, taskId: input.taskId, kind: input.kind, actor: input.actor, sourceThreadId: input.sourceThreadId ?? null, data: (input.data ?? {}) as TaskboardActivity["data"], createdAt: timestamp }
  }

  insertTaskboardChanged(input: {
    projectId: string
    taskId: string | null
    resource: "task" | "comment" | "label" | "thread_link" | "start"
    action: "created" | "updated" | "archived" | "restored" | "deleted"
    changedAt?: number
  }): EventEnvelope {
    return this.insertEvent(null, null, "taskboard/changed", { ...input, changedAt: input.changedAt ?? now() })
  }

  insertTaskboardWorkflowChanged(input: {
    projectId: string
    taskId: string
    resource: "workflow" | "attention" | "thread"
    action: "created" | "updated" | "deleted"
    changedAt?: number
  }): EventEnvelope {
    return this.insertEvent(null, null, "taskboard/workflow/changed", { ...input, changedAt: input.changedAt ?? now() })
  }

  getTaskboardOperation(operationId: string): TaskboardOperation | null {
    const row = this.sqlite.query(`SELECT operation_id, project_id, task_id, method, request_hash, status, result, created_at, updated_at FROM taskboard_operations WHERE operation_id = ?`).get(operationId) as {
      operation_id: string; project_id: string; task_id: string | null; method: string; request_hash: string; status: "pending" | "completed"; result: string | null; created_at: number; updated_at: number
    } | null
    return row ? { operationId: row.operation_id, projectId: row.project_id, taskId: row.task_id, method: row.method, requestHash: row.request_hash, status: row.status, result: row.result ? parse(row.result) : null, createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  beginTaskboardOperation(input: { operationId: string; projectId: string; taskId?: string | null; method: string; requestHash: string; createdAt?: number }): TaskboardOperation {
    const existing = this.getTaskboardOperation(input.operationId)
    if (existing) {
      if (existing.method !== input.method || existing.requestHash !== input.requestHash) throw new AgentError("OPERATION_ID_CONFLICT", "operationId 已用于其他任务看板操作", 409)
      return existing
    }
    const timestamp = input.createdAt ?? now()
    this.sqlite.query(`INSERT INTO taskboard_operations (operation_id, project_id, task_id, method, request_hash, status, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`).run(input.operationId, input.projectId, input.taskId ?? null, input.method, input.requestHash, timestamp, timestamp)
    return this.getTaskboardOperation(input.operationId)!
  }

  completeTaskboardOperation(operationId: string, result: unknown, completedAt = now()): TaskboardOperation {
    const updated = this.sqlite.query(`UPDATE taskboard_operations SET status = 'completed', result = ?, updated_at = ? WHERE operation_id = ?`).run(stringify(result), completedAt, operationId)
    if (updated.changes === 0) throw new AgentError("TASKBOARD_OPERATION_NOT_FOUND", "任务看板操作不存在", 404)
    return this.getTaskboardOperation(operationId)!
  }

  private mapStartOperation(row: StartOperationRow): TaskboardStartOperation {
    return {
      operationId: row.operation_id,
      taskId: row.task_id,
      projectId: row.project_id,
      threadId: row.thread_id,
      worktreeId: row.worktree_id,
      execution: parse<TaskboardStartExecution>(row.execution),
      status: row.status,
      step: row.step,
      revision: row.revision,
      errorCode: row.error_code,
      warnings: parse<string[]>(row.warnings),
      startupInstruction: row.startup_instruction,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }
  }

  getTaskboardStartOperation(operationId: string): TaskboardStartOperation | null {
    const row = this.sqlite.query(`SELECT operation_id, task_id, project_id, thread_id, worktree_id, request_hash, execution, status, step, revision, error_code, warnings, startup_instruction, created_at, updated_at, completed_at FROM taskboard_start_operations WHERE operation_id = ?`).get(operationId) as StartOperationRow | null
    return row ? this.mapStartOperation(row) : null
  }

  activeTaskboardStartOperation(taskId: string): TaskboardStartOperation | null {
    const row = this.sqlite.query(`
      SELECT operation_id, task_id, project_id, thread_id, worktree_id, request_hash,
             execution, status, step, revision, error_code, warnings,
             startup_instruction, created_at, updated_at, completed_at
      FROM taskboard_start_operations
      WHERE task_id = ? AND status IN ('running', 'awaiting_setup_decision')
      ORDER BY updated_at DESC, operation_id DESC
      LIMIT 1
    `).get(taskId) as StartOperationRow | null
    return row ? this.mapStartOperation(row) : null
  }

  findActiveTaskboardStartOperation(taskId: string): TaskboardStartOperation | null {
    return this.activeTaskboardStartOperation(taskId)
  }

  createTaskboardStartOperation(input: { operationId: string; taskId: string; projectId: string; requestHash: string; execution: TaskboardStartExecution; createdAt?: number }): TaskboardStartOperation {
    const existing = this.getTaskboardStartOperation(input.operationId)
    if (existing) {
      const row = this.sqlite.query("SELECT request_hash FROM taskboard_start_operations WHERE operation_id = ?").get(input.operationId) as { request_hash: string }
      if (row.request_hash !== input.requestHash) throw new AgentError("OPERATION_ID_CONFLICT", "operationId 已用于其他启动操作", 409)
      return existing
    }
    const timestamp = input.createdAt ?? now()
    this.sqlite.query(`INSERT INTO taskboard_start_operations (operation_id, task_id, project_id, thread_id, worktree_id, request_hash, execution, status, step, revision, error_code, warnings, startup_instruction, created_at, updated_at, completed_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'running', 'preflight', 1, NULL, '[]', NULL, ?, ?, NULL)`).run(input.operationId, input.taskId, input.projectId, input.requestHash, stringify(input.execution), timestamp, timestamp)
    return this.getTaskboardStartOperation(input.operationId)!
  }

  updateTaskboardStartOperation(input: {
    operationId: string
    expectedRevision: number
    patch: Partial<Pick<TaskboardStartOperation, "threadId" | "worktreeId" | "status" | "step" | "errorCode" | "warnings" | "startupInstruction" | "completedAt">>
    updatedAt?: number
  }): TaskboardStartOperation {
    const current = this.getTaskboardStartOperation(input.operationId)
    if (!current) throw new AgentError("TASKBOARD_START_OPERATION_NOT_FOUND", "任务启动操作不存在", 404)
    const timestamp = input.updatedAt ?? now()
    const result = this.sqlite.query(`
      UPDATE taskboard_start_operations SET thread_id = ?, worktree_id = ?, status = ?, step = ?,
        revision = revision + 1, error_code = ?, warnings = ?, startup_instruction = ?, updated_at = ?, completed_at = ?
      WHERE operation_id = ? AND revision = ?
    `).run(
      input.patch.threadId === undefined ? current.threadId : input.patch.threadId,
      input.patch.worktreeId === undefined ? current.worktreeId : input.patch.worktreeId,
      input.patch.status ?? current.status,
      input.patch.step ?? current.step,
      input.patch.errorCode === undefined ? current.errorCode : input.patch.errorCode,
      stringify(input.patch.warnings ?? current.warnings),
      input.patch.startupInstruction === undefined ? current.startupInstruction : input.patch.startupInstruction,
      timestamp,
      input.patch.completedAt === undefined ? current.completedAt : input.patch.completedAt,
      input.operationId,
      input.expectedRevision,
    )
    if (result.changes === 0) throw conflict()
    return this.getTaskboardStartOperation(input.operationId)!
  }

  listWorkflowTasks(input: TaskboardWorkflowListInput = {}): { tasks: TaskboardWorkflowTaskSummary[]; unreadCount: number; nextCursor: string | null } {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500))
    const cursorOffset = input.cursor?.startsWith("offset:") ? Number(input.cursor.slice(7)) : 0
    const offset = Number.isSafeInteger(cursorOffset) && cursorOffset >= 0 ? cursorOffset : 0
    const clauses = [input.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"]
    const args: Array<string | number> = []
    if (input.projectId) {
      clauses.push("t.project_id = ?")
      args.push(input.projectId)
    } else {
      const projectIds = (this.profileSqlite.query("SELECT id FROM projects WHERE removed_at IS NULL").all() as Array<{ id: string }>).map(({ id }) => id)
      if (projectIds.length === 0) return { tasks: [], unreadCount: 0, nextCursor: null }
      clauses.push(`t.project_id IN (${projectIds.map(() => "?").join(",")})`)
      args.push(...projectIds)
    }
    if (input.statuses?.length) {
      clauses.push(`w.status IN (${input.statuses.map(() => "?").join(",")})`)
      args.push(...input.statuses)
    }
    if (input.priorities?.length) {
      clauses.push(`t.priority IN (${input.priorities.map(() => "?").join(",")})`)
      args.push(...input.priorities)
    }
    if (input.query?.trim()) {
      clauses.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')")
      const escaped = input.query.trim().replace(/[\\%_]/g, "\\$&")
      args.push(`%${escaped}%`, `%${escaped}%`)
    }
    for (const labelId of input.labelIds ?? []) {
      clauses.push("EXISTS (SELECT 1 FROM taskboard_task_labels f WHERE f.task_id = t.id AND f.label_id = ?)")
      args.push(labelId)
    }
    const today = input.today ?? new Date().toISOString().slice(0, 10)
    if (input.datePreset === "overdue") {
      clauses.push("w.due_date IS NOT NULL AND w.due_date < ?")
      args.push(today)
    } else if (input.datePreset === "due_today") {
      clauses.push("w.due_date = ?")
      args.push(today)
    } else if (input.datePreset === "due_7_days") {
      const through = new Date(`${today}T00:00:00.000Z`)
      through.setUTCDate(through.getUTCDate() + 7)
      clauses.push("w.due_date BETWEEN ? AND ?")
      args.push(today, through.toISOString().slice(0, 10))
    } else if (input.datePreset === "no_due_date") {
      clauses.push("w.due_date IS NULL")
    }
    const unreadCountWhere = clauses.join(" AND ")
    const unreadCountArgs = [...args]
    if (input.unread !== undefined) {
      clauses.push("COALESCE(a.unread, 0) = ?")
      args.push(input.unread ? 1 : 0)
    }
    const where = clauses.join(" AND ")
    const order = input.sort === "due_date"
      ? "w.due_date IS NULL, w.due_date, w.position, t.id"
      : input.sort === "updated_at"
        ? "t.updated_at DESC, t.id DESC"
        : "w.status, w.position, t.id"
    const rows = this.sqlite.query(`
      SELECT t.id FROM taskboard_tasks t
      JOIN taskboard_task_workflows w ON w.task_id = t.id
      LEFT JOIN taskboard_task_attention a ON a.task_id = t.id
      WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?
    `).all(...args, limit + 1, offset) as Array<{ id: string }>
    const unreadCount = Number((this.sqlite.query(`
      SELECT COUNT(*) AS count FROM taskboard_tasks t
      JOIN taskboard_task_workflows w ON w.task_id = t.id
      LEFT JOIN taskboard_task_attention a ON a.task_id = t.id
      WHERE ${unreadCountWhere} AND COALESCE(a.unread, 0) = 1
    `).get(...unreadCountArgs) as { count: number }).count)
    return {
      tasks: rows.slice(0, limit).map(({ id }) => {
        const details = this.readWorkflowTask(id)!
        return { ...details.task, threads: details.threads }
      }),
      unreadCount,
      nextCursor: rows.length > limit ? `offset:${offset + limit}` : null,
    }
  }

  createWorkflowTask(input: {
    projectId: string
    title: string
    description?: string
    status?: TaskboardWorkflowStatus
    priority?: TaskboardPriority
    labelIds?: readonly string[]
    startDate?: string | null
    dueDate?: string | null
    threadLinks?: readonly { threadId: string; role: TaskboardThreadRole }[]
    createdAt?: number
  }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const timestamp = input.createdAt ?? now()
      const created = this.createTask({ ...input, status: legacyStatus(input.status ?? "backlog"), createdAt: timestamp })
      this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, start_date = ?, due_date = ?, updated_at = ? WHERE task_id = ?")
        .run(input.status ?? "backlog", input.startDate ?? null, input.dueDate ?? null, timestamp, created.task.id)
      if (input.threadLinks?.length) this.linkWorkflowThreads({ taskId: created.task.id, expectedVersion: created.task.version, links: input.threadLinks, updatedAt: timestamp })
      return this.readWorkflowTask(created.task.id)!
    })
  }

  updateWorkflowTask(input: {
    taskId: string
    expectedVersion: number
    patch: Partial<Pick<TaskboardTask, "title" | "description" | "priority">> & { labelIds?: readonly string[]; startDate?: string | null; dueDate?: string | null }
    updatedAt?: number
  }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const timestamp = input.updatedAt ?? now()
      this.updateTask({ taskId: input.taskId, expectedVersion: input.expectedVersion, patch: input.patch, updatedAt: timestamp })
      this.sqlite.query(`UPDATE taskboard_task_workflows SET start_date = COALESCE(?, start_date), due_date = COALESCE(?, due_date), updated_at = ? WHERE task_id = ?`).run(
        input.patch.startDate === undefined ? null : input.patch.startDate,
        input.patch.dueDate === undefined ? null : input.patch.dueDate,
        timestamp,
        input.taskId,
      )
      if (input.patch.startDate === null) this.sqlite.query("UPDATE taskboard_task_workflows SET start_date = NULL WHERE task_id = ?").run(input.taskId)
      if (input.patch.dueDate === null) this.sqlite.query("UPDATE taskboard_task_workflows SET due_date = NULL WHERE task_id = ?").run(input.taskId)
      return this.readWorkflowTask(input.taskId)!
    })
  }

  moveWorkflowTask(input: { taskId: string; status: TaskboardWorkflowStatus; beforeTaskId?: string | null; afterTaskId?: string | null; expectedVersion: number; note?: string; updatedAt?: number }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const timestamp = input.updatedAt ?? now()
      const current = this.assertTaskVersion(input.taskId, input.expectedVersion)
      const peers = this.sqlite.query(`
        SELECT t.id, w.position FROM taskboard_tasks t
        JOIN taskboard_task_workflows w ON w.task_id = t.id
        WHERE t.project_id = ? AND w.status = ? AND t.archived_at IS NULL AND t.id <> ?
        ORDER BY w.position, t.id
      `).all(current.projectId, input.status, input.taskId) as Array<{ id: string; position: number }>
      let insertion = peers.length
      if (input.afterTaskId) {
        insertion = peers.findIndex(({ id }) => id === input.afterTaskId)
        if (insertion < 0) throw new AgentError("INVALID_REQUEST", "afterTaskId 不属于目标列", 400)
      } else if (input.beforeTaskId) {
        const before = peers.findIndex(({ id }) => id === input.beforeTaskId)
        if (before < 0) throw new AgentError("INVALID_REQUEST", "beforeTaskId 不属于目标列", 400)
        insertion = before + 1
      }
      if (input.beforeTaskId && input.afterTaskId) {
        const before = peers.findIndex(({ id }) => id === input.beforeTaskId)
        const after = peers.findIndex(({ id }) => id === input.afterTaskId)
        if (before < 0 || after < 0 || before + 1 !== after) throw new AgentError("INVALID_REQUEST", "移动锚点不相邻", 400)
        insertion = after
      }
      const previous = insertion > 0 ? peers[insertion - 1]!.position : 0
      const next = insertion < peers.length ? peers[insertion]!.position : previous + TASKBOARD_POSITION_GAP * 2
      if (next - previous > 1) {
        const position = Math.floor((previous + next) / 2)
        const updated = this.sqlite.query("UPDATE taskboard_tasks SET status = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
          .run(legacyStatus(input.status), position, timestamp, input.taskId, input.expectedVersion)
        if (updated.changes === 0) throw conflict()
        this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, position = ?, updated_at = ? WHERE task_id = ?").run(input.status, position, timestamp, input.taskId)
      } else {
        const ordered = peers.map(({ id }) => id)
        ordered.splice(insertion, 0, input.taskId)
        for (let index = 0; index < ordered.length; index += 1) {
          const id = ordered[index]!
          const position = (index + 1) * TASKBOARD_POSITION_GAP
          if (id === input.taskId) {
            this.sqlite.query("UPDATE taskboard_tasks SET status = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
              .run(legacyStatus(input.status), position, timestamp, id, input.expectedVersion)
            this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, position = ?, updated_at = ? WHERE task_id = ?").run(input.status, position, timestamp, id)
          } else {
            this.sqlite.query("UPDATE taskboard_tasks SET position = ?, version = version + 1, updated_at = ? WHERE id = ?").run(position, timestamp, id)
            this.sqlite.query("UPDATE taskboard_task_workflows SET position = ?, updated_at = ? WHERE task_id = ?").run(position, timestamp, id)
          }
        }
      }
      if (input.status === "done" || input.status === "canceled") {
        this.sqlite.query("UPDATE taskboard_task_attention SET unread = 0, unread_at = NULL, read_at = MAX(COALESCE(read_at, 0), ?), reason = NULL, updated_at = ? WHERE task_id = ?")
          .run(timestamp, timestamp, input.taskId)
      }
      if (input.note) this.createComment({ taskId: input.taskId, body: input.note, author: "user", createdAt: timestamp })
      return this.readWorkflowTask(input.taskId)!
    })
  }

  transitionWorkflowTask(input: { taskId: string; expectedVersion: number; status: TaskboardWorkflowStatus; workflowAction: string; actor: TaskboardActor; attentionReason?: TaskboardWorkflowAttentionReason | null; note?: string; sourceThreadId?: string; updatedAt?: number }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const timestamp = input.updatedAt ?? now()
      const current = this.assertTaskVersion(input.taskId, input.expectedVersion)
      const before = this.workflowRow(input.taskId)?.status ?? current.status
      if (input.actor === "agent") {
        if (!input.sourceThreadId || !this.sqlite.query("SELECT 1 FROM taskboard_task_threads WHERE task_id = ? AND thread_id = ? AND role = 'primary'").get(input.taskId, input.sourceThreadId)) {
          throw new AgentError("PERMISSION_DENIED", "只有任务主对话可以推进工作流", 403)
        }
      }
      this.sqlite.query("UPDATE taskboard_tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(legacyStatus(input.status), timestamp, input.taskId, input.expectedVersion)
      this.sqlite.query("UPDATE taskboard_task_workflows SET status = ?, updated_at = ? WHERE task_id = ?").run(input.status, timestamp, input.taskId)
      if (input.note) this.createComment({ taskId: input.taskId, body: input.note, author: input.actor === "agent" ? "agent" : "user", ...(input.sourceThreadId === undefined ? {} : { sourceThreadId: input.sourceThreadId }), createdAt: timestamp })
      if (input.attentionReason) {
        this.sqlite.query(`UPDATE taskboard_task_attention SET unread = 1, unread_at = MAX(COALESCE(unread_at, 0), ?), reason = ?, updated_at = ? WHERE task_id = ?`).run(timestamp, input.attentionReason, timestamp, input.taskId)
      } else {
        this.sqlite.query("UPDATE taskboard_task_attention SET unread = 0, unread_at = NULL, reason = NULL, read_at = MAX(COALESCE(read_at, 0), ?), updated_at = ? WHERE task_id = ?").run(timestamp, timestamp, input.taskId)
      }
      this.recordActivity({ taskId: input.taskId, kind: "task_moved", actor: input.actor, ...(input.sourceThreadId === undefined ? {} : { sourceThreadId: input.sourceThreadId }), data: { before, after: input.status, workflowAction: input.workflowAction }, createdAt: timestamp })
      return this.readWorkflowTask(input.taskId)!
    })
  }

  markWorkflowTaskRead(input: { taskId: string; expectedUnreadAt?: number; readAt?: number }): TaskboardWorkflowTaskDetails {
    const timestamp = input.readAt ?? now()
    const task = this.taskRow(input.taskId)
    if (!task) throw taskNotFound()
    const attention = this.workflowRow(input.taskId)
    if (input.expectedUnreadAt === undefined || attention?.unread_at === null || attention?.unread_at === input.expectedUnreadAt) {
      this.sqlite.query("UPDATE taskboard_task_attention SET unread = 0, unread_at = NULL, read_at = MAX(COALESCE(read_at, 0), ?), reason = NULL, updated_at = ? WHERE task_id = ?").run(timestamp, timestamp, input.taskId)
    }
    return this.readWorkflowTask(input.taskId)!
  }

  linkWorkflowThreads(input: { taskId: string; expectedVersion: number; links: readonly { threadId: string; role: TaskboardThreadRole }[]; updatedAt?: number }): TaskboardWorkflowTaskDetails {
    return this.transaction(() => {
      const task = this.taskRow(input.taskId)
      if (!task) throw taskNotFound()
      if (task.version !== input.expectedVersion) throw conflict()
      const unique = new Set(input.links.map(({ threadId }) => threadId))
      if (unique.size !== input.links.length || input.links.filter(({ role }) => role === "primary").length > 1) throw new AgentError("INVALID_REQUEST", "对话关联重复或包含多个主对话", 400)
      for (const link of input.links) {
        const thread = this.sqlite.query("SELECT project_id FROM threads WHERE id = ? AND kind = 'main' AND archived_at IS NULL").get(link.threadId) as { project_id: string | null } | null
        if (!thread) throw new AgentError("THREAD_NOT_FOUND", "对话不存在或不可关联", 404)
        if (thread.project_id !== task.project_id) throw new AgentError("INVALID_REQUEST", "任务与对话不属于同一项目", 409)
        const owner = this.sqlite.query("SELECT task_id FROM taskboard_task_threads WHERE thread_id = ?").get(link.threadId) as { task_id: string } | null
        if (owner && owner.task_id !== input.taskId) throw new AgentError("TASKBOARD_THREAD_ALREADY_LINKED", "该对话已关联其他任务", 409)
        if (!owner) {
          const candidate = this.findWorkflowByThread({ threadId: link.threadId, projectId: task.project_id })
          if (!candidate.eligible) {
            const message = candidate.ineligibleReason === "active"
              ? "会话正在运行或等待处理，结束后才能整理为任务"
              : candidate.ineligibleReason === "pending_plan"
                ? "会话存在待确认计划，确认后才能整理为任务"
                : "会话当前不可关联任务"
            throw new AgentError("TASKBOARD_THREAD_NOT_ELIGIBLE", message, 409)
          }
        }
      }
      const timestamp = input.updatedAt ?? now()
      const existing = this.sqlite.query("SELECT thread_id, role FROM taskboard_task_threads WHERE task_id = ?").all(input.taskId) as Array<{ thread_id: string; role: TaskboardThreadRole }>
      const targetRoles = new Map(input.links.map((link) => [link.threadId, link.role] as const))
      const changed = existing.length !== input.links.length || existing.some((link) => targetRoles.get(link.thread_id) !== link.role)
      if (!changed) return this.readWorkflowTask(input.taskId)!
      if (input.links.some(({ role }) => role === "primary")) {
        this.sqlite.query("UPDATE taskboard_task_threads SET role = 'supporting', version = version + 1, updated_at = ? WHERE task_id = ? AND role = 'primary'").run(timestamp, input.taskId)
      }
      if (input.links.length === 0) this.sqlite.query("DELETE FROM taskboard_task_threads WHERE task_id = ?").run(input.taskId)
      else this.sqlite.query(`DELETE FROM taskboard_task_threads WHERE task_id = ? AND thread_id NOT IN (${input.links.map(() => "?").join(",")})`).run(input.taskId, ...input.links.map(({ threadId }) => threadId))
      for (const link of input.links) {
        const updated = this.sqlite.query("UPDATE taskboard_task_threads SET role = ?, version = version + 1, updated_at = ? WHERE task_id = ? AND thread_id = ? AND role IS NOT ?").run(link.role, timestamp, input.taskId, link.threadId, link.role)
        if (updated.changes === 0 && !this.sqlite.query("SELECT 1 FROM taskboard_task_threads WHERE task_id = ? AND thread_id = ?").get(input.taskId, link.threadId)) {
          this.sqlite.query("INSERT INTO taskboard_task_threads (task_id, thread_id, role, version, linked_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(input.taskId, link.threadId, link.role, timestamp, timestamp)
        }
      }
      this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, input.taskId)
      return this.readWorkflowTask(input.taskId)!
    })
  }

  listWorkflowThreadCandidates(input: { projectId: string; query?: string; cursor?: string; limit?: number }): { threads: TaskboardWorkflowThreadCandidate[]; nextCursor: string | null } {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
    const cursorOffset = input.cursor?.startsWith("offset:") ? Number(input.cursor.slice(7)) : 0
    const offset = Number.isSafeInteger(cursorOffset) && cursorOffset >= 0 ? cursorOffset : 0
    const args: Array<string | number> = [input.projectId]
    const query = input.query?.trim()
    const queryClause = query ? "AND t.title LIKE ? ESCAPE '\\'" : ""
    if (query) args.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`)
    const rows = this.sqlite.query(`
      SELECT t.id, t.project_id, t.title, t.updated_at,
        (SELECT status FROM turns u WHERE u.thread_id = t.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AS latest_turn_status
      FROM threads t
      WHERE t.project_id = ? AND t.kind = 'main' AND t.archived_at IS NULL ${queryClause}
        AND NOT EXISTS (SELECT 1 FROM taskboard_task_threads l WHERE l.thread_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM turns active WHERE active.thread_id = t.id AND active.status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents'))
        AND NOT EXISTS (
          SELECT 1 FROM turns plan_turn
          WHERE plan_turn.thread_id = t.id AND plan_turn.status = 'completed'
            AND plan_turn.id = (SELECT u.id FROM turns u WHERE u.thread_id = t.id ORDER BY u.created_at DESC, u.id DESC LIMIT 1)
            AND EXISTS (SELECT 1 FROM items plan_item WHERE plan_item.turn_id = plan_turn.id AND plan_item.type = 'plan' AND plan_item.status NOT IN ('pending','running','interrupted'))
        )
      ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?
    `).all(...args, limit + 1, offset) as Array<{ id: string; project_id: string; title: string; updated_at: number; latest_turn_status: string | null }>
    return {
      threads: rows.slice(0, limit).map((row) => ({ threadId: row.id, projectId: row.project_id, title: row.title, latestTurnStatus: wireTurnStatus(row.latest_turn_status), pendingPlanApproval: false, updatedAt: row.updated_at })),
      nextCursor: rows.length > limit ? `offset:${offset + limit}` : null,
    }
  }

  findWorkflowByThread(input: { threadId: string; projectId?: string }): TaskboardWorkflowThreadLookup {
    const thread = this.sqlite.query("SELECT id, project_id, kind, archived_at FROM threads WHERE id = ?").get(input.threadId) as { id: string; project_id: string | null; kind: string; archived_at: number | null } | null
    if (!thread) throw new AgentError("THREAD_NOT_FOUND", "对话不存在", 404)
    const linked = this.sqlite.query("SELECT task_id FROM taskboard_task_threads WHERE thread_id = ?").get(input.threadId) as { task_id: string } | null
    let reason: TaskboardWorkflowThreadLookup["ineligibleReason"] = null
    if (linked) reason = "already_linked"
    else if (thread.archived_at !== null) reason = "archived"
    else if (thread.kind !== "main") reason = "not_main"
    else if (input.projectId !== undefined && thread.project_id !== input.projectId) reason = "project_mismatch"
    else if (this.sqlite.query("SELECT 1 FROM turns WHERE thread_id = ? AND status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents') LIMIT 1").get(input.threadId)) reason = "active"
    else if (this.sqlite.query(`SELECT 1 FROM turns plan_turn WHERE plan_turn.thread_id = ? AND plan_turn.status = 'completed' AND plan_turn.id = (SELECT u.id FROM turns u WHERE u.thread_id = ? ORDER BY u.created_at DESC, u.id DESC LIMIT 1) AND EXISTS (SELECT 1 FROM items plan_item WHERE plan_item.turn_id = plan_turn.id AND plan_item.type = 'plan' AND plan_item.status NOT IN ('pending','running','interrupted')) LIMIT 1`).get(input.threadId, input.threadId)) reason = "pending_plan"
    return { threadId: input.threadId, taskId: linked?.task_id ?? null, eligible: reason === null, ineligibleReason: reason }
  }

  advancePrimaryTaskForFirstTurn(threadId: string, changedAt = now()): { task: TaskboardTaskDetails; event: EventEnvelope; workflowEvent: EventEnvelope } | null {
    return this.transaction(() => {
      const row = this.sqlite.query(`
        SELECT t.id, t.project_id FROM taskboard_tasks t
        JOIN taskboard_task_threads l ON l.task_id = t.id
        JOIN taskboard_task_workflows w ON w.task_id = t.id
        WHERE l.thread_id = ? AND l.role = 'primary' AND t.archived_at IS NULL
          AND w.status = 'todo'
      `).get(threadId) as { id: string; project_id: string } | null
      if (!row) return null
      this.sqlite.query(`UPDATE taskboard_tasks SET status = 'in_progress', version = version + 1, updated_at = ? WHERE id = ?`).run(changedAt, row.id)
      this.sqlite.query(`UPDATE taskboard_task_workflows SET status = 'in_progress', updated_at = ? WHERE task_id = ?`).run(changedAt, row.id)
      this.recordActivity({ taskId: row.id, kind: "task_moved", actor: "system", sourceThreadId: threadId, data: { status: "in_progress" }, createdAt: changedAt })
      return {
        task: this.readTask(row.id)!,
        event: this.insertTaskboardChanged({ projectId: row.project_id, taskId: row.id, resource: "task", action: "updated", changedAt }),
        workflowEvent: this.insertTaskboardWorkflowChanged({ projectId: row.project_id, taskId: row.id, resource: "workflow", action: "updated", changedAt }),
      }
    })
  }
}

export type TaskboardRepository = TaskboardRepositoryDatabase
export const taskboardRepository = (database: TaskboardRepositoryDatabase): TaskboardRepository => database

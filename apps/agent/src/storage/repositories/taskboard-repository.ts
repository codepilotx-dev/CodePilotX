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
      latest_turn_status: TurnStatus | null
      latest_turn_created_at: number | null
    }>
    const projected = rows.map((row) => {
      const latestTurnStatus = row.latest_turn_status
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
          attention: taskboardAttentionFromTurnStatus(latestTurnStatus),
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

  advancePrimaryTaskForFirstTurn(threadId: string, changedAt = now()): { task: TaskboardTaskDetails; event: EventEnvelope } | null {
    return this.transaction(() => {
      const row = this.sqlite.query(`
        SELECT t.id, t.project_id FROM taskboard_tasks t
        JOIN taskboard_task_threads l ON l.task_id = t.id
        WHERE l.thread_id = ? AND l.role = 'primary' AND t.archived_at IS NULL
          AND t.status IN ('backlog','todo')
      `).get(threadId) as { id: string; project_id: string } | null
      if (!row) return null
      this.sqlite.query(`UPDATE taskboard_tasks SET status = 'in_progress', version = version + 1, updated_at = ? WHERE id = ?`).run(changedAt, row.id)
      this.recordActivity({ taskId: row.id, kind: "task_moved", actor: "system", sourceThreadId: threadId, data: { status: "in_progress" }, createdAt: changedAt })
      return {
        task: this.readTask(row.id)!,
        event: this.insertTaskboardChanged({ projectId: row.project_id, taskId: row.id, resource: "task", action: "updated", changedAt }),
      }
    })
  }
}

export type TaskboardRepository = TaskboardRepositoryDatabase
export const taskboardRepository = (database: TaskboardRepositoryDatabase): TaskboardRepository => database

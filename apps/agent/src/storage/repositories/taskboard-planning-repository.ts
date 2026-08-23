import type {
  TaskboardBlocker,
  TaskboardPlanAggregate,
  TaskboardPlanBreadcrumb,
  TaskboardPlanDependency,
  TaskboardPlanItem,
  TaskboardPlanPrerequisite,
  TaskboardPlanningRoot,
  TaskboardPlanningSnapshot,
  TaskboardPriority,
  TaskboardWorkflowStatus,
} from "@codepilotx/shared/taskboard"
import {
  TASKBOARD_DESCRIPTION_MAX_LENGTH,
  TASKBOARD_COMMENT_MAX_LENGTH,
  TASKBOARD_POSITION_GAP,
  TASKBOARD_TITLE_MAX_LENGTH,
} from "@codepilotx/shared/taskboard"
import { AgentError, type EventEnvelope } from "../../domain"
import type { TaskboardRepository } from "./taskboard-repository"

type PlanRow = {
  id: string
  parent_task_id: string
  item_type: "step" | "task"
  child_task_id: string | null
  step_title: string | null
  step_description: string | null
  step_status: "todo" | "done" | "skipped" | "promoted" | null
  skip_reason: string | null
  position: number
  version: number
  ready_notified_at: number | null
  ready_read_at: number | null
  created_at: number
  updated_at: number
}

type TaskIdentity = {
  id: string
  project_id: string
  number: number
  title: string
  version: number
  archived_at: number | null
}

type BlockerRow = {
  id: string
  task_id: string
  plan_item_id: string | null
  reason: string
  status: "open" | "resolved"
  source_thread_id: string | null
  source_turn_id: string | null
  resolution: string | null
  version: number
  created_at: number
  resolved_at: number | null
  updated_at: number
}

const planNotFound = () => new AgentError("TASKBOARD_PLAN_NOT_FOUND", "计划项不存在", 404)
const blockerNotFound = () => new AgentError("TASKBOARD_BLOCKER_NOT_FOUND", "阻碍不存在", 404)
const versionConflict = () => new AgentError("TASKBOARD_PLAN_VERSION_CONFLICT", "计划已在其他窗口更新", 409)
const invalidParent = () => new AgentError("TASKBOARD_PLAN_INVALID_PARENT", "父子任务关系无效", 400)
const cycle = () => new AgentError("TASKBOARD_PLAN_CYCLE", "计划关系不能形成循环", 400)

export type PlanningApplyItem =
  | { clientId: string; kind: "step"; title: string; description?: string; position?: number }
  | {
      clientId: string
      kind: "task"
      title: string
      description?: string
      status?: TaskboardWorkflowStatus
      priority?: TaskboardPriority
      labelIds?: readonly string[]
      startDate?: string | null
      dueDate?: string | null
      position?: number
    }

export class TaskboardPlanningRepository {
  constructor(readonly taskboard: TaskboardRepository) {}

  private get sqlite() { return this.taskboard.sqlite }

  private task(taskId: string): TaskIdentity {
    const row = this.sqlite.query(`
      SELECT id, project_id, number, title, version, archived_at
      FROM taskboard_tasks WHERE id = ?
    `).get(taskId) as TaskIdentity | null
    if (!row) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    return row
  }

  private row(itemId: string): PlanRow {
    const row = this.sqlite.query("SELECT * FROM taskboard_plan_items WHERE id = ?").get(itemId) as PlanRow | null
    if (!row) throw planNotFound()
    return row
  }

  private rows(parentTaskId: string): PlanRow[] {
    return this.sqlite.query(`
      SELECT * FROM taskboard_plan_items WHERE parent_task_id = ? ORDER BY position, id
    `).all(parentTaskId) as PlanRow[]
  }

  private blocker(row: BlockerRow): TaskboardBlocker {
    return {
      id: row.id,
      taskId: row.task_id,
      planItemId: row.plan_item_id,
      reason: row.reason,
      status: row.status,
      sourceThreadId: row.source_thread_id,
      sourceTurnId: row.source_turn_id,
      resolution: row.resolution,
      version: row.version,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      updatedAt: row.updated_at,
    }
  }

  private dependencyRows(parentTaskId: string): TaskboardPlanDependency[] {
    return this.sqlite.query(`
      SELECT d.dependent_item_id, d.prerequisite_item_id
      FROM taskboard_plan_dependencies d
      JOIN taskboard_plan_items i ON i.id = d.dependent_item_id
      WHERE i.parent_task_id = ?
      ORDER BY d.dependent_item_id, d.prerequisite_item_id
    `).all(parentTaskId).map((row: any) => ({
      dependentItemId: row.dependent_item_id,
      prerequisiteItemId: row.prerequisite_item_id,
    }))
  }

  private prerequisite(row: PlanRow): TaskboardPlanPrerequisite {
    if (row.item_type === "step") {
      return {
        id: row.id,
        kind: "step",
        title: row.step_title ?? "",
        satisfied: row.step_status === "done" || row.step_status === "skipped",
      }
    }
    const task = this.taskboard.readWorkflowTask(row.child_task_id!)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "子任务不存在", 404)
    return {
      id: row.id,
      kind: "task",
      title: task.task.title,
      satisfied: task.task.status === "done" || task.task.status === "canceled",
    }
  }

  private prerequisites(itemId: string): TaskboardPlanPrerequisite[] {
    const rows = this.sqlite.query(`
      SELECT p.* FROM taskboard_plan_dependencies d
      JOIN taskboard_plan_items p ON p.id = d.prerequisite_item_id
      WHERE d.dependent_item_id = ? ORDER BY p.position, p.id
    `).all(itemId) as PlanRow[]
    return rows.map((row) => this.prerequisite(row))
  }

  private item(row: PlanRow): TaskboardPlanItem {
    const prerequisites = this.prerequisites(row.id)
    const readiness = prerequisites.some(({ satisfied }) => !satisfied)
      ? { status: "waiting" as const, prerequisites }
      : { status: "ready" as const }
    const base = {
      id: row.id,
      parentTaskId: row.parent_task_id,
      position: row.position,
      readiness,
      unreadReady: row.ready_notified_at !== null && row.ready_read_at === null,
      version: row.version,
    }
    if (row.item_type === "step") {
      return {
        kind: "step",
        ...base,
        title: row.step_title ?? "",
        description: row.step_description ?? "",
        status: row.step_status === "done" || row.step_status === "skipped" ? row.step_status : "todo",
        skipReason: row.skip_reason,
      }
    }
    const child = this.taskboard.readWorkflowTask(row.child_task_id!)
    if (!child) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "子任务不存在", 404)
    return {
      kind: "task",
      ...base,
      childTask: { ...child.task, threads: child.threads },
      promotedFromStep: row.step_status === "promoted" && row.step_title
        ? { title: row.step_title, description: row.step_description ?? "" }
        : null,
    }
  }

  private aggregate(taskId: string): TaskboardPlanAggregate {
    const direct = this.rows(taskId)
    const descendants = this.sqlite.query(`
      WITH RECURSIVE tree(id) AS (
        SELECT child_task_id FROM taskboard_plan_items WHERE parent_task_id = ? AND item_type = 'task'
        UNION ALL
        SELECT p.child_task_id FROM taskboard_plan_items p JOIN tree t ON p.parent_task_id = t.id
        WHERE p.item_type = 'task'
      ) SELECT id FROM tree
    `).all(taskId) as Array<{ id: string }>
    const taskIds = [taskId, ...descendants.map(({ id }) => id)]
    const blockerCount = Number((this.sqlite.query(`
      SELECT COUNT(*) AS count FROM taskboard_blockers
      WHERE status = 'open' AND task_id IN (${taskIds.map(() => "?").join(",")})
    `).get(...taskIds) as { count: number }).count)
    const readyUnreadCount = Number((this.sqlite.query(`
      SELECT COUNT(*) AS count FROM taskboard_plan_items
      WHERE parent_task_id IN (${taskIds.map(() => "?").join(",")})
        AND ready_notified_at IS NOT NULL AND ready_read_at IS NULL
    `).get(...taskIds) as { count: number }).count)
    return {
      directTotal: direct.length,
      directDone: direct.filter((row) => row.item_type === "step"
        ? row.step_status === "done"
        : ["done", "canceled"].includes(this.taskboard.readWorkflowTask(row.child_task_id!)!.task.status)).length,
      directSkipped: direct.filter((row) => row.item_type === "step" && row.step_status === "skipped").length,
      descendantTaskCount: descendants.length,
      openBlockerCount: blockerCount,
      readyUnreadCount,
    }
  }

  listRoots(input: Parameters<TaskboardRepository["listWorkflowTasks"]>[0] = {}): {
    roots: TaskboardPlanningRoot[]
    unreadCount: number
    nextCursor: string | null
  } {
    const requestedLimit = Math.max(1, Math.min(input.limit ?? 200, 500))
    const requestedOffset = input.cursor?.startsWith("offset:") ? Number(input.cursor.slice(7)) : 0
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
    const tasks: ReturnType<TaskboardRepository["listWorkflowTasks"]>["tasks"] = []
    let cursor: string | undefined
    do {
      const { cursor: _ignoredCursor, limit: _ignoredLimit, ...filters } = input
      const page = this.taskboard.listWorkflowTasks({ ...filters, ...(cursor ? { cursor } : {}), limit: 500 })
      tasks.push(...page.tasks)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const allRoots = tasks
      .filter((task) => !this.sqlite.query("SELECT 1 FROM taskboard_plan_items WHERE child_task_id = ?").get(task.id))
      .map((task) => ({ task, aggregate: this.aggregate(task.id) }))
    const roots = allRoots.slice(offset, offset + requestedLimit)
    return {
      roots,
      unreadCount: allRoots.filter(({ task }) => task.attention.unread).length,
      nextCursor: offset + requestedLimit < allRoots.length ? `offset:${offset + requestedLimit}` : null,
    }
  }

  read(taskId: string): TaskboardPlanningSnapshot {
    const task = this.taskboard.readWorkflowTask(taskId)
    if (!task) throw new AgentError("TASKBOARD_TASK_NOT_FOUND", "任务不存在", 404)
    const breadcrumbs: TaskboardPlanBreadcrumb[] = []
    let cursor: TaskIdentity | null = this.task(taskId)
    while (cursor) {
      breadcrumbs.unshift({ taskId: cursor.id, number: cursor.number, title: cursor.title })
      const parent = this.sqlite.query(`
        SELECT t.id, t.project_id, t.number, t.title, t.version, t.archived_at
        FROM taskboard_plan_items p JOIN taskboard_tasks t ON t.id = p.parent_task_id
        WHERE p.child_task_id = ?
      `).get(cursor.id) as TaskIdentity | null
      cursor = parent
    }
    return {
      task,
      breadcrumbs,
      items: this.rows(taskId).map((row) => this.item(row)),
      dependencies: this.dependencyRows(taskId),
      blockers: (this.sqlite.query(`
        SELECT * FROM taskboard_blockers WHERE task_id = ? ORDER BY status, created_at, id
      `).all(taskId) as BlockerRow[]).map((row) => this.blocker(row)),
      aggregate: this.aggregate(taskId),
    }
  }

  assertTaskVersion(taskId: string, expectedVersion: number) {
    if (this.task(taskId).version !== expectedVersion) throw versionConflict()
  }

  projectIdForTask(taskId: string) { return this.task(taskId).project_id }

  assertTaskPlanningMutable(taskId: string) {
    if (this.task(taskId).archived_at !== null) throw new AgentError("CONFLICT", "已归档任务只能恢复或永久删除", 409)
  }

  assertTaskReady(taskId: string) {
    const row = this.sqlite.query("SELECT * FROM taskboard_plan_items WHERE child_task_id = ?").get(taskId) as PlanRow | null
    if (!row) return
    const waiting = this.prerequisites(row.id).filter(({ satisfied }) => !satisfied)
    if (waiting.length === 0) return
    const labels = waiting.map(({ id, title }) => `${id}:${title}`).join("、")
    throw new AgentError(
      "TASKBOARD_PLAN_CONDITION_UNMET",
      `任务前置条件尚未满足：${labels}`,
      409,
      { prerequisites: waiting.map(({ id, title }) => ({ id, title })) },
    )
  }

  refreshAfterTaskStatus(taskId: string, timestamp: number): EventEnvelope {
    const row = this.sqlite.query("SELECT * FROM taskboard_plan_items WHERE child_task_id = ?").get(taskId) as PlanRow | null
    if (row) this.refreshReadiness(row.parent_task_id, timestamp)
    return this.insertPlanningChanged({
      projectId: this.projectIdForTask(taskId),
      rootTaskId: this.rootTaskId(taskId),
      changedTaskId: taskId,
      changedAt: timestamp,
    })
  }

  parentTaskIdForItem(itemId: string) { return this.row(itemId).parent_task_id }

  taskIdForBlocker(blockerId: string) {
    const row = this.sqlite.query("SELECT task_id FROM taskboard_blockers WHERE id = ?").get(blockerId) as { task_id: string } | null
    if (!row) throw blockerNotFound()
    return row.task_id
  }

  private nextPosition(parentTaskId: string) {
    const row = this.sqlite.query("SELECT MAX(position) AS position FROM taskboard_plan_items WHERE parent_task_id = ?")
      .get(parentTaskId) as { position: number | null }
    return (row.position ?? 0) + TASKBOARD_POSITION_GAP
  }

  apply(input: {
    parentTaskId: string
    expectedVersion: number
    items: readonly PlanningApplyItem[]
    dependencies?: readonly { dependentClientId: string; prerequisiteClientId: string }[]
    timestamp: number
  }): TaskboardPlanningSnapshot {
    const parent = this.task(input.parentTaskId)
    if (parent.version !== input.expectedVersion) throw versionConflict()
    const clientIds = new Set(input.items.map(({ clientId }) => clientId))
    if (clientIds.size !== input.items.length) throw new AgentError("INVALID_REQUEST", "计划项 clientId 不能重复", 400)
    for (const dependency of input.dependencies ?? []) {
      if (!clientIds.has(dependency.dependentClientId) || !clientIds.has(dependency.prerequisiteClientId)) {
        throw new AgentError("INVALID_REQUEST", "依赖只能引用本次提交的计划项", 400)
      }
      if (dependency.dependentClientId === dependency.prerequisiteClientId) throw cycle()
    }
    this.assertAcyclic(input.items.map(({ clientId }) => clientId), (input.dependencies ?? []).map((d) => [d.dependentClientId, d.prerequisiteClientId]))
    let next = this.nextPosition(input.parentTaskId)
    const ids = new Map<string, string>()
    for (const item of input.items) {
      const id = crypto.randomUUID()
      ids.set(item.clientId, id)
      const position = item.position ?? next
      next = Math.max(next + TASKBOARD_POSITION_GAP, position + TASKBOARD_POSITION_GAP)
      if (item.kind === "step") {
        const title = item.title.trim()
        if (!title || title.length > TASKBOARD_TITLE_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "步骤标题长度无效", 400)
        if ((item.description ?? "").length > TASKBOARD_DESCRIPTION_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "步骤描述过长", 400)
        this.sqlite.query(`
          INSERT INTO taskboard_plan_items (
            id, parent_task_id, item_type, child_task_id, step_title, step_description,
            step_status, skip_reason, position, version, ready_notified_at, ready_read_at, created_at, updated_at
          ) VALUES (?, ?, 'step', NULL, ?, ?, 'todo', NULL, ?, 1, NULL, NULL, ?, ?)
        `).run(id, input.parentTaskId, title, item.description ?? "", position, input.timestamp, input.timestamp)
      } else {
        const child = this.taskboard.createWorkflowTask({
          projectId: parent.project_id,
          title: item.title,
          description: item.description ?? "",
          status: item.status ?? "backlog",
          priority: item.priority ?? "none",
          labelIds: item.labelIds ?? [],
          startDate: item.startDate ?? null,
          dueDate: item.dueDate ?? null,
          createdAt: input.timestamp,
        })
        this.sqlite.query(`
          INSERT INTO taskboard_plan_items (
            id, parent_task_id, item_type, child_task_id, step_title, step_description,
            step_status, skip_reason, position, version, ready_notified_at, ready_read_at, created_at, updated_at
          ) VALUES (?, ?, 'task', ?, NULL, NULL, NULL, NULL, ?, 1, NULL, NULL, ?, ?)
        `).run(id, input.parentTaskId, child.task.id, position, input.timestamp, input.timestamp)
      }
    }
    for (const dependency of input.dependencies ?? []) {
      this.sqlite.query(`
        INSERT INTO taskboard_plan_dependencies (dependent_item_id, prerequisite_item_id, created_at)
        VALUES (?, ?, ?)
      `).run(ids.get(dependency.dependentClientId)!, ids.get(dependency.prerequisiteClientId)!, input.timestamp)
    }
    this.bumpTask(input.parentTaskId, input.timestamp)
    return this.read(input.parentTaskId)
  }

  updateStep(input: {
    itemId: string
    expectedVersion: number
    patch: { title?: string; description?: string; status?: "todo" | "done" | "skipped"; skipReason?: string | null }
    timestamp: number
  }): TaskboardPlanningSnapshot {
    const current = this.row(input.itemId)
    if (current.item_type !== "step") throw new AgentError("INVALID_REQUEST", "只有轻量步骤可以这样更新", 400)
    if (current.version !== input.expectedVersion) throw versionConflict()
    if (!Object.values(input.patch).some(value => value !== undefined)) throw new AgentError("INVALID_REQUEST", "步骤更新缺少字段", 400)
    const nextTitle = input.patch.title === undefined ? current.step_title : input.patch.title.trim()
    const nextDescription = input.patch.description ?? current.step_description
    if (!nextTitle || nextTitle.length > TASKBOARD_TITLE_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "步骤标题长度无效", 400)
    if ((nextDescription ?? "").length > TASKBOARD_DESCRIPTION_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "步骤描述过长", 400)
    const status = input.patch.status ?? (current.step_status as "todo" | "done" | "skipped")
    const skipReason = input.patch.skipReason === undefined ? current.skip_reason : input.patch.skipReason
    if (status === "skipped" && !skipReason?.trim()) throw new AgentError("INVALID_REQUEST", "跳过步骤必须填写原因", 400)
    const result = this.sqlite.query(`
      UPDATE taskboard_plan_items SET step_title = ?, step_description = ?, step_status = ?,
        skip_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `).run(
      nextTitle,
      nextDescription,
      status,
      status === "skipped" ? skipReason!.trim() : null,
      input.timestamp,
      input.itemId,
      input.expectedVersion,
    )
    if (result.changes === 0) throw versionConflict()
    this.refreshReadiness(current.parent_task_id, input.timestamp)
    this.bumpTask(current.parent_task_id, input.timestamp)
    return this.read(current.parent_task_id)
  }

  promoteStep(input: {
    itemId: string
    expectedVersion: number
    task: { status?: TaskboardWorkflowStatus; priority?: TaskboardPriority; labelIds?: readonly string[]; startDate?: string | null; dueDate?: string | null }
    timestamp: number
  }): TaskboardPlanningSnapshot {
    const current = this.row(input.itemId)
    if (current.item_type !== "step") throw new AgentError("INVALID_REQUEST", "只有轻量步骤可以升级", 400)
    if (current.version !== input.expectedVersion) throw versionConflict()
    const parent = this.task(current.parent_task_id)
    const child = this.taskboard.createWorkflowTask({
      projectId: parent.project_id,
      title: current.step_title!,
      description: current.step_description ?? "",
      ...input.task,
      createdAt: input.timestamp,
    })
    this.sqlite.query(`
      UPDATE taskboard_plan_items SET item_type = 'task', child_task_id = ?, step_status = 'promoted',
        skip_reason = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `).run(child.task.id, input.timestamp, input.itemId, input.expectedVersion)
    this.bumpTask(current.parent_task_id, input.timestamp)
    return this.read(current.parent_task_id)
  }

  reorder(input: { itemId: string; expectedVersion: number; beforeItemId?: string | null; afterItemId?: string | null; timestamp: number }) {
    const current = this.row(input.itemId)
    if (current.version !== input.expectedVersion) throw versionConflict()
    const peers = this.rows(current.parent_task_id).filter(({ id }) => id !== current.id)
    let insertion = peers.length
    if (input.afterItemId) {
      insertion = peers.findIndex(({ id }) => id === input.afterItemId)
      if (insertion < 0) throw new AgentError("INVALID_REQUEST", "afterItemId 不属于当前任务", 400)
    } else if (input.beforeItemId) {
      const index = peers.findIndex(({ id }) => id === input.beforeItemId)
      if (index < 0) throw new AgentError("INVALID_REQUEST", "beforeItemId 不属于当前任务", 400)
      insertion = index + 1
    }
    if (input.beforeItemId && input.afterItemId) {
      const before = peers.findIndex(({ id }) => id === input.beforeItemId)
      const after = peers.findIndex(({ id }) => id === input.afterItemId)
      if (before < 0 || after !== before + 1) throw new AgentError("INVALID_REQUEST", "排序锚点不相邻", 400)
      insertion = after
    }
    const order = peers.map(({ id }) => id)
    order.splice(insertion, 0, current.id)
    order.forEach((id, index) => this.sqlite.query(`
      UPDATE taskboard_plan_items SET position = ?, version = version + 1, updated_at = ? WHERE id = ?
    `).run((index + 1) * TASKBOARD_POSITION_GAP, input.timestamp, id))
    this.bumpTask(current.parent_task_id, input.timestamp)
    return this.read(current.parent_task_id)
  }

  reparent(input: {
    childTaskId: string
    expectedVersion: number
    parentTaskId: string | null
    beforeItemId?: string | null
    afterItemId?: string | null
    timestamp: number
  }) {
    const child = this.task(input.childTaskId)
    if (child.version !== input.expectedVersion) throw versionConflict()
    const existing = this.sqlite.query("SELECT * FROM taskboard_plan_items WHERE child_task_id = ?")
      .get(input.childTaskId) as PlanRow | null
    if (input.parentTaskId === null) {
      if (existing) this.sqlite.query("DELETE FROM taskboard_plan_items WHERE id = ?").run(existing.id)
      this.bumpTask(input.childTaskId, input.timestamp)
      if (existing) this.bumpTask(existing.parent_task_id, input.timestamp)
      return { childTaskId: input.childTaskId, parentTaskId: null }
    }
    const parent = this.task(input.parentTaskId)
    if (parent.archived_at !== null) throw new AgentError("CONFLICT", "不能把子任务挂到已归档任务", 409)
    if (parent.project_id !== child.project_id || parent.id === child.id) throw invalidParent()
    const descendants = this.descendantTaskIds(child.id)
    if (descendants.includes(parent.id)) throw cycle()
    const oldParent = existing?.parent_task_id ?? null
    let itemId: string
    if (existing) {
      itemId = existing.id
      if (oldParent !== parent.id) {
        this.sqlite.query("DELETE FROM taskboard_plan_dependencies WHERE dependent_item_id = ? OR prerequisite_item_id = ?")
          .run(existing.id, existing.id)
      }
      this.sqlite.query(`UPDATE taskboard_plan_items SET parent_task_id = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ?`)
        .run(parent.id, this.nextPosition(parent.id), input.timestamp, existing.id)
    } else {
      itemId = crypto.randomUUID()
      this.sqlite.query(`
        INSERT INTO taskboard_plan_items (
          id, parent_task_id, item_type, child_task_id, step_title, step_description, step_status,
          skip_reason, position, version, ready_notified_at, ready_read_at, created_at, updated_at
        ) VALUES (?, ?, 'task', ?, NULL, NULL, NULL, NULL, ?, 1, NULL, NULL, ?, ?)
      `).run(itemId, parent.id, child.id, this.nextPosition(parent.id), input.timestamp, input.timestamp)
    }
    this.reorderAttached(itemId, parent.id, input.beforeItemId, input.afterItemId, input.timestamp)
    this.bumpTask(child.id, input.timestamp)
    this.bumpTask(parent.id, input.timestamp)
    if (oldParent && oldParent !== parent.id) this.bumpTask(oldParent, input.timestamp)
    return { childTaskId: child.id, parentTaskId: parent.id }
  }

  setDependencies(input: { itemId: string; expectedVersion: number; prerequisiteItemIds: readonly string[]; timestamp: number }) {
    const current = this.row(input.itemId)
    if (current.version !== input.expectedVersion) throw versionConflict()
    const wasWaiting = this.prerequisites(current.id).some(({ satisfied }) => !satisfied)
    const ids = [...new Set(input.prerequisiteItemIds)]
    for (const id of ids) {
      const prerequisite = this.row(id)
      if (id === current.id || prerequisite.parent_task_id !== current.parent_task_id) throw cycle()
    }
    const siblingIds = this.rows(current.parent_task_id).map(({ id }) => id)
    const existing = this.dependencyRows(current.parent_task_id)
      .filter(({ dependentItemId }) => dependentItemId !== current.id)
      .map(({ dependentItemId, prerequisiteItemId }) => [dependentItemId, prerequisiteItemId] as [string, string])
    this.assertAcyclic(siblingIds, [...existing, ...ids.map((id) => [current.id, id] as [string, string])])
    this.sqlite.query("DELETE FROM taskboard_plan_dependencies WHERE dependent_item_id = ?").run(current.id)
    for (const id of ids) this.sqlite.query(`
      INSERT INTO taskboard_plan_dependencies (dependent_item_id, prerequisite_item_id, created_at) VALUES (?, ?, ?)
    `).run(current.id, id, input.timestamp)
    this.sqlite.query(`UPDATE taskboard_plan_items SET version = version + 1, ready_notified_at = NULL, ready_read_at = NULL, updated_at = ? WHERE id = ?`)
      .run(input.timestamp, current.id)
    if (wasWaiting) this.refreshReadiness(current.parent_task_id, input.timestamp)
    this.bumpTask(current.parent_task_id, input.timestamp)
    return this.read(current.parent_task_id)
  }

  createBlocker(input: { taskId: string; planItemId?: string | null; reason: string; sourceThreadId?: string | null; sourceTurnId?: string | null; timestamp: number }) {
    const task = this.task(input.taskId)
    if (input.planItemId) {
      const item = this.row(input.planItemId)
      if (item.parent_task_id !== input.taskId || item.item_type !== "step") {
        throw new AgentError("INVALID_REQUEST", "阻碍只能关联当前任务的轻量步骤", 400)
      }
    }
    let sourceThreadId = input.sourceThreadId ?? null
    if (input.sourceTurnId) {
      const turn = this.sqlite.query(`
        SELECT u.thread_id, t.project_id FROM turns u JOIN threads t ON t.id = u.thread_id WHERE u.id = ?
      `).get(input.sourceTurnId) as { thread_id: string; project_id: string | null } | null
      if (!turn) throw new AgentError("INVALID_REQUEST", "来源 Turn 不存在", 400)
      if (sourceThreadId && sourceThreadId !== turn.thread_id) throw new AgentError("INVALID_REQUEST", "来源 Turn 与会话不匹配", 400)
      if (turn.project_id !== task.project_id) throw new AgentError("INVALID_REQUEST", "阻碍来源与任务不属于同一项目", 400)
      sourceThreadId = turn.thread_id
    } else if (sourceThreadId) {
      const thread = this.sqlite.query("SELECT project_id FROM threads WHERE id = ?").get(sourceThreadId) as { project_id: string | null } | null
      if (!thread) throw new AgentError("THREAD_NOT_FOUND", "来源会话不存在", 404)
      if (thread.project_id !== task.project_id) throw new AgentError("INVALID_REQUEST", "阻碍来源与任务不属于同一项目", 400)
    }
    const reason = input.reason.trim()
    if (!reason || reason.length > TASKBOARD_COMMENT_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "阻碍原因长度无效", 400)
    const id = crypto.randomUUID()
    this.sqlite.query(`
      INSERT INTO taskboard_blockers (
        id, task_id, plan_item_id, reason, status, source_thread_id, source_turn_id,
        resolution, version, created_at, resolved_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, 1, ?, NULL, ?)
    `).run(id, input.taskId, input.planItemId ?? null, reason, sourceThreadId, input.sourceTurnId ?? null, input.timestamp, input.timestamp)
    const row = this.sqlite.query("SELECT * FROM taskboard_blockers WHERE id = ?").get(id) as BlockerRow
    return this.blocker(row)
  }

  resolveBlocker(input: { blockerId: string; expectedVersion: number; resolution: string; timestamp: number }) {
    const current = this.sqlite.query("SELECT * FROM taskboard_blockers WHERE id = ?").get(input.blockerId) as BlockerRow | null
    if (!current) throw blockerNotFound()
    if (current.version !== input.expectedVersion) throw versionConflict()
    if (current.status === "resolved") throw new AgentError("INVALID_REQUEST", "阻碍已经解决", 400)
    const resolution = input.resolution.trim()
    if (!resolution || resolution.length > TASKBOARD_COMMENT_MAX_LENGTH) throw new AgentError("INVALID_REQUEST", "解决说明长度无效", 400)
    this.sqlite.query(`
      UPDATE taskboard_blockers SET status = 'resolved', resolution = ?, resolved_at = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND version = ?
    `).run(resolution, input.timestamp, input.timestamp, input.blockerId, input.expectedVersion)
    return this.blocker(this.sqlite.query("SELECT * FROM taskboard_blockers WHERE id = ?").get(input.blockerId) as BlockerRow)
  }

  markRead(input: { taskId: string; itemId?: string; expectedReadyNotifiedAt?: number; timestamp: number }) {
    this.task(input.taskId)
    const clause = input.itemId ? "id = ? AND parent_task_id = ?" : "parent_task_id = ?"
    const args: Array<string | number> = input.itemId ? [input.itemId, input.taskId] : [input.taskId]
    if (input.expectedReadyNotifiedAt !== undefined) {
      this.sqlite.query(`UPDATE taskboard_plan_items SET ready_read_at = ?, updated_at = ? WHERE ${clause} AND ready_notified_at = ?`)
        .run(input.timestamp, input.timestamp, ...args, input.expectedReadyNotifiedAt)
    } else {
      this.sqlite.query(`UPDATE taskboard_plan_items SET ready_read_at = ?, updated_at = ? WHERE ${clause} AND ready_notified_at IS NOT NULL AND ready_read_at IS NULL`)
        .run(input.timestamp, input.timestamp, ...args)
    }
    return this.read(input.taskId)
  }

  archiveTree(input: { rootTaskId: string; expectedVersion: number; includeLinkedThreads?: boolean; timestamp: number }) {
    const root = this.task(input.rootTaskId)
    if (root.version !== input.expectedVersion) throw versionConflict()
    const treeTaskIds = [root.id, ...this.descendantTaskIds(root.id)]
    const taskIds = treeTaskIds.filter((id) => this.task(id).archived_at === null)
    const batchId = crypto.randomUUID()
    this.sqlite.query(`INSERT INTO taskboard_archive_batches (id, root_task_id, include_linked_threads, created_at, restored_at) VALUES (?, ?, ?, ?, NULL)`)
      .run(batchId, root.id, input.includeLinkedThreads ? 1 : 0, input.timestamp)
    for (const taskId of taskIds) {
      this.sqlite.query("INSERT INTO taskboard_archive_batch_tasks (batch_id, task_id) VALUES (?, ?)").run(batchId, taskId)
      this.sqlite.query("UPDATE taskboard_tasks SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND archived_at IS NULL")
        .run(input.timestamp, input.timestamp, taskId)
      this.sqlite.query("UPDATE taskboard_task_attention SET unread = 0, unread_at = NULL, read_at = ?, reason = NULL, updated_at = ? WHERE task_id = ?")
        .run(input.timestamp, input.timestamp, taskId)
    }
    if (input.includeLinkedThreads && treeTaskIds.length > 0) this.sqlite.query(`
      UPDATE threads SET archived_at = ?, updated_at = ? WHERE id IN (
        SELECT thread_id FROM taskboard_task_threads WHERE task_id IN (${treeTaskIds.map(() => "?").join(",")})
      ) AND archived_at IS NULL
    `).run(input.timestamp, input.timestamp, ...treeTaskIds)
    return { batchId, taskIds }
  }

  restoreTree(input: { rootTaskId: string; timestamp: number }) {
    this.task(input.rootTaskId)
    const batch = this.sqlite.query(`
      SELECT id FROM taskboard_archive_batches
      WHERE root_task_id = ? AND restored_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(input.rootTaskId) as { id: string } | null
    if (!batch) throw new AgentError("TASKBOARD_PLAN_NOT_FOUND", "没有可恢复的任务树归档批次", 404)
    const taskIds = (this.sqlite.query("SELECT task_id FROM taskboard_archive_batch_tasks WHERE batch_id = ? ORDER BY task_id")
      .all(batch.id) as Array<{ task_id: string }>).map(({ task_id }) => task_id)
    for (const taskId of taskIds) this.sqlite.query(`
      UPDATE taskboard_tasks SET archived_at = NULL, version = version + 1, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL
    `).run(input.timestamp, taskId)
    this.sqlite.query("UPDATE taskboard_archive_batches SET restored_at = ? WHERE id = ?").run(input.timestamp, batch.id)
    return { batchId: batch.id, taskIds }
  }

  deleteTree(rootTaskId: string, timestamp: number) {
    this.task(rootTaskId)
    const directParent = this.sqlite.query("SELECT parent_task_id FROM taskboard_plan_items WHERE child_task_id = ?")
      .get(rootTaskId) as { parent_task_id: string } | null
    const taskIds = [rootTaskId, ...this.descendantTaskIds(rootTaskId)]
    if (taskIds.some((id) => this.task(id).archived_at === null)) {
      throw new AgentError("INVALID_REQUEST", "只有整棵任务树都已归档才能永久删除", 400)
    }
    this.sqlite.query(`DELETE FROM taskboard_plan_items WHERE parent_task_id IN (${taskIds.map(() => "?").join(",")}) OR child_task_id IN (${taskIds.map(() => "?").join(",")})`)
      .run(...taskIds, ...taskIds)
    const deletedTaskIds = [...taskIds].reverse()
    for (const taskId of deletedTaskIds) this.sqlite.query("DELETE FROM taskboard_tasks WHERE id = ? AND archived_at IS NOT NULL").run(taskId)
    if (directParent) {
      this.bumpTask(directParent.parent_task_id, timestamp)
      this.refreshReadiness(directParent.parent_task_id, timestamp)
    }
    return { deletedTaskIds }
  }

  insertPlanningChanged(input: { projectId: string; rootTaskId: string; changedTaskId: string; changedAt: number }): EventEnvelope {
    return this.taskboard.insertEvent(null, null, "taskboard/planning/changed", input)
  }

  insertArchiveEvents(input: { projectId: string; rootTaskId: string; taskIds: readonly string[]; includeLinkedThreads: boolean; timestamp: number }) {
    const events: EventEnvelope[] = []
    for (const taskId of input.taskIds) {
      events.push(this.taskboard.insertTaskboardChanged({ projectId: input.projectId, taskId, resource: "task", action: "archived", changedAt: input.timestamp }))
      events.push(this.taskboard.insertTaskboardWorkflowChanged({ projectId: input.projectId, taskId, resource: "workflow", action: "updated", changedAt: input.timestamp }))
    }
    if (input.includeLinkedThreads) {
      const treeTaskIds = [input.rootTaskId, ...this.descendantTaskIds(input.rootTaskId)]
      const threads = this.sqlite.query(`
        SELECT DISTINCT t.id FROM threads t JOIN taskboard_task_threads l ON l.thread_id = t.id
        WHERE l.task_id IN (${treeTaskIds.map(() => "?").join(",")}) AND t.archived_at = ?
      `).all(...treeTaskIds, input.timestamp) as Array<{ id: string }>
      for (const { id } of threads) events.push(this.taskboard.insertEvent(id, null, "thread/updated", {
        threadId: id,
        patch: { archived: true },
        updatedAt: input.timestamp,
      }))
    }
    return events
  }

  insertRestoreEvents(input: { projectId: string; taskIds: readonly string[]; timestamp: number }) {
    return input.taskIds.flatMap((taskId) => [
      this.taskboard.insertTaskboardChanged({ projectId: input.projectId, taskId, resource: "task", action: "restored", changedAt: input.timestamp }),
      this.taskboard.insertTaskboardWorkflowChanged({ projectId: input.projectId, taskId, resource: "workflow", action: "updated", changedAt: input.timestamp }),
    ])
  }

  insertDeleteEvents(input: { projectId: string; taskIds: readonly string[]; timestamp: number }) {
    return input.taskIds.flatMap((taskId) => [
      this.taskboard.insertTaskboardChanged({ projectId: input.projectId, taskId, resource: "task", action: "deleted", changedAt: input.timestamp }),
      this.taskboard.insertTaskboardWorkflowChanged({ projectId: input.projectId, taskId, resource: "workflow", action: "deleted", changedAt: input.timestamp }),
    ])
  }

  rootTaskId(taskId: string) {
    let current = taskId
    while (true) {
      const row = this.sqlite.query("SELECT parent_task_id FROM taskboard_plan_items WHERE child_task_id = ?")
        .get(current) as { parent_task_id: string } | null
      if (!row) return current
      current = row.parent_task_id
    }
  }

  private refreshReadiness(parentTaskId: string, timestamp: number) {
    for (const row of this.rows(parentTaskId)) {
      const dependencies = this.prerequisites(row.id)
      if (dependencies.length > 0 && dependencies.every(({ satisfied }) => satisfied) && row.ready_notified_at === null) {
        this.sqlite.query(`UPDATE taskboard_plan_items SET ready_notified_at = ?, ready_read_at = NULL, updated_at = ? WHERE id = ?`)
          .run(timestamp, timestamp, row.id)
      } else if (dependencies.some(({ satisfied }) => !satisfied) && row.ready_notified_at !== null) {
        this.sqlite.query(`UPDATE taskboard_plan_items SET ready_notified_at = NULL, ready_read_at = NULL, updated_at = ? WHERE id = ?`)
          .run(timestamp, row.id)
      }
    }
  }

  refreshForChildTask(childTaskId: string, timestamp: number) {
    const parent = this.sqlite.query("SELECT parent_task_id FROM taskboard_plan_items WHERE child_task_id = ?")
      .get(childTaskId) as { parent_task_id: string } | null
    if (parent) this.refreshReadiness(parent.parent_task_id, timestamp)
  }

  unmetPrerequisitesForTask(taskId: string) {
    const item = this.sqlite.query("SELECT id FROM taskboard_plan_items WHERE child_task_id = ?")
      .get(taskId) as { id: string } | null
    return item ? this.prerequisites(item.id).filter(({ satisfied }) => !satisfied) : []
  }

  private reorderAttached(itemId: string, parentTaskId: string, beforeItemId: string | null | undefined, afterItemId: string | null | undefined, timestamp: number) {
    if (!beforeItemId && !afterItemId) return
    const peers = this.rows(parentTaskId).filter(({ id }) => id !== itemId)
    let insertion = peers.length
    if (afterItemId) {
      insertion = peers.findIndex(({ id }) => id === afterItemId)
      if (insertion < 0) throw new AgentError("INVALID_REQUEST", "afterItemId 不属于新父任务", 400)
    } else if (beforeItemId) {
      const index = peers.findIndex(({ id }) => id === beforeItemId)
      if (index < 0) throw new AgentError("INVALID_REQUEST", "beforeItemId 不属于新父任务", 400)
      insertion = index + 1
    }
    if (beforeItemId && afterItemId) {
      const before = peers.findIndex(({ id }) => id === beforeItemId)
      const after = peers.findIndex(({ id }) => id === afterItemId)
      if (before < 0 || after !== before + 1) throw new AgentError("INVALID_REQUEST", "排序锚点不相邻", 400)
      insertion = after
    }
    const order = peers.map(({ id }) => id)
    order.splice(insertion, 0, itemId)
    order.forEach((id, index) => this.sqlite.query(`
      UPDATE taskboard_plan_items SET position = ?, version = version + 1, updated_at = ? WHERE id = ?
    `).run((index + 1) * TASKBOARD_POSITION_GAP, timestamp, id))
  }

  private descendantTaskIds(taskId: string): string[] {
    return (this.sqlite.query(`
      WITH RECURSIVE tree(id) AS (
        SELECT child_task_id FROM taskboard_plan_items WHERE parent_task_id = ? AND item_type = 'task'
        UNION ALL
        SELECT p.child_task_id FROM taskboard_plan_items p JOIN tree t ON p.parent_task_id = t.id
        WHERE p.item_type = 'task'
      ) SELECT id FROM tree
    `).all(taskId) as Array<{ id: string }>).map(({ id }) => id)
  }

  private bumpTask(taskId: string, timestamp: number) {
    this.sqlite.query("UPDATE taskboard_tasks SET version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, taskId)
  }

  private assertAcyclic(nodes: readonly string[], edges: readonly (readonly [string, string])[]) {
    const incoming = new Map(nodes.map((id) => [id, 0]))
    const outgoing = new Map(nodes.map((id) => [id, [] as string[]]))
    for (const [dependent, prerequisite] of edges) {
      incoming.set(dependent, (incoming.get(dependent) ?? 0) + 1)
      outgoing.get(prerequisite)?.push(dependent)
    }
    const queue = nodes.filter((id) => incoming.get(id) === 0)
    let visited = 0
    while (queue.length) {
      const id = queue.shift()!
      visited += 1
      for (const dependent of outgoing.get(id) ?? []) {
        const count = (incoming.get(dependent) ?? 1) - 1
        incoming.set(dependent, count)
        if (count === 0) queue.push(dependent)
      }
    }
    if (visited !== nodes.length) throw cycle()
  }
}

export type TaskboardPlanningRepositoryType = TaskboardPlanningRepository

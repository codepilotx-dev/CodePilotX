import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-taskboard-"))
  paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ id: "project:taskboard", rootPath: join(root, "workspace"), name: "Taskboard" })
  return { db, project }
}

describe("TaskboardRepository", () => {
  test("五态核心记录前向投影为七态，兼容状态和标题更新不会清除扩展状态", async () => {
    const { db, project } = await fixture()
    const created = db.createTask({ projectId: project.id, title: "兼容投影", status: "in_progress" })
    expect(db.readWorkflowTask(created.task.id)?.task).toMatchObject({ status: "in_progress", startDate: null, dueDate: null })

    const blocked = db.transitionWorkflowTask({
      taskId: created.task.id,
      expectedVersion: created.task.version,
      status: "blocked",
      workflowAction: "report_blocked",
      actor: "user",
      attentionReason: "blocked",
      note: "等待外部条件",
    })
    expect(blocked.task.status).toBe("blocked")
    expect(db.readTask(created.task.id)?.task.status).toBe("in_progress")

    const renamed = db.updateTask({ taskId: created.task.id, expectedVersion: blocked.task.version, patch: { title: "只改标题" } })
    expect(db.readWorkflowTask(created.task.id)?.task.status).toBe("blocked")

    db.moveTask({ taskId: created.task.id, expectedVersion: renamed.task.version, status: "done" })
    expect(db.readWorkflowTask(created.task.id)?.task.status).toBe("done")

    const cancelCandidate = db.createTask({ projectId: project.id, title: "取消任务", status: "todo" })
    const canceled = db.transitionWorkflowTask({
      taskId: cancelCandidate.task.id,
      expectedVersion: cancelCandidate.task.version,
      status: "canceled",
      workflowAction: "cancel",
      actor: "user",
    })
    expect(canceled.task.status).toBe("canceled")
    expect(db.readTask(cancelCandidate.task.id)?.task.status).toBe("done")
    const canceledRenamed = db.updateTask({ taskId: cancelCandidate.task.id, expectedVersion: canceled.task.version, patch: { title: "取消后改标题" } })
    expect(canceledRenamed.task.status).toBe("done")
    expect(db.readWorkflowTask(cancelCandidate.task.id)?.task.status).toBe("canceled")
    db.close()
  })

  test("项目编号永久递增，归档删除后不复用", async () => {
    const { db, project } = await fixture()
    const first = db.createTask({ projectId: project.id, title: "一号任务" })
    const second = db.createTask({ projectId: project.id, title: "二号任务" })
    expect([first.task.number, second.task.number]).toEqual([1, 2])

    const archived = db.archiveTask({ taskId: first.task.id, expectedVersion: first.task.version })
    expect(archived.task.archivedAt).not.toBeNull()
    expect(db.deleteTask({ taskId: first.task.id, expectedVersion: archived.task.version })).toBe(true)
    const third = db.createTask({ projectId: project.id, title: "三号任务" })
    expect(third.task.number).toBe(3)
    db.close()
  })

  test("日期筛选使用客户端显式提供的本地当天日期", async () => {
    const { db, project } = await fixture()
    const dueToday = db.createWorkflowTask({
      projectId: project.id,
      title: "本地今天到期",
      dueDate: "2026-08-23",
    })
    db.createWorkflowTask({
      projectId: project.id,
      title: "UTC 前一天到期",
      dueDate: "2026-08-22",
    })

    const result = db.listWorkflowTasks({
      projectId: project.id,
      datePreset: "due_today",
      today: "2026-08-23",
    })
    expect(result.tasks.map(task => task.id)).toEqual([dueToday.task.id])
    db.close()
  })

  test("CAS 更新、标签、评论 tombstone 与 operation replay 保持稳定", async () => {
    const { db, project } = await fixture()
    const label = db.createLabel({ projectId: project.id, name: "Desktop", normalizedName: "desktop" })
    const created = db.createTask({ projectId: project.id, title: "契约", labelIds: [label.id] })
    const updated = db.updateTask({
      taskId: created.task.id,
      expectedVersion: created.task.version,
      patch: { priority: "urgent" },
    })
    expect(updated.task.priority).toBe("urgent")
    expect(() => db.updateTask({ taskId: created.task.id, expectedVersion: created.task.version, patch: { title: "冲突" } })).toThrow("其他窗口")

    const comment = db.createComment({ taskId: created.task.id, body: "检查完成", author: "user" })
    const deleted = db.deleteComment({ commentId: comment.id, expectedVersion: comment.version })
    expect(deleted).toMatchObject({ body: "", deletedAt: expect.any(Number), version: 2 })

    const pending = db.beginTaskboardOperation({
      operationId: "operation:taskboard",
      projectId: project.id,
      taskId: created.task.id,
      method: "taskboard/task/update",
      requestHash: "hash:1",
    })
    expect(pending.status).toBe("pending")
    const completed = db.completeTaskboardOperation(pending.operationId, { taskId: created.task.id })
    expect(completed).toMatchObject({ status: "completed", result: { taskId: created.task.id } })
    expect(db.beginTaskboardOperation({ operationId: pending.operationId, projectId: project.id, method: pending.method, requestHash: pending.requestHash })).toEqual(completed)
    expect(() => db.beginTaskboardOperation({ operationId: pending.operationId, projectId: project.id, method: "taskboard/task/archive", requestHash: "hash:2" })).toThrow("operationId")
    db.close()
  })

  test("列间排序在 rank 无间隔时仅重排目标列并递增版本", async () => {
    const { db, project } = await fixture()
    const first = db.createTask({ projectId: project.id, title: "第一项", status: "todo" })
    const second = db.createTask({ projectId: project.id, title: "第二项", status: "todo" })
    const moved = db.createTask({ projectId: project.id, title: "待移动", status: "backlog" })
    db.sqlite.query("UPDATE taskboard_tasks SET position = 1 WHERE id = ?").run(first.task.id)
    db.sqlite.query("UPDATE taskboard_tasks SET position = 2 WHERE id = ?").run(second.task.id)

    const result = db.moveTask({
      taskId: moved.task.id,
      status: "todo",
      beforeTaskId: first.task.id,
      afterTaskId: second.task.id,
      expectedVersion: moved.task.version,
    })
    const tasks = db.listTasks({ projectId: project.id, statuses: ["todo"] }).tasks
    expect(tasks.map(({ title }) => title)).toEqual(["第一项", "待移动", "第二项"])
    expect(tasks.map(({ position }) => position)).toEqual([1_024, 2_048, 3_072])
    expect(result.task.version).toBe(2)
    expect(tasks.find(({ id }) => id === first.task.id)!.version).toBe(2)
    db.close()
  })

  test("七态排序使用独立位置，阻碍列重排不改动处理中任务版本", async () => {
    const { db, project } = await fixture()
    const first = db.createWorkflowTask({ projectId: project.id, title: "阻碍一", status: "blocked" })
    const second = db.createWorkflowTask({ projectId: project.id, title: "阻碍二", status: "blocked" })
    const moved = db.createWorkflowTask({ projectId: project.id, title: "待插入阻碍", status: "blocked" })
    const running = db.createWorkflowTask({ projectId: project.id, title: "处理中", status: "in_progress" })
    db.sqlite.query("UPDATE taskboard_task_workflows SET position = 1 WHERE task_id = ?").run(first.task.id)
    db.sqlite.query("UPDATE taskboard_task_workflows SET position = 2 WHERE task_id = ?").run(second.task.id)

    db.moveWorkflowTask({
      taskId: moved.task.id,
      status: "blocked",
      beforeTaskId: first.task.id,
      afterTaskId: second.task.id,
      expectedVersion: moved.task.version,
    })
    expect(db.listWorkflowTasks({ projectId: project.id, statuses: ["blocked"] }).tasks.map(task => task.title)).toEqual([
      "阻碍一",
      "待插入阻碍",
      "阻碍二",
    ])
    expect(db.readWorkflowTask(running.task.id)?.task.version).toBe(running.task.version)
    expect(db.readWorkflowTask(running.task.id)?.task.status).toBe("in_progress")
    db.close()
  })

  test("一个 thread 只能属于一个任务，删除 thread 只移除 link", async () => {
    const { db, project } = await fixture()
    const first = db.createTask({ projectId: project.id, title: "主任务" })
    const second = db.createTask({ projectId: project.id, title: "其他任务" })
    const thread = db.createThread({ title: "执行对话", workspace: { kind: "project", projectID: project.id } })
    const linked = db.linkPrimaryThread({ taskId: first.task.id, threadId: thread.id, expectedVersion: first.task.version })
    expect(linked.threads).toHaveLength(1)
    expect(db.taskLinkForThread(thread.id)?.role).toBe("primary")
    expect(() => db.linkThread({ taskId: second.task.id, threadId: thread.id, role: "supporting", expectedVersion: second.task.version })).toThrow("其他任务")

    db.sqlite.query("DELETE FROM threads WHERE id = ?").run(thread.id)
    expect(db.taskLinkForThread(thread.id)).toBeNull()
    expect(db.readTask(first.task.id)?.task.title).toBe("主任务")
    db.close()
  })

  test("历史会话候选拒绝运行中会话，任务与多会话绑定失败时整体回滚", async () => {
    const { db, project } = await fixture()
    const eligible = db.createThread({ title: "已结束会话", workspace: { kind: "project", projectID: project.id } })
    const active = db.createThread({ title: "运行中会话", workspace: { kind: "project", projectID: project.id } })
    db.sqlite.query(`
      INSERT INTO turns (id, thread_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES (?, ?, 'running', 'chat', '{}', 'auto', 1, 1)
    `).run("turn:active-candidate", active.id)

    expect(db.findWorkflowByThread({ threadId: eligible.id, projectId: project.id })).toMatchObject({ eligible: true, ineligibleReason: null })
    expect(db.findWorkflowByThread({ threadId: active.id, projectId: project.id })).toMatchObject({ eligible: false, ineligibleReason: "active" })
    expect(() => db.createWorkflowTask({
      projectId: project.id,
      title: "不得部分创建",
      status: "in_review",
      threadLinks: [
        { threadId: eligible.id, role: "primary" },
        { threadId: active.id, role: "supporting" },
      ],
    })).toThrow("结束后")
    expect(db.listWorkflowTasks({ projectId: project.id }).tasks).toHaveLength(0)
    expect(db.taskLinkForThread(eligible.id)).toBeNull()
    db.close()
  })

  test("主会话等待用户或执行失败时只产生任务级待整理提醒", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "等待处理", status: "in_progress" })
    const thread = db.createThread({ title: "主会话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: task.task.id, threadId: thread.id, expectedVersion: task.task.version })
    db.sqlite.query(`
      INSERT INTO turns (id, thread_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES (?, ?, 'running', 'chat', '{}', 'auto', 1, 1)
    `).run("turn:needs-user", thread.id)
    db.sqlite.query("UPDATE turns SET status = 'waiting_question', updated_at = 2 WHERE id = ?").run("turn:needs-user")

    const waiting = db.readWorkflowTask(task.task.id)
    expect(waiting?.task.attention).toMatchObject({
      unread: true,
      unreadAt: 2,
      reason: "execution_attention",
    })
    expect(waiting?.threads[0]).toMatchObject({
      latestTurnStatus: "waiting-question",
      pendingPlanApproval: false,
      attention: "needs_input",
    })
    expect(waiting?.task.status).toBe("in_progress")
    db.close()
  })

  test("主会话的待确认计划投影为需要处理且不改变任务工作流状态", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "等待计划确认", status: "in_progress" })
    const thread = db.createThread({ title: "计划主会话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: task.task.id, threadId: thread.id, expectedVersion: task.task.version })
    db.sqlite.query(`
      INSERT INTO turns (id, thread_id, status, mode, model_ref, strategy, created_at, updated_at)
      VALUES ('turn:pending-plan', ?, 'completed', 'chat', '{}', 'auto', 1, 1)
    `).run(thread.id)
    db.sqlite.query(`
      INSERT INTO agent_executions (
        id, thread_id, turn_id, profile, task, model_ref, session_id,
        depth, run_sequence, status, created_at, updated_at
      ) VALUES ('agent:pending-plan', ?, 'turn:pending-plan', 'main', '', '{}', 'session:pending-plan', 0, 0, 'completed', 1, 1)
    `).run(thread.id)
    db.sqlite.query(`
      INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at)
      VALUES ('item:pending-plan', ?, 'turn:pending-plan', 'agent:pending-plan', 'plan', 'completed', '{}', 0, 1, 1)
    `).run(thread.id)

    const projected = db.readWorkflowTask(task.task.id)
    expect(projected?.threads[0]).toMatchObject({
      latestTurnStatus: "completed",
      pendingPlanApproval: true,
      attention: "needs_input",
    })
    expect(projected?.task.status).toBe("in_progress")
    db.close()
  })

  test("primary 固定在首位，supporting 按活跃注意状态和最近活动排序", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "多对话任务" })
    const createThread = (id: string, title: string, updatedAt: number) => {
      const thread = db.createThread({ id, title, workspace: { kind: "project", projectID: project.id } })
      db.sqlite.query("UPDATE threads SET updated_at = ? WHERE id = ?").run(updatedAt, id)
      return thread
    }
    const primary = createThread("thread:primary", "主执行", 1)
    const running = createThread("thread:running", "运行中", 200)
    const needsInput = createThread("thread:needs-input", "待输入", 100)
    const idle = createThread("thread:idle", "空闲", 600)
    const completed = createThread("thread:completed", "已完成", 500)
    for (const [threadId, status, createdAt] of [
      [running.id, "running", 200],
      [needsInput.id, "waiting-question", 100],
      [completed.id, "completed", 500],
    ] as const) {
      db.sqlite.query(`
        INSERT INTO turns (id, thread_id, status, mode, model_ref, strategy, created_at, updated_at)
        VALUES (?, ?, ?, 'chat', '{}', 'auto', ?, ?)
      `).run(`turn:${threadId}`, threadId, status, createdAt, createdAt)
    }
    db.linkPrimaryThread({ taskId: task.task.id, threadId: primary.id, linkedAt: 10 })
    db.linkThread({ taskId: task.task.id, threadId: completed.id, role: "supporting", linkedAt: 50 })
    db.linkThread({ taskId: task.task.id, threadId: idle.id, role: "supporting", linkedAt: 40 })
    db.linkThread({ taskId: task.task.id, threadId: needsInput.id, role: "supporting", linkedAt: 30 })
    db.linkThread({ taskId: task.task.id, threadId: running.id, role: "supporting", linkedAt: 20 })

    expect(db.listThreadLinks(task.task.id).map(({ threadId }) => threadId)).toEqual([
      primary.id,
      running.id,
      needsInput.id,
      idle.id,
      completed.id,
    ])
    db.close()
  })

  test("start operation 使用 revision CAS 并可关联 thread/worktree 摘要", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "开始执行" })
    const operation = db.createTaskboardStartOperation({
      operationId: "start:1",
      taskId: task.task.id,
      projectId: project.id,
      requestHash: "hash:start",
      execution: { kind: "local" },
    })
    const completed = db.updateTaskboardStartOperation({
      operationId: operation.operationId,
      expectedRevision: operation.revision,
      patch: { step: "complete", status: "completed", startupInstruction: "先读取任务", completedAt: 3 },
      updatedAt: 3,
    })
    expect(completed).toMatchObject({ revision: 2, status: "completed", step: "complete", startupInstruction: "先读取任务" })
    expect(() => db.updateTaskboardStartOperation({ operationId: operation.operationId, expectedRevision: 1, patch: { status: "failed" } })).toThrow("其他窗口")
    db.close()
  })

  test("按任务恢复最近的 active durable start operation", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "恢复启动" })
    const create = (operationId: string, createdAt: number) => db.createTaskboardStartOperation({
      operationId,
      taskId: task.task.id,
      projectId: project.id,
      requestHash: `hash:${operationId}`,
      execution: { kind: "local" },
      createdAt,
    })
    const older = create("start:older", 10)
    const awaiting = create("start:awaiting", 20)
    const completed = create("start:completed", 30)
    db.updateTaskboardStartOperation({
      operationId: awaiting.operationId,
      expectedRevision: awaiting.revision,
      patch: { status: "awaiting_setup_decision" },
      updatedAt: 25,
    })
    db.updateTaskboardStartOperation({
      operationId: completed.operationId,
      expectedRevision: completed.revision,
      patch: { status: "completed", step: "complete", completedAt: 30 },
      updatedAt: 30,
    })

    expect(db.activeTaskboardStartOperation(task.task.id)?.operationId).toBe(awaiting.operationId)
    expect(db.findActiveTaskboardStartOperation(task.task.id)?.operationId).toBe(awaiting.operationId)
    const active = db.activeTaskboardStartOperation(task.task.id)!
    db.updateTaskboardStartOperation({
      operationId: active.operationId,
      expectedRevision: active.revision,
      patch: { status: "failed", completedAt: 40 },
      updatedAt: 40,
    })
    expect(db.activeTaskboardStartOperation(task.task.id)?.operationId).toBe(older.operationId)
    db.close()
  })
})

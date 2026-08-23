import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { TaskboardService } from "../src/taskboard/TaskboardService"
import { TaskContextService } from "../src/task-context/TaskContextService"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-task-context-")); paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ id: crypto.randomUUID(), rootPath: join(root, "workspace"), name: "Context" })
  const hub = await Effect.runPromise(EventHub.make)
  const context = new TaskContextService(db, hub)
  const taskboard = new TaskboardService(db, hub, db.repositories.taskboard, context)
  const task = await taskboard.create({ projectId: project.id, title: "共享上下文", status: "todo", operationId: crypto.randomUUID(), actor: { kind: "user", sourceThreadId: null } })
  const thread = db.createThread({ title: "主执行", workspace: { kind: "project", projectID: project.id } })
  db.linkPrimaryThread({ taskId: task.task.id, threadId: thread.id, expectedVersion: task.task.version })
  return { db, project, taskId: task.task.id, threadId: thread.id, context }
}

const attachChildTask = (db: AgentDatabase, parentTaskId: string, title = "实现子任务") => {
  const parent = db.repositories.taskboard.readWorkflowTask(parentTaskId)
  if (!parent) throw new Error("parent task fixture missing")
  const snapshot = db.repositories.planning.apply({
    parentTaskId,
    expectedVersion: parent.task.version,
    items: [{ clientId: crypto.randomUUID(), kind: "task", title }],
    timestamp: Date.now(),
  })
  const child = snapshot.items.find((item) => item.kind === "task")
  if (!child || child.kind !== "task") throw new Error("child task fixture missing")
  return child.childTask.id
}

const linkTaskThread = (db: AgentDatabase, projectId: string, taskId: string, title: string) => {
  const thread = db.createThread({ title, workspace: { kind: "project", projectID: projectId } })
  const task = db.repositories.taskboard.readWorkflowTask(taskId)
  if (!task) throw new Error("task fixture missing")
  db.linkPrimaryThread({ taskId, threadId: thread.id, expectedVersion: task.task.version })
  return thread.id
}

describe("TaskContextService", () => {
  test("主会话与 subagent 解析到同一任务，普通 child 不继承", async () => {
    const { db, project, taskId, threadId, context } = await fixture()
    const child = db.createThread({ title: "子 Agent", workspace: { kind: "project", projectID: project.id } })
    db.sqlite.query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?").run(threadId, child.id)
    const ordinary = db.createThread({ title: "普通子会话", workspace: { kind: "project", projectID: project.id } })
    db.sqlite.query("UPDATE threads SET parent_thread_id = ? WHERE id = ?").run(threadId, ordinary.id)
    expect(context.resolveTaskForThread(threadId)?.taskId).toBe(taskId)
    expect(context.resolveTaskForThread(child.id)?.taskId).toBe(taskId)
    expect(context.resolveTaskForThread(ordinary.id)).toBeNull()
    expect(context.promptForThread(child.id)).toBe(context.promptForThread(threadId))
    expect(context.snapshot(taskId).digest.length).toBeLessThanOrEqual(6_000)
    expect(context.promptForThread(ordinary.id)).toBeNull()
    db.close()
  })

  test("Evidence 幂等递增，未验证证据不默认读取", async () => {
    const { db, taskId, threadId, context } = await fixture()
    const input = { threadId, turnId: crypto.randomUUID(), verified: false, summary: "可能发生副作用" }
    expect(context.captureEvidence(input)?.snapshot.evidenceRevision).toBe(1)
    expect(context.captureEvidence(input)).toBeNull()
    expect(context.read(taskId, { includeEvidence: true }).evidence).toEqual([])
    expect(context.read(taskId, { includeEvidence: true, includeUnverified: true }).evidence).toHaveLength(1)
    db.close()
  })

  test("publish 使用 context revision 拒绝并发旧写入并生成确定性 digest", async () => {
    const { db, taskId, threadId, context } = await fixture()
    const first = context.publish({ taskId, expectedContextRevision: 1, sourceKind: "user", sourceThreadId: threadId, changes: [{ op: "add", section: "decision", title: "存储", content: "使用任务级 Capsule" }] })
    expect(first.snapshot.contextRevision).toBe(2)
    expect(first.snapshot.digest).toContain("使用任务级 Capsule")
    expect(() => context.publish({ taskId, expectedContextRevision: 1, sourceKind: "user", changes: [{ op: "add", section: "risk", title: "冲突", content: "拒绝旧版本" }] })).toThrow()
    db.close()
  })

  test("proposal stale 持久化，且 proposal 之后的新 Evidence 继续 pending", async () => {
    const first = await fixture()
    const stale = first.context.createProposal({ taskId: first.taskId, baseContextRevision: 1, throughEvidenceRevision: 0, changes: [], modelRef: null })
    first.context.publish({ taskId: first.taskId, expectedContextRevision: 1, sourceKind: "user", changes: [{ op: "add", section: "objective", title: "目标", content: "推进版本" }] })
    expect(() => first.context.applyProposal(stale.id)).toThrow()
    expect(first.context.proposal(stale.id).status).toBe("stale")
    first.db.close()

    const second = await fixture()
    second.context.captureEvidence({ threadId: second.threadId, turnId: "turn:evidence:1", verified: true, summary: "第一条证据" })
    const proposal = second.context.createProposal({ taskId: second.taskId, baseContextRevision: 1, throughEvidenceRevision: 1, changes: [], modelRef: null })
    second.context.captureEvidence({ threadId: second.threadId, turnId: "turn:evidence:2", verified: true, summary: "后续证据" })
    expect(second.context.applyProposal(proposal.id).snapshot.pendingEvidenceCount).toBe(1)
    second.db.close()
  })

  test("子任务会话的下一次 prompt 同时包含自身和由近到远的祖先摘要", async () => {
    const { db, project, taskId, context } = await fixture()
    const childTaskId = attachChildTask(db, taskId, "实现任务树")
    const grandchildTaskId = attachChildTask(db, childTaskId, "修复任务树缺陷")
    const childThreadId = linkTaskThread(db, project.id, grandchildTaskId, "缺陷修复会话")

    context.publish({
      taskId,
      expectedContextRevision: 1,
      sourceKind: "user",
      changes: [{ op: "add", section: "decision", title: "父级决策", content: "沿用 taskboard repository" }],
    })
    context.publish({
      taskId: childTaskId,
      expectedContextRevision: 1,
      sourceKind: "user",
      changes: [{ op: "add", section: "code_map", title: "子级代码地图", content: "修改 planning service" }],
    })
    context.publish({
      taskId: grandchildTaskId,
      expectedContextRevision: 1,
      sourceKind: "user",
      changes: [{ op: "add", section: "progress", title: "当前进展", content: "已复现问题" }],
    })

    const prompt = context.promptForThread(childThreadId)
    expect(prompt).toContain(`<task_context task_id="${grandchildTaskId}"`)
    expect(prompt).toContain("已复现问题")
    expect(prompt).toContain(`<ancestor_task_context task_id="${childTaskId}"`)
    expect(prompt).toContain("修改 planning service")
    expect(prompt).toContain(`<ancestor_task_context task_id="${taskId}"`)
    expect(prompt).toContain("沿用 taskboard repository")
    expect(prompt!.indexOf(`task_id="${childTaskId}"`)).toBeLessThan(prompt!.indexOf(`task_id="${taskId}"`))
    db.close()
  })

  test("context read includeAncestors 保留每条上下文的任务来源并按自身、近祖先、远祖先返回", async () => {
    const { db, taskId, context } = await fixture()
    const childTaskId = attachChildTask(db, taskId, "第一层子任务")
    const grandchildTaskId = attachChildTask(db, childTaskId, "第二层子任务")
    for (const [targetTaskId, title] of [[taskId, "根任务上下文"], [childTaskId, "父任务上下文"], [grandchildTaskId, "当前任务上下文"]] as const) {
      context.publish({
        taskId: targetTaskId,
        expectedContextRevision: 1,
        sourceKind: "user",
        changes: [{ op: "add", section: "objective", title, content: `${title}内容` }],
      })
    }

    const ownOnly = context.read(grandchildTaskId)
    expect(ownOnly.entries.map((item) => item.taskId)).toEqual([grandchildTaskId])
    const inherited = context.read(grandchildTaskId, { includeAncestors: true })
    expect(inherited.entries.map((item) => ({ taskId: item.taskId, title: item.title }))).toEqual([
      { taskId: grandchildTaskId, title: "当前任务上下文" },
      { taskId: childTaskId, title: "父任务上下文" },
      { taskId, title: "根任务上下文" },
    ])
    db.close()
  })

  test("子任务 publish 与 proposal apply 分别只向直接父任务汇总一条幂等 task Evidence", async () => {
    const { db, taskId, context } = await fixture()
    const childTaskId = attachChildTask(db, taskId)
    const proposal = context.createProposal({
      taskId: childTaskId,
      baseContextRevision: 1,
      throughEvidenceRevision: 0,
      changes: [{ op: "add", section: "finding", title: "调研结论", content: "可复用现有上下文表" }],
      modelRef: null,
    })
    context.applyProposal(proposal.id)
    context.publish({
      taskId: childTaskId,
      expectedContextRevision: 2,
      sourceKind: "user",
      changes: [{ op: "add", section: "validation", title: "验证结果", content: "聚焦测试通过" }],
    })

    const parentEvidence = context.read(taskId, { includeEvidence: true }).evidence
    expect(parentEvidence).toHaveLength(2)
    expect(parentEvidence.every((item) => item.sourceKind === "task" && item.verified)).toBe(true)
    expect(parentEvidence.map((item) => item.sourceId)).toEqual([
      `context:${childTaskId}:2`,
      `context:${childTaskId}:3`,
    ])
    const persisted = db.sqlite.query(`
      SELECT source_id, COUNT(*) AS count FROM task_context_evidence
      WHERE task_id = ? AND source_kind = 'task' GROUP BY source_id ORDER BY source_id
    `).all(taskId) as Array<{ source_id: string; count: number }>
    expect(persisted).toEqual([
      { source_id: `context:${childTaskId}:2`, count: 1 },
      { source_id: `context:${childTaskId}:3`, count: 1 },
    ])
    db.close()
  })

  test("子任务改挂或解绑后不再向旧父任务汇总新的上下文 Evidence", async () => {
    const { db, project, taskId: oldParentTaskId, context } = await fixture()
    const childTaskId = attachChildTask(db, oldParentTaskId)
    context.publish({
      taskId: childTaskId,
      expectedContextRevision: 1,
      sourceKind: "user",
      changes: [{ op: "add", section: "progress", title: "旧父级阶段", content: "完成初步扫描" }],
    })
    expect(context.read(oldParentTaskId, { includeEvidence: true }).evidence).toHaveLength(1)

    const taskboard = new TaskboardService(db, await Effect.runPromise(EventHub.make), db.repositories.taskboard, context)
    const newParent = await taskboard.create({
      projectId: project.id,
      title: "新的父任务",
      status: "todo",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const childBeforeMove = db.repositories.taskboard.readWorkflowTask(childTaskId)
    if (!childBeforeMove) throw new Error("child task fixture missing")
    db.repositories.planning.reparent({
      childTaskId,
      expectedVersion: childBeforeMove.task.version,
      parentTaskId: newParent.task.id,
      timestamp: Date.now(),
    })
    context.publish({
      taskId: childTaskId,
      expectedContextRevision: 2,
      sourceKind: "user",
      changes: [{ op: "add", section: "progress", title: "新父级阶段", content: "开始实现" }],
    })
    expect(context.read(oldParentTaskId, { includeEvidence: true }).evidence).toHaveLength(1)
    expect(context.read(newParent.task.id, { includeEvidence: true }).evidence).toHaveLength(1)

    const childBeforeDetach = db.repositories.taskboard.readWorkflowTask(childTaskId)
    if (!childBeforeDetach) throw new Error("child task fixture missing")
    db.repositories.planning.reparent({
      childTaskId,
      expectedVersion: childBeforeDetach.task.version,
      parentTaskId: null,
      timestamp: Date.now(),
    })
    context.publish({
      taskId: childTaskId,
      expectedContextRevision: 3,
      sourceKind: "user",
      changes: [{ op: "add", section: "progress", title: "解绑阶段", content: "独立继续开发" }],
    })
    expect(context.read(oldParentTaskId, { includeEvidence: true }).evidence).toHaveLength(1)
    expect(context.read(newParent.task.id, { includeEvidence: true }).evidence).toHaveLength(1)
    db.close()
  })

  test("子任务完成时向当前直接父任务写入唯一的最终结果 Evidence", async () => {
    const { db, taskId, context } = await fixture()
    const childTaskId = attachChildTask(db, taskId, "完成上下文汇总")
    const child = db.repositories.taskboard.readWorkflowTask(childTaskId)!
    db.repositories.taskboard.moveWorkflowTask({
      taskId: childTaskId,
      expectedVersion: child.task.version,
      status: "done",
      updatedAt: Date.now(),
    })
    expect(context.rollupTaskCompletion(childTaskId)).not.toBeNull()
    expect(context.rollupTaskCompletion(childTaskId)).toBeNull()
    expect(context.read(taskId, { includeEvidence: true }).evidence).toEqual([
      expect.objectContaining({ sourceKind: "task", verified: true }),
    ])
    db.close()
  })
})

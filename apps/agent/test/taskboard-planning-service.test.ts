import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { TaskboardPlanningRepository } from "../src/storage/repositories/taskboard-planning-repository"
import { TaskboardPlanningService } from "../src/taskboard/TaskboardPlanningService"
import { TaskboardService } from "../src/taskboard/TaskboardService"
import { createTaskboardDefinitions } from "../src/tool/Taskboard/definitions"
import type { ToolContext } from "../src/tool/ToolRegistry"
import { TaskboardStartService } from "../src/taskboard/TaskboardStartService"
import type { ThreadService } from "../src/session/ThreadService"
import type { ManagedWorktreeService } from "../src/worktree/ManagedWorktreeService"
import type { ThreadExecutionPreparationService } from "../src/worktree/ThreadExecutionPreparationService"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-taskboard-planning-"))
  paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ id: crypto.randomUUID(), rootPath: join(root, "workspace"), name: "Planning" })
  const parent = db.createWorkflowTask({ projectId: project.id, title: "长期任务", status: "todo" })
  const hub = await Effect.runPromise(EventHub.make)
  const repository = new TaskboardPlanningRepository(db.repositories.taskboard)
  const service = new TaskboardPlanningService(db, hub, repository, () => 1_000)
  const taskboard = new TaskboardService(db, hub, db.repositories.taskboard)
  return { db, project, parent, repository, service, taskboard }
}

describe("TaskboardPlanningService", () => {
  test("原子创建混合计划，并在前置步骤完成后只产生一次解锁提醒", async () => {
    const { db, parent, service } = await fixture()
    const result = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [
        { clientId: "research", kind: "step", title: "扫描代码库" },
        { clientId: "implement", kind: "task", title: "实现功能", status: "todo" },
      ],
      dependencies: [{ dependentClientId: "implement", prerequisiteClientId: "research" }],
    })
    const step = result.snapshot.items.find((item) => item.kind === "step")!
    const child = result.snapshot.items.find((item) => item.kind === "task")!
    expect(child.readiness.status).toBe("waiting")
    const start = new TaskboardStartService(
      db,
      await Effect.runPromise(EventHub.make),
      db.repositories.taskboard,
      {} as ThreadService,
      {} as ManagedWorktreeService,
      {} as ThreadExecutionPreparationService,
      () => 1_000,
      db.repositories.planning,
    )
    await expect(start.start({
      taskId: child.childTask.id,
      operationId: crypto.randomUUID(),
      execution: { kind: "local" },
    })).rejects.toMatchObject({ code: "TASKBOARD_PLAN_CONDITION_UNMET" })

    const completed = await service.updateStep({
      operationId: crypto.randomUUID(),
      itemId: step.id,
      expectedVersion: step.version,
      patch: { status: "done" },
    })
    const ready = completed.snapshot.items.find((item) => item.id === child.id)!
    expect(ready.readiness.status).toBe("ready")
    expect(ready.unreadReady).toBe(true)

    const reread = await service.markRead({ operationId: crypto.randomUUID(), taskId: parent.task.id, itemId: child.id })
    expect(reread.snapshot.items.find((item) => item.id === child.id)?.unreadReady).toBe(false)
    db.close()
  })

  test("循环依赖和无效批量依赖都回滚，不留下部分计划", async () => {
    const { db, parent, service } = await fixture()
    await expect(service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [{ clientId: "a", kind: "step", title: "A" }],
      dependencies: [{ dependentClientId: "a", prerequisiteClientId: "missing" }],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" })
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM taskboard_plan_items").get()).toEqual({ count: 0 })

    const applied = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [
        { clientId: "a", kind: "step", title: "A" },
        { clientId: "b", kind: "step", title: "B" },
      ],
    })
    const [a, b] = applied.snapshot.items
    const first = await service.setDependencies({ operationId: crypto.randomUUID(), itemId: a!.id, expectedVersion: a!.version, prerequisiteItemIds: [b!.id] })
    const nextB = first.snapshot.items.find((item) => item.id === b!.id)!
    await expect(service.setDependencies({ operationId: crypto.randomUUID(), itemId: nextB.id, expectedVersion: nextB.version, prerequisiteItemIds: [a!.id] }))
      .rejects.toMatchObject({ code: "TASKBOARD_PLAN_CYCLE" })
    db.close()
  })

  test("步骤升级保留计划项与依赖，任务改挂拒绝跨项目和后代成环", async () => {
    const { db, project, parent, service } = await fixture()
    const first = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [
        { clientId: "source", kind: "step", title: "可升级步骤", description: "保留来源" },
        { clientId: "after", kind: "step", title: "后续步骤" },
      ],
      dependencies: [{ dependentClientId: "after", prerequisiteClientId: "source" }],
    })
    const source = first.snapshot.items.find(item => item.kind === "step" && item.title === "可升级步骤")!
    const promoted = await service.promoteStep({
      operationId: crypto.randomUUID(),
      itemId: source.id,
      expectedVersion: source.version,
      task: { status: "todo" },
    })
    const promotedItem = promoted.snapshot.items.find(item => item.id === source.id)!
    expect(promotedItem).toMatchObject({
      kind: "task",
      promotedFromStep: { title: "可升级步骤", description: "保留来源" },
    })
    expect(promoted.snapshot.dependencies.some(value => value.prerequisiteItemId === source.id)).toBe(true)

    if (promotedItem.kind !== "task") throw new Error("promoted fixture missing")
    const childPlan = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: promotedItem.childTask.id,
      expectedVersion: promotedItem.childTask.version,
      items: [{ clientId: "grandchild", kind: "task", title: "孙任务" }],
    })
    const grandchild = childPlan.snapshot.items.find(item => item.kind === "task")!
    const currentParent = db.readWorkflowTask(parent.task.id)!
    await expect(service.reparent({
      operationId: crypto.randomUUID(),
      childTaskId: parent.task.id,
      expectedVersion: currentParent.task.version,
      parentTaskId: grandchild.childTask.id,
    })).rejects.toMatchObject({ code: "TASKBOARD_PLAN_CYCLE" })

    const otherProject = db.createProject({ id: crypto.randomUUID(), rootPath: join(paths[0]!, "other"), name: "Other" })
    const otherParent = db.createWorkflowTask({ projectId: otherProject.id, title: "其他项目", status: "todo" })
    const currentChild = db.readWorkflowTask(promotedItem.childTask.id)!
    await expect(service.reparent({
      operationId: crypto.randomUUID(),
      childTaskId: promotedItem.childTask.id,
      expectedVersion: currentChild.task.version,
      parentTaskId: otherParent.task.id,
    })).rejects.toMatchObject({ code: "TASKBOARD_PLAN_INVALID_PARENT" })
    expect(db.getProject(project.id)?.id).toBe(project.id)
    db.close()
  })

  test("子任务终态刷新依赖，报告与解决阻碍不隐式改写后续状态", async () => {
    const { db, parent, repository, service } = await fixture()
    const applied = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [
        { clientId: "a", kind: "task", title: "A", status: "todo" },
        { clientId: "b", kind: "task", title: "B", status: "todo" },
      ],
      dependencies: [{ dependentClientId: "b", prerequisiteClientId: "a" }],
    })
    const a = applied.snapshot.items.find(item => item.kind === "task" && item.childTask.title === "A")
    const b = applied.snapshot.items.find(item => item.kind === "task" && item.childTask.title === "B")
    if (!a || a.kind !== "task" || !b || b.kind !== "task") throw new Error("子任务计划未创建")
    const hub = await Effect.runPromise(EventHub.make)
    const workflows = new TaskboardService(db, hub, db.repositories.taskboard, undefined, () => 2_000, repository)
    await workflows.moveWorkflow({
      operationId: crypto.randomUUID(),
      taskId: a.childTask.id,
      expectedVersion: a.childTask.version,
      status: "done",
    })
    expect(service.read(parent.task.id).snapshot.items.find(item => item.id === b.id)).toMatchObject({
      readiness: { status: "ready" },
      unreadReady: true,
    })

    const currentB = db.readWorkflowTask(b.childTask.id)!
    const blocked = await workflows.transitionWorkflow({
      operationId: crypto.randomUUID(),
      taskId: b.childTask.id,
      expectedVersion: currentB.task.version,
      action: "report_blocked",
      note: "等待用户确认接口范围",
    })
    const blocker = service.read(b.childTask.id).snapshot.blockers[0]!
    expect(blocker).toMatchObject({ reason: "等待用户确认接口范围", status: "open" })
    await service.resolveBlocker({
      operationId: crypto.randomUUID(),
      blockerId: blocker.id,
      expectedVersion: blocker.version,
      resolution: "用户已确认范围",
    })
    expect(db.readWorkflowTask(b.childTask.id)?.task.status).toBe(blocked.task.status)
    db.close()
  })

  test("任务树归档批次只恢复本批次任务，永久删除保留会话", async () => {
    const { db, project, parent, service } = await fixture()
    const applied = await service.apply({
      operationId: crypto.randomUUID(),
      parentTaskId: parent.task.id,
      expectedVersion: parent.task.version,
      items: [{ clientId: "child", kind: "task", title: "子任务", status: "todo" }],
    })
    const child = applied.snapshot.items.find((item) => item.kind === "task")!
    const thread = db.createThread({ title: "修复会话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: child.childTask.id, threadId: thread.id, expectedVersion: child.childTask.version })
    const currentParent = db.readWorkflowTask(parent.task.id)!
    const archived = await service.archiveTree({
      operationId: crypto.randomUUID(),
      rootTaskId: parent.task.id,
      expectedVersion: currentParent.task.version,
    })
    expect(archived.taskIds).toHaveLength(2)
    const restored = await service.restoreTree({ operationId: crypto.randomUUID(), rootTaskId: parent.task.id })
    expect(restored.batchId).toBe(archived.batchId)

    const restoredParent = db.readWorkflowTask(parent.task.id)!
    await service.archiveTree({ operationId: crypto.randomUUID(), rootTaskId: parent.task.id, expectedVersion: restoredParent.task.version })
    const deleteOperationId = crypto.randomUUID()
    const deleted = await service.deleteTree({ operationId: deleteOperationId, rootTaskId: parent.task.id })
    expect(deleted.deletedTaskIds).toContain(child.childTask.id)
    expect(db.getThread(thread.id)?.id).toBe(thread.id)
    expect(await service.deleteTree({ operationId: deleteOperationId, rootTaskId: parent.task.id })).toEqual(deleted)
    db.close()
  })

  test("planning 工具只使用可信当前会话，关联后才能原子规划", async () => {
    const { db, project, parent, service, taskboard } = await fixture()
    const definitions = createTaskboardDefinitions(taskboard, service)
    const link = definitions.find(({ sdkName }) => sdkName === "taskboard_link_current")!
    const apply = definitions.find(({ sdkName }) => sdkName === "taskboard_plan_apply")!
    expect(link.schema.safeParse({ taskId: parent.task.id, expectedVersion: 1, threadId: "model-thread" }).success).toBe(false)
    const primaryThread = db.createThread({ title: "已有主会话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: parent.task.id, threadId: primaryThread.id, expectedVersion: parent.task.version })
    const currentParent = db.readWorkflowTask(parent.task.id)!
    const thread = db.createThread({ title: "规划会话", workspace: { kind: "project", projectID: project.id } })
    const context = {
      invocation: { threadID: thread.id, turnID: "host-turn", agentID: "host-agent", toolCallID: crypto.randomUUID() },
    } as ToolContext
    const linked = await link.execute({ taskId: parent.task.id, expectedVersion: currentParent.task.version }, context) as any
    expect(linked.task.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadId: primaryThread.id, role: "primary" }),
      expect.objectContaining({ threadId: thread.id, role: "supporting" }),
    ]))
    const result = await apply.execute({
      expectedVersion: linked.task.task.version,
      items: [{ clientId: "scan", kind: "step", title: "扫描代码库" }],
    }, { invocation: { ...context.invocation!, toolCallID: crypto.randomUUID() } } as ToolContext) as any
    expect(result.snapshot.items).toHaveLength(1)
    expect(db.repositories.taskboard.taskLinkForThread(thread.id)?.taskId).toBe(parent.task.id)
    db.close()
  })
})

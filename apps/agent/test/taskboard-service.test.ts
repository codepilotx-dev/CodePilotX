import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { TaskboardService } from "../src/taskboard/TaskboardService"
import { TaskboardStartService } from "../src/taskboard/TaskboardStartService"
import { EnvironmentDeltaStore } from "../src/local-environment/EnvironmentDeltaStore"
import { TaskExecutionBindingService } from "../src/worktree/TaskExecutionBindingService"
import { ThreadExecutionPreparationService } from "../src/worktree/ThreadExecutionPreparationService"
import { WorktreeRepository } from "../src/worktree/WorktreeRepository"
import type { ThreadService } from "../src/session/ThreadService"
import type { ManagedWorktreeService } from "../src/worktree/ManagedWorktreeService"
import { createTaskboardDefinitions } from "../src/tool/Taskboard/definitions"
import type { ToolContext } from "../src/tool/ToolRegistry"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-taskboard-service-"))
  paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ id: crypto.randomUUID(), rootPath: join(root, "workspace"), name: "Taskboard" })
  const hub = await Effect.runPromise(EventHub.make)
  return { db, project, service: new TaskboardService(db, hub, db.repositories.taskboard) }
}

const insertWorktree = (db: AgentDatabase, projectId: string, id: string, status: "ready" | "ready-with-setup-error") => {
  const timestamp = Date.now()
  return new WorktreeRepository(db.sqlite).insertWorktree({
    id,
    projectId,
    repositoryRoot: "repository",
    path: `managed/${id}`,
    status,
    branchName: null,
    baseCommit: "a".repeat(40),
    headCommit: "a".repeat(40),
    permanent: false,
    pinned: false,
    boundOnce: false,
    setupStatus: status === "ready" ? "succeeded" : "failed",
    environmentRevision: 0,
    continuedWithoutSetup: false,
    restoreSnapshotPath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: timestamp,
    deletedAt: null,
  })
}

describe("TaskboardService", () => {
  test("operation replay 不重复任务、活动或 durable event", async () => {
    const { db, project, service } = await fixture()
    const input = {
      projectId: project.id,
      title: "幂等任务",
      operationId: crypto.randomUUID(),
      actor: { kind: "user" as const, sourceThreadId: null },
    }
    const first = await service.create(input)
    const replay = await service.create(input)

    expect(replay.task.id).toBe(first.task.id)
    expect(db.listTasks({ projectId: project.id }).tasks).toHaveLength(1)
    expect(db.readTask(first.task.id)?.activities.map(({ kind }) => kind)).toEqual(["task_created"])
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'taskboard/changed'").get() as { count: number }).count).toBe(1)
    db.close()
  })

  test("Agent 权限、单次冲突重试与首次 Turn 自动领取保持一致", async () => {
    const { db, project, service } = await fixture()
    const created = await service.create({
      projectId: project.id,
      title: "执行任务",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const thread = db.createThread({ title: "执行对话", workspace: { kind: "project", projectID: project.id } })
    const linked = db.linkPrimaryThread({ taskId: created.task.id, threadId: thread.id, expectedVersion: created.task.version })

    await expect(service.update({
      taskId: created.task.id,
      expectedVersion: linked.task.version,
      operationId: crypto.randomUUID(),
      patch: { status: "done" },
      actor: { kind: "agent", sourceThreadId: thread.id },
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" })

    const externallyUpdated = db.updateTask({ taskId: created.task.id, expectedVersion: linked.task.version, patch: { priority: "high" } })
    const retried = await service.agentUpdate({
      threadId: thread.id,
      taskId: created.task.id,
      expectedVersion: linked.task.version,
      operationId: crypto.randomUUID(),
      status: "in_progress",
    })
    expect(retried.task.task).toMatchObject({ status: "in_progress", priority: externallyUpdated.task.priority })

    const second = await service.create({
      projectId: project.id,
      title: "首次消息领取",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const secondThread = db.createThread({ title: "第二个执行对话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: second.task.id, threadId: secondThread.id, expectedVersion: second.task.version })
    expect(service.admitPrimaryThread(secondThread.id)).not.toBeNull()
    expect(db.readTask(second.task.id)?.task.status).toBe("in_progress")
    expect(service.admitPrimaryThread(secondThread.id)).toBeNull()
    db.close()
  })

  test("start local 在 thread/create replay 未回调时修复 primary link 并完成 operation", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "恢复启动" })
    const thread = db.createThread({ title: "已存在对话", workspace: { kind: "project", projectID: project.id } })
    const worktreeRepository = new WorktreeRepository(db.sqlite)
    const bindings = new TaskExecutionBindingService(worktreeRepository)
    const threadExecutions = new ThreadExecutionPreparationService(db, bindings, new EnvironmentDeltaStore(paths.at(-1)!))
    const replayingThreads = { create: async () => ({ id: thread.id }) } as unknown as ThreadService
    const start = new TaskboardStartService(
      db,
      await Effect.runPromise(EventHub.make),
      db.repositories.taskboard,
      replayingThreads,
      {} as ManagedWorktreeService,
      threadExecutions,
    )

    const operation = await start.start({ taskId: task.task.id, execution: { kind: "local" }, operationId: crypto.randomUUID() })
    expect(operation).toMatchObject({ status: "completed", step: "complete", threadId: thread.id })
    expect(operation.startupInstruction).toContain(`${project.name} #${task.task.number}`)
    expect(db.taskLinkForThread(thread.id)).toMatchObject({ taskId: task.task.id, role: "primary" })
    expect(bindings.read(thread.id)).toMatchObject({ kind: "local", projectId: project.id })
    db.close()
  })

  test("已有 primary thread 时 start 幂等返回原对话且不创建第二个", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "已有主对话" })
    const thread = db.createThread({ title: "主对话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: task.task.id, threadId: thread.id, expectedVersion: task.task.version })
    const threads = { create: async () => { throw new Error("不应创建新对话") } } as unknown as ThreadService
    const start = new TaskboardStartService(db, await Effect.runPromise(EventHub.make), db.repositories.taskboard, threads, {} as ManagedWorktreeService, {} as ThreadExecutionPreparationService)

    const operation = await start.start({ taskId: task.task.id, execution: { kind: "local" }, operationId: crypto.randomUUID() })
    expect(operation).toMatchObject({ status: "completed", threadId: thread.id })
    expect(db.readTask(task.task.id)?.threads).toHaveLength(1)
    db.close()
  })

  test("Taskboard 工具只接受 host-owned identity 且 mutation 不暴露给 subagent", async () => {
    let received: Record<string, unknown> | null = null
    const fake = {
      agentCreate: async (input: Record<string, unknown>) => { received = input; return { task: {} } },
    } as unknown as TaskboardService
    const definitions = createTaskboardDefinitions(fake)
    const create = definitions.find(({ sdkName }) => sdkName === "taskboard_create")!
    expect(create.allowedProfiles).toEqual(["main"])
    expect(create.allowedModes).toEqual(["chat"])
    expect(create.visibility).toBe("deferred")
    expect(create.schema.safeParse({ title: "伪造", threadId: "model-thread" }).success).toBe(false)

    await create.execute({ title: "可信来源" }, {
      invocation: { threadID: "host-thread", turnID: "host-turn", agentID: "host-agent", toolCallID: "host-tool-call" },
    } as ToolContext)
    expect(received).toMatchObject({ threadId: "host-thread", turnId: "host-turn", agentId: "host-agent", operationId: "taskboard-tool:host-tool-call" })
  })

  test("new worktree setup 失败进入可恢复等待状态", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "等待 setup" })
    let creates = 0
    const worktrees = {
      create: async () => {
        creates += 1
        insertWorktree(db, project.id, "worktree:setup", "ready-with-setup-error")
        return { worktree: { id: "worktree:setup", status: "ready-with-setup-error", continuedWithoutSetup: false }, operation: { warnings: ["setup failed"] } }
      },
    } as unknown as ManagedWorktreeService
    const start = new TaskboardStartService(
      db,
      await Effect.runPromise(EventHub.make),
      db.repositories.taskboard,
      {} as ThreadService,
      worktrees,
      {} as ThreadExecutionPreparationService,
    )
    const execution = { kind: "new_worktree" as const, startingState: { type: "working_tree" as const } }
    const operation = await start.start({ taskId: task.task.id, execution, operationId: crypto.randomUUID() })
    expect(operation).toMatchObject({ status: "awaiting_setup_decision", worktreeId: "worktree:setup", errorCode: "WORKTREE_SETUP_REQUIRED" })
    // Reopening the dialog defaults to local execution. The task-scoped durable
    // saga must still surface the existing setup decision instead of creating
    // a second worktree or requiring the renderer to remember operationId.
    const recovered = await start.start({ taskId: task.task.id, execution: { kind: "local" }, operationId: crypto.randomUUID() })
    expect(recovered.operationId).toBe(operation.operationId)
    expect(creates).toBe(1)
    db.close()
  })

  test("仅补偿本次新建 worktree，不删除用户选择的已有 worktree", async () => {
    const { db, project } = await fixture()
    const first = db.createTask({ projectId: project.id, title: "新建失败" })
    const second = db.createTask({ projectId: project.id, title: "已有失败" })
    const deleted: string[] = []
    const worktrees = {
      create: async () => {
        insertWorktree(db, project.id, "worktree:new", "ready")
        return { worktree: { id: "worktree:new", status: "ready", continuedWithoutSetup: false }, operation: { warnings: [] } }
      },
      delete: async ({ worktreeId }: { worktreeId: string }) => { deleted.push(worktreeId); return {} },
    } as unknown as ManagedWorktreeService
    const failingPreparation = { prepare: async () => { throw new Error("binding failed") } } as unknown as ThreadExecutionPreparationService
    const start = new TaskboardStartService(db, await Effect.runPromise(EventHub.make), db.repositories.taskboard, {} as ThreadService, worktrees, failingPreparation)

    await expect(start.start({ taskId: first.task.id, execution: { kind: "new_worktree", startingState: { type: "working_tree" } }, operationId: crypto.randomUUID() })).rejects.toThrow("binding failed")
    insertWorktree(db, project.id, "worktree:existing", "ready")
    await expect(start.start({ taskId: second.task.id, execution: { kind: "existing_worktree", worktreeId: "worktree:existing" }, operationId: crypto.randomUUID() })).rejects.toThrow("binding failed")
    expect(deleted).toEqual(["worktree:new"])
    db.close()
  })

  test("新建 worktree 补偿失败时返回安全的 rollback_failed 状态", async () => {
    const { db, project } = await fixture()
    const task = db.createTask({ projectId: project.id, title: "补偿失败" })
    const worktrees = {
      create: async () => {
        insertWorktree(db, project.id, "worktree:rollback-failed", "ready")
        return {
          worktree: { id: "worktree:rollback-failed", status: "ready", continuedWithoutSetup: false },
          operation: { warnings: [] },
        }
      },
      delete: async () => { throw new Error("cleanup failed") },
    } as unknown as ManagedWorktreeService
    const failingPreparation = {
      prepare: async () => { throw new Error("binding failed") },
    } as unknown as ThreadExecutionPreparationService
    const start = new TaskboardStartService(
      db,
      await Effect.runPromise(EventHub.make),
      db.repositories.taskboard,
      {} as ThreadService,
      worktrees,
      failingPreparation,
    )

    const operation = await start.start({
      taskId: task.task.id,
      execution: { kind: "new_worktree", startingState: { type: "working_tree" } },
      operationId: crypto.randomUUID(),
    })
    expect(operation).toMatchObject({
      status: "rollback_failed",
      errorCode: "ROLLBACK_FAILED",
      warnings: ["新建 worktree 清理失败，请在 worktree 管理页检查"],
    })
    expect(JSON.stringify(operation)).not.toContain("cleanup failed")
    db.close()
  })
})

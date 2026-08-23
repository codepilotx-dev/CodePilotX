import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
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
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { ToolExecutor } from "../src/tool/ToolExecutor"
import { ThreadService as RuntimeThreadService } from "../src/session/ThreadService"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
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
  test("归档 primary 不能 continue，new_primary 会降级旧关联", async () => {
    const { db, project, service } = await fixture()
    const created = await service.create({ projectId: project.id, title: "归档主会话", status: "todo", operationId: crypto.randomUUID(), actor: { kind: "user", sourceThreadId: null } })
    const thread = db.createThread({ title: "旧主会话", workspace: { kind: "project", projectID: project.id } })
    const linked = db.linkPrimaryThread({ taskId: created.task.id, threadId: thread.id, expectedVersion: created.task.version })
    db.sqlite.query("UPDATE threads SET archived_at = ? WHERE id = ?").run(Date.now(), thread.id)
    expect(() => db.repositories.taskboard.prepareWorkflowStart({ taskId: created.task.id, expectedVersion: linked.task.version, mode: "continue_primary" })).toThrow()
    db.repositories.taskboard.prepareWorkflowStart({ taskId: created.task.id, expectedVersion: linked.task.version, mode: "new_primary" })
    expect(db.repositories.taskboard.taskLinkForThread(thread.id)?.role).toBe("supporting")
    db.close()
  })

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

  test("Agent 权限、冲突拒绝与已授权任务首次 Turn 自动领取保持一致", async () => {
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

    db.updateTask({ taskId: created.task.id, expectedVersion: linked.task.version, patch: { priority: "high" } })
    await expect(service.agentUpdate({
      threadId: thread.id,
      taskId: created.task.id,
      expectedVersion: linked.task.version,
      operationId: crypto.randomUUID(),
      title: "不得盲目覆盖",
    })).rejects.toMatchObject({ code: "CONFLICT" })

    const second = await service.create({
      projectId: project.id,
      title: "首次消息领取",
      status: "todo",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const secondThread = db.createThread({ title: "第二个执行对话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: second.task.id, threadId: secondThread.id, expectedVersion: second.task.version })
    expect(service.admitPrimaryThread(secondThread.id)).toHaveLength(2)
    expect(db.readTask(second.task.id)?.task.status).toBe("in_progress")
    expect(service.admitPrimaryThread(secondThread.id)).toEqual([])

    const backlog = await service.create({
      projectId: project.id,
      title: "尚未授权的任务",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const backlogThread = db.createThread({ title: "未授权对话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: backlog.task.id, threadId: backlogThread.id, expectedVersion: backlog.task.version })
    expect(service.admitPrimaryThread(backlogThread.id)).toEqual([])
    expect(db.readTask(backlog.task.id)?.task.status).toBe("backlog")
    db.close()
  })

  test("主会话可原子提交验收并产生评论与未读，辅助会话不能推进", async () => {
    const { db, project, service } = await fixture()
    const created = await service.create({
      projectId: project.id,
      title: "原子交付",
      status: "in_progress",
      operationId: crypto.randomUUID(),
      actor: { kind: "user", sourceThreadId: null },
    })
    const primary = db.createThread({ title: "主会话", workspace: { kind: "project", projectID: project.id } })
    const supporting = db.createThread({ title: "辅助会话", workspace: { kind: "project", projectID: project.id } })
    const linked = db.linkPrimaryThread({ taskId: created.task.id, threadId: primary.id, expectedVersion: created.task.version })
    const withSupporting = db.linkThread({ taskId: created.task.id, threadId: supporting.id, role: "supporting", expectedVersion: linked.task.version })

    await expect(service.agentTransition({
      threadId: supporting.id,
      taskId: created.task.id,
      expectedVersion: withSupporting.task.version,
      operationId: crypto.randomUUID(),
      action: "submit_review",
      note: "不应成功",
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" })

    const delivered = await service.agentTransition({
      threadId: primary.id,
      taskId: created.task.id,
      expectedVersion: withSupporting.task.version,
      operationId: crypto.randomUUID(),
      action: "submit_review",
      note: "实现与验证均已完成",
    })
    expect(delivered.task.task.status).toBe("in_review")
    expect(delivered.task.task.attention).toMatchObject({ unread: true, reason: "review_requested" })
    expect(delivered.task.comments.at(-1)).toMatchObject({ author: "agent", body: "实现与验证均已完成", sourceThreadId: primary.id })
    expect(delivered.task.activities.at(-1)?.data).toMatchObject({ workflowAction: "submit_review", after: "in_review" })
    db.close()
  })

  test("从历史会话创建任务时默认进入等你确认", async () => {
    const { db, project, service } = await fixture()
    const thread = db.createThread({ title: "历史交付", workspace: { kind: "project", projectID: project.id } })
    const created = await service.createWorkflow({
      operationId: crypto.randomUUID(),
      projectId: project.id,
      title: "整理历史交付",
      threadLinks: [{ threadId: thread.id, role: "primary" }],
    })
    expect(created.task.status).toBe("in_review")
    expect(created.threads).toEqual([expect.objectContaining({ threadId: thread.id, role: "primary" })])
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

  test("任务 primary 获得可信执行提示和条件激活工具，supporting 不扩权", async () => {
    const { db, project, service } = await fixture()
    const task = db.createWorkflowTask({ projectId: project.id, title: "真实执行任务", status: "in_progress" })
    const primary = db.createThread({ title: "主会话", workspace: { kind: "project", projectID: project.id } })
    const supporting = db.createThread({ title: "辅助会话", workspace: { kind: "project", projectID: project.id } })
    db.linkPrimaryThread({ taskId: task.task.id, threadId: primary.id, expectedVersion: task.task.version })
    db.linkThread({ taskId: task.task.id, threadId: supporting.id, role: "supporting" })

    const context = service.primaryExecutionContext(primary.id)
    expect(context?.instruction).toContain(`${project.name} #${task.task.number}：${task.task.title}`)
    expect(context?.instruction).toContain("taskboard_transition")
    expect(service.primaryExecutionContext(supporting.id)).toBeNull()

    const registry = new ToolRegistry()
    for (const definition of createTaskboardDefinitions(service)) registry.register(definition)
    const executor = new ToolExecutor(registry)
    const ordinary = executor.exposurePlan({ taskMode: "chat", sandboxMode: "workspace-write", profile: "main" })
    const linked = executor.exposurePlan({
      taskMode: "chat",
      sandboxMode: "workspace-write",
      profile: "main",
      activeDeferredTools: context!.activeTools,
    })
    expect(ordinary.exposed).not.toContain("taskboard_read")
    expect(linked.exposed).toEqual(expect.arrayContaining(["taskboard_read", "taskboard_transition"]))
    const done = db.repositories.taskboard.updateTask({
      taskId: task.task.id,
      expectedVersion: db.readTask(task.task.id)!.task.version,
      patch: { status: "done" },
    })
    expect(service.primaryExecutionContext(primary.id)?.activeTools).toContain("taskboard_comment")
    await service.agentComment({
      threadId: primary.id,
      expectedVersion: done.task.version,
      operationId: crypto.randomUUID(),
      body: "已完成最终回归复核",
    })
    expect(db.readTask(task.task.id)?.task.status).toBe("done")
    expect(db.readTask(task.task.id)?.comments.at(-1)).toMatchObject({
      body: "已完成最终回归复核",
      sourceThreadId: primary.id,
    })
    db.close()
  })

  test("ThreadService 将 primary 执行上下文注入可信提示并传入 runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-taskboard-runtime-"))
    paths.push(root)
    const workspaceRoot = join(root, "workspace")
    const cwd = join(workspaceRoot, "work")
    const outputDirectory = join(workspaceRoot, "outputs")
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(outputDirectory, { recursive: true })])
    const workspace = await WorkspaceService.open(workspaceRoot)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, {
      content: "完成关联任务",
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "queue",
      taskMode: "chat",
    })
    const activeTools = ["taskboard_read", "taskboard_transition"] as const
    const exposureInputs: Array<Record<string, unknown>> = []
    const runInputs: Array<Record<string, unknown>> = []
    const orchestrator = {
      toolExposure: (input: Record<string, unknown>) => {
        exposureInputs.push(input)
        return { eager: [], deferred: [], exposed: [...activeTools] }
      },
      run: async (input: Record<string, unknown>) => {
        runInputs.push(input)
        return { status: "paused" as const }
      },
      clearTurnPermissionGrants: () => undefined,
    }
    const questions = { setResumeHandler: () => undefined }
    const subagents = {
      setParentResumeHandler: () => undefined,
      resolvedWaitCheckpoint: () => null,
      delegationFor: () => undefined,
    }
    const service = new RuntimeThreadService(
      db,
      hub,
      {
        resolve: async () => ({ providerID: "openai", id: "test", variant: null }),
        models: async () => [],
        getModel: async () => ({ contextWindow: 128_000 }),
      } as never,
      null as never,
      questions as never,
      orchestrator as never,
      subagents as never,
      { listByBinding: async () => [], read: async () => { throw new Error("unused") } } as never,
      { dataRoot: root, userHome: root },
      { recall: () => [], enqueue: () => null } as never,
      { load: () => undefined, run: async () => [] } as never,
      {
        resolve: async () => ({
          kind: "projectless",
          projectID: null,
          workspaceRoot,
          cwd,
          runtimeWorkspaceRoots: [],
          instructionSources: [],
          outputDirectory,
          workspace,
          executionBinding: {} as never,
        }),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      (threadID) => threadID === thread.id
        ? { instruction: "关联 Taskboard 任务 #7；完成后使用 taskboard_transition 提交验收。", activeTools }
        : null,
    )

    await (service as unknown as { executeTurn(threadID: string, turnID: string): Promise<void> })
      .executeTurn(thread.id, turn.turnID)

    expect(exposureInputs).toHaveLength(1)
    expect(exposureInputs[0]?.activeDeferredTools).toEqual(activeTools)
    expect(runInputs).toHaveLength(1)
    expect(runInputs[0]?.activeDeferredTools).toEqual(activeTools)
    expect((runInputs[0]?.promptSections as Array<Record<string, unknown>>).find(({ id }) => id === "taskboard.execution")).toMatchObject({
      role: "developer",
      authority: "builtin",
      content: "关联 Taskboard 任务 #7；完成后使用 taskboard_transition 提交验收。",
      requiredTools: [...activeTools],
    })
    db.close()
  })

  test("Taskboard 工具只接受 host-owned identity 且 mutation 不暴露给 subagent", async () => {
    let received: Record<string, unknown> | null = null
    const fake = {
      agentCreate: async (input: Record<string, unknown>) => { received = input; return { task: {} } },
    } as unknown as TaskboardService
    const definitions = createTaskboardDefinitions(fake)
    const create = definitions.find(({ sdkName }) => sdkName === "taskboard_create")!
    const transition = definitions.find(({ sdkName }) => sdkName === "taskboard_transition")!
    expect(create.allowedProfiles).toEqual(["main"])
    expect(create.allowedModes).toEqual(["chat"])
    expect(create.visibility).toBe("deferred")
    expect(create.schema.safeParse({ title: "伪造", threadId: "model-thread" }).success).toBe(false)
    expect(transition.allowedProfiles).toEqual(["main"])
    expect(transition.schema.safeParse({ expectedVersion: 1, action: "submit_review" }).success).toBe(false)
    expect(transition.schema.safeParse({ expectedVersion: 1, action: "accept", note: "越权验收" }).success).toBe(false)

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

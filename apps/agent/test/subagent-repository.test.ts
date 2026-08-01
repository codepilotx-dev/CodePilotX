import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { SubagentRepository } from "../src/subagent/SubagentRepository"
import { canonicalSubagentChangedFiles } from "../src/subagent/SubagentService"
import { ThreadProjection } from "../src/transport/ThreadProjection"

const paths: string[] = []
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }).catch(() => undefined)
})

const model = Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5") })
const permission = { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" } as const

describe("子 Agent 持久化与调度", () => {
  test("原子创建 child Thread、Task、Run、Turn、Execution 和主时间线 Item", () => {
    const path = join(tmpdir(), `codepilotx-subagent-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const thread = db.createThread()
    const root = db.createTurn(thread.id, { content: "root", model, permissionConfig: permission, strategy: "queue", taskMode: "chat" })
    const repository = new SubagentRepository(db)
    const created = repository.create({
      parentThreadID: thread.id, parentTurnID: root.turnID, parentAgentID: root.agentID,
      displayName: "Rawls", profile: "explorer", task: "审计实现", model,
      permissionCeiling: permission, workspaceMode: "shared", workspaceRoot: "C:\\workspace",
    })

    expect(created.task.currentRun?.id).toBe(created.run.id)
    expect(created.run.permissionConfig.sandboxMode).toBe("read-only")
    expect(created.agent).toMatchObject({ depth: 1, profile: "explorer", subagentRunID: created.run.id, runSequence: 0, sessionID: `subagent:${created.task.id}` })
    const snapshot = new ThreadProjection(db).snapshot(thread.id)!
    expect(snapshot.subagents).toHaveLength(1)
    expect(snapshot.items.find((item) => item.type === "subagent")).toMatchObject({ subagentTaskId: created.task.id, childThreadId: created.task.childThreadId, displayName: "Rawls", status: "queued" })
    expect(new ThreadProjection(db).list().map((item) => item.id)).toEqual([thread.id])
    expect(new ThreadProjection(db).snapshot(created.task.childThreadId)?.agents[0]).toMatchObject({ subagentRunId: created.run.id, runSequence: 0 })
    db.close()
  })

  test("同一根 Agent 最多 claim 四个子任务并持久化队列原因，删除父 Thread 级联清理", () => {
    const path = join(tmpdir(), `codepilotx-subagent-limit-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const thread = db.createThread()
    const root = db.createTurn(thread.id, { content: "root", model, permissionConfig: permission, strategy: "queue", taskMode: "chat" })
    const repository = new SubagentRepository(db)
    const created = Array.from({ length: 5 }, (_, index) => repository.create({
      parentThreadID: thread.id, parentTurnID: root.turnID, parentAgentID: root.agentID,
      displayName: `Explorer ${index + 1}`, profile: "explorer", task: `任务 ${index + 1}`, model,
      permissionCeiling: permission, workspaceMode: "shared", workspaceRoot: "C:\\workspace",
    }))
    for (const child of created.slice(0, 4)) expect(repository.claim(child.run.id)).toMatchObject({ run: { status: "running" } })
    expect(repository.claim(created[4]!.run.id)).toEqual({ queued: true })
    expect(repository.run(created[4]!.run.id)?.queueReason).toBe("parent-limit")
    expect(new ThreadProjection(db).snapshot(thread.id)?.items.filter((item) => item.type === "subagent").at(-1)).toMatchObject({ queueReason: "parent-limit" })

    db.sqlite.query("DELETE FROM threads WHERE id = ?").run(thread.id)
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM subagent_tasks").get() as { count: number }).count).toBe(0)
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM subagent_runs").get() as { count: number }).count).toBe(0)
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM threads").get() as { count: number }).count).toBe(0)
    db.close()
  })

  test("共享工作区 writer 可与父任务和其他 writer 并行 claim", () => {
    const path = join(tmpdir(), `codepilotx-subagent-shared-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const thread = db.createThread()
    const root = db.createTurn(thread.id, { content: "root", model, permissionConfig: permission, strategy: "queue", taskMode: "chat" })
    db.updateTurnStatus(root.turnID, "running")
    const repository = new SubagentRepository(db)
    const created = Array.from({ length: 2 }, (_, index) => repository.create({
      parentThreadID: thread.id, parentTurnID: root.turnID, parentAgentID: root.agentID,
      displayName: `Worker ${index + 1}`, profile: "worker", task: `任务 ${index + 1}`, model,
      permissionCeiling: permission, workspaceMode: "shared", workspaceRoot: "C:\\workspace",
    }))

    expect(repository.claim(created[0]!.run.id)).toMatchObject({ run: { status: "running" } })
    expect(repository.claim(created[1]!.run.id)).toMatchObject({ run: { status: "running" } })
    expect((db.sqlite.query("SELECT COUNT(*) AS count FROM workspace_writer_leases").get() as { count: number }).count).toBe(0)
    db.close()
  })

  test("完成文件清单只接受 canonical patch 路径并复用匹配的模型说明", () => {
    expect(canonicalSubagentChangedFiles(
      [
        { path: "src\\one.ts", summary: "更新入口" },
        { path: "hallucinated.ts", summary: "不存在" },
      ],
      [
        { data: { files: [{ path: "src/one.ts" }, { path: "src/two.ts" }] } },
        { data: { files: [{ path: "src/one.ts" }] } },
      ],
    )).toEqual([
      { path: "src/one.ts", summary: "更新入口" },
      { path: "src/two.ts", summary: "由子 Agent 修改" },
    ])
  })

  test("同一 child Thread 的 retry 创建下一 generation，steer 在同一 run 增加执行序号", () => {
    const path = join(tmpdir(), `codepilotx-subagent-generation-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const thread = db.createThread()
    const root = db.createTurn(thread.id, { content: "root", model, permissionConfig: permission, strategy: "queue", taskMode: "chat" })
    const repository = new SubagentRepository(db)
    const created = repository.create({ parentThreadID: thread.id, parentTurnID: root.turnID, parentAgentID: root.agentID, displayName: "Mill", profile: "worker", task: "实施", model, permissionCeiling: permission, workspaceMode: "worktree", workspaceRoot: "C:\\workspace" })
    const steered = repository.continueTask({ taskID: created.task.id, message: "缩小范围", sameRun: true })
    expect(steered.run.id).toBe(created.run.id)
    expect(steered.agent.runSequence).toBe(1)
    repository.finish(created.run.id, "failed", null, "失败")
    const retried = repository.continueTask({ taskID: created.task.id, message: "重试", sameRun: false })
    expect(retried.run).toMatchObject({ generation: 2, status: "queued" })
    expect(retried.task.childThreadId).toBe(created.task.childThreadId)
    expect(retried.agent.runSequence).toBe(0)
    db.close()
  })
})

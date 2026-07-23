import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ThreadHistoryService } from "../src/session/ThreadHistoryService"
import { AgentDatabase } from "../src/storage/Database"
import { SqlitePiSessionRepo, SqlitePiSessionStorage } from "../src/storage/SqlitePiSession"
import { EventHub } from "../src/storage/EventHub"
import { ThreadProjection } from "../src/transport/ThreadProjection"
import { Model, Provider } from "@codepilotx/model-schema"

const paths: string[] = []
const databases: AgentDatabase[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await sleep(100)
    }
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    database.close()
  }
  await Promise.all(paths.splice(0).map((path) => removePath(path)))
})

const makeHistory = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-history-"))
  paths.push(root)
  const databasePath = join(root, "agent.sqlite")
  const db = new AgentDatabase(databasePath)
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  return { db, history: new ThreadHistoryService(db, hub), projection: new ThreadProjection(db), root, databasePath }
}

const input = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt") }),
  permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
  strategy: "queue",
  taskMode: "chat",
} as const)

describe("Thread 历史", () => {
  test("按项目列出并投影首条用户消息", async () => {
    const { db, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const first = db.createThread("第一段", project.id)
    db.createTurn(first.id, input("alpha 历史搜索目标"))
    const second = db.createThread("第二段", project.id)
    db.createTurn(second.id, input("beta"))

    const threads = projection.list({ projectID: project.id })
    expect(new Set(threads.map((thread) => thread.id))).toEqual(new Set([first.id, second.id]))
    expect(threads.find((thread) => thread.id === first.id)?.firstUserMessage).toBe("alpha 历史搜索目标")
  })

  test("支持重命名、归档、取消归档和删除", async () => {
    const { db, history, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const thread = db.createThread("原标题", project.id)

    const renamed = await history.patch(thread.id, { title: "新标题", archived: true })
    expect(renamed.title).toBe("新标题")
    expect(typeof renamed.archivedAt).toBe("number")
    expect(projection.list({ projectID: project.id, archived: false })).toEqual([])
    expect(projection.list({ projectID: project.id, archived: true }).map((item) => item.id)).toEqual([thread.id])

    const active = await history.patch(thread.id, { archived: false })
    expect(active.archivedAt).toBeNull()
    const session = await new SqlitePiSessionRepo(db).create({ id: `${thread.id}:main`, threadID: thread.id, agentID: "creator" })
    await session.appendMessage({ role: "user", content: "private history", timestamp: Date.now() })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    await history.remove(thread.id)
    expect(db.getThread(thread.id)).toBeNull()
    expect(db.sqlite.query("SELECT 1 FROM pi_sessions WHERE thread_id = ?").get(thread.id)).toBeNull()
    expect(db.sqlite.query("SELECT 1 FROM pi_session_entries WHERE session_id = ?").get(`${thread.id}:main`)).toBeNull()
  })

  test("父 Thread 删除会清理子 Agent Pi 历史，但拒绝删除活跃子 Thread", async () => {
    const { db, history } = await makeHistory()
    const parent = db.createThread("parent")
    const child = db.createThread("child")
    db.sqlite.query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?").run(parent.id, child.id)
    const repo = new SqlitePiSessionRepo(db)
    const childSession = await repo.create({ id: `subagent:${child.id}`, threadID: child.id, agentID: "creator" })
    await childSession.appendMessage({ role: "user", content: "child history", timestamp: Date.now() })
    ;(childSession.getStorage() as SqlitePiSessionStorage).flush()

    const childTurn = db.createTurn(child.id, input("running"))
    db.claimTurnExecution(childTurn.turnID)
    await expect(history.remove(parent.id)).rejects.toMatchObject({ code: "THREAD_ACTIVE" })
    db.sqlite.query("UPDATE turns SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), childTurn.turnID)

    await history.remove(parent.id)
    expect(db.getThread(parent.id)).toBeNull()
    expect(db.getThread(child.id)).toBeNull()
    expect(db.sqlite.query("SELECT 1 FROM pi_sessions WHERE id = ?").get(`subagent:${child.id}`)).toBeNull()
  })

  test("ThreadSnapshot 返回对应 Turn 的 Item", async () => {
    const { db, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const thread = db.createThread("对话", project.id)
    const turn = db.createTurn(thread.id, input("第一条"))
    const timestamp = Date.now()
    db.upsertItem(thread.id, {
      id: "item-1",
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: "text",
      status: "completed",
      data: { text: "回答" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.messages).toMatchObject([{ id: turn.inputID, turnId: turn.turnID, role: "user" }])
    expect(snapshot?.items).toMatchObject([{ id: "item-1", type: "text", text: "回答" }])
  })

  test("按稳定排他游标分页 Turn，并将 queued Turn 与附件独立投影", async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread("分页会话")
    const completed = Array.from({ length: 12 }, (_, index) => {
      const created = db.createTurn(thread.id, input(`第 ${index + 1} 轮`), "completed")
      db.updateTurnStatus(created.turnID, "completed")
      return created
    })
    const queued = db.createTurn(thread.id, input("排队中的一轮"))
    const sameTimestamp = 1_700_000_000_000
    db.sqlite.query("UPDATE turns SET created_at = ? WHERE thread_id = ? AND status <> 'queued'").run(sameTimestamp, thread.id)
    db.sqlite.query(`INSERT INTO input_attachments (id, thread_id, input_id, kind, name, media_type, size_bytes, sha256, storage_path, created_at, bound_at)
      VALUES ('attachment-history', ?, ?, 'text', 'history.txt', 'text/plain', 7, 'sha-history', 'history.txt', ?, ?)`).run(
      thread.id,
      completed[0]!.inputID,
      sameTimestamp,
      sameTimestamp,
    )

    const first = projection.historyPage(thread.id)!
    expect(first.turns).toHaveLength(10)
    expect(first.hasOlder).toBe(true)
    expect(first.olderCursor).toBeString()
    expect(first.queue.turns.map((turn) => turn.id)).toEqual([queued.turnID])
    expect(first.queue.inputs.map((item) => item.id)).toEqual([queued.inputID])

    const second = projection.historyPage(thread.id, { before: first.olderCursor! })!
    expect(second.turns).toHaveLength(2)
    expect(second.hasOlder).toBe(false)
    expect(second.olderCursor).toBeNull()
    const allBundles = [...second.turns, ...first.turns]
    expect(allBundles.flatMap((bundle) => bundle.attachments)).toMatchObject([{
      id: "attachment-history",
      name: "history.txt",
      mediaType: "text/plain",
    }])
    expect(allBundles.flatMap((bundle) => bundle.inputs).find((item) => item.id === completed[0]!.inputID)?.attachmentIds).toEqual(["attachment-history"])

    const combined = allBundles.map((bundle) => bundle.turn.id)
    const expected = (db.sqlite.query("SELECT id FROM turns WHERE thread_id = ? AND status <> 'queued' ORDER BY created_at, id").all(thread.id) as Array<{ id: string }>).map((row) => row.id)
    expect(combined).toEqual(expected)
    expect(new Set(combined).size).toBe(12)
  })

  test("设置立即持久化且幂等更新不修改活跃时间或重复写事件", async () => {
    const { db, history, databasePath } = await makeHistory()
    const thread = db.createThread("设置持久化")
    const updatedAt = thread.updatedAt
    const beforeEvents = db.eventsAfter(0).length
    const settings = {
      taskMode: "plan",
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review" },
    } as const

    await history.patchSettings(thread.id, settings)
    expect(db.getThreadSettings(thread.id)).toEqual(settings)
    expect(db.sqlite.query("SELECT updated_at FROM threads WHERE id = ?").get(thread.id)).toEqual({ updated_at: updatedAt })
    expect(db.eventsAfter(0).length).toBe(beforeEvents + 1)

    await history.patchSettings(thread.id, {})
    await history.patchSettings(thread.id, settings)
    expect(db.eventsAfter(0).length).toBe(beforeEvents + 1)

    db.close()
    databases.splice(databases.indexOf(db), 1)
    const reopened = new AgentDatabase(databasePath)
    databases.push(reopened)
    expect(reopened.getThreadSettings(thread.id)).toEqual(settings)
  })

  test("创建 Thread 时保存并投影初始设置", async () => {
    const { db, projection } = await makeHistory()
    const settings = {
      taskMode: "plan",
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
    } as const
    const thread = db.createThread("Plan 会话", undefined, settings)

    expect(projection.snapshot(thread.id)?.thread.settings).toEqual(settings)
    expect(projection.list().find((item) => item.id === thread.id)?.settings).toEqual(settings)
  })

  test("创建 Turn 原子同步 Thread 设置并保持已有 Turn 快照不变", async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread("不可变快照")
    const firstInput = input("第一轮")
    const first = db.createTurn(thread.id, firstInput)
    expect(first.settingsEvent?.id).toBeLessThan(first.event.id)
    db.claimTurnExecution(first.turnID)

    const nextSettings = {
      taskMode: "plan",
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review" },
    } as const
    db.updateThreadSettings(thread.id, nextSettings)
    const second = db.createTurn(thread.id, { ...firstInput, content: "第二轮", ...nextSettings })
    expect(second.settingsEvent).toBeNull()

    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.thread.settings).toEqual(nextSettings)
    expect(snapshot?.turns.find((turn) => turn.id === first.turnID)).toMatchObject({
      mode: "chat",
      permissionConfig: firstInput.permissionConfig,
    })
    expect(snapshot?.turns.find((turn) => turn.id === second.turnID)).toMatchObject({
      mode: "plan",
      permissionConfig: nextSettings.permissionConfig,
    })
    expect(snapshot?.inputs.find((item) => item.id === second.inputID)).toMatchObject({
      mode: "plan",
      permissionConfig: nextSettings.permissionConfig,
    })
  })
})

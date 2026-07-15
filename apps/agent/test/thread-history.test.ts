import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ThreadHistoryService } from "../src/session/ThreadHistoryService"
import { AgentDatabase } from "../src/storage/Database"
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
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  return { db, history: new ThreadHistoryService(db, hub), projection: new ThreadProjection(db), root }
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
    await history.remove(thread.id)
    expect(db.getThread(thread.id)).toBeNull()
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
})

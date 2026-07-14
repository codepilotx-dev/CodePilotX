import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionHistoryService } from "../src/session/SessionHistoryService"
import { AgentDatabase } from "../src/storage/Database"
import { EventHub } from "../src/storage/EventHub"

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
  return { db, history: new SessionHistoryService(db, hub), root }
}

const input = (content: string) => ({
  content,
  model: { providerID: "openai", modelID: "gpt" },
  permissionMode: "review",
  strategy: "queue",
  taskMode: "chat",
} as const)

describe("历史会话", () => {
  test("按项目分页列出并支持内容搜索", async () => {
    const { db, history, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const first = db.createSession("第一段", project.id)
    db.createRun(first.id, input("alpha 历史搜索目标"))
    const second = db.createSession("第二段", project.id)
    db.createRun(second.id, input("beta"))

    const page = history.list({ projectID: project.id, limit: 1 })
    expect(page.sessions).toHaveLength(1)
    expect(page.nextCursor).toBeTruthy()

    expect(page.nextCursor).not.toBeNull()
    const next = history.list({ projectID: project.id, limit: 1, cursor: page.nextCursor! })
    expect(new Set([...page.sessions, ...next.sessions].map((session) => session.id)).size).toBe(2)

    const search = history.list({ projectID: project.id, search: "alpha" })
    expect(search.sessions.map((session) => session.id)).toEqual([first.id])
    expect(search.sessions[0]?.firstUserMessage).toBe("alpha 历史搜索目标")
  })

  test("支持重命名、归档、取消归档和删除", async () => {
    const { db, history, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const session = db.createSession("原标题", project.id)

    const renamed = await history.patch(session.id, { title: "新标题", archived: true })
    expect(renamed.title).toBe("新标题")
    expect(typeof renamed.archivedAt).toBe("number")
    expect(history.list({ projectID: project.id }).sessions).toEqual([])
    expect(history.list({ projectID: project.id, archived: true }).sessions.map((item) => item.id)).toEqual([session.id])

    const active = await history.patch(session.id, { archived: false })
    expect(active.archivedAt).toBeNull()
    await history.remove(session.id)
    expect(db.getSession(session.id)).toBeNull()
  })

  test("按消息 ordinal 分页并返回对应 run 的 parts", async () => {
    const { db, history, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const session = db.createSession("对话", project.id)
    const run = db.createRun(session.id, input("第一条"))
    const timestamp = Date.now()
    db.upsertPart(session.id, {
      id: "part-1",
      runID: run.runID,
      type: "text",
      status: "completed",
      data: { text: "回答" },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const page = history.listMessages(session.id, { limit: 1 })
    expect(page.messages).toMatchObject([{ id: run.inputID, runID: run.runID, role: "user" }])
    expect(page.parts).toMatchObject([{ id: "part-1", type: "text", text: "回答" }])
    expect(page.nextCursor).toBeNull()
  })
})

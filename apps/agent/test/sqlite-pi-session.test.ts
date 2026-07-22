import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/Database"
import { SqlitePiSessionRepo, SqlitePiSessionStorage } from "../src/storage/SqlitePiSession"

const roots: string[] = []
const databases: AgentDatabase[] = []

const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await Promise.all(roots.splice(0).map(removePath))
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-pi-session-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  return { db, repo: new SqlitePiSessionRepo(db) }
}

describe("SqlitePiSessionRepo", () => {
  test("缓冲当前轮写入并在 flush 后恢复完整上下文和统计", async () => {
    const { db, repo } = await setup()
    const session = await repo.create({ id: "session-main", threadID: "thread-main", agentID: "agent-main" })
    await session.appendModelChange("openai", "gpt-test")
    await session.appendThinkingLevelChange("high")
    await session.appendActiveToolsChange(["read", "shell"])
    const userEntryID = await session.appendMessage({ role: "user", content: "hello", timestamp: 1 })
    await session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "world" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-test",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 20,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
      },
      stopReason: "stop",
      timestamp: 2,
    })
    await session.appendLabel(userEntryID, "入口")
    await session.appendSessionName(" 主会话\n")

    const storage = session.getStorage() as SqlitePiSessionStorage
    expect(storage.pendingCount).toBe(7)
    expect((await session.buildContext()).messages).toHaveLength(2)
    expect(await session.getLabel(userEntryID)).toBe("入口")
    expect(await session.getSessionName()).toBe("主会话")
    expect(await session.getSessionStats()).toEqual({
      messageCount: 2,
      cachedTokens: 3,
      uncachedTokens: 12,
      totalTokens: 20,
      costTotal: 0.33,
    })

    const beforeFlush = await repo.openByID("session-main")
    expect(await beforeFlush.getEntries()).toEqual([])

    db.transaction(() => storage.flush())
    expect(storage.pendingCount).toBe(0)
    const reopened = await repo.openByID("session-main")
    expect(await reopened.getLeafId()).toBe(await session.getLeafId())
    expect((await reopened.getEntries()).map((entry) => entry.type)).toEqual([
      "model_change",
      "thinking_level_change",
      "active_tools_change",
      "message",
      "message",
      "label",
      "session_info",
    ])
    expect(await reopened.getSessionName()).toBe("主会话")
  })

  test("支持树导航、compaction、fork、游标和丢弃未提交写入", async () => {
    const { repo } = await setup()
    const source = await repo.create({ id: "source", threadID: "thread", agentID: "agent" })
    const first = await source.appendMessage({ role: "user", content: "first", timestamp: 1 })
    const answer = await source.appendMessage({ role: "user", content: "answer", timestamp: 2 })
    const compaction = await source.appendCompaction("summary", first, 120)
    ;(source.getStorage() as SqlitePiSessionStorage).flush()

    expect((await source.getBranch()).map((entry) => entry.id)).toEqual([first, answer, compaction])
    expect((await source.getEntries({ afterEntrySeq: 1, limit: 1 })).map((entry) => entry.id)).toEqual([answer])

    await source.moveTo(first)
    const storage = source.getStorage() as SqlitePiSessionStorage
    expect(await source.getLeafId()).toBe(first)
    storage.discardPending()
    expect(await source.getLeafId()).toBe(compaction)

    const forked = await repo.fork(await source.getMetadata(), {
      id: "forked",
      threadID: "thread",
      agentID: "agent-fork",
      entryId: answer,
      position: "at",
    })
    expect((await forked.getEntries()).map((entry) => entry.id)).toEqual([first, answer])
    expect(await forked.getLeafId()).toBe(answer)
    expect((await repo.list({ threadID: "thread" })).map((metadata) => metadata.id).sort()).toEqual(["forked", "source"])

    await repo.delete(await forked.getMetadata())
    expect((await repo.list({ agentID: "agent-fork" }))).toEqual([])
  })

  test("外层业务事务回滚时保留待提交 entry 以便安全重试", async () => {
    const { db, repo } = await setup()
    const session = await repo.create({ id: "rollback", threadID: "thread", agentID: "agent" })
    await session.appendMessage({ role: "user", content: "retry me", timestamp: 1 })
    const storage = session.getStorage() as SqlitePiSessionStorage

    expect(() => db.transaction(() => {
      storage.flush()
      throw new Error("outbox failed")
    })).toThrow("outbox failed")
    expect(storage.pendingCount).toBe(1)
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM pi_session_entries WHERE session_id = ?").get("rollback")).toEqual({ count: 0 })

    storage.flush()
    expect(storage.pendingCount).toBe(0)
    expect((await repo.openByID("rollback")).getEntries()).resolves.toHaveLength(1)
  })
})

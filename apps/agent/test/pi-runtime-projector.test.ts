import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeFixturePaths } from "./fixture-cleanup"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { SqlitePiSessionRepo, type SqlitePiSessionStorage } from "../src/storage/SqlitePiSession"
import { PiRuntimeProjector } from "../src/orchestration/pi/PiRuntimeProjector"
import type { PiRuntimeEventContext } from "../src/orchestration/pi/types"

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-pi-projector-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const thread = db.createThread("Pi projector test")
  const turn = db.createTurn(thread.id, {
    content: "projector",
    model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
    permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
    strategy: "queue",
    taskMode: "chat",
  })
  const repo = new SqlitePiSessionRepo(db)
  const sessionID = "session-projector"
  const session = await repo.create({ id: sessionID, threadID: thread.id, agentID: turn.agentID })
  const storage = session.getStorage() as SqlitePiSessionStorage
  const published: Array<{ method: string }> = []
  const publish = async (event: { method: string }) => { published.push({ method: event.method }) }
  const projector = new PiRuntimeProjector({
    db,
    contextCompaction: { complete: () => ({ event: { method: "context/compacted" } }) } as never,
    storage,
    session: session as never,
    runtimeModel: { provider: "openai", id: "model", contextWindow: 128_000 } as never,
    sessionID,
    publish: publish as never,
  })
  const context: PiRuntimeEventContext = { threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID }
  return { db, threadID: thread.id, turnID: turn.turnID, storage, session, published, projector, context }
}

describe("PiRuntimeProjector savepoint", () => {
  test("事务成功后 flush 先于发布，canonical item 落库且 durable 顺序不变", async () => {
    const { db, threadID, turnID, storage, session, projector, context } = await setup()
    const ordering: string[] = []
    const originalFlush = storage.flush.bind(storage)
    storage.flush = (() => { ordering.push("flush"); originalFlush() }) as never
    const publishOrder: string[] = []
    const publish = async (event: { method: string }) => { publishOrder.push(`publish:${event.method}`) }
    ;(projector as unknown as { options: { publish: (event: { method: string }) => Promise<void> } }).options.publish = publish as never
    db.appendGuide(threadID, turnID, {
      content: "steer",
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "guide",
      taskMode: "chat",
    } as never, "input:projector:steer")
    const resultEntryID = await session.appendMessage({ role: "user", content: "ok", timestamp: 1 })

    await projector.handle({ context, type: "assistant.started", textItemID: "text-1", reasoningItemID: "reasoning-1", placement: "process" })
    await projector.handle({
      context,
      type: "assistant.completed",
      textItemID: "text-1",
      reasoningItemID: "reasoning-1",
      planItemID: "plan-1",
      placement: "result",
      sessionEntryID: resultEntryID,
      content: [{ type: "text", text: "完成了" }],
      text: "完成了",
      provider: "openai",
      api: "responses",
      model: "model",
      usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 0, reasoning: 0 },
    })
    await projector.handle({ context, type: "tool.started", toolCallID: "call-1", tool: "Read", input: { file_path: "a.txt" } })
    await projector.handle({ context, type: "tool.updated", toolCallID: "call-1", tool: "Read", update: "reading" })
    await projector.handle({ context, type: "tool.finished", toolCallID: "call-1", tool: "Read", result: "ok", details: undefined, isError: false })
    await projector.handle({ context, type: "queue.consumed", delivery: "steer", inputIDs: ["input:projector:steer"] })
    await projector.handle({ context, type: "runtime.savepoint", hadPendingMutations: true })

    expect(ordering).toEqual(["flush"])
    expect(publishOrder).toEqual([
      "publish:item/started",
      "publish:tool/callStarted",
      "publish:tool/outputDelta",
      "publish:tool/callCompleted",
      "publish:item/completed",
      "publish:queue/updated",
    ])
    expect(db.getItem("text-1")).toMatchObject({ id: "text-1", status: "completed", data: { text: "完成了" } })
    expect(db.getItem("call-1")).toMatchObject({ id: "call-1", status: "completed", data: { state: "completed", output: "ok" } })
    expect(storage.pendingCount).toBe(0)
  })

  test("savepoint 事务回滚时不发布任何事件并调用 discardPending", async () => {
    const { db, storage, published, projector, context } = await setup()
    db.sqlite.exec(`CREATE TRIGGER fail_savepoint BEFORE INSERT ON events WHEN NEW.method = 'item/completed' BEGIN SELECT RAISE(ABORT, 'outbox failed'); END`)

    await projector.handle({
      context,
      type: "assistant.completed",
      textItemID: "text-rollback",
      reasoningItemID: "reasoning-rollback",
      planItemID: "plan-rollback",
      placement: "result",
      content: [{ type: "text", text: "will roll back" }],
      text: "will roll back",
      provider: "openai",
      api: "responses",
      model: "model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })
    await expect(projector.handle({ context, type: "runtime.savepoint", hadPendingMutations: true }))
      .rejects.toThrow("outbox failed")
    expect(published).toEqual([])
    expect(storage.pendingCount).toBe(0)
    expect(db.getItem("text-rollback")).toBeNull()
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM pi_session_entries WHERE session_id = 'session-projector'").get()).toEqual({ count: 0 })

    // pending 已清理：后续 savepoint 不再发布旧项
    await projector.handle({ context, type: "runtime.savepoint", hadPendingMutations: false })
    expect(published).toEqual([])
  })

  test("aborted 清理 pending buffer 且不发布", async () => {
    const { storage, published, projector, context } = await setup()
    await projector.handle({
      context,
      type: "assistant.completed",
      textItemID: "text-abort",
      reasoningItemID: "reasoning-abort",
      planItemID: "plan-abort",
      placement: "result",
      content: [{ type: "text", text: "interrupted" }],
      text: "interrupted",
      provider: "openai",
      api: "responses",
      model: "model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })
    await projector.handle({ context, type: "runtime.aborted" })
    expect(storage.pendingCount).toBe(0)
    await projector.handle({ context, type: "runtime.savepoint", hadPendingMutations: false })
    expect(published).toEqual([])
  })

  test("compaction.completed 在事务内落盘并在提交后发布产品记录", async () => {
    const { db, storage, published, projector, session, context } = await setup()
    await session.appendMessage({ role: "user", content: "before", timestamp: 1 })
    const leaf = (await session.getLeafId())!
    await session.appendCompaction("summary", leaf, 100)
    const entryID = (await session.getLeafId())!
    const entry = await session.getEntry(entryID)

    const publishOrder: string[] = []
    ;(projector as unknown as { options: { publish: (event: { method: string }) => Promise<void> } }).options.publish = (async (event: { method: string }) => {
      publishOrder.push(`publish:${event.method}`)
    }) as never

    await projector.handle({
      context,
      type: "compaction.completed",
      entryID: entryID!,
      summary: entry?.type === "compaction" ? entry.summary : "",
      firstKeptEntryID: leaf,
      tokensBefore: 100,
      beforeCount: 1,
      trigger: "manual",
      promptText: "prompt",
    })
    expect(storage.pendingCount).toBe(0)
    expect(publishOrder).toEqual(["publish:context/compacted"])
  })
})

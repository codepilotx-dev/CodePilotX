import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
import { TurnPatchService } from "../src/patch/TurnPatchService"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { WorkspaceService } from "../src/workspace/WorkspaceService"

const roots: string[] = []
const databases: AgentDatabase[] = []
const hash = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex")

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map(async (root) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch (cause) {
        if (
          !(cause instanceof Error)
          || !("code" in cause)
          || cause.code !== "EBUSY"
        ) throw cause
        await Bun.sleep(50)
      }
    }
  }))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-turn-patch-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, {
    content: "修改两个文件",
    model: Model.Ref.make({
      providerID: Provider.ID.make("openai"),
      id: Model.ID.make("test"),
    }),
    permissionConfig: {
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
    },
    strategy: "queue",
    taskMode: "chat",
  })
  const workspace = await WorkspaceService.open(root)
  const itemID = `patch:${turn.turnID}`
  db.upsertItem(thread.id, {
    id: itemID,
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: "patch",
    status: "completed",
    data: {
      files: [
        { path: "first.txt", additions: 1, deletions: 1 },
        { path: "second.txt", additions: 1, deletions: 1 },
      ],
      totalAdditions: 2,
      totalDeletions: 2,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  db.repositories.turnPatches.recordBatch({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    toolCallID: "tool:edit-both",
    files: [
      {
        operation: "update",
        path: "first.txt",
        beforeContent: "first-before\n",
        afterContent: "first-after\n",
        beforeSha256: hash("first-before\n"),
        afterSha256: hash("first-after\n"),
      },
      {
        operation: "update",
        path: "second.txt",
        beforeContent: "second-before\n",
        afterContent: "second-after\n",
        beforeSha256: hash("second-before\n"),
        afterSha256: hash("second-after\n"),
      },
    ],
  })
  const service = new TurnPatchService(
    db,
    await Effect.runPromise(EventHub.make),
    async () => workspace,
  )
  return { root, db, thread, turn, itemID, service }
}

describe("TurnPatchService", () => {
  test("任一文件 SHA 不匹配时整次撤销零写入，恢复端点后可撤销和重做", async () => {
    const { root, itemID, thread, service } = await fixture()
    await writeFile(join(root, "first.txt"), "first-after\n", "utf8")
    await writeFile(join(root, "second.txt"), "parallel-change\n", "utf8")

    await expect(service.apply({
      threadID: thread.id,
      itemID,
      action: "undo",
      expectedVersion: 0,
      operationID: "operation:conflict",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "patch-state-changed", paths: ["second.txt"] },
    })
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-after\n")
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("parallel-change\n")

    await writeFile(join(root, "second.txt"), "second-after\n", "utf8")
    const undone = await service.apply({
      threadID: thread.id,
      itemID,
      action: "undo",
      expectedVersion: 0,
      operationID: "operation:undo",
    })
    expect(undone.data).toMatchObject({
      reversible: true,
      applyState: "undone",
      actionVersion: 1,
    })
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-before\n")
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("second-before\n")

    const reapplied = await service.apply({
      threadID: thread.id,
      itemID,
      action: "reapply",
      expectedVersion: 1,
      operationID: "operation:reapply",
    })
    expect(reapplied.data).toMatchObject({
      applyState: "applied",
      actionVersion: 2,
    })
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-after\n")
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("second-after\n")
  })

  test("同一文件多批次折叠到轮次端点，并撤销/重做创建文件", async () => {
    const { root, db, itemID, thread, turn, service } = await fixture()
    db.repositories.turnPatches.recordBatch({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      toolCallID: "tool:follow-up",
      files: [
        {
          operation: "update",
          path: "first.txt",
          beforeContent: "first-after\n",
          afterContent: "first-final\n",
          beforeSha256: hash("first-after\n"),
          afterSha256: hash("first-final\n"),
        },
        {
          operation: "create",
          path: "created.txt",
          beforeContent: null,
          afterContent: "created\n",
          beforeSha256: null,
          afterSha256: hash("created\n"),
        },
      ],
    })
    await writeFile(join(root, "first.txt"), "first-final\n", "utf8")
    await writeFile(join(root, "second.txt"), "second-after\n", "utf8")
    await writeFile(join(root, "created.txt"), "created\n", "utf8")

    await service.apply({
      threadID: thread.id,
      itemID,
      action: "undo",
      expectedVersion: 0,
      operationID: "operation:chain-undo",
    })
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-before\n")
    expect(await Bun.file(join(root, "created.txt")).exists()).toBe(false)

    const reapplied = await service.apply({
      threadID: thread.id,
      itemID,
      action: "reapply",
      expectedVersion: 1,
      operationID: "operation:chain-reapply",
    })
    expect(reapplied.data.actionVersion).toBe(2)
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-final\n")
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe("created\n")

    const repeated = await service.apply({
      threadID: thread.id,
      itemID,
      action: "reapply",
      expectedVersion: 1,
      operationID: "operation:chain-reapply",
    })
    expect(repeated.data.actionVersion).toBe(2)
    expect(await readFile(join(root, "created.txt"), "utf8")).toBe("created\n")
  })

  test("任一工具证据被标记不完整后整轮卡片拒绝撤销", async () => {
    const { root, db, itemID, thread, turn, service } = await fixture()
    db.repositories.turnPatches.markIncomplete(thread.id, turn.turnID)
    await writeFile(join(root, "first.txt"), "first-after\n", "utf8")
    await writeFile(join(root, "second.txt"), "second-after\n", "utf8")

    await expect(service.apply({
      threadID: thread.id,
      itemID,
      action: "undo",
      expectedVersion: 0,
      operationID: "operation:incomplete",
    })).rejects.toMatchObject({ code: "CONFLICT" })
    expect(await readFile(join(root, "first.txt"), "utf8")).toBe("first-after\n")
    expect(await readFile(join(root, "second.txt"), "utf8")).toBe("second-after\n")
  })
})

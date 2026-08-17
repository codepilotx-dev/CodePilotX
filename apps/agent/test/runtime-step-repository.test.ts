import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeFixturePaths } from "./fixture-cleanup"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import {
  RuntimeStepRepository,
  runtimeContextDigest,
} from "../src/storage/repositories/runtime-step-repository"

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-runtime-step-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const thread = db.createThread("runtime step test")
  const turn = db.createTurn(thread.id, {
    content: "initial",
    model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
    permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
    strategy: "queue",
    taskMode: "chat",
  })
  db.sqlite.query("DELETE FROM inputs WHERE turn_id = ?").run(turn.turnID)
  const enqueue = (content: string, deliveryKind: "wake" | "steer" | "follow-up" | "next-turn" | "context", createdAt: number) => {
    db.appendGuide(thread.id, turn.turnID, {
      content,
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "guide",
      taskMode: "chat",
    }, `input:${deliveryKind}:${createdAt}`)
    db.sqlite.query(
      "UPDATE inputs SET delivery_kind = ?, created_at = ? WHERE id = ?",
    ).run(deliveryKind, createdAt, `input:${deliveryKind}:${createdAt}`)
  }
  return { db, threadID: thread.id, turnID: turn.turnID, enqueue }
}

describe("RuntimeStepRepository", () => {
  test("inbox 按 created_at,id 原子认领且不重复", async () => {
    const { db, threadID, turnID, enqueue } = await setup()
    const repo = new RuntimeStepRepository(db)
    enqueue("wake-1", "wake", 100)
    enqueue("steer-1", "steer", 200)
    enqueue("follow-1", "follow-up", 300)

    const step1 = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m1", startedAt: 400 })
    const first = repo.claimInputs(threadID, turnID, step1.id)
    expect(first.map((input) => input.content)).toEqual(["wake-1", "steer-1", "follow-1"])
    const step2 = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m2", startedAt: 500 })
    const second = repo.claimInputs(threadID, turnID, step2.id)
    expect(second).toEqual([])
    expect([step1.ordinal, step2.ordinal]).toEqual([0, 1])
  })

  test("step 状态机：complete/fail/interrupt 与 ordinal 连续", async () => {
    const { db, threadID, turnID } = await setup()
    const repo = new RuntimeStepRepository(db)
    const step1 = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: ["input:a"], runtimeManifestHash: "m1", startedAt: 100 })
    repo.completeStep(step1.id, 200, "stop")
    const step2 = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m2", startedAt: 300 })
    repo.failStep(step2.id, 400)
    const step3 = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m3", startedAt: 500 })
    repo.interruptStep(step3.id, 600)

    const steps = repo.listSteps(turnID)
    expect(steps.map((step) => [step.ordinal, step.status])).toEqual([
      [0, "completed"],
      [1, "failed"],
      [2, "interrupted"],
    ])
    expect(steps[0]!.stopReason).toBe("stop")
    expect(steps[0]!.claimedInputIds).toEqual(["input:a"])
  })

  test("启动恢复：running step 标记 interrupted，未完成 claim 释放回 inbox", async () => {
    const { db, threadID, turnID, enqueue } = await setup()
    const repo = new RuntimeStepRepository(db)
    enqueue("wake-1", "wake", 100)
    enqueue("steer-1", "steer", 200)
    const step = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m1", startedAt: 300 })
    repo.claimInputs(threadID, turnID, step.id)

    const interrupted = repo.recoverInterruptedSteps()
    expect(interrupted).toEqual([{ threadId: threadID, turnId: turnID, stepId: step.id, ordinal: 0 }])
    const nextStep = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m2", startedAt: 400 })
    const reclaimed = repo.claimInputs(threadID, turnID, nextStep.id)
    expect(reclaimed.map((input) => input.content)).toEqual(["wake-1", "steer-1"])
  })

  test("context snapshot：digest 确定且 step 完成后 claim 不再释放", async () => {
    const { db, threadID, turnID, enqueue } = await setup()
    const repo = new RuntimeStepRepository(db)
    enqueue("wake-1", "wake", 100)
    const step = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m1", startedAt: 200 })
    repo.claimInputs(threadID, turnID, step.id)
    repo.completeStep(step.id, 300, "stop")

    const input = {
      threadId: threadID,
      turnId: turnID,
      stepId: step.id,
      attemptOrdinal: 0,
      piSessionId: "session:1",
      piLeafEntryId: "entry:leaf",
      messageEntryIds: ["entry:1", "entry:2"],
      messageDigest: "digest-messages",
      promptText: "system prompt",
      toolCatalogJson: "[]",
      runtimeManifestJson: "{}",
      createdAt: 400,
    }
    const record = repo.insertContextSnapshot(input)
    expect(record.contextDigest).toBe(runtimeContextDigest({
      messageEntryIds: input.messageEntryIds,
      messageDigest: input.messageDigest,
      promptText: input.promptText,
      toolCatalogJson: input.toolCatalogJson,
      runtimeManifestJson: input.runtimeManifestJson,
    }))

    // 同一 step 的第二个 attempt 允许（reactive compaction 后新快照）
    const second = repo.insertContextSnapshot({ ...input, attemptOrdinal: 1, createdAt: 500 })
    expect(second.attemptOrdinal).toBe(1)

    // completed step 的 claim 永久保留（consumed 语义）
    repo.releaseUncommittedClaims(threadID, turnID)
    const nextStep = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m2", startedAt: 600 })
    expect(repo.claimInputs(threadID, turnID, nextStep.id)).toEqual([])
  })

  test("thread 永久删除级联清理 runtime step 与 context snapshot", async () => {
    const { db, threadID, turnID } = await setup()
    const repo = new RuntimeStepRepository(db)
    const step = repo.insertStep({ threadId: threadID, turnId: turnID, claimedInputIds: [], runtimeManifestHash: "m1", startedAt: 100 })
    repo.insertContextSnapshot({
      threadId: threadID,
      turnId: turnID,
      stepId: step.id,
      attemptOrdinal: 0,
      piSessionId: "session:1",
      piLeafEntryId: null,
      messageEntryIds: [],
      messageDigest: "d",
      promptText: "p",
      toolCatalogJson: "[]",
      runtimeManifestJson: "{}",
      createdAt: 200,
    })

    db.sqlite.query("DELETE FROM threads WHERE id = ?").run(threadID)
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM runtime_steps").get()).toEqual({ count: 0 })
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM runtime_context_snapshots").get()).toEqual({ count: 0 })
  })
})

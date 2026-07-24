import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestionService } from "../src/session/QuestionService"
import { EventHub } from "../src/storage/events/EventHub"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { Model, Provider } from "@codepilotx/model-schema"

const databases: AgentDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe("问题 checkpoint", () => {
  test("回复持久化 RunState 并触发恢复回调，不依赖内存 Promise", async () => {
    const db = new AgentDatabase(join(tmpdir(), `codepilotx-question-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = { content: "规划一个改动", model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" }, strategy: "queue", taskMode: "plan" } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    const resumed: string[] = []
    questions.setResumeHandler((_threadID, turnID) => resumed.push(turnID))
    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: "clarification",
      question: "选择实现方式",
      options: ["A", "B"],
      checkpoint: { state: '{"version":1}', interruption: { name: "request_user_input" } },
    })

    await questions.reply(id, "A")
    const checkpoint = questions.claimResolvedCheckpoint(turn.turnID)

    expect(resumed).toEqual([turn.turnID])
    expect(checkpoint?.approval).toEqual({ state: '{"version":1}', interruption: { name: "request_user_input" }, answer: "A", checkpointID: id })
  })

  test("问题创建和回复在 outbox 失败时整体回滚", async () => {
    const db = new AgentDatabase(join(tmpdir(), `codepilotx-question-atomic-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = { content: "规划一个改动", model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" }, strategy: "queue", taskMode: "plan" } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    db.sqlite.exec(`CREATE TRIGGER fail_question_requested BEFORE INSERT ON events WHEN NEW.method = 'question/requested' BEGIN SELECT RAISE(ABORT, 'question outbox unavailable'); END`)
    await expect(questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: "clarification",
      question: "选择实现方式",
      options: ["A", "B"],
      checkpoint: { state: '{"version":1}', interruption: { name: "request_user_input" } },
    })).rejects.toThrow("question outbox unavailable")
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM question_requests WHERE turn_id = ?").get(turn.turnID)).toEqual({ count: 0 })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "running" })
    db.sqlite.exec("DROP TRIGGER fail_question_requested")

    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: "clarification",
      question: "选择实现方式",
      options: ["A", "B"],
      checkpoint: { state: '{"version":1}', interruption: { name: "request_user_input" } },
    })
    db.sqlite.exec(`CREATE TRIGGER fail_question_resolved BEFORE INSERT ON events WHEN NEW.method = 'serverRequest/resolved' BEGIN SELECT RAISE(ABORT, 'resolve outbox unavailable'); END`)
    await expect(questions.reply(id, "A")).rejects.toThrow("resolve outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM question_requests WHERE id = ?").get(id)).toEqual({ status: "pending" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_question" })
  })
})

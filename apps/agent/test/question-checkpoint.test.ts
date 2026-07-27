import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestionService } from "../src/session/QuestionService"
import { createLifecycleTools } from "../src/orchestration/pi/PiToolAdapter"
import { EventHub } from "../src/storage/events/EventHub"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { Model, Provider } from "@codepilotx/model-schema"

const databases: AgentDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe("问题 checkpoint", () => {
  test("request_user_input 接受 rich questions 并拒绝越界超时", async () => {
    const received: unknown[] = []
    const [tool] = createLifecycleTools({
      requestUserInput: async (input) => {
        received.push(input)
        return { paused: true }
      },
    }, { exposedTools: ["request_user_input"] } as never)
    const input = {
      questions: [{
        id: "delivery",
        header: "发送方式",
        question: "下一条消息如何处理？",
        options: [
          { label: "Steer", description: "进入当前 Turn" },
          { label: "排队", description: "等待下一 Turn" },
        ],
      }],
      autoResolutionMs: 60_000,
    }
    await tool!.execute("question-call", input as never, new AbortController().signal)
    expect(received).toEqual([input])
    await expect(tool!.execute("question-call-2", { ...input, autoResolutionMs: 59_999 } as never, new AbortController().signal)).rejects.toThrow()
  })

  test("rich questions 按结构化 answers 恢复，不压平多题答案", async () => {
    const db = new AgentDatabase(join(tmpdir(), `codepilotx-question-rich-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const thread = db.createThread()
    const input = { content: "规划一个改动", model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" }, strategy: "queue", taskMode: "plan" } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const questions = new QuestionService(db, hub)
    const id = await questions.checkpoint(thread.id, turn.turnID, turn.agentID, {
      kind: "clarification",
      questions: [
        {
          id: "delivery",
          header: "发送方式",
          question: "下一条消息如何处理？",
          options: [
            { label: "Steer", description: "进入当前 Turn" },
            { label: "排队", description: "等待下一 Turn" },
          ],
        },
        {
          id: "persist",
          header: "持久化",
          question: "是否持久化？",
          options: [
            { label: "是", description: "写入 SQLite" },
            { label: "否", description: "仅保存在内存" },
          ],
        },
      ],
      checkpoint: { state: '{"version":2}', interruption: { name: "request_user_input" } },
    })
    const row = db.sqlite.query("SELECT payload, payload_version FROM question_requests WHERE id = ?").get(id) as { payload: string; payload_version: number }
    expect(row.payload_version).toBe(2)
    expect(JSON.parse(row.payload).questions).toHaveLength(2)

    await questions.reply(id, [
      { questionId: "delivery", choiceIds: ["delivery:0"] },
      { questionId: "persist", choiceIds: [], text: "需要持久化" },
    ])
    const checkpoint = questions.claimResolvedCheckpoint(turn.turnID)
    expect(JSON.parse(checkpoint!.approval.answer!)).toEqual({
      resolution: "user",
      answers: [
        { questionId: "delivery", choiceIds: ["delivery:0"] },
        { questionId: "persist", choiceIds: [], text: "需要持久化" },
      ],
    })
  })

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
    db.sqlite.exec(`CREATE TRIGGER fail_question_resolved BEFORE INSERT ON events WHEN NEW.method = 'interaction/resolved' BEGIN SELECT RAISE(ABORT, 'resolve outbox unavailable'); END`)
    await expect(questions.reply(id, "A")).rejects.toThrow("resolve outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM question_requests WHERE id = ?").get(id)).toEqual({ status: "pending" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_question" })
    db.sqlite.exec("DROP TRIGGER fail_question_resolved")

    const operation = {
      operationID: "question:resolve:atomic",
      interactionID: id,
      response: {
        kind: "question",
        status: "answered",
        answers: [{ questionId: "question-tool", choiceIds: ["question-tool:0"] }],
        resolution: "user",
      },
      result: { interactionId: id, state: "resolved" },
    }
    db.sqlite.exec(`CREATE TRIGGER fail_interaction_operation BEFORE INSERT ON interaction_operations BEGIN SELECT RAISE(ABORT, 'operation unavailable'); END`)
    await expect(questions.reply(id, "A", false, "user", false, operation)).rejects.toThrow("operation unavailable")
    expect(db.sqlite.query("SELECT status FROM question_requests WHERE id = ?").get(id)).toEqual({ status: "pending" })
    expect(db.interactionOperation(operation.operationID)).toBeNull()
    db.sqlite.exec("DROP TRIGGER fail_interaction_operation")

    await questions.reply(id, "A", false, "user", false, operation)
    expect(db.interactionOperation(operation.operationID)?.result).toEqual(operation.result)
    const resolvedEvent = db.sqlite.query("SELECT params FROM events WHERE method = 'interaction/resolved' AND turn_id = ?").get(turn.turnID) as { params: string }
    expect(JSON.parse(resolvedEvent.params)).toEqual({
      result: operation.response,
      resolvedAt: expect.any(Number),
    })
  })
})

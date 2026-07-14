import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QuestionService } from "../src/session/QuestionService"
import { EventHub } from "../src/storage/EventHub"
import { AgentDatabase } from "../src/storage/Database"

const databases: AgentDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe("问题 checkpoint", () => {
  test("回复持久化 RunState 并触发恢复回调，不依赖内存 Promise", async () => {
    const db = new AgentDatabase(join(tmpdir(), `codepilotx-question-${crypto.randomUUID()}.sqlite`))
    databases.push(db)
    const hub = await Effect.runPromise(EventHub.make)
    const session = db.createSession()
    const input = { content: "规划一个改动", model: { providerID: "openai", modelID: "test" }, permissionMode: "ask", strategy: "queue", taskMode: "plan" } as const
    const run = db.createRun(session.id, input)
    db.startRun(run.runID)
    const questions = new QuestionService(db, hub)
    const resumed: string[] = []
    questions.setResumeHandler((_sessionID, runID) => resumed.push(runID))
    const id = await questions.checkpoint(session.id, run.runID, {
      kind: "clarification",
      question: "选择实现方式",
      options: ["A", "B"],
      checkpoint: { state: '{"version":1}', interruption: { name: "request_user_input" } },
    })

    await questions.reply(id, "A")
    const checkpoint = questions.claimResolvedCheckpoint(run.runID)

    expect(resumed).toEqual([run.runID])
    expect(checkpoint?.approval).toEqual({ state: '{"version":1}', interruption: { name: "request_user_input" }, answer: "A" })
  })
})

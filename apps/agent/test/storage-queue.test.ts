import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/Database"
import { Model, Provider } from "@codepilotx/model-schema"

const paths: string[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const modelRef = (providerID: string, id: string) => Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make(id) })
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
afterEach(async () => Promise.all(paths.splice(0).map((path) => removePath(path))))

describe("持久化队列", () => {
  test("严格按创建顺序取下一条 Turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "first", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const first = db.createTurn(thread.id, input)
    db.createTurn(thread.id, { ...input, content: "second" })
    expect(db.nextQueuedTurn(thread.id)?.id).toBe(first.turnID)
    db.close()
  })

  test("主 Agent 模型按项目默认和全局默认回退", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const globalModel = modelRef("openai", "global")
    const defaultModel = modelRef("openai", "project")

    db.saveProjectSettings(project.id, { defaultModel })
    expect(db.resolveProjectModel(project.id, globalModel)).toEqual(defaultModel)
    db.saveProjectSettings(project.id, { defaultModel: null })
    expect(db.resolveProjectModel(project.id, globalModel)).toEqual(globalModel)
    db.close()
  })

  test("重启时保留具有 checkpoint 的待回答问题", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const databasePath = join(root, "agent.sqlite")
    const db = new AgentDatabase(databasePath)
    const thread = db.createThread()
    const input = { content: "plan", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "plan" } as const
    const turn = db.createTurn(thread.id, input)
    db.updateTurnStatus(turn.turnID, "waiting_question")
    db.updateAgentStatus(turn.agentID, "waiting_question")
    db.saveAgentTurnCheckpoint({ agentID: turn.agentID, turnID: turn.turnID, threadID: thread.id, state: "waiting_question", payload: { inputID: turn.inputID }, version: 1 })
    db.run("INSERT INTO question_requests (id, thread_id, turn_id, agent_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)", "question", thread.id, turn.turnID, turn.agentID, JSON.stringify({ question: "确认范围？" }), Date.now())
    db.close()

    const recovered = new AgentDatabase(databasePath)
    expect(recovered.activeTurn(thread.id)).toMatchObject({ id: turn.turnID, status: "waiting_question" })
    expect(recovered.sqlite.query("SELECT status FROM question_requests WHERE id = 'question'").get()).toEqual({ status: "pending" })
    recovered.close()
  })
})

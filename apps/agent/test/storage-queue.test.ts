import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/Database"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("持久化队列", () => {
  test("严格按创建顺序取下一条 Run", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const session = db.createSession()
    const input = { content: "first", model: { providerID: "openai", modelID: "gpt" }, permissionMode: "review", strategy: "queue", taskMode: "chat" } as const
    const first = db.createRun(session.id, input)
    db.createRun(session.id, { ...input, content: "second" })
    expect(db.nextQueuedRun(session.id)?.id).toBe(first.runID)
    db.close()
  })

  test("项目模型按角色、项目默认和全局默认回退", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const project = db.createProject({ rootPath: join(root, "project"), name: "测试项目" })
    const globalModel = { providerID: "openai", modelID: "global" }
    const defaultModel = { providerID: "openai", modelID: "project" }
    const reviewerModel = { providerID: "anthropic", modelID: "reviewer" }

    db.saveProjectSettings(project.id, { defaultModel, plannerModel: null, developerModel: null, reviewerModel })
    expect(db.resolveProjectModel(project.id, "planner", globalModel)).toEqual(defaultModel)
    expect(db.resolveProjectModel(project.id, "reviewer", globalModel)).toEqual(reviewerModel)
    db.saveProjectSettings(project.id, { defaultModel: null, plannerModel: null, developerModel: null, reviewerModel: null })
    expect(db.resolveProjectModel(project.id, "developer", globalModel)).toEqual(globalModel)
    db.close()
  })

  test("重启时保留具有 checkpoint 的待回答问题", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const databasePath = join(root, "agent.sqlite")
    const db = new AgentDatabase(databasePath)
    const session = db.createSession()
    const input = { content: "plan", model: { providerID: "openai", modelID: "gpt" }, permissionMode: "review", strategy: "queue", taskMode: "plan" } as const
    const run = db.createRun(session.id, input)
    db.setRunWorkflowState(run.runID, { status: "waiting_question", currentStage: "planner", canContinueFromPlan: false })
    db.saveAgentRunCheckpoint({ runID: run.runID, sessionID: session.id, stage: "planner", state: "waiting_question", payload: { inputID: run.inputID }, version: 1 })
    db.run("INSERT INTO questions (id, session_id, run_id, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", "question", session.id, run.runID, JSON.stringify({ question: "确认范围？" }), Date.now())
    db.close()

    const recovered = new AgentDatabase(databasePath)
    expect(recovered.activeRun(session.id)).toMatchObject({ id: run.runID, status: "waiting_question" })
    expect(recovered.sqlite.query("SELECT status FROM questions WHERE id = 'question'").get()).toEqual({ status: "pending" })
    recovered.close()
  })
})

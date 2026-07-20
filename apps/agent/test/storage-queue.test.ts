import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/Database"
import { AgentError } from "../src/domain"
import { ThreadProjection } from "../src/transport/ThreadProjection"
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
  test("保留客户端 inputId 并可恢复既有 turn admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "client admission", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const created = db.createTurn(thread.id, input, "queued", { inputID: "input:client:1" })
    expect(created.inputID).toBe("input:client:1")
    expect(db.inputAdmission("input:client:1")).toMatchObject({
      id: "input:client:1",
      thread_id: thread.id,
      turn_id: created.turnID,
      content: input.content,
    })
    const guide = db.appendGuide(thread.id, created.turnID, { ...input, strategy: "guide", content: "steer" }, "input:steer:1")
    expect(guide.inputID).toBe("input:steer:1")
    expect(db.inputAdmission("input:steer:1")).toMatchObject({
      turn_id: created.turnID,
      strategy: "guide",
    })
    db.close()
  })

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

  test("重排顺序持久化并参与下一条 Turn 选择", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const databasePath = join(root, "agent.sqlite")
    const input = { content: "first", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const db = new AgentDatabase(databasePath)
    const thread = db.createThread()
    const first = db.createTurn(thread.id, input)
    const second = db.createTurn(thread.id, { ...input, content: "second" })
    const third = db.createTurn(thread.id, { ...input, content: "third" })
    db.reorderQueuedInputs(thread.id, [third.inputID, first.inputID, second.inputID], { operationID: "reorder-1", expectedVersion: 3 })
    db.close()

    const reopened = new AgentDatabase(databasePath)
    expect(reopened.nextQueuedTurn(thread.id)?.id).toBe(third.turnID)
    reopened.close()
  })

  test("编辑删除校验版本且相同 operationId 可安全重试", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "queued", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const queued = db.createTurn(thread.id, input)
    db.updateQueuedInput(thread.id, queued.inputID, "edited", { operationID: "update-1", expectedVersion: 1 })
    const removed = db.removeQueuedInput(thread.id, queued.inputID, { operationID: "remove-1", expectedVersion: 2 })
    const duplicate = db.removeQueuedInput(thread.id, queued.inputID, { operationID: "remove-1", expectedVersion: 2 })
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.event?.id).toBe(removed.event?.id)
    expect(() => db.resumeQueue(thread.id, { operationID: "stale", expectedVersion: 1 })).toThrow(AgentError)
    expect(db.queueStateMeta(thread.id)).toEqual({ version: 3, pauseReason: null })
    db.close()
  })

  test("中断暂停队列并由 resume 恢复", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "queued", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const queued = db.createTurn(thread.id, input)
    db.pauseQueue(thread.id, "interrupted")
    expect(db.nextQueuedTurn(thread.id)).toBeNull()
    db.resumeQueue(thread.id, { operationID: "resume-1", expectedVersion: 2 })
    expect(db.nextQueuedTurn(thread.id)?.id).toBe(queued.turnID)
    db.close()
  })

  test("删除暂停队列最后一条消息会清除暂停原因", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "queued", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const queued = db.createTurn(thread.id, input)
    db.pauseQueue(thread.id, "interrupted")
    db.removeQueuedInput(thread.id, queued.inputID, { operationID: "remove-last", expectedVersion: 2 })
    expect(db.queueStateMeta(thread.id)).toEqual({ version: 3, pauseReason: null })
    db.close()
  })

  test("Steer 原子转移 queued input 到活动 Turn mailbox", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-db-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread()
    const input = { content: "active", model: modelRef("openai", "gpt"), permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" }, strategy: "queue", taskMode: "chat" } as const
    const active = db.createTurn(thread.id, input)
    db.claimTurnExecution(active.turnID)
    const queued = db.createTurn(thread.id, { ...input, content: "steer me" })
    expect(new ThreadProjection(db).list().find((item) => item.id === thread.id)?.latestTurnStatus).toBe("running")
    db.steerQueuedInput(thread.id, queued.inputID, { operationID: "steer-1", expectedVersion: 3 })
    expect(db.activeTurn(thread.id)?.id).toBe(active.turnID)
    expect(db.hasGuideMailbox(active.turnID)).toBe(true)
    expect(db.sqlite.query("SELECT turn_id, status FROM inputs WHERE id = ?").get(queued.inputID)).toEqual({ turn_id: active.turnID, status: "mailbox" })
    expect(db.sqlite.query("SELECT 1 FROM turns WHERE id = ?").get(queued.turnID)).toBeNull()
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

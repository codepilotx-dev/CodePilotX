import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/Database"

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true }).catch(() => undefined)))
})

const input = {
  content: "执行任务",
  model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
  permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
  strategy: "queue",
  taskMode: "chat",
} as const

describe("Turn 生命周期事务", () => {
  test("start outbox 失败时不留下 running 状态", () => {
    const path = join(tmpdir(), `codepilotx-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.sqlite.exec(`CREATE TRIGGER fail_turn_started BEFORE INSERT ON events WHEN NEW.method = 'turn/started' BEGIN SELECT RAISE(ABORT, 'start outbox unavailable'); END`)

    expect(() => db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })).toThrow("start outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "queued" })
    expect(db.sqlite.query("SELECT status FROM agent_executions WHERE id = ?").get(turn.agentID)).toEqual({ status: "queued" })
  })

  test("terminal outbox 失败时状态、checkpoint 和队列一起回滚", () => {
    const path = join(tmpdir(), `codepilotx-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    db.saveAgentTurnCheckpoint({ agentID: turn.agentID, turnID: turn.turnID, threadID: thread.id, state: "ready", payload: { marker: true }, version: 1 })
    db.sqlite.exec(`CREATE TRIGGER fail_turn_completed BEFORE INSERT ON events WHEN NEW.method = 'turn/completed' BEGIN SELECT RAISE(ABORT, 'terminal outbox unavailable'); END`)

    expect(() => db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: "completed" })).toThrow("terminal outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "running" })
    expect(db.sqlite.query("SELECT status FROM agent_executions WHERE id = ?").get(turn.agentID)).toEqual({ status: "running" })
    expect(db.getAgentTurnCheckpoint(turn.turnID)).not.toBeNull()
  })

  test("interrupt outbox 失败时 claimed/resuming checkpoint 不会被提前消费", () => {
    const path = join(tmpdir(), `codepilotx-interrupt-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    db.saveAgentTurnCheckpoint({ agentID: turn.agentID, turnID: turn.turnID, threadID: thread.id, state: "ready", payload: {}, version: 1 })
    db.sqlite.query(`
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at)
      VALUES ('claimed', ?, ?, ?, 'tool', 'high', 'test', 'claimed', 'allow', '{}', ?)
    `).run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.sqlite.query(`
      INSERT INTO question_requests
        (id, thread_id, turn_id, agent_id, payload, payload_version, status, answer, created_at)
      VALUES ('resuming', ?, ?, ?, '{}', 1, 'resuming', '{"value":"A"}', ?)
    `).run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.sqlite.exec(`CREATE TRIGGER fail_turn_interrupted BEFORE INSERT ON events WHEN NEW.method = 'turn/interrupted' BEGIN SELECT RAISE(ABORT, 'interrupt outbox unavailable'); END`)

    expect(() => db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: "interrupted" })).toThrow("interrupt outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'claimed'").get()).toEqual({ status: "claimed" })
    expect(db.sqlite.query("SELECT status FROM question_requests WHERE id = 'resuming'").get()).toEqual({ status: "resuming" })
    expect(db.getAgentTurnCheckpoint(turn.turnID)).not.toBeNull()
  })

  test("plan ready 和 decision 的 projection 与 outbox 同事务", () => {
    const path = join(tmpdir(), `codepilotx-plan-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, { ...input, taskMode: "plan" })
    db.claimTurnExecution(turn.turnID)
    const createdAt = Date.now()
    const planItem = {
      id: `${turn.turnID}:plan`,
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: "plan" as const,
      status: "pending" as const,
      data: { title: "计划", markdown: "step", version: 1, state: "awaiting-confirmation" },
      createdAt,
      updatedAt: createdAt,
    }
    db.sqlite.exec(`CREATE TRIGGER fail_plan_ready BEFORE INSERT ON events WHEN NEW.method = 'plan/ready' BEGIN SELECT RAISE(ABORT, 'plan ready outbox unavailable'); END`)
    expect(() => db.waitForPlanConfirmation({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      payload: { plan: "step" },
      version: 1,
      plan: "step",
      item: planItem,
    })).toThrow("plan ready outbox unavailable")
    expect(db.getItem(planItem.id)).toBeNull()
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toBeNull()
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "running" })
    db.sqlite.exec("DROP TRIGGER fail_plan_ready")

    db.waitForPlanConfirmation({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      payload: { plan: "step" },
      version: 1,
      plan: "step",
      item: planItem,
    })
    db.sqlite.exec(`CREATE TRIGGER fail_plan_decision BEFORE INSERT ON events WHEN NEW.method = 'plan/decision' BEGIN SELECT RAISE(ABORT, 'plan decision outbox unavailable'); END`)
    expect(() => db.decidePlan(turn.turnID, "continue")).toThrow("plan decision outbox unavailable")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_plan_confirmation" })
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe("waiting_plan_confirmation")
  })

  test("重启中断写入 turn、agent、item 和 queue durable events 且只执行一次", () => {
    const path = join(tmpdir(), `codepilotx-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const thread = db.createThread()
    const active = db.createTurn(thread.id, input)
    db.claimTurnExecution(active.turnID)
    db.upsertItem(thread.id, { id: "running-item", turnID: active.turnID, agentID: active.agentID, type: "tool", status: "running", data: {}, createdAt: Date.now(), updatedAt: Date.now() })
    db.createTurn(thread.id, { ...input, content: "queued" })
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(active.turnID)).toEqual({ status: "interrupted" })
    for (const method of ["turn/interrupted", "agent/upserted", "item/completed", "queue/updated"]) {
      expect((db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = ? AND (turn_id = ? OR thread_id = ?)").get(method, active.turnID, thread.id) as { count: number }).count).toBeGreaterThan(0)
    }
    const count = (db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'turn/interrupted' AND turn_id = ?").get(active.turnID) as { count: number }).count
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE method = 'turn/interrupted' AND turn_id = ?").get(active.turnID)).toEqual({ count })
  })

  test("重启会安全重开纯数据 checkpoint，并对运行中的审批副作用 fail-closed", () => {
    const path = join(tmpdir(), `codepilotx-claim-recovery-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const thread = db.createThread()
    const questionTurn = db.createTurn(thread.id, input)
    db.claimTurnExecution(questionTurn.turnID)
    db.sqlite.query(`
      INSERT INTO question_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, payload, payload_version, status, answer, created_at, resolved_at)
      VALUES ('question-resuming', ?, ?, ?, 'question-tool', '{}', 1, 'resuming', '{"value":"A"}', ?, ?)
    `).run(thread.id, questionTurn.turnID, questionTurn.agentID, Date.now(), Date.now())

    const denyTurn = db.createTurn(thread.id, { ...input, content: "deny" })
    db.claimTurnExecution(denyTurn.turnID)
    db.sqlite.query(`
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at, resolved_at)
      VALUES ('approval-deny', ?, ?, ?, 'deny-tool', 'high', 'deny', 'claimed', 'deny', '{}', ?, ?)
    `).run(thread.id, denyTurn.turnID, denyTurn.agentID, Date.now(), Date.now())

    const ambiguousTurn = db.createTurn(thread.id, { ...input, content: "ambiguous" })
    db.claimTurnExecution(ambiguousTurn.turnID)
    db.sqlite.query(`
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at, resolved_at)
      VALUES ('approval-running', ?, ?, ?, 'running-tool', 'high', 'allow', 'claimed', 'allow', '{}', ?, ?)
    `).run(thread.id, ambiguousTurn.turnID, ambiguousTurn.agentID, Date.now(), Date.now())
    db.sqlite.query(`
      INSERT INTO tool_calls
        (id, thread_id, turn_id, agent_id, tool_name, input, status, started_at)
      VALUES ('running-tool', ?, ?, ?, 'Shell', '{}', 'running', ?)
    `).run(thread.id, ambiguousTurn.turnID, ambiguousTurn.agentID, Date.now())
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    expect(db.sqlite.query("SELECT status FROM question_requests WHERE id = 'question-resuming'").get()).toEqual({ status: "resolved" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(questionTurn.turnID)).toEqual({ status: "queued" })
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'approval-deny'").get()).toEqual({ status: "resolved" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(denyTurn.turnID)).toEqual({ status: "queued" })
    expect(db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'approval-running'").get()).toEqual({ status: "cancelled" })
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(ambiguousTurn.turnID)).toEqual({ status: "interrupted" })
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?").get(ambiguousTurn.turnID)).toEqual({ method: "approval/cancelled" })
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'turn/interrupted' AND turn_id = ?").get(ambiguousTurn.turnID)).toEqual({ method: "turn/interrupted" })
  })
})

import { afterEach, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
import { DEFAULT_PERMISSION_CONFIG, formatStructuredPlanMarkdown, type StructuredPlan } from "@codepilotx/shared/thread"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { ThreadService } from "../src/session/ThreadService"
import { PlanApprovalService } from "../src/session/plan/PlanApprovalService"
import { ThreadProjection } from "../src/transport/ThreadProjection"
import { filterAdvertisedCapabilities } from "../src/transport/rpc/handlers/system-capabilities"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
const databases: AgentDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})
const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") })
const input = { content: "调查并计划", model, permissionConfig: DEFAULT_PERMISSION_CONFIG, taskMode: "plan" as const, strategy: "start" as const }

function client(db: AgentDatabase, root: string, onValidate?: () => Promise<void>) {
  const hub = { publish: () => Effect.void }
  const threads = new ThreadService(db, hub as never, {
    resolve: async () => { await onValidate?.(); return { capabilities: { tools: true } } },
  } as never, null as never, { setResumeHandler: () => undefined } as never,
  { clearTurnPermissionGrants: () => undefined } as never,
  { resolvedWaitCheckpoint: () => null, setParentResumeHandler: () => undefined } as never,
  null as never, { dataRoot: root, userHome: root }, null as never, null as never,
  { resolve: async () => ({}) } as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)
  // Exercise real admission/transaction/dispatch, but do not call a provider or start tools.
  const dispatched: string[] = []
  Object.defineProperty(threads, "executeTurn", { value: async (_threadId: string, turnId: string) => { dispatched.push(turnId) } })
  const service = new PlanApprovalService(db, hub as never, threads)
  return { service, threads, dispatched }
}

async function fixture(onValidate?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "cpx-plan-approval-"))
  roots.push(root)
  const path = join(root, "history.sqlite")
  const db = new AgentDatabase(path)
  databases.push(db)
  const { service, threads, dispatched } = client(db, root, onValidate)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, input, "running")
  const planId = crypto.randomUUID()
  db.upsertItem(thread.id, { id: planId, turnID: turn.turnID, agentID: turn.agentID, type: "plan", status: "completed", data: { title: "真实计划", markdown: "修改 A，然后验证 B。" }, createdAt: Date.now(), updatedAt: Date.now() })
  db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: "completed" })
  const approval = service.read(thread.id)!
  const params = { threadId: thread.id, approvalId: approval.id, expectedVersion: approval.version, operationId: crypto.randomUUID() }
  return { db, root, path, service, threads, dispatched, thread, turn, approval, params, planId }
}

test("完整计划在实时终态、快照和分页投影一致；未批准不启动轮次", async () => {
  const { db, thread, approval, dispatched } = await fixture()
  const projection = new ThreadProjection(db)
  expect(dispatched).toEqual([])
  expect(projection.snapshot(thread.id)?.pendingPlanApproval).toEqual(approval)
  expect(projection.historyPage(thread.id)?.pendingPlanApproval).toEqual(approval)
  expect(projection.list().find((item) => item.id === thread.id)?.pendingPlanApproval).toBe(true)
})

test("实施原子接纳且同操作重试/并发只启动一次；模型和权限保持", async () => {
  const { db, service, params, dispatched, approval, thread } = await fixture()
  const selected = { ...model, variant: Model.VariantID.make("high") }
  const request = { ...params, response: { action: "implement" as const, model: selected } }
  const results = await Promise.all([service.respond(request), service.respond(request)])
  expect(results.map((result) => result.disposition)).toEqual(["applied", "duplicate"])
  expect(dispatched).toHaveLength(1)
  expect(results[0]!.approval.status).toBe("implemented")
  const admitted = db.getTurnInput(results[0]!.approval.nextTurnId!)!
  expect(admitted.content).toContain(approval.markdown)
  expect(admitted.model).toEqual(selected)
  expect(admitted.permissionConfig).toEqual(DEFAULT_PERMISSION_CONFIG)
  expect(admitted.taskMode).toBe("chat")
  expect(service.read(thread.id)).toBeNull()
  await expect(service.respond({ ...request, response: { action: "implement", model: { ...selected, variant: Model.VariantID.make("low") } } })).rejects.toMatchObject({ code: "OPERATION_ID_CONFLICT" })
})

test("反馈创建 Plan 轮次；关闭不创建轮次且发设置事件；关闭记录重启不复活", async () => {
  const first = await fixture()
  const feedback = await first.service.respond({ ...first.params, response: { action: "feedback", feedback: "先处理 B" } })
  expect(first.db.getTurnInput(feedback.approval.nextTurnId!)?.taskMode).toBe("plan")
  expect(first.db.getTurnInput(feedback.approval.nextTurnId!)?.content).toContain("先处理 B")
  const second = await fixture()
  const closed = await second.service.respond({ ...second.params, response: { action: "close" } })
  expect(closed.approval.status).toBe("closed")
  expect(closed.approval.nextTurnId).toBeNull()
  expect(second.dispatched).toHaveLength(0)
  expect(second.db.getThreadSettings(second.thread.id)?.taskMode).toBe("chat")
  const events = second.db.sqlite.query("SELECT method FROM events WHERE thread_id = ? ORDER BY id DESC LIMIT 1").get(second.thread.id)
  expect(events).toMatchObject({ method: "thread/settings/updated" })
  second.db.close(); databases.splice(databases.indexOf(second.db), 1)
  const reopened = new AgentDatabase(second.path); databases.push(reopened)
  expect(reopened.repositories.planApprovals.pending(second.thread.id)).toBeNull()
  expect(reopened.repositories.planApprovals.get(closed.approval.id)?.status).toBe("closed")
})

test("异步校验期间出现新的输入会使旧计划失效，不能接纳旧计划", async () => {
  let intervene = () => {}
  const value = await fixture(async () => intervene())
  intervene = () => { value.db.createTurn(value.thread.id, { ...input, content: "新要求" }, "queued") }
  await expect(value.service.respond({ ...value.params, response: { action: "implement" } })).rejects.toMatchObject({ code: "TURN_ACTIVE" })
  expect(value.dispatched).toHaveLength(0)
  expect(value.db.repositories.planApprovals.get(value.approval.id)?.status).toBe("superseded")
})

test("事务接纳失败回滚批准和设置；变更源计划/子代理不能执行", async () => {
  const value = await fixture()
  value.db.sqlite.exec("CREATE TRIGGER reject_plan_input BEFORE INSERT ON inputs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
  await expect(value.service.respond({ ...value.params, response: { action: "implement" } })).rejects.toThrow("fixture failure")
  expect(value.db.repositories.planApprovals.get(value.approval.id)?.status).toBe("pending")
  expect(value.db.getThreadSettings(value.thread.id)?.taskMode).toBe("plan")
  expect(value.dispatched).toHaveLength(0)
  value.db.sqlite.exec("DROP TRIGGER reject_plan_input")
  value.db.sqlite.query("UPDATE items SET status = 'running' WHERE id = ?").run(value.planId)
  await expect(value.service.respond({ ...value.params, response: { action: "implement" } })).rejects.toMatchObject({ code: "CONFLICT" })
  value.db.sqlite.query("UPDATE threads SET kind = 'subagent' WHERE id = ?").run(value.thread.id)
  await expect(value.service.respond({ ...value.params, response: { action: "close" } })).rejects.toMatchObject({ code: "PERMISSION_DENIED" })
})

test("旧 schema43 升级恢复最新完整计划，保留历史数据与未知字段", async () => {
  const { db, path, thread, approval } = await fixture()
  db.sqlite.exec("DROP TABLE plan_approvals; PRAGMA user_version = 43; CREATE TABLE future_fixture(value TEXT); INSERT INTO future_fixture VALUES ('retained')")
  db.close(); databases.splice(databases.indexOf(db), 1)
  const upgraded = new AgentDatabase(path); databases.push(upgraded)
  expect(upgraded.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 49 })
  expect(upgraded.repositories.planApprovals.pending(thread.id)?.markdown).toBe(approval.markdown)
  expect(upgraded.sqlite.query("SELECT value FROM future_fixture").get()).toEqual({ value: "retained" })
  upgraded.repositories.planApprovals.recover()
  expect(upgraded.sqlite.query("SELECT count(*) as count FROM plan_approvals").get()).toEqual({ count: 1 })
})

test("普通编码、失败/中断、空或未完成计划均不产生批准；只选择最后完整计划", async () => {
  const { db, thread, service } = await fixture()
  for (const scenario of [
    { mode: "chat" as const, status: "completed" as const, itemStatus: "completed" as const, markdown: "不是 Plan" },
    { mode: "plan" as const, status: "failed" as const, itemStatus: "completed" as const, markdown: "失败计划" },
    { mode: "plan" as const, status: "interrupted" as const, itemStatus: "completed" as const, markdown: "中断计划" },
    { mode: "plan" as const, status: "completed" as const, itemStatus: "running" as const, markdown: "片段" },
    { mode: "plan" as const, status: "completed" as const, itemStatus: "completed" as const, markdown: "  " },
  ]) {
    const turn = db.createTurn(thread.id, { ...input, taskMode: scenario.mode }, "running")
    db.upsertItem(thread.id, { id: crypto.randomUUID(), turnID: turn.turnID, agentID: turn.agentID, type: "plan", status: scenario.itemStatus, data: { markdown: scenario.markdown }, createdAt: Date.now(), updatedAt: Date.now() })
    db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: scenario.status })
    expect(service.read(thread.id)).toBeNull()
  }
  const turn = db.createTurn(thread.id, input, "running")
  for (const markdown of ["较早计划", "最终计划"]) db.upsertItem(thread.id, { id: crypto.randomUUID(), turnID: turn.turnID, agentID: turn.agentID, type: "plan", status: "completed", data: { markdown }, createdAt: Date.now(), updatedAt: Date.now() })
  db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: "completed" })
  expect(service.read(thread.id)?.markdown).toBe("最终计划")
})

test("结构化计划随计划项与审批投影，并优先于同 turn 的标签计划", async () => {
  const root = await mkdtemp(join(tmpdir(), "cpx-plan-structured-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "history.sqlite"))
  databases.push(db)
  const { service } = client(db, root)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, input, "running")
  const structured: StructuredPlan = {
    title: "结构化计划交付",
    summary: "把最终方案升级为 submit_plan 提交。",
    changes: [{ area: "共享契约", items: ["新增 StructuredPlanSchema"] }],
    interfaceChanges: ["新增 plan.structured.v1"],
    tests: ["聚焦行为测试"],
    assumptions: [],
  }
  const markdown = formatStructuredPlanMarkdown(structured)
  // 先写入仅 Markdown 的标签计划，结构化计划随后提交且优先级更高。
  db.upsertItem(thread.id, { id: crypto.randomUUID(), turnID: turn.turnID, agentID: turn.agentID, type: "plan", status: "completed", data: { title: "标签计划", markdown: "# 标签计划\n\n旧方案" }, createdAt: Date.now(), updatedAt: Date.now() })
  const itemId = `${turn.turnID}:plan`
  db.upsertItem(thread.id, { id: itemId, turnID: turn.turnID, agentID: turn.agentID, type: "plan", status: "completed", data: { title: structured.title, markdown, structured }, createdAt: Date.now(), updatedAt: Date.now() })
  db.finalizeTurn({ threadID: thread.id, turnID: turn.turnID, agentID: turn.agentID, status: "completed" })

  const approval = service.read(thread.id)!
  expect(approval.planItemId).toBe(itemId)
  expect(approval.structured).toEqual(structured)
  expect(approval.markdown).toBe(markdown)

  const projection = new ThreadProjection(db)
  const snapshot = projection.snapshot(thread.id)!
  expect(snapshot.pendingPlanApproval?.structured).toEqual(structured)
  expect(projection.historyPage(thread.id)?.pendingPlanApproval?.structured).toEqual(structured)
  const planItems = snapshot.items.filter((item) => item.type === "plan")
  expect(planItems.find((item) => item.id === itemId)?.structured).toEqual(structured)
  expect(planItems.find((item) => item.id !== itemId)?.structured).toBeUndefined()

  const admitted = await service.respond({ ...approvalParams(approval, thread.id), response: { action: "implement" } })
  expect(db.getTurnInput(admitted.approval.nextTurnId!)?.content).toContain(markdown)

  // 非法或旧的结构化对象只回退到 Markdown，不透传未经验证的对象。
  db.sqlite.query("UPDATE items SET data = ? WHERE id = ?").run(JSON.stringify({ title: "坏数据", markdown: "仍可用", structured: { title: "缺字段" } }), itemId)
  const fallback = projection.snapshot(thread.id)!.items.find((item) => item.id === itemId)
  expect(fallback?.type === "plan" && fallback.structured).toBeUndefined()
  expect(fallback?.type === "plan" && fallback.markdown).toBe("仍可用")
})

function approvalParams(approval: { id: string; version: number }, threadId: string) {
  return { threadId, approvalId: approval.id, expectedVersion: approval.version, operationId: crypto.randomUUID() }
}

test("更高未知 schema 缺少新表时原样保留并禁用计划能力", async () => {
  const { db, path, thread } = await fixture()
  db.sqlite.exec("DROP TABLE plan_approvals; PRAGMA user_version = 99")
  db.close(); databases.splice(databases.indexOf(db), 1)
  const future = new AgentDatabase(path); databases.push(future)
  expect(future.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 99 })
  expect(future.repositories.planApprovals.available()).toBe(false)
  expect(filterAdvertisedCapabilities(future)).not.toContain("plan.approval.v1")
  expect(new ThreadProjection(future).historyPage(thread.id)?.pendingPlanApproval).toBeNull()
  expect(() => future.repositories.planApprovals.requireThread(thread.id, true)).toThrow("当前存储不支持计划批准")
})

test("独立连接与协调器并发批准经过异步屏障后仍只接纳一个轮次", async () => {
  let reached = 0
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const validate = async () => { if (++reached === 2) release(); await barrier }
  const first = await fixture(validate)
  const otherDb = new AgentDatabase(first.path); databases.push(otherDb)
  const second = client(otherDb, first.root, validate)
  const results = await Promise.allSettled([
    first.service.respond({ ...first.params, response: { action: "implement" } }),
    second.service.respond({ ...first.params, operationId: crypto.randomUUID(), response: { action: "implement" } }),
  ])
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
  expect([...first.dispatched, ...second.dispatched]).toHaveLength(1)
  expect(first.db.sqlite.query("SELECT count(*) as count FROM turns WHERE thread_id = ?").get(first.thread.id)).toEqual({ count: 2 })
  expect(first.db.repositories.planApprovals.get(first.approval.id)?.status).toBe("implemented")
})

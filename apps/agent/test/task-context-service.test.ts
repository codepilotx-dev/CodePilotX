import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { EventHub } from "../src/storage/events/EventHub"
import { TaskboardService } from "../src/taskboard/TaskboardService"
import { TaskContextService } from "../src/task-context/TaskContextService"
import { removeFixturePaths } from "./fixture-cleanup"

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-task-context-")); paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const project = db.createProject({ id: crypto.randomUUID(), rootPath: join(root, "workspace"), name: "Context" })
  const hub = await Effect.runPromise(EventHub.make)
  const context = new TaskContextService(db, hub)
  const taskboard = new TaskboardService(db, hub, db.repositories.taskboard, context)
  const task = await taskboard.create({ projectId: project.id, title: "共享上下文", status: "todo", operationId: crypto.randomUUID(), actor: { kind: "user", sourceThreadId: null } })
  const thread = db.createThread({ title: "主执行", workspace: { kind: "project", projectID: project.id } })
  db.linkPrimaryThread({ taskId: task.task.id, threadId: thread.id, expectedVersion: task.task.version })
  return { db, project, taskId: task.task.id, threadId: thread.id, context }
}

describe("TaskContextService", () => {
  test("主会话与 subagent 解析到同一任务，普通 child 不继承", async () => {
    const { db, project, taskId, threadId, context } = await fixture()
    const child = db.createThread({ title: "子 Agent", workspace: { kind: "project", projectID: project.id } })
    db.sqlite.query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?").run(threadId, child.id)
    const ordinary = db.createThread({ title: "普通子会话", workspace: { kind: "project", projectID: project.id } })
    db.sqlite.query("UPDATE threads SET parent_thread_id = ? WHERE id = ?").run(threadId, ordinary.id)
    expect(context.resolveTaskForThread(threadId)?.taskId).toBe(taskId)
    expect(context.resolveTaskForThread(child.id)?.taskId).toBe(taskId)
    expect(context.resolveTaskForThread(ordinary.id)).toBeNull()
    expect(context.promptForThread(child.id)).toBe(context.promptForThread(threadId))
    expect(context.snapshot(taskId).digest.length).toBeLessThanOrEqual(6_000)
    expect(context.promptForThread(ordinary.id)).toBeNull()
    db.close()
  })

  test("Evidence 幂等递增，未验证证据不默认读取", async () => {
    const { db, taskId, threadId, context } = await fixture()
    const input = { threadId, turnId: crypto.randomUUID(), verified: false, summary: "可能发生副作用" }
    expect(context.captureEvidence(input)?.snapshot.evidenceRevision).toBe(1)
    expect(context.captureEvidence(input)).toBeNull()
    expect(context.read(taskId, { includeEvidence: true }).evidence).toEqual([])
    expect(context.read(taskId, { includeEvidence: true, includeUnverified: true }).evidence).toHaveLength(1)
    db.close()
  })

  test("publish 使用 context revision 拒绝并发旧写入并生成确定性 digest", async () => {
    const { db, taskId, threadId, context } = await fixture()
    const first = context.publish({ taskId, expectedContextRevision: 1, sourceKind: "user", sourceThreadId: threadId, changes: [{ op: "add", section: "decision", title: "存储", content: "使用任务级 Capsule" }] })
    expect(first.snapshot.contextRevision).toBe(2)
    expect(first.snapshot.digest).toContain("使用任务级 Capsule")
    expect(() => context.publish({ taskId, expectedContextRevision: 1, sourceKind: "user", changes: [{ op: "add", section: "risk", title: "冲突", content: "拒绝旧版本" }] })).toThrow()
    db.close()
  })

  test("proposal stale 持久化，且 proposal 之后的新 Evidence 继续 pending", async () => {
    const first = await fixture()
    const stale = first.context.createProposal({ taskId: first.taskId, baseContextRevision: 1, throughEvidenceRevision: 0, changes: [], modelRef: null })
    first.context.publish({ taskId: first.taskId, expectedContextRevision: 1, sourceKind: "user", changes: [{ op: "add", section: "objective", title: "目标", content: "推进版本" }] })
    expect(() => first.context.applyProposal(stale.id)).toThrow()
    expect(first.context.proposal(stale.id).status).toBe("stale")
    first.db.close()

    const second = await fixture()
    second.context.captureEvidence({ threadId: second.threadId, turnId: "turn:evidence:1", verified: true, summary: "第一条证据" })
    const proposal = second.context.createProposal({ taskId: second.taskId, baseContextRevision: 1, throughEvidenceRevision: 1, changes: [], modelRef: null })
    second.context.captureEvidence({ threadId: second.threadId, turnId: "turn:evidence:2", verified: true, summary: "后续证据" })
    expect(second.context.applyProposal(proposal.id).snapshot.pendingEvidenceCount).toBe(1)
    second.db.close()
  })
})

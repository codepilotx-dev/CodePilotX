import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LegacyAgentInputItem as AgentInputItem } from "../src/storage/SqliteAgentSession"
import { Model, Provider } from "@codepilotx/model-schema"
import { ContextManager, contextFingerprint, estimateContextTokens } from "../src/context/ContextManager"
import { HookService } from "../src/hooks/HookService"
import { MemoryService, projectMemoryKey } from "../src/memory/MemoryService"
import { AgentDatabase, SCHEMA_VERSION } from "../src/storage/Database"
import { SqliteAgentSession } from "../src/storage/SqliteAgentSession"

const roots: string[] = []
const removeRoot = async (root: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(root, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(50)
    }
  }
}
afterEach(async () => Promise.all(roots.splice(0).map(removeRoot)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-context-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const thread = db.createThread("上下文")
  return { root, db, thread }
}

describe("v8 上下文存储", () => {
  test("创建新表并持久化 granular approval JSON", async () => {
    const { db } = await fixture()
    const policy = { type: "granular" as const, sandboxApproval: true, rules: false, skillApproval: true, requestPermissions: false, mcpElicitations: true }
    const thread = db.createThread("granular", undefined, { taskMode: "chat", permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: policy, approvalsReviewer: "user" } })
    expect(db.getThreadSettings(thread.id)?.permissionConfig.approvalPolicy).toEqual(policy)
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    const tables = new Set((db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name))
    for (const table of ["prompt_session_state", "agent_compactions", "guardian_review_sessions", "hook_runs", "memory_jobs", "context_usage_samples"]) expect(tables.has(table)).toBe(true)
    db.close()
  })

  test("压缩原子替换历史并记录 outbox", async () => {
    const { db, thread } = await fixture()
    const session = new SqliteAgentSession(db, thread.id)
    await session.addItems([{ role: "user", content: "旧问题" }, { role: "assistant", content: "旧回答" }] as AgentInputItem[])
    const manager = new ContextManager(db)
    manager.establishBaseline({ threadID: thread.id, promptVersion: "v1", baseHash: "base", contextHash: "context", cacheKey: thread.id })
    let targetTokens = 0
    const compacted = await manager.compact({
      threadID: thread.id,
      session,
      contextWindowTokens: 100,
      compactor: {
        compact: async (input) => {
          targetTokens = input.targetTokens
          return { summary: "摘要", replacementHistory: [{ role: "user", content: "摘要" }] as AgentInputItem[] }
        },
      },
    })
    expect(compacted).toMatchObject({ beforeCount: 2, afterCount: 1, baselineVersion: 2, targetTokens: 55 })
    expect(targetTokens).toBe(55)
    expect(await session.getItems()).toHaveLength(1)
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM agent_compactions").get()).toEqual({ count: 1 })
    expect(db.sqlite.query("SELECT source FROM context_usage_samples").get()).toEqual({ source: "compaction-estimate" })
    expect(db.sqlite.query("SELECT method FROM events WHERE method = 'context/compacted'").get()).toEqual({ method: "context/compacted" })
    expect(manager.state(thread.id)?.needsCompaction).toBe(false)
    db.close()
  })

  test("压缩器返回过大 history 时在事务前确定性裁剪到 55%", async () => {
    const { db, thread } = await fixture()
    const session = new SqliteAgentSession(db, thread.id)
    await session.addItems([{ role: "user", content: "旧问题" }, { role: "assistant", content: "旧回答" }] as AgentInputItem[])
    const manager = new ContextManager(db)
    manager.establishBaseline({ threadID: thread.id, promptVersion: "v1", baseHash: "base", contextHash: "context", cacheKey: thread.id })
    const result = await manager.compact({
      threadID: thread.id,
      session,
      contextWindowTokens: 1_000,
      compactor: { compact: async () => ({ summary: "摘要", replacementHistory: [{ role: "user", content: "x".repeat(20_000) }] as AgentInputItem[] }) },
    })
    expect(result.afterTokens).toBeLessThanOrEqual(550)
    expect(estimateContextTokens({ items: await session.getItems() })).toBeLessThanOrEqual(550)
    db.close()
  })

  test("估算确定且仅在同一输入指纹上优先使用实测 usage", async () => {
    const { db, thread } = await fixture()
    const manager = new ContextManager(db)
    manager.establishBaseline({ threadID: thread.id, promptVersion: "v1", baseHash: "base", contextHash: "context", cacheKey: thread.id })
    const left = [{ role: "user", content: "hello", metadata: { b: 2, a: 1 } }] as unknown as AgentInputItem[]
    const right = [{ metadata: { a: 1, b: 2 }, content: "hello", role: "user" }] as unknown as AgentInputItem[]
    expect(estimateContextTokens({ items: left })).toBe(estimateContextTokens({ items: right }))
    expect(contextFingerprint({ items: left })).toBe(contextFingerprint({ items: right }))

    manager.recordMeasuredUsage({ threadID: thread.id, items: left, contextWindowTokens: 100, inputTokens: 79, outputTokens: 7 })
    expect(manager.snapshot({ threadID: thread.id, items: right, contextWindowTokens: 100 })).toMatchObject({ usedTokens: 79, utilization: 0.79, needsCompaction: false })

    manager.recordMeasuredUsage({ threadID: thread.id, items: left, contextWindowTokens: 100, inputTokens: 80, outputTokens: 7 })
    const measured = manager.snapshot({ threadID: thread.id, items: right, contextWindowTokens: 100 })
    expect(measured).toMatchObject({ source: "measured", usedTokens: 80, triggerTokens: 80, targetTokens: 55, needsCompaction: true })
    expect(manager.state(thread.id)).toMatchObject({ usageTokens: 80, usageSource: "measured", needsCompaction: true })

    manager.appendFragments(thread.id, [{ id: "mode.chat", kind: "mode", version: 2, hash: "mode-2", payload: {}, createdAt: Date.now() }], "context-2")
    const changed = manager.snapshot({ threadID: thread.id, items: [{ role: "user", content: "changed" }] as AgentInputItem[], contextWindowTokens: 100 })
    expect(changed).toMatchObject({ source: "estimated", needsCompaction: true })
    expect(manager.usageSamples(thread.id)).toHaveLength(3)
    db.close()
  })

  test("prompt-too-long 只裁剪完整 round 并保留稳定前缀与下一轮", async () => {
    const { db, thread } = await fixture()
    const session = new SqliteAgentSession(db, thread.id)
    await session.addItems([
      { role: "system", content: "stable" },
      { role: "user", content: "first" },
      { type: "function_call", callId: "call-1", name: "read", arguments: "{}" },
      { type: "function_call_result", callId: "call-1", output: "ok" },
      { role: "assistant", content: "done" },
      { role: "user", content: "second" },
      { role: "assistant", content: "keep" },
    ] as unknown as AgentInputItem[])
    expect(await session.dropOldestRound()).toBe(4)
    expect(await session.getItems()).toEqual([
      { role: "system", content: "stable" },
      { role: "user", content: "second" },
      { role: "assistant", content: "keep" },
    ] as AgentInputItem[])
    db.close()
  })

  test("连续 contextual-user 与当前用户输入按同一 round 成对裁剪", async () => {
    const { db, thread } = await fixture()
    const session = new SqliteAgentSession(db, thread.id)
    await session.addItems([
      { role: "system", content: "stable" },
      { role: "user", content: [{ type: "input_text", text: '<context_data section_id="context.project">project</context_data>' }] },
      { role: "user", content: [{ type: "input_text", text: '<context_data section_id="memory.0">memory</context_data>' }] },
      { role: "user", content: [{ type: "input_text", text: '<context_data section_id="turn.user-message">first</context_data>' }] },
      { type: "function_call", callId: "call-context", name: "read", arguments: "{}" },
      { type: "function_call_result", callId: "call-context", output: "ok" },
      { role: "assistant", content: "done" },
      { role: "user", content: [{ type: "input_text", text: '<context_data section_id="turn.user-message">second</context_data>' }] },
      { role: "assistant", content: "keep" },
    ] as unknown as AgentInputItem[])
    expect(await session.dropOldestRound()).toBe(6)
    expect(await session.getItems()).toEqual([
      { role: "system", content: "stable" },
      { role: "user", content: [{ type: "input_text", text: '<context_data section_id="turn.user-message">second</context_data>' }] },
      { role: "assistant", content: "keep" },
    ] as unknown as AgentInputItem[])
    db.close()
  })
})

describe("Hooks 与记忆", () => {
  test("用户 Hook 先执行，未知项目 Hook 暂停且响应后可恢复", async () => {
    const { root, db, thread } = await fixture()
    const userConfig = join(root, "user-hooks.json")
    await mkdir(join(root, ".codepilotx"))
    await writeFile(userConfig, JSON.stringify({ hooks: [{ id: "user", event: "pre_tool_use", command: "user-hook" }] }), "utf8")
    await writeFile(join(root, ".codepilotx", "hooks.json"), JSON.stringify({ hooks: [{ id: "project", event: "pre_tool_use", command: "project-hook" }] }), "utf8")
    const input = {
      content: "test",
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "queue",
      taskMode: "chat",
    } as const
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    const called: string[] = []
    const hooks = new HookService(db, { run: async ({ command }) => { called.push(command); return { output: JSON.stringify({ decision: "continue" }) } } })
    hooks.load({ userConfigPath: userConfig, projectRoot: root })
    await expect(hooks.run("pre_tool_use", {}, { threadID: thread.id, turnID: turn.turnID, workspaceRoot: root })).rejects.toMatchObject({ code: "HOOK_TRUST_REQUIRED" })
    expect(called).toEqual(["user-hook"])
    expect(db.getAgentTurnCheckpoint(turn.turnID)?.state).toBe("waiting_hook_trust")
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "waiting_permission" })
    const request = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").get() as { id: string }
    const resolved = db.resolveHookTrustRequest(request.id, "allow")
    expect(resolved.resumed).toEqual([{ agentID: turn.agentID, turnID: turn.turnID, threadID: thread.id }])
    expect(resolved.events).toHaveLength(1)
    expect(db.getAgentTurnCheckpoint(turn.turnID)).toBeNull()
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(turn.turnID)).toEqual({ status: "queued" })
    db.close()
  })

  test("缺少可选 Hook 配置时为空，命令交由注入 runner", async () => {
    const { root, db, thread } = await fixture()
    const called: string[] = []
    const hooks = new HookService(db, { run: async (input) => { called.push(input.command); return { output: JSON.stringify({ decision: "ask", reason: "检查" }) } } })
    expect(hooks.load({ projectRoot: root })).toEqual([])
    await mkdir(join(root, ".codepilotx"))
    await writeFile(join(root, ".codepilotx", "hooks.json"), JSON.stringify({ hooks: [{ id: "check", event: "pre_tool_use", command: "check-hook", timeoutMs: 1000 }] }), "utf8")
    hooks.load({ projectRoot: root })
    await expect(hooks.run("pre_tool_use", { value: "evidence" }, { threadID: thread.id, toolName: "shell", workspaceRoot: root })).rejects.toMatchObject({ code: "HOOK_TRUST_REQUIRED" })
    expect(called).toEqual([])
    const trust = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").get() as { id: string }
    db.resolveHookTrustRequest(trust.id, "allow")
    const result = await hooks.run("pre_tool_use", { value: "evidence" }, { threadID: thread.id, toolName: "shell" })
    expect(called).toEqual(["check-hook"])
    expect(result[0]?.result.decision).toBe("ask")
    db.close()
  })

  test("Hook narrowedInput 不能扩大原始 scope", async () => {
    const { root, db } = await fixture()
    await mkdir(join(root, ".codepilotx"))
    await writeFile(join(root, ".codepilotx", "hooks.json"), JSON.stringify({ hooks: [{ id: "narrow", event: "pre_tool_use", command: "check" }] }), "utf8")
    const hooks = new HookService(db, { run: async () => ({ output: JSON.stringify({ decision: "continue", narrowedInput: { timeoutMs: 60_000 } }) }) })
    hooks.load({ projectRoot: root })
    await expect(hooks.run("pre_tool_use", { input: { timeoutMs: 1_000 } }, { workspaceRoot: root })).rejects.toMatchObject({ code: "HOOK_TRUST_REQUIRED" })
    const trust = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").get() as { id: string }
    db.resolveHookTrustRequest(trust.id, "allow")
    await expect(hooks.run("pre_tool_use", { input: { timeoutMs: 1_000 } })).rejects.toThrow("扩大")
    db.close()
  })

  test("Hook hash 变化重新请求信任且 block 后绝不执行", async () => {
    const { root, db } = await fixture()
    await mkdir(join(root, ".codepilotx"))
    const path = join(root, ".codepilotx", "hooks.json")
    await writeFile(path, JSON.stringify({ hooks: [{ id: "project", event: "pre_tool_use", command: "first" }] }), "utf8")
    let executions = 0
    const hooks = new HookService(db, { run: async () => { executions += 1; return { output: JSON.stringify({ decision: "continue" }) } } })
    hooks.load({ projectRoot: root })
    await expect(hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: root })).rejects.toMatchObject({ code: "HOOK_TRUST_REQUIRED" })
    const first = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").get() as { id: string }
    db.resolveHookTrustRequest(first.id, "allow")
    await hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: root })
    expect(executions).toBe(1)

    await writeFile(path, JSON.stringify({ hooks: [{ id: "project", event: "pre_tool_use", command: "changed" }] }), "utf8")
    hooks.load({ projectRoot: root })
    await expect(hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: root })).rejects.toMatchObject({ code: "HOOK_TRUST_REQUIRED" })
    const second = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").get() as { id: string }
    expect(second.id).not.toBe(first.id)
    db.resolveHookTrustRequest(second.id, "block")
    expect(await hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: root })).toEqual([])
    expect(executions).toBe(1)
    db.close()
  })

  test("并行 workspace 使用各自不可变 Hook 配置", async () => {
    const { root, db } = await fixture()
    const projectA = join(root, "project-a")
    const projectB = join(root, "project-b")
    await Promise.all([mkdir(join(projectA, ".codepilotx"), { recursive: true }), mkdir(join(projectB, ".codepilotx"), { recursive: true })])
    await Promise.all([
      writeFile(join(projectA, ".codepilotx", "hooks.json"), JSON.stringify({ hooks: [{ id: "same-id", event: "pre_tool_use", command: "project-a" }] }), "utf8"),
      writeFile(join(projectB, ".codepilotx", "hooks.json"), JSON.stringify({ hooks: [{ id: "same-id", event: "pre_tool_use", command: "project-b" }] }), "utf8"),
    ])
    const called: string[] = []
    const hooks = new HookService(db, { run: async (input) => { if (input.command === "project-a") await Bun.sleep(20); called.push(input.command); return { output: JSON.stringify({ decision: "continue" }) } } })
    hooks.load({ projectRoot: projectA })
    hooks.load({ projectRoot: projectB })
    await Promise.allSettled([
      hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: projectA }),
      hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: projectB }),
    ])
    const requests = db.sqlite.query("SELECT id FROM hook_trust_requests WHERE status = 'pending'").all() as Array<{ id: string }>
    expect(requests).toHaveLength(2)
    requests.forEach(({ id }) => db.resolveHookTrustRequest(id, "allow"))
    const [a, b] = await Promise.all([
      hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: projectA }),
      hooks.run("pre_tool_use", { input: {} }, { workspaceRoot: projectB }),
    ])
    expect(a[0]?.hook.command).toBe("project-a")
    expect(b[0]?.hook.command).toBe("project-b")
    expect(called.sort()).toEqual(["project-a", "project-b"])
    db.close()
  })

  test("记忆严格 opt-in，项目隔离并过滤凭据", async () => {
    const { db } = await fixture()
    const disabled = new MemoryService(db, { enabled: false })
    expect(disabled.remember({ scope: "user", content: "偏好简洁回答" })).toBeNull()
    const memory = new MemoryService(db, { enabled: true })
    const projectKey = projectMemoryKey("F:\\repo")
    expect(memory.remember({ scope: "project", projectKey, content: "项目使用 Bun" })?.content).toBe("项目使用 Bun")
    expect(memory.remember({ scope: "user", content: "api_key=super-secret-value" })).toBeNull()
    expect(memory.recall({ query: "Bun", projectKey })).toHaveLength(1)
    expect(memory.recall({ query: "Bun", projectKey: projectMemoryKey("F:\\other") })).toHaveLength(0)
    db.close()
  })

  test("记忆单 worker 排空队列且业务失败不无限重试", async () => {
    const { db } = await fixture()
    let calls = 0
    let active = 0
    let maxActive = 0
    const memory = new MemoryService(db, {
      enabled: true,
      extractor: { extract: async () => {
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          if (calls === 1) throw new Error("business failure")
          return [{ scope: "user", content: "记住第二项" }]
        } finally { active -= 1 }
      } },
    })
    memory.enqueue({ transcript: "first" })
    memory.enqueue({ transcript: "second" })
    await memory.drain()
    expect(calls).toBe(2)
    expect(maxActive).toBe(1)
    expect(db.sqlite.query("SELECT status, COUNT(*) AS count FROM memory_jobs GROUP BY status ORDER BY status").all()).toEqual([
      { status: "completed", count: 1 },
      { status: "failed", count: 1 },
    ])
    db.close()
  })
})

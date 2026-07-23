import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Capabilities, EventManifest, RpcMethods } from "@codepilotx/agent-protocol"
import { MemoryService, projectMemoryKey } from "../src/memory/MemoryService"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { RpcRouter, type RpcRouterDependencies } from "../src/transport/rpc/RpcRouter"
import { ThreadService } from "../src/session/ThreadService"

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
  const root = await mkdtemp(join(tmpdir(), "codepilotx-memory-rpc-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const memory = new MemoryService(db, { enabled: true })
  const dependencies = {
    db, memory,
    hub: null, threads: null, history: null, approvals: null, questions: null, subagents: null,
    attachments: null, providers: null, integrations: null, sandbox: null,
  } as unknown as RpcRouterDependencies
  const router = new RpcRouter(dependencies)
  let id = 0
  const initialized = await router.handle({
    jsonrpc: "2.0",
    id: ++id,
    method: "initialize",
    params: {
      clientInfo: { name: "memory-rpc-test", version: "1.0.0" },
      protocols: ["thread-rpc-v4"],
      capabilities: [...Capabilities],
      interactionDelivery: "active",
    },
  }) as any
  const connectionId = initialized.result.connectionId as string
  await router.handle({
    jsonrpc: "2.0",
    method: "initialized",
    params: { protocol: "thread-rpc-v4" },
  }, { connectionId })
  const call = async (method: string, params: Record<string, unknown>) => await router.handle(
    { jsonrpc: "2.0", id: ++id, method, params },
    { connectionId },
  ) as any
  return { root, db, memory, call }
}

describe("Memory RPC 项目作用域", () => {
  test("Prompt、compact 与 Memory Router 方法均可通过共享 RPC 边界", () => {
    for (const method of ["prompt/preview", "prompt/refresh", "thread/compact", "memory/list", "memory/read", "memory/save", "memory/delete", "memory/reset"] as const) {
      expect(RpcMethods[method]).toBeDefined()
    }
  })

  test("Context、Hook trust 与审批取消事件通过共享 SSE 边界", () => {
    for (const method of ["context/compacted", "context/recoveryRequired", "hook/trust/requested", "hook/trust/resolved", "approval/cancelled"] as const) {
      expect(EventManifest[method]).toBeDefined()
    }
  })

  test("新 RPC 方法已在共享 schema 登记且 read/delete 校验 scope", async () => {
    const { root, db, memory, call } = await fixture()
    const workspaceA = join(root, "workspace-a")
    const workspaceB = join(root, "workspace-b")
    await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
    const projectA = db.createProject({ rootPath: workspaceA })
    const projectB = db.createProject({ rootPath: workspaceB })
    const entry = memory.remember({ scope: "project", projectKey: projectMemoryKey(workspaceA), content: "仅属于 A" })!

    expect((await call("memory/read", { id: entry.id })).error).toMatchObject({ code: -32602 })
    expect((await call("memory/read", { id: entry.id, scope: "project", projectId: projectB.id })).error).toMatchObject({ code: -32000, data: { code: "MEMORY_NOT_FOUND" } })
    expect((await call("memory/read", { id: entry.id, scope: "project", projectId: projectA.id })).result).toMatchObject({ entry: { id: entry.id, content: "仅属于 A" } })
    expect((await call("memory/delete", { id: entry.id, scope: "project", projectId: projectB.id, operationId: "delete:b" })).result).toEqual({ deleted: false, id: entry.id })
    expect(memory.read({ id: entry.id, scope: "project", projectKey: projectMemoryKey(workspaceA) })).not.toBeNull()
    expect((await call("memory/delete", { id: entry.id, scope: "project", projectId: projectA.id, operationId: "delete:a" })).result).toEqual({ deleted: true, id: entry.id })
    db.close()
  })

  test("project list/reset 缺少 projectId/threadId 时拒绝且不能跨项目清空", async () => {
    const { root, db, memory, call } = await fixture()
    const workspaceA = join(root, "workspace-a")
    const workspaceB = join(root, "workspace-b")
    await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
    const projectA = db.createProject({ rootPath: workspaceA })
    const projectB = db.createProject({ rootPath: workspaceB })
    const threadA = db.createThread("A", projectA.id)
    memory.remember({ scope: "project", projectKey: projectMemoryKey(workspaceA), content: "A" })
    memory.remember({ scope: "project", projectKey: projectMemoryKey(workspaceB), content: "B" })

    expect((await call("memory/list", { scope: "project" })).error).toMatchObject({ code: -32602 })
    expect((await call("memory/reset", { scope: "project" })).error).toMatchObject({ code: -32602 })
    expect((await call("memory/list", { scope: "project", workspacePath: workspaceA })).error).toMatchObject({ code: -32602 })
    expect((await call("memory/reset", { scope: "project", projectId: projectB.id, includeEventLog: false, operationId: "reset:b" })).result).toEqual({ deleted: 1 })
    expect(memory.list({ scope: "project", projectKey: projectMemoryKey(workspaceA) })).toHaveLength(1)
    expect(memory.list({ scope: "project", projectKey: projectMemoryKey(workspaceB) })).toHaveLength(0)
    expect((await call("memory/list", { scope: "project", projectId: projectA.id })).result).toMatchObject({ entries: [{ content: "A" }] })
    expect((await call("memory/list", { scope: "project", threadId: threadA.id })).error).toMatchObject({ code: -32602 })
    db.close()
  })

  test("memory/save 使用可选 id 原地更新", async () => {
    const { db, call } = await fixture()
    const created = await call("memory/save", { scope: "user", content: "旧内容", operationId: "save:create" })
    const id = (created.result as { entry: { id: string } }).entry.id
    const updated = await call("memory/save", { id, scope: "user", content: "新内容", operationId: "save:update" })
    expect(updated.result).toMatchObject({ entry: { id, content: "新内容" } })
    expect((await call("memory/list", { scope: "user" })).result).toMatchObject({ entries: [{ id, content: "新内容" }] })
    for (const table of ["turns", "inputs"]) {
      const columns = (db.sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
      expect(columns).not.toContain("permission_mode")
    }
    db.close()
  })

  test("新线程冻结 prompt settings，只有显式 refresh 才更新", async () => {
    const { db, memory } = await fixture()
    db.setSetting("desktop.settings.v1", { systemPrompt: "v1", enableMemory: true })
    const questions = { setResumeHandler: () => undefined }
    const subagents = { setParentResumeHandler: () => undefined }
    const service = new ThreadService(
      db, null as never, null as never, null as never, questions as never, null as never,
      subagents as never, null as never, ".", memory, null as never, null as never,
    )
    await Bun.sleep(0)
    const thread = db.createThread("snapshot")
    service.refreshPromptSettings(thread.id)
    expect(db.getThreadPromptSettings(thread.id)).toMatchObject({ engine: "prompt-engine-v2", version: 2, settings: { systemPrompt: "v1", enableMemory: true } })
    db.setSetting("desktop.settings.v1", { systemPrompt: "v2", enableMemory: false })
    expect(db.getThreadPromptSettings<{ settings: { systemPrompt: string } }>(thread.id)?.settings.systemPrompt).toBe("v1")
    expect(service.refreshPromptSettings(thread.id)).toMatchObject({ settings: { systemPrompt: "v2", enableMemory: false } })
    db.close()
  })
})

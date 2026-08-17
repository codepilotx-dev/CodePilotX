import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeFixturePaths } from "./fixture-cleanup"
import { Capabilities } from "@codepilotx/agent-protocol"
import { Model, Provider } from "@codepilotx/model-schema"
import { RpcRouter, type RpcRouterDependencies } from "../src/transport/rpc/RpcRouter"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { RuntimeContributionRegistry } from "../src/runtime/RuntimeContribution"
import { ModelRequestSnapshotRepository } from "../src/storage/repositories/model-request-snapshot-repository"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async (capabilities: readonly string[]) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-runtime-rpc-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  const registry = new RuntimeContributionRegistry((contribution) => contribution.manifest.id === "skills@builtin")
  registry.register({
    manifest: {
      id: "core@builtin",
      version: 1,
      displayName: "核心运行时",
      description: "注册工具与统一执行管线。",
      provides: ["tools", "guard", "observer"],
      enablement: "required",
    },
    register: () => undefined,
  })
  registry.register({
    manifest: {
      id: "skills@builtin",
      version: 2,
      displayName: "Skills",
      description: "技能列表与读取。",
      provides: ["tools", "prompt"],
      enablement: "conditional",
    },
    register: () => undefined,
  })
  const dependencies = {
    runtimeContributions: registry,
    requestSnapshots: new ModelRequestSnapshotRepository(db),
    db,
    hub: null, threads: null, history: null, approvals: null, questions: null, subagents: null,
    attachments: null, providers: null, integrations: null,
  } as unknown as RpcRouterDependencies
  const router = new RpcRouter(dependencies)
  let id = 0
  const initialized = await router.handle({
    jsonrpc: "2.0",
    id: ++id,
    method: "initialize",
    params: {
      clientInfo: { name: "runtime-rpc-test", version: "1.0.0" },
      protocols: ["thread-rpc-v4"],
      capabilities: [...capabilities],
      interactionDelivery: "active",
    },
  }) as any
  const connectionId = initialized.result.connectionId as string
  await router.handle({
    jsonrpc: "2.0",
    method: "initialized",
    params: { protocol: "thread-rpc-v4" },
  }, { connectionId })
  const call = async (method: string, params: Record<string, unknown> = {}) => await router.handle(
    { jsonrpc: "2.0", id: ++id, method, params },
    { connectionId },
  ) as any
  return { root, db, registry, call }
}

describe("Runtime 贡献 RPC", () => {
  test("runtime/contribution/list 只读返回内置贡献及其实际状态", async () => {
    const { db, call } = await fixture(Capabilities)
    const response = await call("runtime/contribution/list")
    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({
      contributions: [
        {
          id: "core@builtin",
          version: 1,
          displayName: "核心运行时",
          description: "注册工具与统一执行管线。",
          provides: ["tools", "guard", "observer"],
          enablement: "required",
          enabled: true,
        },
        {
          id: "skills@builtin",
          version: 2,
          displayName: "Skills",
          description: "技能列表与读取。",
          provides: ["tools", "prompt"],
          enablement: "conditional",
          enabled: true,
        },
      ],
    })
    db.close()
  })

  test("未协商 runtime.contributions.v1 capability 时返回 capability 门禁错误", async () => {
    const { db, call } = await fixture(["rpc.typed.v1"])
    const response = await call("runtime/contribution/list")
    expect(response.result).toBeUndefined()
    expect(response.error).toBeDefined()
    db.close()
  })
})

describe("Runtime 请求快照 RPC", () => {
  const seedSnapshot = async (db: AgentDatabase, repo: ModelRequestSnapshotRepository, threadID: string) => {
    const turn = db.createTurn(threadID, {
      content: "snapshot",
      model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
      strategy: "queue",
      taskMode: "chat",
    })
    return repo.insertCaptured({
      threadId: threadID,
      turnId: turn.turnID,
      agentId: turn.agentID,
      sessionId: "session:rpc",
      providerId: "openai",
      api: "openai-responses",
      modelId: "gpt-test",
      payloadJson: "{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}",
      runtimeManifest: JSON.stringify({ version: 1, presetID: "main/chat" }),
      createdAt: 100,
    })
  }

  test("list/read 按任务隔离返回摘要与完整 payload", async () => {
    const { db, call } = await fixture(Capabilities)
    const threadA = db.createThread("任务 A")
    const threadB = db.createThread("任务 B")
    const repo = new ModelRequestSnapshotRepository(db)
    const summary = await seedSnapshot(db, repo, threadA.id)

    const list = await call("runtime/request-snapshot/list", { threadId: threadA.id })
    const payloadJson = "{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
    expect(list.error).toBeUndefined()
    expect(list.result.items).toEqual([{
      id: summary.id,
      threadId: threadA.id,
      turnId: summary.turnId,
      agentId: summary.agentId,
      requestOrdinal: 0,
      providerId: "openai",
      api: "openai-responses",
      modelId: "gpt-test",
      status: "captured",
      payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
      payloadSha256: summary.payloadSha256,
      errorCode: null,
      createdAt: 100,
    }])
    expect(list.result.nextCursor).toBeUndefined()

    const read = await call("runtime/request-snapshot/read", { threadId: threadA.id, snapshotId: summary.id })
    expect(read.error).toBeUndefined()
    expect(read.result.snapshot.payloadJson).toBe(payloadJson)
    expect(read.result.snapshot.runtimeManifest).toBe(JSON.stringify({ version: 1, presetID: "main/chat" }))

    // 跨任务读取被拒绝（安全 envelope）
    const wrong = await call("runtime/request-snapshot/read", { threadId: threadB.id, snapshotId: summary.id })
    expect(wrong.result).toBeUndefined()
    expect(wrong.error).toMatchObject({ data: { code: "REQUEST_SNAPSHOT_NOT_FOUND" } })
    expect(JSON.stringify(wrong)).not.toContain("你好")
    db.close()
  })

  test("未协商 runtime.request-snapshots.v1 capability 时返回 capability 门禁错误", async () => {
    const { db, call } = await fixture(["rpc.typed.v1"])
    const response = await call("runtime/request-snapshot/list", { threadId: "thread:any" })
    expect(response.result).toBeUndefined()
    expect(response.error).toBeDefined()
    db.close()
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeFixturePaths } from "./fixture-cleanup"
import { InMemorySessionRepo } from "@codepilotx/pi-agent-core"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai"
import { Model, Provider } from "@codepilotx/model-schema"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import {
  ModelRequestSnapshotRepository,
  requestSnapshotPayloadHash,
  type RequestSnapshotSummary,
  type StoredRuntimeManifest,
} from "../src/storage/repositories/model-request-snapshot-repository"
import { ModelRequestSnapshotRecorder, type RequestSnapshotRecorder } from "../src/snapshot/RequestSnapshotRecorder"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { PiAgentRuntime } from "../src/orchestration/pi/PiAgentRuntime"
import type { PiRuntimeRequest } from "../src/orchestration/pi/types"

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const runtimeManifest: StoredRuntimeManifest = {
  version: 2,
  layers: [],
  pluginBindings: [],
  serviceBindings: [],
  interceptorBindings: [],
  serviceBindingHash: "binding-hash",
  presetID: "main/chat",
  contributions: [{ id: "core@builtin", version: 1 }],
  promptHash: "prompt-hash",
  toolCatalogHash: "catalog-hash",
  toolNames: ["Read", "Bash"],
  manifestHash: "manifest-hash",
}

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-request-snapshot-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  const thread = db.createThread("请求快照测试")
  const turn = db.createTurn(thread.id, {
    content: "snapshot",
    model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") }),
    permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
    strategy: "queue",
    taskMode: "chat",
  })
  return {
    db,
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    sessionID: "session:snapshot",
  }
}

const insertCaptured = (repo: ModelRequestSnapshotRepository, input: {
  db: AgentDatabase
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  payloadJson?: string
  createdAt: number
}): RequestSnapshotSummary => repo.insertCaptured({
  threadId: input.threadID,
  turnId: input.turnID,
  agentId: input.agentID,
  sessionId: input.sessionID,
  providerId: "openai",
  api: "openai-responses",
  modelId: "gpt-test",
  payloadJson: input.payloadJson ?? '{"messages":[]}',
  runtimeManifest: JSON.stringify(runtimeManifest),
  createdAt: input.createdAt,
})

describe("ModelRequestSnapshotRepository", () => {
  test("captured 保存精确 UTF-8 JSON 并计算 SHA-256 与字节数", async () => {
    const { db, threadID, turnID, agentID, sessionID } = await setup()
    const repo = new ModelRequestSnapshotRepository(db)
    const payloadJson = JSON.stringify({ messages: [{ role: "user", content: "中文 🐋 内容" }], model: "gpt-test" })

    const summary = insertCaptured(repo, { db, threadID, turnID, agentID, sessionID, payloadJson, createdAt: 100 })

    expect(summary.status).toBe("captured")
    expect(summary.errorCode).toBeNull()
    expect(summary.payloadSha256).toBe(requestSnapshotPayloadHash(payloadJson))
    expect(summary.payloadBytes).toBe(Buffer.byteLength(payloadJson, "utf8"))
    expect(summary.requestOrdinal).toBe(0)

    const detail = repo.read(threadID, summary.id)
    expect(detail?.payloadJson).toBe(payloadJson)
    expect(detail?.runtimeManifest).toBe(JSON.stringify(runtimeManifest))
    expect(detail?.payloadSha256).toBe(requestSnapshotPayloadHash(payloadJson))
    expect(detail?.payloadBytes).toBe(Buffer.byteLength(payloadJson, "utf8"))
    expect(detail?.providerId).toBe("openai")
    expect(detail?.modelId).toBe("gpt-test")
    expect(detail?.createdAt).toBe(100)
  })

  test("同一 session 的 ordinal 连续分配，不同 session 从 0 开始", async () => {
    const { db, threadID, turnID, agentID, sessionID } = await setup()
    const repo = new ModelRequestSnapshotRepository(db)

    const first = insertCaptured(repo, { db, threadID, turnID, agentID, sessionID, createdAt: 100 })
    const second = insertCaptured(repo, { db, threadID, turnID, agentID, sessionID, createdAt: 200 })
    const other = insertCaptured(repo, { db, threadID, turnID, agentID, sessionID: "session:other", createdAt: 300 })

    expect([first.requestOrdinal, second.requestOrdinal, other.requestOrdinal]).toEqual([0, 1, 0])
  })

  test("cursor 分页稳定且按 thread 隔离", async () => {
    const { db, threadID, turnID, agentID, sessionID } = await setup()
    const other = db.createThread("其他任务")
    const repo = new ModelRequestSnapshotRepository(db)
    for (const createdAt of [100, 200, 300, 400, 500]) {
      insertCaptured(repo, { db, threadID, turnID, agentID, sessionID, createdAt })
    }
    insertCaptured(repo, { db, threadID: other.id, turnID, agentID, sessionID: "session:other", createdAt: 600 })

    const page1 = repo.list(threadID, undefined, 2)
    expect(page1.items.map((item) => item.createdAt)).toEqual([500, 400])
    expect(page1.nextCursor).toBeDefined()
    const page2 = repo.list(threadID, page1.nextCursor, 2)
    expect(page2.items.map((item) => item.createdAt)).toEqual([300, 200])
    const page3 = repo.list(threadID, page2.nextCursor, 2)
    expect(page3.items.map((item) => item.createdAt)).toEqual([100])
    expect(page3.nextCursor).toBeUndefined()

    const onlyOther = repo.list(other.id, undefined, 50)
    expect(onlyOther.items).toHaveLength(1)
    expect(onlyOther.items[0]!.createdAt).toBe(600)
    expect(repo.read(threadID, onlyOther.items[0]!.id)).toBeNull()
  })

  test("归档任务保留快照，永久删除任务级联删除", async () => {
    const { db, threadID, turnID, agentID, sessionID } = await setup()
    const repo = new ModelRequestSnapshotRepository(db)
    const summary = insertCaptured(repo, { db, threadID, turnID, agentID, sessionID, createdAt: 100 })

    db.sqlite.query("UPDATE threads SET archived_at = 1 WHERE id = ?").run(threadID)
    expect(repo.list(threadID).items.map((item) => item.id)).toEqual([summary.id])

    db.sqlite.query("DELETE FROM threads WHERE id = ?").run(threadID)
    expect(repo.list(threadID).items).toEqual([])
    expect(repo.read(threadID, summary.id)).toBeNull()
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM model_request_snapshots").get()).toEqual({ count: 0 })
  })

  test("missing 记录无 payload 只保留固定安全错误码", async () => {
    const { db, threadID, turnID, agentID, sessionID } = await setup()
    const repo = new ModelRequestSnapshotRepository(db)
    const summary = repo.insertMissing({
      threadId: threadID,
      turnId: turnID,
      agentId: agentID,
      sessionId: sessionID,
      providerId: "openai",
      api: "openai-responses",
      modelId: "gpt-test",
      errorCode: "SERIALIZE_FAILED",
      runtimeManifest: JSON.stringify(runtimeManifest),
      createdAt: 100,
    })

    expect(summary.status).toBe("missing")
    expect(summary.errorCode).toBe("SERIALIZE_FAILED")
    expect(summary.payloadBytes).toBeNull()
    expect(summary.payloadSha256).toBeNull()
    const detail = repo.read(threadID, summary.id)
    expect(detail?.payloadJson).toBeNull()
  })
})

describe("ModelRequestSnapshotRecorder", () => {
  const recorderFixture = async (enabled: () => boolean) => {
    const base = await setup()
    const published: Array<{ method: string }> = []
    const warnings: string[] = []
    const recorder = new ModelRequestSnapshotRecorder({
      db: base.db,
      enabled,
      publish: async (event) => { published.push({ method: event.method }) },
      logger: {
        warn: (_event: string, fields: { details?: { code?: string } }) => {
          warnings.push(String(fields.details?.code ?? "warn"))
        },
      } as never,
    })
    return { ...base, published, warnings, recorder }
  }

  const captureInput = (base: { threadID: string; turnID: string; agentID: string; sessionID: string }) => ({
    threadID: base.threadID,
    turnID: base.turnID,
    agentID: base.agentID,
    sessionID: base.sessionID,
    providerId: "openai",
    api: "openai-responses",
    modelId: "gpt-test",
    payload: { messages: [{ role: "user", content: "你好" }] },
    runtimeManifest,
  })

  test("配置关闭时不采集也不发布", async () => {
    const { db, threadID, published, recorder } = await recorderFixture(() => false)
    await recorder.capture(captureInput({ threadID, turnID: "turn", agentID: "agent", sessionID: "session" }))
    expect(published).toEqual([])
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM model_request_snapshots").get()).toEqual({ count: 0 })
  })

  test("开启后落下 captured 快照并发布 created event", async () => {
    const base = await recorderFixture(() => true)
    const { db, threadID, published, recorder } = base
    await recorder.capture(captureInput(base))

    expect(published.map(({ method }) => method).filter((method) => method === "runtime/request-snapshot/created")).toHaveLength(1)
    const rows = db.sqlite.query("SELECT * FROM model_request_snapshots").all() as Array<{ status: string; payload_json: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("captured")
    expect(rows[0]!.payload_json).toBe(JSON.stringify(captureInput(base).payload))
  })

  test("序列化失败落 missing 行并标记 SERIALIZE_FAILED，Provider 请求继续", async () => {
    const base = await recorderFixture(() => true)
    const { db, published, recorder } = base
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await recorder.capture({ ...captureInput(base), payload: circular })
    expect(published.map(({ method }) => method).filter((method) => method === "runtime/request-snapshot/created")).toHaveLength(1)
    const rows = db.sqlite.query("SELECT status, error_code, payload_json FROM model_request_snapshots").all() as Array<{ status: string; error_code: string; payload_json: string | null }>
    expect(rows).toEqual([{ status: "missing", error_code: "SERIALIZE_FAILED", payload_json: null }])
  })

  test("captured 存储失败落 missing 行并标记 STORAGE_FAILED，捕获不抛错", async () => {
    const base = await recorderFixture(() => true)
    const { db, recorder } = base
    db.sqlite.exec(`CREATE TRIGGER fail_captured BEFORE INSERT ON model_request_snapshots WHEN NEW.status = 'captured' BEGIN SELECT RAISE(ABORT, 'capture storage failed'); END`)

    await expect(recorder.capture(captureInput(base))).resolves.toBeUndefined()
    const rows = db.sqlite.query("SELECT status, error_code FROM model_request_snapshots").all() as Array<{ status: string; error_code: string }>
    expect(rows).toEqual([{ status: "missing", error_code: "STORAGE_FAILED" }])
  })

  test("publish 失败不产生 captured+missing 双记录，只写安全诊断", async () => {
    const base = await recorderFixture(() => true)
    const { db, recorder } = base
    const publish = async () => { throw new Error("hub unavailable") }
    const recorderWithFailingPublish = new ModelRequestSnapshotRecorder({
      db: base.db,
      enabled: () => true,
      publish,
      logger: {
        warn: () => undefined,
      } as never,
    })

    await expect(recorderWithFailingPublish.capture(captureInput(base))).resolves.toBeUndefined()
    const rows = db.sqlite.query(
      "SELECT status, error_code FROM model_request_snapshots",
    ).all() as Array<{ status: string; error_code: string | null }>
    // 事务已提交：只有 captured，没有追加 missing。
    expect(rows).toEqual([{ status: "captured", error_code: null }])
    expect(recorder).toBeDefined()
  })

  test("数据库不可写时只产生无 payload 的安全诊断，Provider 请求继续", async () => {
    const base = await recorderFixture(() => true)
    const { db, published, warnings, recorder } = base
    db.sqlite.exec("DROP TABLE model_request_snapshots")

    await expect(recorder.capture(captureInput(base))).resolves.toBeUndefined()
    expect(published).toEqual([])
    expect(warnings).toEqual(["STORAGE_FAILED"])
  })
})

describe("PiAgentRuntime 请求快照采集", () => {
  test("before_provider_payload 中采集脱敏后的完整请求并携带冻结快照", async () => {
    const captures: Array<{ modelId: string; payload: unknown; runtimeManifest: StoredRuntimeManifest }> = []
    const recorder: RequestSnapshotRecorder = {
      capture: async (input) => {
        captures.push({
          modelId: input.modelId,
          payload: input.payload,
          runtimeManifest: input.runtimeManifest,
        })
      },
    }
    const faux = fauxProvider({ models: [{ id: "snapshot-test", input: ["text"], contextWindow: 64_000 }] })
    faux.setResponses([fauxAssistantMessage("ok")])
    // 真实 Provider 会在发送前调用 onPayload；faux 流不触发，这里包装一层以覆盖
    // before_provider_payload 采集路径。
    const originalStream = faux.provider.streamSimple ?? faux.provider.stream
    const capturingProvider = {
      ...faux.provider,
      streamSimple: async (model: never, context: never, options: { onPayload?: (payload: unknown) => Promise<void> } | undefined) => {
        await options?.onPayload?.({ messages: (context as { messages: unknown }).messages, model: (model as { id: string }).id })
        return originalStream(model as never, context as never, options as never)
      },
    }
    const models = createModels()
    models.setProvider(capturingProvider as never)
    const repo = new InMemorySessionRepo()
    const sessionID = crypto.randomUUID()
    const session = await repo.create({ id: sessionID })
    const runtime = new PiAgentRuntime({
      harnessFactory: {
        resolve: async () => ({ models, session }),
      },
      toolExecutor: {
        deferredDefinitions: () => [],
        baseCatalog: () => new ToolRegistry(),
      } as never,
      requestSnapshot: recorder,
    })
    const request: PiRuntimeRequest = {
      threadID: "thread-snapshot",
      turnID: "turn-snapshot",
      agentID: "agent-snapshot",
      sessionID,
      content: "original snapshot request",
      taskMode: "chat",
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      signal: new AbortController().signal,
      workspace: {} as never,
      model: faux.getModel(),
      policyModel: { providerID: "faux", id: "snapshot-test" } as never,
      exposedTools: [],
      promptSections: [{
        id: "test-system",
        role: "system",
        cache: "global-stable",
        authority: "builtin",
        source: { type: "builtin", name: "test" },
        content: "snapshot test",
      }],
    }

    await runtime.run(request)
    await runtime.dispose()

    expect(captures).toHaveLength(1)
    expect(captures[0]!.modelId).toBe("snapshot-test")
    expect(captures[0]!.runtimeManifest).toMatchObject({
      version: 2,
      presetID: "main/chat",
      layers: [],
      pluginBindings: [],
      serviceBindings: [],
      interceptorBindings: [],
      promptHash: expect.any(String),
      toolCatalogHash: expect.any(String),
      toolNames: expect.any(Array),
      serviceBindingHash: expect.any(String),
      manifestHash: expect.any(String),
    })
    expect(captures[0]!.payload).toBeDefined()
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import { Model, Provider } from "@codepilotx/model-schema"
import { Capabilities } from "@codepilotx/agent-protocol"
import { AgentDatabase } from "../src/storage/Database"
import { RpcRouter, type RpcRouterDependencies } from "../src/transport/RpcRouter"

const roots: string[] = []
const removeRoot = async (root: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(50)
    }
  }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeRoot))
})

const fixture = async (
  overrides: Partial<RpcRouterDependencies> = {},
) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-rpc-v3-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  let reviewSummaryCalls = 0
  let githubStatusCalls = 0
  const reviewSnapshot = (projectId: string, source: { kind: "unstaged" }) => ({
    projectId,
    generation: "generation:1",
    source,
    repositoryRoot: root,
    headSha: null,
    baseSha: null,
    files: [],
    totals: { files: 0, additions: 0, deletions: 0, changedLines: 0, changedBytes: 0 },
    largeDiffMode: false,
  })
  const review = {
    summary: async (projectId: string, source: { kind: "unstaged" }) => {
      reviewSummaryCalls += 1
      return reviewSnapshot(projectId, source)
    },
    summaryResult: async (projectId: string, source: { kind: "unstaged" }) => {
      reviewSummaryCalls += 1
      return {
        snapshot: reviewSnapshot(projectId, source),
        cacheState: "fresh" as const,
      }
    },
  }
  const github = {
    authStatus: async () => {
      githubStatusCalls += 1
      return { configured: false, authenticated: false, user: null }
    },
  }
  const toolingStatus = {
    id: "ripgrep" as const,
    preference: "managed" as const,
    phase: "idle" as const,
    activeSource: null,
    pinnedVersion: "15.2.0",
    managed: { installed: false, version: null },
    system: { available: false, version: null, path: null },
  }
  const tooling = {
    listStatuses: async () => [toolingStatus],
    setPreference: async (id: "nodejs" | "python" | "git-bash" | "ripgrep", preference: "managed" | "system") => ({ ...toolingStatus, id, preference }),
    install: async (id: "nodejs" | "python" | "git-bash" | "ripgrep") => ({ ...toolingStatus, id, phase: "ready" as const, managed: { installed: true, version: "15.2.0" } }),
  }
  const router = new RpcRouter({
    db,
    review,
    github,
    hub: { publish: () => Effect.void },
    threads: { resumeHookTrust: () => undefined },
    history: null,
    approvals: null,
    questions: null,
    subagents: null,
    attachments: null,
    providers: null,
    integrations: null,
    memory: null,
    hooks: null,
    sandbox: null,
    tooling,
    ...overrides,
  } as unknown as RpcRouterDependencies)
  let id = 0
  let connectionId: string | null = null
  const call = (method: string, params: Record<string, unknown>) =>
    router.handle(
      { jsonrpc: "2.0", id: `test:${++id}`, method, params },
      connectionId ? { connectionId } : {},
    ) as Promise<any>
  const initialize = async (capabilities: readonly string[] = Capabilities) => {
    const response = await call("initialize", {
      clientInfo: { name: "test", version: "1.0.0", platform: "win32" },
      protocols: ["thread-rpc-v3"],
      capabilities: [...capabilities],
      interactionDelivery: "active",
    })
    connectionId = response.result.connectionId
    await router.handle({
      jsonrpc: "2.0",
      method: "initialized",
      params: { protocol: "thread-rpc-v3" },
    }, { connectionId: connectionId! })
    return response
  }
  return {
    db,
    router,
    call,
    initialize,
    counts: () => ({ reviewSummaryCalls, githubStatusCalls }),
  }
}

describe("RPC v3 Router", () => {
  test("initialize negotiates thread-rpc-v3 and returns formal capabilities", async () => {
    const { db, initialize } = await fixture()
    const response = await initialize()
    expect(response.result).toMatchObject({
      protocol: "thread-rpc-v3",
      serverInfo: { name: "codepilotx-agent" },
      capabilities: expect.arrayContaining(["rpc.typed.v1", "git.review.v1", "github.oauth.v1"]),
      limits: { maxSubscriptions: 16, maxStreamsPerSubscription: 64 },
    })
    expect(typeof response.result.connectionId).toBe("string")
    db.close()
  })

  test("RpcMethods is the only method allowlist and params are validated before services", async () => {
    const { db, call, counts, initialize } = await fixture()
    await initialize()
    expect((await call("project/updateSettings", {})).error).toMatchObject({ code: -32601 })
    expect((await call("review/summary", { projectId: "", source: { kind: "unstaged" } })).error).toMatchObject({ code: -32602 })
    expect(counts().reviewSummaryCalls).toBe(0)
    db.close()
  })

  test("rejects requests until the initialized notification completes the negotiated connection", async () => {
    const { db, call } = await fixture()
    expect((await call("github/auth/status", {})).error).toMatchObject({
      code: -32000,
      data: { code: "UNAUTHORIZED" },
    })
    db.close()
  })

  test("rejects methods whose capability was not negotiated by the client", async () => {
    const { db, call, initialize } = await fixture()
    await initialize(["rpc.typed.v1"])
    expect((await call("review/summary", {
      projectId: "project:1",
      source: { kind: "unstaged" },
    })).error).toMatchObject({
      code: -32000,
      data: { code: "CAPABILITY_REQUIRED", details: { capability: "git.review.v1" } },
    })
    db.close()
  })

  test("review and github methods pass through the typed dispatcher", async () => {
    const { db, call, counts, initialize } = await fixture()
    await initialize()
    const review = await call("review/summary", {
      projectId: "project:1",
      source: { kind: "unstaged" },
    })
    expect(review.result).toMatchObject({
      snapshot: {
        projectId: "project:1",
        generation: "generation:1",
        totals: { files: 0 },
      },
      cacheState: "fresh",
    })
    const github = await call("github/auth/status", {})
    expect(github.result).toEqual({ configured: false, authenticated: false, user: null })
    expect(counts()).toEqual({ reviewSummaryCalls: 1, githubStatusCalls: 1 })
    db.close()
  })

  test("tooling methods pass through the typed dispatcher", async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    expect((await call("tooling/list", {})).result.statuses).toEqual([
      expect.objectContaining({ id: "ripgrep", preference: "managed", pinnedVersion: "15.2.0" }),
    ])
    expect((await call("tooling/setPreference", { id: "ripgrep", preference: "system", operationId: "tooling:preference:1" })).result.status)
      .toMatchObject({ id: "ripgrep", preference: "system" })
    expect((await call("tooling/install", { id: "ripgrep", force: true, operationId: "tooling:install:1" })).result.status)
      .toMatchObject({ id: "ripgrep", phase: "ready", managed: { installed: true } })
    expect((await call("tooling/setPreference", { id: "nodejs", preference: "managed", operationId: "tooling:preference:node" })).result.status)
      .toMatchObject({ id: "nodejs", preference: "managed" })
    expect((await call("tooling/install", { id: "python", force: false, operationId: "tooling:install:python" })).result.status)
      .toMatchObject({ id: "python", phase: "ready" })
    db.close()
  })

  test("workspace file methods expose declared file errors instead of internal workspace codes", async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    const root = roots.at(-1)!
    const project = db.createProject({ rootPath: root })
    await writeFile(join(root, "binary.bin"), new Uint8Array([0xff, 0xfe]))
    await writeFile(join(root, "too-large.txt"), Buffer.alloc(20 * 1024 * 1024 + 1, 97))

    const missing = await call("workspace/file/read", {
      projectId: project.id,
      path: "missing.txt",
    })
    expect(missing.error).toMatchObject({
      code: -32000,
      data: { code: "FILE_NOT_FOUND", retryable: false },
    })
    expect(missing.error.message).not.toBe("Agent 内部错误")
    expect((await call("workspace/file/read", {
      projectId: project.id,
      path: "binary.bin",
    })).error).toMatchObject({
      code: -32000,
      data: { code: "FILE_NOT_TEXT", retryable: false },
    })
    expect((await call("workspace/file/read", {
      projectId: project.id,
      path: "too-large.txt",
    })).error).toMatchObject({
      code: -32000,
      data: {
        code: "FILE_TOO_LARGE",
        retryable: false,
        details: {
          sizeBytes: 20 * 1024 * 1024 + 1,
          maxBytes: 20 * 1024 * 1024,
        },
      },
    })
    expect((await call("workspace/file/read", {
      projectId: project.id,
      path: "../outside.txt",
    })).error).toMatchObject({
      code: -32000,
      data: { code: "PATH_DENIED", retryable: false },
    })
    db.close()
  })

  test("model/list returns the complete versioned v3 catalog", async () => {
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [],
        models: async () => [],
      } as unknown as RpcRouterDependencies["providers"],
    })
    await initialize()
    const response = await call("model/list", {})
    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({
      providers: [],
      defaultModel: null,
      reviewerModel: null,
      catalogVersion: expect.any(Number),
    })
    db.close()
  })

  test("paged model catalog filters, caches, and expires versioned cursors", async () => {
    const providerID = Schema.decodeUnknownSync(Provider.ID)("provider:test")
    const otherProviderID = Schema.decodeUnknownSync(Provider.ID)("provider:other")
    const models = [
      Model.Info.empty(providerID, Schema.decodeUnknownSync(Model.ID)("alpha")),
      Model.Info.empty(providerID, Schema.decodeUnknownSync(Model.ID)("beta")),
      Model.Info.empty(otherProviderID, Schema.decodeUnknownSync(Model.ID)("gamma")),
    ]
    let listCalls = 0
    let modelCalls = 0
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => {
          listCalls += 1
          return [Provider.Info.empty(providerID), Provider.Info.empty(otherProviderID)]
        },
        models: async () => {
          modelCalls += 1
          return models
        },
        refresh: async () => undefined,
      } as unknown as RpcRouterDependencies["providers"],
    })
    await initialize()

    const providers = await call("provider/list", {})
    expect(providers.result.providers).toHaveLength(2)
    const first = await call("model/list", { providerId: providerID, enabled: true, limit: 1 })
    expect(first.result).toMatchObject({ total: 2, catalogVersion: 1 })
    expect(first.result.providers[0].models.map((model: Model.Info) => model.id)).toEqual(["alpha"])
    expect(typeof first.result.nextCursor).toBe("string")

    const second = await call("model/list", {
      providerId: providerID,
      enabled: true,
      limit: 1,
      cursor: first.result.nextCursor,
    })
    expect(second.result.providers[0].models.map((model: Model.Info) => model.id)).toEqual(["beta"])
    expect(second.result.nextCursor).toBeUndefined()
    expect(listCalls).toBe(1)
    expect(modelCalls).toBe(1)

    await call("model/refresh", { operationId: "operation:model-refresh-paged" })
    const expired = await call("model/list", {
      providerId: providerID,
      enabled: true,
      limit: 1,
      cursor: first.result.nextCursor,
    })
    expect(expired.error).toMatchObject({ data: { code: "CURSOR_EXPIRED" } })
    db.close()
  })

  test("model mutations and refresh return their declared versioned results", async () => {
    let refreshCalls = 0
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [],
        models: async () => [],
        refresh: async () => {
          refreshCalls += 1
        },
      } as unknown as RpcRouterDependencies["providers"],
    })
    await initialize()
    expect((await call("model/setDefault", {
      model: null,
      operationId: "operation:model-default",
    })).result).toEqual({
      defaultModel: null,
      settingsVersion: 2,
    })
    expect((await call("model/setReviewer", {
      model: null,
      operationId: "operation:model-reviewer",
    })).result).toEqual({
      reviewerModel: null,
      settingsVersion: 3,
    })
    expect((await call("model/refresh", {
      operationId: "operation:model-refresh",
    })).result).toMatchObject({
      providers: [],
      catalogVersion: 4,
    })
    expect(refreshCalls).toBe(1)
    db.close()
  })

  test("integration methods consume camelCase v3 params and return declared resources", async () => {
    const integrationId = "integration:fixture"
    const attemptId = "attempt:fixture"
    const connection = {
      type: "credential",
      id: "credential:fixture",
      label: "Fixture",
    }
    let connected = false
    let attemptStatus: Record<string, unknown> = {
      status: "pending",
      time: { created: 1, expires: 10_000 },
    }
    const integration = () => ({
      id: integrationId,
      name: "Fixture",
      methods: [
        { type: "key" },
        { id: "oauth:fixture", type: "oauth", label: "OAuth" },
      ],
      connections: connected ? [connection] : [],
    })
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies["providers"],
      integrations: {
        list: async () => [integration()],
        connect: async () => {
          connected = true
          return connection
        },
        authorize: async () => ({
          attemptID: attemptId,
          url: "https://example.com/authorize",
          instructions: "Authorize",
          mode: "code",
          time: { created: 1, expires: 10_000 },
        }),
        complete: async () => {
          connected = true
          attemptStatus = {
            status: "complete",
            time: { created: 1, expires: 10_000 },
          }
          return connection
        },
        status: async () => attemptStatus,
        attemptContext: () => ({
          integrationID: integrationId,
          ...(connected ? { connection } : {}),
        }),
        disconnect: async () => {
          connected = false
        },
      } as unknown as RpcRouterDependencies["integrations"],
    })
    await initialize()

    expect((await call("integration/connect", {
      integrationId,
      key: "fixture-key",
      operationId: "operation:integration-connect",
    })).result.integration.connections).toHaveLength(1)
    expect((await call("integration/authorize", {
      integrationId,
      methodId: "oauth:fixture",
      inputs: {},
      operationId: "operation:integration-authorize",
    })).result.attempt.attemptID).toBe(attemptId)
    expect((await call("integration/authorizeStatus", {
      attemptId,
    })).result.attempt).toMatchObject({
      attemptId,
      integrationId,
      status: { status: "pending" },
    })
    expect((await call("integration/authorizeComplete", {
      attemptId,
      code: "fixture-code",
      operationId: "operation:integration-complete",
    })).result).toMatchObject({
      attempt: {
        attemptId,
        integrationId,
        status: { status: "complete" },
      },
      integration: { id: integrationId },
    })
    expect((await call("integration/disconnect", {
      integrationId,
      credentialId: connection.id,
      operationId: "operation:integration-disconnect",
    })).result.integration.connections).toHaveLength(0)
    db.close()
  })

  test("provider methods return the declared v3 health and summary shapes", async () => {
    const provider = Provider.Info.empty(Provider.ID.make("provider:fixture"))
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies["providers"],
      integrations: {
        list: async () => [],
      } as unknown as RpcRouterDependencies["integrations"],
    })
    await initialize()

    expect((await call("provider/test", {
      providerId: provider.id,
    })).result).toMatchObject({
      providerId: provider.id,
      status: "unavailable",
      category: "configuration",
    })
    expect((await call("provider/updateSettings", {
      providerId: provider.id,
      settings: {
        name: "Fixture provider",
        api: "https://example.com/v1",
      },
      operationId: "operation:provider-settings",
    })).result).toEqual({
      provider: {
        id: provider.id,
        name: provider.name,
        disabled: false,
        configured: true,
        modelCount: 0,
      },
      catalogVersion: 2,
    })
    expect(db.providerSettings<Record<string, unknown>>().get(provider.id)).toMatchObject({
      name: "Fixture provider",
      api: "https://example.com/v1",
    })
    db.close()
  })

  test("event subscriptions track high-watermarks, acknowledgements and closure", async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    db.insertEvent("thread:1", null, "thread/updated", {})
    const subscribed = await call("event/subscribe", {
      streams: [{ streamId: "global", after: 0 }, { streamId: "thread:1", after: 0 }],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: "global", sequence: 1 },
      { streamId: "thread:1", sequence: 1 },
    ])
    const subscriptionId = subscribed.result.subscriptionId
    expect((await call("event/ack", {
      subscriptionId,
      positions: [{ streamId: "thread:1", sequence: 1 }],
    })).result.acknowledged).toEqual([{ streamId: "thread:1", sequence: 1 }])
    expect((await call("event/unsubscribe", { subscriptionId })).result).toEqual({ ok: true })
    expect((await call("event/ack", {
      subscriptionId,
      positions: [{ streamId: "thread:1", sequence: 1 }],
    })).error).toMatchObject({ code: -32000, data: { code: "SUBSCRIPTION_NOT_FOUND" } })
    expect((await call("event/subscribe", {
      streams: [{ streamId: "global", after: 99 }],
    })).error).toMatchObject({ code: -32000, data: { code: "CURSOR_EXPIRED" } })
    db.close()
  })

  test("latest event cursors normalize to the captured high-watermark after retained history advances", async () => {
    const { db, router, call, initialize } = await fixture()
    const initialized = await initialize()
    const discarded = db.insertEvent("thread:1", null, "thread/updated", {})
    const retained = db.insertEvent("thread:1", null, "thread/updated", {})
    db.sqlite.query("DELETE FROM events WHERE id = ?").run(discarded.id)

    expect((await call("event/subscribe", {
      streams: [{ streamId: "global", after: 0 }],
    })).error).toMatchObject({
      code: -32000,
      data: {
        code: "CURSOR_EXPIRED",
        details: { streamId: "global", lowWatermark: retained.id, highWatermark: retained.id },
      },
    })

    const subscribed = await call("event/subscribe", {
      streams: [{ streamId: "global", after: "latest" }],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: "global", sequence: retained.id },
    ])
    const subscription = router.subscriptions.get(
      subscribed.result.subscriptionId,
      initialized.result.connectionId,
    )
    expect(subscription?.streams.get("global")).toBe(retained.id)
    expect(subscription?.acknowledged.get("global")).toBe(retained.id)
    db.close()
  })

  test("recovers and idempotently resolves hook trust through the unified interaction methods", async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    const project = db.createProject({ rootPath: roots.at(-1)! })
    const thread = db.createThread("interaction", project.id)
    const turn = db.createTurn(thread.id, {
      content: "test",
      model: Model.Ref.make({
        providerID: Provider.ID.make("test"),
        id: Model.ID.make("model"),
      }),
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      strategy: "queue",
      taskMode: "chat",
    })
    const pending = db.ensureHookTrustRequest({
      threadID: thread.id,
      turnID: turn.turnID,
      workspacePath: roots.at(-1)!,
      configPath: join(roots.at(-1)!, ".codepilotx", "hooks.json"),
      configHash: "a".repeat(64),
      auditSummary: {
        hooks: [{ id: "pre-tool", event: "preToolUse", command: "bun run check" }],
      },
    })
    const listed = await call("interaction/listPending", {
      threadId: thread.id,
      kinds: ["hookTrust"],
    })
    expect(listed.result.interactions).toMatchObject([{
      interactionId: pending.request.id,
      kind: "hookTrust",
      version: 1,
      hook: { id: "pre-tool", command: "bun run check" },
    }])
    const params = {
      interactionId: pending.request.id,
      expectedVersion: 1,
      response: { kind: "hookTrust", decision: "allow" },
      operationId: "interaction:hook:allow",
    }
    const resolved = await call("interaction/respond", params)
    expect(resolved.result).toMatchObject({
      interactionId: pending.request.id,
      kind: "hookTrust",
      state: "resolved",
      version: 2,
    })
    expect((await call("interaction/respond", params)).result).toEqual(resolved.result)
    expect(db.interactionOperation(params.operationId)?.result).toEqual(resolved.result)
    db.close()
  })
})

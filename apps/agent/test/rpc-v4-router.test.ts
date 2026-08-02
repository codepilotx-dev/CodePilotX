import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import { Model, Provider } from "@codepilotx/model-schema"
import { Capabilities } from "@codepilotx/agent-protocol"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { AgentError } from "../src/domain"
import { RpcRouter, type RpcRouterDependencies } from "../src/transport/rpc/RpcRouter"
import { ThreadProjection } from "../src/transport/ThreadProjection"

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
  routerOptions: { connectionLeaseMs?: number; now?: () => number } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-rpc-v4-"))
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
    applyBatch: async (input: {
      action: "stage" | "unstage" | "revert"
      generation: string
      items: Array<{ path: string }>
    }) => ({
      ok: true as const,
      action: input.action,
      paths: input.items.map((item) => item.path),
      generation: input.generation,
      appliedCount: input.items.length,
    }),
  }
  const github = {
    authStatus: async () => {
      githubStatusCalls += 1
      return { configured: false, authenticated: false, user: null }
    },
  }
  const configDocument: Record<string, unknown> = {}
  const router = new RpcRouter({
    config: {
      snapshot: () => configDocument,
      read: async () => ({
        config: configDocument,
        origins: {},
        diagnostics: [],
        profileState: {
          activeProfile: null,
          selectedProfile: null,
          restartRequired: false,
        },
      }),
      batchWrite: async ({ edits }: { edits: Array<{ keyPath: string[]; value: unknown }> }) => {
        for (const edit of edits) {
          let cursor = configDocument
          for (const key of edit.keyPath.slice(0, -1)) {
            if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {}
            cursor = cursor[key] as Record<string, unknown>
          }
          const leaf = edit.keyPath.at(-1)!
          if (edit.value === null) delete cursor[leaf]
          else cursor[leaf] = edit.value
        }
        return {
          status: "ok",
          version: "a".repeat(64),
          filePath: join(root, "config.json"),
        }
      },
    },
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
    piModels: null,
    providerCredentials: null,
    authSessions: null,
    apiKeys: null,
    memory: null,
    hooks: null,
    ...overrides,
  } as unknown as RpcRouterDependencies, routerOptions)
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
      protocols: ["thread-rpc-v4"],
      capabilities: [...capabilities],
      interactionDelivery: "active",
    })
    connectionId = response.result.connectionId
    await router.handle({
      jsonrpc: "2.0",
      method: "initialized",
      params: { protocol: "thread-rpc-v4" },
    }, { connectionId: connectionId! })
    return response
  }
  return {
    db,
    configDocument,
    router,
    call,
    initialize,
    counts: () => ({ reviewSummaryCalls, githubStatusCalls }),
  }
}

describe("RPC v4 Router", () => {
  test("Chat admission 使用独立 start、steer、queue/add 和精确 interrupt 入口", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const threads = {
      startTurn: async (...args: unknown[]) => {
        calls.push({ method: "start", args })
        return { disposition: "started" as const, turnID: "turn:start", inputID: "input:start" }
      },
      steerTurn: async (...args: unknown[]) => {
        calls.push({ method: "steer", args })
        return { disposition: "steered" as const, turnID: "turn:active", inputID: "input:steer" }
      },
      enqueueFollowUp: async (...args: unknown[]) => {
        calls.push({ method: "queue", args })
        return { disposition: "queued" as const, turnID: "turn:queued", inputID: "input:queued" }
      },
      stop: async (...args: unknown[]) => {
        calls.push({ method: "interrupt", args })
        return "interrupted" as const
      },
      resumeHookTrust: () => undefined,
    }
    const value = await fixture({ threads: threads as never })
    await value.initialize()
    const model = Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("test") })
    const thread = value.db.createThread()
    const active = value.db.createTurn(thread.id, {
      content: "active",
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      strategy: "start",
      taskMode: "chat",
    })
    value.db.claimTurnExecution(active.turnID)

    const start = await value.call("turn/start", {
      threadId: "thread:start",
      inputId: "input:start",
      content: "start",
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      taskMode: "chat",
    })
    const steer = await value.call("turn/steer", {
      threadId: thread.id,
      turnId: active.turnID,
      inputId: "input:steer",
      content: "steer",
      attachmentIds: ["attachment:steer"],
    })
    const queued = await value.call("queue/add", {
      threadId: thread.id,
      inputId: "input:queued",
      content: "later",
      model,
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      taskMode: "chat",
      operationId: "operation:queue",
    })
    const interrupted = await value.call("turn/interrupt", {
      threadId: thread.id,
      turnId: active.turnID,
      operationId: "operation:interrupt",
    })

    expect(start.result.disposition).toBe("accepted")
    expect(steer.result.disposition).toBe("accepted")
    expect(queued.result.admission).toBe("queued")
    expect(interrupted.result).toMatchObject({ turnId: active.turnID, status: "interrupted" })
    expect(calls.map(({ method }) => method)).toEqual(["start", "steer", "queue", "interrupt"])
    expect(calls.at(-1)?.args).toEqual([thread.id, active.turnID])
    value.db.close()
  })

  test("initialize negotiates thread-rpc-v4 and returns formal capabilities", async () => {
    const { db, initialize } = await fixture()
    const response = await initialize()
    expect(response.result).toMatchObject({
      protocol: "thread-rpc-v4",
      serverInfo: { name: "codepilotx-agent" },
      capabilities: expect.arrayContaining(["rpc.typed.v1", "git.review.v1", "github.oauth.v1"]),
      limits: { maxSubscriptions: 16, maxStreamsPerSubscription: 64 },
    })
    expect(typeof response.result.connectionId).toBe("string")
    db.close()
  })

  test("sandbox compatibility methods report the removed runtime without invoking a backend", async () => {
    const { db, initialize, call } = await fixture()
    await initialize()

    for (const method of ["sandbox/status", "sandbox/refresh"]) {
      expect((await call(method, {})).result).toEqual({
        sandbox: {
          state: "unsupported",
          platform: process.platform,
          architecture: process.arch,
          runtimeVersion: "host-hook-v1",
          maturity: "alpha",
          maxConcurrentCommands: 1,
          error: "内置命令沙箱已移除；Shell 经 Pi Hook 和权限检查后以当前用户身份在本机执行。",
          operations: {
            canInstall: false,
            canRepair: false,
            canUninstall: false,
          },
        },
      })
    }

    for (const [method, params] of [
      ["sandbox/install", { operationId: "sandbox:install" }],
      ["sandbox/repair", { operationId: "sandbox:repair" }],
      ["sandbox/uninstall", { operationId: "sandbox:uninstall", confirm: true }],
    ] as const) {
      expect((await call(method, params)).error).toMatchObject({
        code: -32000,
        data: { code: "SANDBOX_UNAVAILABLE", retryable: true },
      })
    }
    db.close()
  })

  test("release notes RPC requires its capability and delegates exact list params", async () => {
    const calls: Array<{ currentVersion: string; refresh: boolean }> = []
    const { db, call, initialize } = await fixture({
      releaseNotes: {
        list: async (currentVersion: string, refresh: boolean) => {
          calls.push({ currentVersion, refresh })
          return {
            source: "github-releases",
            repository: "codepilotx-dev/CodePilotX",
            currentVersion,
            currentReleaseFound: false,
            fetchedAt: "2026-07-27T00:00:00.000Z",
            truncated: false,
            releases: [],
          }
        },
      } as unknown as RpcRouterDependencies["releaseNotes"],
    })
    await initialize()

    const response = await call("release-notes/list", {
      currentVersion: "0.2.0-beta.1",
      refresh: true,
    })

    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      repository: "codepilotx-dev/CodePilotX",
      currentVersion: "0.2.0-beta.1",
    })
    expect(calls).toEqual([{
      currentVersion: "0.2.0-beta.1",
      refresh: true,
    }])
    db.close()
  })

  test("dispatches all MCP management methods through the typed runtime service", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const server = {
      name: "fixture",
      scope: "user" as const,
      enabled: true,
      transport: {
        type: "http" as const,
        url: "http://127.0.0.1:3000/mcp",
      },
    }
    const listResult = {
      servers: [{ server, effective: true }],
      generation: 2,
    }
    const mcp = {
      list: async (input: unknown) => {
        calls.push({ method: "list", input })
        return listResult
      },
      status: async (input: unknown) => {
        calls.push({ method: "status", input })
        return {
          servers: [{
            name: "fixture",
            scope: "user",
            type: "http",
            state: "connected",
            auth: { source: "none", canLogin: true, canLogout: false },
            toolCount: 1,
            resourceCount: 1,
            promptCount: 1,
          }],
          totalTools: 1,
          totalResources: 1,
          totalPrompts: 1,
          generation: 2,
        }
      },
      save: async (input: unknown) => {
        calls.push({ method: "save", input })
        return { ...listResult, changed: true }
      },
      remove: async (input: unknown) => {
        calls.push({ method: "remove", input })
        return { servers: [], generation: 3, changed: true }
      },
      setEnabled: async (input: unknown) => {
        calls.push({ method: "setEnabled", input })
        return { ...listResult, changed: true }
      },
      reload: async (input: unknown) => {
        calls.push({ method: "reload", input })
        return {
          generation: 4,
          added: [],
          replaced: ["fixture"],
          removed: [],
          unchanged: [],
          failed: [],
        }
      },
      oauthStart: async (input: unknown) => {
        calls.push({ method: "oauthStart", input })
        return {
          attemptId: "oauth-attempt",
          authorizationUrl: "https://auth.example/authorize",
          expiresAt: Date.now() + 60_000,
        }
      },
      oauthStatus: (input: unknown) => {
        calls.push({ method: "oauthStatus", input })
        return { state: "pending" }
      },
      oauthLogout: async (input: unknown) => {
        calls.push({ method: "oauthLogout", input })
        return { generation: 5 }
      },
    }
    const { db, call, initialize } = await fixture({ mcp } as never)
    await initialize()
    const workspace = "F:\\workspace"
    expect((await call("mcp/list", { workspace })).result).toEqual(listResult)
    expect((await call("mcp/status", { workspace })).result.totalTools).toBe(1)
    expect((await call("mcp/save", {
      workspace,
      server,
      operationId: "save-operation",
    })).result).toEqual(listResult)
    expect((await call("mcp/setEnabled", {
      workspace,
      scope: "user",
      name: "fixture",
      enabled: false,
      operationId: "enable-operation",
    })).result).toEqual(listResult)
    expect((await call("mcp/remove", {
      workspace,
      scope: "user",
      name: "fixture",
      operationId: "remove-operation",
    })).result.servers).toEqual([])
    expect((await call("mcp/reload", {
      workspace,
      operationId: "reload-operation",
    })).result.replaced).toEqual(["fixture"])
    expect((await call("mcp/oauth/start", {
      workspace,
      scope: "user",
      name: "fixture",
      operationId: "oauth-start-operation",
    })).result.attemptId).toBe("oauth-attempt")
    expect((await call("mcp/oauth/status", {
      attemptId: "oauth-attempt",
    })).result.state).toBe("pending")
    expect((await call("mcp/oauth/logout", {
      workspace,
      scope: "user",
      name: "fixture",
      operationId: "oauth-logout-operation",
    })).result.generation).toBe(5)
    expect(calls.map((entry) => entry.method)).toEqual([
      "list",
      "status",
      "save",
      "setEnabled",
      "remove",
      "reload",
      "oauthStart",
      "oauthStatus",
      "oauthLogout",
    ])
    expect(calls.filter((entry) => entry.method !== "oauthStatus").every((entry) =>
      (entry.input as { workspace?: string }).workspace === workspace
    )).toBe(true)
    db.close()
  })

  test("thread/history/read 返回分页正文与同事务 streamPosition", async () => {
    const { db, initialize, call } = await fixture()
    await initialize()
    const thread = db.createThread("分页 RPC")
    const model = Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt") })
    for (let index = 0; index < 11; index += 1) {
      const turn = db.createTurn(thread.id, {
        content: `第 ${index + 1} 轮`,
        model,
        permissionConfig: DEFAULT_PERMISSION_CONFIG,
        strategy: "queue",
        taskMode: "chat",
      }, "completed")
      db.updateTurnStatus(turn.turnID, "completed")
    }

    const response = await call("thread/history/read", { threadId: thread.id })
    expect(response.error).toBeUndefined()
    expect(response.result.turns).toHaveLength(10)
    expect(response.result.hasOlder).toBe(true)
    expect(response.result.streamPosition).toEqual({
      streamId: thread.id,
      sequence: (db.sqlite.query("SELECT MAX(id) AS id FROM events WHERE thread_id = ?").get(thread.id) as { id: number }).id,
    })

    const older = await call("thread/history/read", { threadId: thread.id, before: response.result.olderCursor })
    expect(older.result.turns).toHaveLength(1)
    expect(older.result.hasOlder).toBe(false)
    expect(older.result.olderCursor).toBeNull()
    db.close()
  })

  test("thread/mark-read 通过 read-through 清除持久化未读标记", async () => {
    let database: AgentDatabase
    const history = {
      markRead: (threadID: string, readThroughAt: number) => {
        database.markThreadReadThrough(threadID, readThroughAt)
        return new ThreadProjection(database).list().find((item) => item.id === threadID)!
      },
    } as unknown as RpcRouterDependencies["history"]
    const { db, initialize, call } = await fixture({ history })
    database = db
    await initialize()
    const thread = db.createThread("未读 RPC")
    db.markThreadUnread(thread.id, 100)

    const stale = await call("thread/mark-read", {
      threadId: thread.id,
      readThroughAt: 90,
      operationId: "operation:mark-read-stale",
    })
    expect(stale.error).toBeUndefined()
    expect(stale.result.thread.unreadAt).toBe(100)

    const read = await call("thread/mark-read", {
      threadId: thread.id,
      readThroughAt: 100,
      operationId: "operation:mark-read",
    })
    expect(read.error).toBeUndefined()
    expect(read.result.thread.unreadAt).toBeNull()
    expect(db.sqlite.query(
      "SELECT read_at, unread_at FROM thread_read_state WHERE thread_id = ?",
    ).get(thread.id)).toEqual({ read_at: 100, unread_at: null })
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
    const applied = await call("review/applyBatch", {
      projectId: "project:1",
      source: { kind: "unstaged" },
      generation: "generation:1",
      action: "stage",
      items: [{ path: "src/index.ts", expectedRevision: "revision:1" }],
    })
    expect(applied.result).toEqual({
      ok: true,
      action: "stage",
      paths: ["src/index.ts"],
      generation: "generation:1",
      appliedCount: 1,
    })
    const github = await call("github/auth/status", {})
    expect(github.result).toEqual({ configured: false, authenticated: false, user: null })
    expect(counts()).toEqual({ reviewSummaryCalls: 1, githubStatusCalls: 1 })
    db.close()
  })

  test("Git 和 Review RPC 错误只公开允许的安全 details", async () => {
    const gitFailure = await fixture({
      review: {
        summaryResult: async () => {
          throw new AgentError("GIT_COMMAND_FAILED", "Git 操作失败", 409, {
            stderr: "fatal: C:\\secret\\repository",
            args: ["status", "--porcelain"],
          })
        },
      } as never,
    })
    await gitFailure.initialize()
    const failed = await gitFailure.call("review/summary", {
      projectId: "project:git-error",
      source: { kind: "unstaged" },
    })
    expect(failed.error.data).toEqual({
      code: "GIT_COMMAND_FAILED",
      retryable: false,
    })
    expect(JSON.stringify(failed)).not.toContain("secret")

    const expiredFailure = await fixture({
      review: {
        summaryResult: async () => {
          throw new AgentError(
            "REVIEW_SNAPSHOT_EXPIRED",
            "Review 快照已经过期，请刷新后重试",
            409,
            {
              latestGeneration: "generation:latest",
              retryable: true,
              stderr: "fatal: C:\\secret\\repository",
            },
          )
        },
      } as never,
    })
    await expiredFailure.initialize()
    const expired = await expiredFailure.call("review/summary", {
      projectId: "project:review-expired",
      source: { kind: "unstaged" },
    })
    expect(expired.error.data).toEqual({
      code: "REVIEW_SNAPSHOT_EXPIRED",
      retryable: false,
      details: {
        latestGeneration: "generation:latest",
        retryable: true,
      },
    })
    expect(JSON.stringify(expired)).not.toContain("secret")
  })

  test("task suggestion RPC resolves project scope and returns safe service output", async () => {
    let calls = 0
    const suggestions = {
      generate: async (params: any, projectKey?: string) => {
        calls += 1
        expect(params.workspace.kind).toBe("project")
        expect(typeof projectKey).toBe("string")
        return {
          contextKey: "context:1",
          generatedAt: 1,
          suggestions: [{
            id: "suggestion:1",
            categoryId: "codex-review",
            label: "审查当前改动",
            prompt: "Review current changes",
          }],
        }
      },
    }
    const { db, call, initialize } = await fixture({
      suggestions,
    } as unknown as Partial<RpcRouterDependencies>)
    await initialize()
    const project = db.createProject({ rootPath: roots.at(-1)! })
    const context = {
      workspaceName: "fixture",
      branchName: "main",
      git: null,
      recentTasks: [],
      localCandidates: [
        { id: "1", categoryId: "codex-explore", label: "探索", prompt: "Explore" },
        { id: "2", categoryId: "codex-create", label: "构建", prompt: "Build" },
        { id: "3", categoryId: "codex-review", label: "审查", prompt: "Review" },
        { id: "4", categoryId: "codex-fix", label: "修复", prompt: "Fix" },
      ],
    }
    const response = await call("task-suggestion/generate", {
      workspace: { kind: "project", projectId: project.id },
      context,
    })
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({
      contextKey: "context:1",
      suggestions: [{ categoryId: "codex-review" }],
    })
    expect(calls).toBe(1)

    const missing = await call("task-suggestion/generate", {
      workspace: { kind: "project", projectId: "project:missing" },
      context,
    })
    expect(missing.error).toMatchObject({
      data: { code: "PROJECT_NOT_FOUND" },
    })
    expect(calls).toBe(1)
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
      folderId: project.primaryFolderId,
      path: "missing.txt",
    })
    expect(missing.error).toMatchObject({
      code: -32000,
      data: { code: "FILE_NOT_FOUND", retryable: false },
    })
    expect(missing.error.message).not.toBe("Agent 内部错误")
    expect((await call("workspace/file/read", {
      projectId: project.id,
      folderId: project.primaryFolderId,
      path: "binary.bin",
    })).error).toMatchObject({
      code: -32000,
      data: { code: "FILE_NOT_TEXT", retryable: false },
    })
    expect((await call("workspace/file/read", {
      projectId: project.id,
      folderId: project.primaryFolderId,
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
      folderId: project.primaryFolderId,
      path: "../outside.txt",
    })).error).toMatchObject({
      code: -32000,
      data: { code: "PATH_DENIED", retryable: false },
    })
    db.close()
  })

  test("model/list returns the complete versioned v4 catalog", async () => {
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
    const authConfiguredCalls: string[] = []
    const { db, call, initialize } = await fixture({
      providers: {
        list: async () => {
          listCalls += 1
          return [
            Provider.Info.empty(providerID),
            { ...Provider.Info.empty(otherProviderID), disabled: true },
          ]
        },
        models: async () => {
          modelCalls += 1
          return models
        },
        refresh: async () => undefined,
      } as unknown as RpcRouterDependencies["providers"],
      piModels: {
        providerDefinitions: async () => [
          {
            kind: "builtin",
            id: providerID,
            enabled: true,
            allowModels: [],
            denyModels: [],
            models: [],
          },
          {
            kind: "builtin",
            id: otherProviderID,
            enabled: true,
            allowModels: [],
            denyModels: [],
            models: [],
          },
        ],
        configIssues: async () => [],
        isAuthConfigured: async (candidateProviderID: string) => {
          authConfiguredCalls.push(candidateProviderID)
          return true
        },
      } as unknown as RpcRouterDependencies["piModels"],
    })
    await initialize()

    const providers = await call("provider/list", {})
    expect(providers.error).toBeUndefined()
    expect(providers.result.providers).toHaveLength(2)
    expect(providers.result.providers.map((provider: { authConfigured: boolean }) =>
      provider.authConfigured
    )).toEqual([true, false])
    expect(authConfiguredCalls).toEqual([String(providerID)])
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

  test("provider methods create canonical Pi v2 configuration", async () => {
    const provider = Provider.Info.empty(Provider.ID.make("provider:fixture"))
    const { db, configDocument, call, initialize } = await fixture({
      providers: {
        list: async () => [provider],
        models: async () => [],
        reload: async () => undefined,
      } as unknown as RpcRouterDependencies["providers"],
    })
    await initialize()

    expect((await call("provider/test", {
      providerId: provider.id,
    })).result).toMatchObject({
      providerId: provider.id,
      status: "unavailable",
      category: "configuration",
    })
    expect((await call("provider/create", {
      definition: {
        kind: "custom",
        id: provider.id,
        name: "Fixture provider",
        enabled: true,
        baseUrl: "https://example.com/v1",
        auth: "none",
        env: [],
        allowInsecureHttp: false,
        headers: {},
        models: [{
          id: "fixture-model",
          api: "openai-completions",
        }],
      },
      operationId: "operation:provider-create",
    })).result).toEqual({
      providerId: provider.id,
      catalogVersion: 2,
    })
    expect(
      (configDocument.model_providers as Record<string, unknown>)[provider.id],
    ).toMatchObject({
      name: "Fixture provider",
      base_url: "https://example.com/v1",
      kind: "custom",
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

  test("thread stream cursors use the global event high-watermark", async () => {
    const { db, call, initialize } = await fixture()
    await initialize()
    db.insertEvent("thread:1", null, "thread/updated", {})
    const globalHigh = db.insertEvent("thread:2", null, "thread/updated", {}).id

    const subscribed = await call("event/subscribe", {
      streams: [{ streamId: "thread:1", after: "latest" }],
    })
    expect(subscribed.result.highWatermarks).toEqual([
      { streamId: "thread:1", sequence: globalHigh },
    ])
    expect((await call("event/ack", {
      subscriptionId: subscribed.result.subscriptionId,
      positions: [{ streamId: "thread:1", sequence: globalHigh }],
    })).result.acknowledged).toEqual([
      { streamId: "thread:1", sequence: globalHigh },
    ])
    db.close()
  })

  test("connection lease is touched by RPC/SSE activity and lazily closes subscriptions", async () => {
    let now = 1_000
    const { db, router, call, initialize } = await fixture({}, {
      connectionLeaseMs: 1_000,
      now: () => now,
    })
    const initialized = await initialize()
    const connectionId = initialized.result.connectionId as string
    const subscribed = await call("event/subscribe", {
      streams: [{ streamId: "global", after: "latest" }],
    })

    now = 1_900
    expect((await call("github/auth/status", {})).error).toBeUndefined()
    now = 2_800
    expect(router.touchConnection(connectionId)).toBe(true)
    now = 3_801
    expect(router.touchConnection(connectionId)).toBe(false)
    expect(router.subscriptions.get(subscribed.result.subscriptionId, connectionId)).toBeNull()
    expect((await call("github/auth/status", {})).error).toMatchObject({
      data: { code: "UNAUTHORIZED" },
    })
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

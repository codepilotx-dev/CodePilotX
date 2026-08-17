import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import {
  PiOrchestratorAdapter,
  type AgentLoopOverride,
  type AgentLoopRunInput,
} from "../src/orchestration/PiOrchestratorAdapter"
import type { AgentRuntimeRequest } from "../src/orchestration/AgentRuntimeTypes"
import { AgentError } from "../src/domain"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { SystemProfileLoader, PENDING_SYSTEM_PROFILE_KEY } from "../src/plugin/system/SystemProfileLoader"
import { SystemServiceRegistry } from "../src/plugin/system/SystemServiceRegistry"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

// ── Adapter 委托路径（PR 8C） ─────────────────────────────────────────────

const makeRequest = (overrides: Partial<AgentRuntimeRequest> = {}): AgentRuntimeRequest => ({
  threadID: "thread:1",
  turnID: "turn:1",
  agentID: "agent:1",
  sessionID: "session:1",
  content: "hello",
  taskMode: "chat",
  fallbackModel: { providerID: "fixture", id: "model" } as never,
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  signal: new AbortController().signal,
  workspace: {} as never,
  resolveModel: async () => ({ ref: { providerID: "fixture", id: "model" } as never, model: {} }),
  onUsage: async () => undefined,
  onRuntimeReady: async () => undefined,
  pause: async () => undefined,
  ...overrides,
})

const makeAdapter = (
  loopOverride: () => AgentLoopOverride | null,
  publish: (event: unknown) => void = () => undefined,
) => new PiOrchestratorAdapter({
  db: {} as never,
  hub: { publish: (event: unknown) => {
    publish(event)
    return Effect.succeed(event)
  } } as never,
  models: {} as never,
  toolExecutor: {} as never,
  contextCompaction: {} as never,
  loopOverride,
})

const completedLoop: AgentLoopOverride = {
  runTurn: async (input) => {
    expect(input.threadID).toBe("thread:1")
    expect(input.turnID).toBe("turn:1")
    expect(input.agentID).toBe("agent:1")
    expect(input.sessionID).toBe("session:1")
    expect(input.model).toEqual({ providerID: "fixture", id: "model" })
    expect(input.taskMode).toBe("chat")
    expect(input.content).toBe("hello")
    return {
      status: "completed",
      output: "fixture loop done",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, requests: 1 },
      events: [{ method: "fixture/event", params: { ok: true } }],
    }
  },
}

describe("System agent-loop provider（PR 8C）", () => {
  test("provider completed：固定输入透传，output/usage/事件发布由 Host 完成", async () => {
    let ready = false
    let usage: unknown
    const published: unknown[] = []
    const adapter = makeAdapter(() => completedLoop, async (event) => {
      published.push(event)
    })
    const result = await adapter.run(makeRequest({
      onRuntimeReady: async () => {
        ready = true
      },
      onUsage: async (u) => {
        usage = u
      },
    }))
    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.output).toBe("fixture loop done")
      expect(result.result).toBeUndefined()
    }
    expect(ready).toBe(true)
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, requests: 1 })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ method: "fixture/event", params: { ok: true } })
  })

  test("provider paused：映射为 { status: \"paused\", output }", async () => {
    const adapter = makeAdapter(() => ({
      runTurn: async () => ({ status: "paused" as const, output: "waiting" }),
    }))
    const result = await adapter.run(makeRequest())
    expect(result).toEqual({ status: "paused", output: "waiting" })
  })

  test("provider error：映射为 AgentError（分类输出）", async () => {
    const adapter = makeAdapter(() => ({
      runTurn: async () => ({
        status: "error" as const,
        output: "",
        error: { code: "FIXTURE_LOOP_FAILED", message: "fixture 失败" },
      }),
    }))
    await expect(adapter.run(makeRequest())).rejects.toMatchObject({
      code: "FIXTURE_LOOP_FAILED",
      message: "fixture 失败",
    })
  })

  test("provider interrupted：映射为 RUN_ABORTED 499（中断状态）", async () => {
    const adapter = makeAdapter(() => ({
      runTurn: async () => ({ status: "interrupted" as const, output: "" }),
    }))
    await expect(adapter.run(makeRequest())).rejects.toMatchObject({
      code: "RUN_ABORTED",
      status: 499,
    })
  })

  test("provider 抛异常：fail-closed 为 LOOP_PROVIDER_ERROR，不泄露原始异常", async () => {
    const adapter = makeAdapter(() => ({
      runTurn: async () => {
        throw new Error("secret detail")
      },
    }))
    await expect(adapter.run(makeRequest())).rejects.toMatchObject({
      code: "LOOP_PROVIDER_ERROR",
      message: "secret detail",
    })
  })

  test("resume/aborted 状态透传给 provider", async () => {
    let received: AgentLoopRunInput | undefined
    const adapter = makeAdapter(() => ({
      runTurn: async (input) => {
        received = input
        return { status: "completed" as const, output: "ok" }
      },
    }))
    const signal = new AbortController()
    signal.abort()
    await adapter.run(makeRequest({
      signal: signal.signal,
      resume: {
        state: "{}",
        interruption: { toolCallID: "call:1" },
        answer: null,
        toolCallID: "call:1",
      },
    }))
    expect(received?.aborted).toBe(true)
    expect(received?.resume?.toolCallID).toBe("call:1")
  })

  test("无 provider（loopOverride 返回 null）不进入委托路径", async () => {
    let called = false
    const adapter = makeAdapter(() => null)
    const run = adapter.run(makeRequest({
      resolveModel: async () => {
        called = true
        throw new AgentError("MODEL_UNAVAILABLE", "fixture: 无模型", 409)
      },
    }))
    await expect(run).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" })
    expect(called).toBe(true)
  })
})

// ── Loader 集成：agent-loop provider 经 System Profile 激活 ───────────────

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-agent-loop-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  const registry = new SystemServiceRegistry()
  const loader = new SystemProfileLoader(db, registry)
  return { root, db, installer, repo, loader, registry }
}

const AGENT_LOOP_BUNDLE = `export default {
  id: "acme.loop-provider",
  version: "1.0.0",
  displayName: "测试 Loop Provider",
  provides: ["codepilotx.agent-loop@1"],
  requires: {},
  register: (context) => {
    context.registerProvider("codepilotx.agent-loop@1", {
      runTurn: async (input) => ({
        status: "completed",
        output: "fixture loop: " + input.content,
      }),
    })
    return undefined
  },
}
`

test("agent-loop provider 经 System Profile 激活后注册进 registry，默认时返回 null", async () => {
  const { db, installer, repo, loader, registry } = await fixture()
  // 默认：无激活 provider 时 registry 返回 null（行为不变）。
  expect(registry.resolve("codepilotx.agent-loop@1")).toBeNull()

  const built = makePluginPackage([{ path: "plugin.ts", content: AGENT_LOOP_BUNDLE }], {
    id: "acme.loop-provider",
    version: "1.0.0",
    tier: "system",
    runtime: { kind: "system", entry: "plugin.ts" },
    contributes: {
      services: [{
        key: "codepilotx.agent-loop@1",
        version: "1.0.0",
        methods: { runTurn: { input: { type: "object" }, output: { type: "object" } } },
      }],
    },
  })
  const archive = join(installer.packagesRoot(), "acme.loop-provider.cpxplugin")
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant("acme.loop-provider", installed.digest, "__digest__", true)
  const generationId = "gen-loop"
  repo.insertGeneration({
    id: generationId,
    pluginId: "acme.loop-provider",
    kind: "system",
    version: "1.0.0",
    digest: installed.digest,
    status: "staged",
    configJson: "{}",
  })
  repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
  const boot = await loader.bootAttempt()
  expect(boot.ok).toBe(true)
  const provider = registry.resolve<{ runTurn: (input: { content: string }) => Promise<{ output: string }> }>("codepilotx.agent-loop@1")
  expect(provider).not.toBeNull()
  expect(registry.providerOf("codepilotx.agent-loop@1")).toBe("acme.loop-provider")
  const result = await provider!.runTurn({ content: "hi" })
  expect(result.output).toBe("fixture loop: hi")
  await loader.dispose()
  db.close()
})

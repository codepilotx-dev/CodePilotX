import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { InMemorySessionRepo } from "@codepilotx/pi-agent-core"
import { DEFAULT_PERMISSION_CONFIG } from "@codepilotx/shared/thread"
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai"
import { ToolRegistry } from "../src/tool/ToolRegistry"
import { PiAgentRuntime } from "../src/orchestration/pi/PiAgentRuntime"
import { RuntimeInterceptorChain } from "../src/runtime/RuntimeInterceptorChain"
import type { PiRuntimeRequest } from "../src/orchestration/pi/types"
import type { PromptBundle } from "../src/prompt/types"
import { AgentRuntimeScopeImpl, type AgentRuntimeIdentity } from "../src/runtime/AgentRuntimeScope"
import {
  createRuntimeSnapshot,
  hashRuntimeText,
  resolveRuntimePresetID,
  RuntimeContributionRegistry,
  type RuntimeContribution,
} from "../src/runtime/RuntimeContribution"

const identity = (n: number): AgentRuntimeIdentity => ({
  threadID: `thread-${n}`,
  turnID: `turn-${n}`,
  agentID: `agent-${n}`,
  sessionID: `session-${n}`,
})

describe("Agent Runtime Scope", () => {
  test("disposer 按注册逆序释放且每个只执行一次", async () => {
    const scope = new AgentRuntimeScopeImpl(identity(1))
    const order: string[] = []
    scope.add(() => { order.push("a") })
    scope.add(() => { order.push("b") })
    scope.add(() => { order.push("c") })
    await scope.dispose("settled")
    expect(order).toEqual(["c", "b", "a"])
    await scope.dispose("shutdown")
    expect(order).toEqual(["c", "b", "a"])
  })

  test("abort/异常路径同样释放并等待已登记操作收敛", async () => {
    const scope = new AgentRuntimeScopeImpl(identity(2))
    let released = false
    scope.add(async () => { released = true })
    let operationDone = false
    const operation = scope.run(async () => {
      await Bun.sleep(10)
      operationDone = true
    })
    await scope.dispose("aborted")
    await operation
    expect(operationDone).toBe(true)
    expect(released).toBe(true)
  })

  test("子 scope 先于父 scope 释放", async () => {
    const parent = new AgentRuntimeScopeImpl(identity(3))
    const order: string[] = []
    parent.add(() => { order.push("parent") })
    const child = parent.fork(identity(4))
    child.add(() => { order.push("child") })
    await parent.dispose("shutdown")
    expect(order).toEqual(["child", "parent"])
  })

  test("一个 disposer 失败不阻止其他 disposer，并抛出安全错误", async () => {
    const scope = new AgentRuntimeScopeImpl(identity(5))
    const order: string[] = []
    scope.add(() => { order.push("ok-1") })
    scope.add(() => { throw new Error("boom") })
    scope.add(() => { order.push("ok-2") })
    await expect(scope.dispose("failed")).rejects.toMatchObject({ code: "RUNTIME_SCOPE_DISPOSE_FAILED" })
    expect(order).toEqual(["ok-2", "ok-1"])
  })

  test("dispose 后拒绝新的操作与 disposer，且重复释放幂等", async () => {
    const scope = new AgentRuntimeScopeImpl(identity(6))
    let runs = 0
    scope.add(() => { runs += 1 })
    await scope.dispose("settled")
    expect(() => scope.add(() => undefined)).toThrow()
    await expect(scope.run(async () => 1)).rejects.toMatchObject({ code: "RUNTIME_SCOPE_DISPOSED" })
    expect(runs).toBe(1)
  })
})

describe("Runtime 预设、注册表与快照", () => {
  test("preset 按 profile 与任务模式解析", () => {
    expect(resolveRuntimePresetID({ taskMode: "chat", profile: "main" })).toBe("main/chat")
    expect(resolveRuntimePresetID({ taskMode: "plan", profile: "main" })).toBe("main/plan")
    expect(resolveRuntimePresetID({ taskMode: "chat", profile: "explorer" })).toBe("subagent/explorer")
    expect(resolveRuntimePresetID({ taskMode: "plan", profile: "worker" })).toBe("subagent/worker")
  })

  test("快照哈希确定且与工具集合顺序无关", () => {
    const base = {
      presetID: "main/chat" as const,
      contributions: [{ id: "core@builtin" as const, version: 1 }],
      promptText: "system prompt",
      toolNames: ["b", "a"],
    }
    const first = createRuntimeSnapshot({
      ...base,
      toolCatalog: [
        { sdkName: "b", inputSchema: { type: "object" } },
        { sdkName: "a", inputSchema: { type: "object" } },
      ],
    })
    const second = createRuntimeSnapshot({
      ...base,
      toolCatalog: [
        { sdkName: "a", inputSchema: { type: "object" } },
        { sdkName: "b", inputSchema: { type: "object" } },
      ],
    })
    expect(first).toEqual(second)
    expect(first.toolNames).toEqual(["a", "b"])
    expect(first.promptHash).toBe(hashRuntimeText("system prompt"))
    const changed = createRuntimeSnapshot({
      ...base,
      promptText: "system prompt v2",
      toolCatalog: [
        { sdkName: "b", inputSchema: { type: "object" } },
        { sdkName: "a", inputSchema: { type: "object" } },
      ],
    })
    expect(changed.manifestHash).not.toBe(first.manifestHash)
  })

  test("注册表静态注册去重，required 恒启用、conditional 沿用配置", () => {
    const registry = new RuntimeContributionRegistry((contribution) => contribution.manifest.id === "skills@builtin")
    const core: RuntimeContribution = {
      manifest: { id: "core@builtin", version: 1, displayName: "核心", description: "", provides: ["tools"], enablement: "required" },
      register: () => undefined,
    }
    const skills: RuntimeContribution = {
      manifest: { id: "skills@builtin", version: 2, displayName: "技能", description: "", provides: ["prompt", "tools"], enablement: "conditional" },
      register: () => undefined,
    }
    const mcp: RuntimeContribution = {
      manifest: { id: "mcp@builtin", version: 1, displayName: "MCP", description: "", provides: ["tools"], enablement: "conditional" },
      register: () => undefined,
    }
    registry.register(core)
    registry.register(skills)
    registry.register(mcp)
    expect(() => registry.register(core)).toThrow()
    expect(registry.enabled(core)).toBe(true)
    expect(registry.enabled(skills)).toBe(true)
    expect(registry.enabled(mcp)).toBe(false)
    // resolveEnabled 只返回实际启用贡献；快照不记录 disabled 贡献。
    expect(registry.resolveEnabled()).toEqual([core, skills])
    expect(registry.snapshot()).toEqual([
      { id: "core@builtin", version: 1 },
      { id: "skills@builtin", version: 2 },
    ])
  })

  test("快照插件字段默认无插件中性值，且 manifest 哈希包含插件与绑定标识", () => {
    const snapshot = createRuntimeSnapshot({
      presetID: "main/chat",
      contributions: [{ id: "core@builtin", version: 1 }],
      promptText: "system prompt",
      toolCatalog: [{ sdkName: "a", inputSchema: { type: "object" } }],
      toolNames: ["a"],
    })
    expect(snapshot.pluginGeneration).toBeNull()
    expect(snapshot.serviceBindingHash).toBe(hashRuntimeText("[]"))
    const withPlugin = createRuntimeSnapshot({
      presetID: "main/chat",
      contributions: [{ id: "core@builtin", version: 1 }],
      promptText: "system prompt",
      toolCatalog: [{ sdkName: "a", inputSchema: { type: "object" } }],
      toolNames: ["a"],
      pluginGeneration: "plugin-a@1:digest",
      serviceBindingHash: hashRuntimeText(`["publisher.svc@1"]`),
    })
    expect(withPlugin.manifestHash).not.toBe(snapshot.manifestHash)
  })
})

describe("PiAgentRuntime 与 Runtime Scope 集成", () => {
  async function createRuntime(input: {
    responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]
    contributions: RuntimeContributionRegistry
    leases?: Array<{ id: string; generation: number; events: string[] }>
    capture?: (input: unknown) => void
  }) {
    const faux = fauxProvider({
      models: [{ id: "scope-test", input: ["text"], contextWindow: 64_000 }],
    })
    faux.setResponses(input.responses)
    const models = createModels()
    if (input.capture) {
      // faux 流不触发 onPayload，包装一层以覆盖 before_provider_payload 采集路径。
      const originalStream = faux.provider.streamSimple ?? faux.provider.stream
      models.setProvider({
        ...faux.provider,
        streamSimple: async (model: never, context: never, options: { onPayload?: (payload: unknown) => Promise<void> } | undefined) => {
          await options?.onPayload?.({ messages: (context as { messages: unknown }).messages, model: (model as { id: string }).id })
          return originalStream(model as never, context as never, options as never)
        },
      } as never)
    } else {
      models.setProvider(faux.provider)
    }
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
      contributions: input.contributions,
      ...(input.leases ? {
        acquireLeases: async () => input.leases!.map((lease) => {
          lease.events.push(`acquire-${lease.id}`)
          return {
            id: lease.id,
            generation: lease.generation,
            release: async () => { lease.events.push(`release-${lease.id}`) },
          }
        }),
      } : {}),
      ...(input.capture ? { requestSnapshot: { capture: input.capture } as never } : {}),
    })
    const request: PiRuntimeRequest = {
      threadID: "thread-scope",
      turnID: "turn-scope",
      agentID: "agent-scope",
      sessionID,
      content: "original scope request",
      taskMode: "chat",
      permissionConfig: DEFAULT_PERMISSION_CONFIG,
      signal: new AbortController().signal,
      workspace: {} as never,
      model: faux.getModel(),
      policyModel: { providerID: "faux", id: "scope-test" } as never,
      exposedTools: [],
      promptSections: [{
        id: "test-system",
        role: "system",
        cache: "global-stable",
        authority: "builtin",
        source: { type: "builtin", name: "test" },
        content: "runtime scope test",
      }],
    }
    return { runtime, request }
  }

  test("harness 替换时上一轮 scope 进入释放路径，贡献按轮注册到新 scope", async () => {
    const disposals: string[] = []
    const contributions = new RuntimeContributionRegistry()
    contributions.register({
      manifest: {
        id: "core@builtin",
        version: 1,
        displayName: "核心",
        description: "",
        provides: ["tools"],
        enablement: "required",
      },
      register: ({ scope }) => () => { disposals.push("core-disposed") },
    })
    const { runtime, request } = await createRuntime({
      responses: [fauxAssistantMessage("first"), fauxAssistantMessage("second")],
      contributions,
    })
    await runtime.run(request)
    expect(disposals).toEqual([])
    await runtime.run(request)
    expect(disposals).toEqual(["core-disposed"])
    await runtime.dispose()
    expect(disposals).toEqual(["core-disposed", "core-disposed"])
  })

  test("租约在 scope 内先取后放，贡献 disposer 先于租约释放", async () => {
    const order: string[] = []
    const contributions = new RuntimeContributionRegistry()
    contributions.register({
      manifest: {
        id: "core@builtin",
        version: 1,
        displayName: "核心",
        description: "",
        provides: ["tools"],
        enablement: "required",
      },
      register: () => () => { order.push("contribution-disposed") },
    })
    const { runtime, request } = await createRuntime({
      responses: [fauxAssistantMessage("first"), fauxAssistantMessage("second")],
      contributions,
      leases: [{ id: "mcp", generation: 1, events: order }],
    })
    await runtime.run(request)
    expect(order).toEqual(["acquire-mcp"])
    await runtime.run(request)
    // 第一轮 scope 释放：后注册的贡献 disposer 先于先注册的租约释放；
    // 随后第二轮运行再次获取租约。
    expect(order).toEqual(["acquire-mcp", "contribution-disposed", "release-mcp", "acquire-mcp"])
    await runtime.dispose()
    expect(order).toEqual([
      "acquire-mcp", "contribution-disposed", "release-mcp", "acquire-mcp",
      "contribution-disposed", "release-mcp",
    ])
  })

  test("贡献在快照冻结前通过 builder handles 登记 prompt、工具与观察者", async () => {
    let composed: PromptBundle | undefined
    let captured: { runtimeManifest?: { toolNames?: string[]; contributions?: unknown[] } } | undefined
    const observerEvents: string[] = []
    const contributions = new RuntimeContributionRegistry()
    contributions.register({
      manifest: {
        id: "fixture@builtin",
        version: 1,
        displayName: "夹具",
        description: "",
        provides: ["tools", "prompt", "guard", "observer"],
        enablement: "conditional",
      },
      register: ({ builders }) => {
        builders.addPromptSection({
          id: "fixture-section",
          role: "system",
          cache: "dynamic",
          authority: "external-data",
          source: { type: "runtime", name: "fixture" },
          content: "fixture prompt content",
        })
        builders.addToolDefinition({
          sdkName: "fixture-tool",
          schema: z.object({}),
          inputSchema: {},
          description: "fixture tool",
          capabilities: { filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false },
          allowedModes: ["chat", "plan"],
          allowedProfiles: ["main"],
          approvalStrategy: "policy",
          visibility: "deferred",
          executionMode: "sequential",
          execute: async () => "fixture-result",
        })
        builders.addObserver((event) => { observerEvents.push((event as { type: string }).type) })
      },
    })
    const { runtime, request } = await createRuntime({
      responses: [fauxAssistantMessage("fixture done")],
      contributions,
      capture: (input) => { captured = input as typeof captured },
    })
    request.onPromptComposed = (bundle) => { composed = bundle }
    await runtime.run(request)
    expect(composed?.instructions).toContain("fixture prompt content")
    expect(observerEvents.length).toBeGreaterThan(0)
    expect(captured?.runtimeManifest?.toolNames).toContain("fixture-tool")
    expect(captured?.runtimeManifest?.contributions).toContainEqual({ id: "fixture@builtin", version: 1 })
  })

  test("重复贡献工具 SDK name 在 Harness 创建前 fail closed", async () => {
    const contributions = new RuntimeContributionRegistry()
    const duplicatedTool: import("../src/tool/ToolRegistry").ToolDefinition = {
      sdkName: "duplicate-tool",
      schema: z.object({}),
      inputSchema: {},
      description: "duplicate",
      capabilities: { filesystem: "none", network: "none", process: false, externalState: false, userInteraction: false },
      allowedModes: ["chat", "plan"],
      allowedProfiles: ["main"],
      approvalStrategy: "policy",
      visibility: "deferred",
      executionMode: "sequential",
      execute: async () => "duplicate-result",
    }
    contributions.register({
      manifest: {
        id: "duplicate@builtin",
        version: 1,
        displayName: "重复工具",
        description: "",
        provides: ["tools"],
        enablement: "required",
      },
      register: ({ builders }) => {
        builders.addToolDefinition(duplicatedTool)
        builders.addToolDefinition({ ...duplicatedTool })
      },
    })
    const { runtime, request } = await createRuntime({
      responses: [fauxAssistantMessage("never")],
      contributions,
      capture: () => undefined,
    })
    await expect(runtime.run(request)).rejects.toMatchObject({
      code: "TOOL_ALREADY_REGISTERED",
    })
    await runtime.dispose()
  })
})

describe("RuntimeInterceptorChain", () => {
  test("按登记顺序执行且 next() 最多一次", async () => {
    const order: string[] = []
    const chain = new RuntimeInterceptorChain([
      {
        id: "first@builtin",
        version: 1,
        point: "tool-pre-execute",
        intercept: async (input, next) => {
          order.push("first:before")
          const value = await next({ ...(input as object), stepped: 1 })
          order.push("first:after")
          return value
        },
      },
      {
        id: "second@builtin",
        version: 1,
        point: "tool-pre-execute",
        intercept: async (input, next) => {
          order.push("second")
          return next(input)
        },
      },
    ])
    const result = await chain.run<{ stepped: number }>("tool-pre-execute", { stepped: 0 })
    expect(result.stepped).toBe(1)
    expect(order).toEqual(["first:before", "second", "first:after"])
  })

  test("重复调用 next() 是安全错误", async () => {
    const chain = new RuntimeInterceptorChain([
      {
        id: "bad@builtin",
        version: 1,
        point: "tool-pre-execute",
        intercept: async (input, next) => {
          await next(input)
          await next(input)
          return input
        },
      },
    ])
    await expect(chain.run("tool-pre-execute", {})).rejects.toMatchObject({
      code: "INTERCEPTOR_NEXT_REPEATED",
    })
  })

  test("不调用 next() 表示明确 short-circuit", async () => {
    const chain = new RuntimeInterceptorChain([
      {
        id: "short@builtin",
        version: 1,
        point: "tool-pre-execute",
        intercept: async () => ({ handled: true }),
      },
    ])
    const result = await chain.run<{ handled: boolean }>("tool-pre-execute", {})
    expect(result).toEqual({ handled: true })
  })

  test("不同扩展点互不干扰", async () => {
    const chain = new RuntimeInterceptorChain([
      {
        id: "pre@builtin",
        version: 1,
        point: "pre-step",
        intercept: async (input, next) => next({ ...(input as object), pre: true }),
      },
    ])
    const toolResult = await chain.run("tool-pre-execute", { tool: "Read" })
    expect(toolResult).toEqual({ tool: "Read" })
    const preResult = await chain.run<{ pre: boolean }>("pre-step", {})
    expect(preResult.pre).toBe(true)
  })
})

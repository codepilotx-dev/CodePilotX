import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Capabilities } from "@codepilotx/agent-protocol"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { RpcRouter, type RpcRouterDependencies } from "../src/transport/rpc/RpcRouter"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginService } from "../src/plugin/PluginService"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

type DeveloperModeState = { on: boolean }

const fixture = async (developerMode: boolean) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-rpc-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const state: DeveloperModeState = { on: developerMode }
  const configService = {
    snapshot: () => ({ plugins: { developerMode: state.on } }),
  } as unknown as RpcRouterDependencies["config"]
  const published: Array<{ method: string; params: unknown }> = []
  const pluginService = new PluginService({
    db,
    installer: new PluginInstaller({ root: pluginRoot, db }),
    configService,
    publish: async (event) => { published.push({ method: event.method, params: event.params }) },
  })
  const dependencies = {
    config: configService,
    db,
    hub: null, threads: null, history: null, approvals: null, questions: null, subagents: null,
    attachments: null, localContextPaths: null, projectSources: null, providers: null, piModels: null,
    apiKeys: null, modelHealth: null, providerCredentials: null, providerCredentialStore: null,
    authSessions: null, memory: null, hooks: null, review: null, github: null, git: null,
    tooling: null, pets: null, releaseNotes: null, skills: null, mcp: null, suggestions: null,
    usage: null, turnPatches: null, terminalContext: null, terminalOutput: null,
    localEnvironment: null, worktrees: null, handoff: null, threadFork: null, sideChats: null,
    executionBindings: null, worktreeRepository: null, environmentDeltas: null, speech: null,
    threadExecutions: null, taskboard: null, taskboardStart: null, runtimeContributions: null,
    requestSnapshots: null,
    pluginService,
  } as unknown as RpcRouterDependencies
  const router = new RpcRouter(dependencies)
  let id = 0
  const initialized = await router.handle({
    jsonrpc: "2.0",
    id: ++id,
    method: "initialize",
    params: {
      clientInfo: { name: "plugin-rpc-test", version: "1.0.0" },
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
  const call = async (method: string, params: Record<string, unknown> = {}) => await router.handle(
    { jsonrpc: "2.0", id: ++id, method, params },
    { connectionId },
  ) as any
  return { root, db, router, call, state, published, pluginRoot }
}

/** 构造合法 .cpxplugin 归档并安装，返回插件摘要。 */
const installFixture = async (call: (method: string, params?: Record<string, unknown>) => Promise<any>, pluginRoot: string, version = "1.0.0") => {
  const archive = join(pluginRoot, "hello.cpxplugin")
  const built = makePluginPackage([{ path: "index.ts", content: "console.log('hi')" }], { version })
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const response = await call("plugin/installPackage", { packagePath: archive, operationId: "op-install-1" })
  expect(response.error).toBeUndefined()
  return response.result as { pluginId: string; version: string; digest: string; status: string }
}

describe("插件管理 RPC", () => {
  test("无 capability 客户端看不到管理方法", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-rpc-"))
    roots.push(root)
    const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
    const pluginService = new PluginService({
      db,
      installer: new PluginInstaller({ root: join(root, "plugins"), db }),
      configService: { snapshot: () => ({ plugins: { developerMode: false } }) } as never,
      publish: async () => undefined,
    })
    const router = new RpcRouter({
      config: { snapshot: () => ({ plugins: { developerMode: false } }) } as never,
      db, hub: null, threads: null, history: null, approvals: null, questions: null, subagents: null,
      attachments: null, localContextPaths: null, projectSources: null, providers: null, piModels: null,
      apiKeys: null, modelHealth: null, providerCredentials: null, providerCredentialStore: null,
      authSessions: null, memory: null, hooks: null, review: null, github: null, git: null,
      tooling: null, pets: null, releaseNotes: null, skills: null, mcp: null, suggestions: null,
      usage: null, turnPatches: null, terminalContext: null, terminalOutput: null,
      localEnvironment: null, worktrees: null, handoff: null, threadFork: null, sideChats: null,
      executionBindings: null, worktreeRepository: null, environmentDeltas: null, speech: null,
      threadExecutions: null, taskboard: null, taskboardStart: null, runtimeContributions: null,
      requestSnapshots: null, pluginService,
    } as unknown as RpcRouterDependencies)
    let id = 0
    const initialized = await router.handle({
      jsonrpc: "2.0",
      id: ++id,
      method: "initialize",
      params: {
        clientInfo: { name: "plugin-rpc-test", version: "1.0.0" },
        protocols: ["thread-rpc-v4"],
        capabilities: ["rpc.typed.v1"],
        interactionDelivery: "active",
      },
    }) as any
    const connectionId = initialized.result.connectionId as string
    await router.handle({ jsonrpc: "2.0", method: "initialized", params: { protocol: "thread-rpc-v4" } }, { connectionId })
    const response = await router.handle({
      jsonrpc: "2.0", id: ++id, method: "plugin/list", params: {},
    }, { connectionId }) as any
    expect(response.result).toBeUndefined()
    expect(response.error).toBeDefined()
    db.close()
  })

  test("完整流程：安装（installed-disabled）→ 信任确认 → enable → disable → uninstall", async () => {
    const { db, call, pluginRoot, published } = await fixture(true)
    const installed = await installFixture(call, pluginRoot)

    // 安装后 disabled 且未信任
    const list = await call("plugin/list")
    expect(list.result.plugins).toHaveLength(1)
    expect(list.result.plugins[0].enabledGlobal).toBe(false)
    expect(list.result.plugins[0].runtimeKind).toBe("process")

    // 未确认信任时 enable 被拒
    const untrusted = await call("plugin/enable", { pluginId: installed.pluginId, scope: "global", operationId: "op-enable-1" })
    expect(untrusted.result).toBeUndefined()
    expect(untrusted.error.data.code).toBe("PLUGIN_DIGEST_UNTRUSTED")

    // 确认信任（digest 级）
    const grants = await call("plugin/grants/update", {
      pluginId: installed.pluginId,
      grants: [{ permissionId: "__digest__", granted: true }],
      operationId: "op-grants-1",
    })
    expect(grants.result.digest).toBe(installed.digest)

    // enable
    const enabled = await call("plugin/enable", { pluginId: installed.pluginId, scope: "global", operationId: "op-enable-2" })
    expect(enabled.result).toEqual({ ok: true })
    expect((await call("plugin/list")).result.plugins[0].enabledGlobal).toBe(true)

    // workspace override：workspace disable 高于 global enable
    const wsDisable = await call("plugin/disable", { pluginId: installed.pluginId, scope: "workspace", workspaceKey: "ws:abc", operationId: "op-disable-1" })
    expect(wsDisable.result).toEqual({ ok: true })
    const after = (await call("plugin/list")).result.plugins[0]
    expect(after.enabledGlobal).toBe(true)
    expect(after.workspaceOverrides).toContainEqual({ workspaceKey: "ws:abc", enabled: false })

    // uninstall
    const removed = await call("plugin/uninstall", { pluginId: installed.pluginId, operationId: "op-uninstall-1" })
    expect(removed.result).toEqual({ ok: true })
    expect((await call("plugin/list")).result.plugins).toHaveLength(0)

    // inventory/operation 事件已发布
    expect(published.some((event) => event.method === "plugin/inventory-changed")).toBe(true)
    expect(published.some((event) => event.method === "plugin/operation-updated")).toBe(true)
    db.close()
  })

  test("Developer Mode 关闭时 process 包不能启用", async () => {
    const { db, call, pluginRoot } = await fixture(false)
    const installed = await installFixture(call, pluginRoot)
    await call("plugin/grants/update", {
      pluginId: installed.pluginId,
      grants: [{ permissionId: "__digest__", granted: true }],
      operationId: "op-grants-1",
    })
    const enabled = await call("plugin/enable", { pluginId: installed.pluginId, scope: "global", operationId: "op-enable-1" })
    expect(enabled.result).toBeUndefined()
    expect(enabled.error.data.code).toBe("PLUGIN_DEVELOPER_MODE_REQUIRED")
    expect((await call("plugin/list")).result.plugins[0].enabledGlobal).toBe(false)
    db.close()
  })

  test("重放安装操作（同 operationId）幂等返回原结果", async () => {
    const { db, call, pluginRoot } = await fixture(true)
    const installed = await installFixture(call, pluginRoot)
    // 同 operationId 重放
    const replay = await call("plugin/installPackage", {
      packagePath: join(pluginRoot, "hello.cpxplugin"),
      operationId: "op-install-1",
    })
    expect(replay.error).toBeUndefined()
    expect(replay.result.digest).toBe(installed.digest)
    expect(replay.result.status).toBe("installed-disabled")
    // 没有重复安装（packages 只有一个）
    expect((await call("plugin/list")).result.plugins).toHaveLength(1)
    // operation/get 返回完成状态
    const operation = await call("plugin/operation/get", { operationId: "op-install-1" })
    expect(operation.result.status).toBe("completed")
    db.close()
  })

  test("敏感错误被安全归一化：不包含原始路径与命令", async () => {
    const { db, call, pluginRoot } = await fixture(true)
    const archive = join(pluginRoot, "evil.cpxplugin")
    await writeZip(archive, [{ path: "../escape.txt", content: "x" }])
    const response = await call("plugin/installPackage", { packagePath: archive, operationId: "op-evil-1" })
    expect(response.result).toBeUndefined()
    expect(response.error).toBeDefined()
    expect(response.error.data.code).toBe("PLUGIN_ARCHIVE_UNSAFE")
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain(pluginRoot)
    expect(serialized).not.toContain("escape")
    expect(serialized).not.toContain("stack")
    db.close()
  })

  test("配置 get/update 持久化", async () => {
    const { db, call, pluginRoot } = await fixture(true)
    const installed = await installFixture(call, pluginRoot)
    const updated = await call("plugin/config/update", {
      pluginId: installed.pluginId,
      config: { greeting: "你好" },
      operationId: "op-config-1",
    })
    expect(updated.error).toBeUndefined()
    expect(updated.result.config).toEqual({ greeting: "你好" })
    const read = await call("plugin/config/get", { pluginId: installed.pluginId })
    expect(read.result.config).toEqual({ greeting: "你好" })
    db.close()
  })

  test("update 后 digest 变化，新 digest 不继承信任", async () => {
    const { db, call, pluginRoot } = await fixture(true)
    const first = await installFixture(call, pluginRoot, "1.0.0")
    await call("plugin/grants/update", {
      pluginId: first.pluginId,
      grants: [{ permissionId: "__digest__", granted: true }],
      operationId: "op-grants-1",
    })
    // 更新到 v2（新 digest）
    const archive = join(pluginRoot, "hello.cpxplugin")
    const built = makePluginPackage([{ path: "index.ts", content: "v2" }], { version: "1.0.1" })
    await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
    const updated = await call("plugin/installPackage", { packagePath: archive, operationId: "op-install-2" })
    expect(updated.result.digest).not.toBe(first.digest)
    // enable 需要重新确认
    const enabled = await call("plugin/enable", { pluginId: first.pluginId, scope: "global", operationId: "op-enable-1" })
    expect(enabled.error.data.code).toBe("PLUGIN_DIGEST_UNTRUSTED")
    // 且更新后 enablement 重置
    expect((await call("plugin/list")).result.plugins[0].enabledGlobal).toBe(false)
    db.close()
  })
})

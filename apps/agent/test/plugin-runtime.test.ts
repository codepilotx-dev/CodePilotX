import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { PluginRuntimeManager, PLUGIN_CRASH_RETRY_DELAY_MS } from "../src/plugin/runtime/manager"
import { buildRunnerEnvironment } from "../src/plugin/runtime/supervisor"
import { buildServiceGraph } from "../src/plugin/runtime/service-graph"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const runnerSource = () => readFile(join(import.meta.dir, "fixtures", "plugin-runner.ts"), "utf8")

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-runtime-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  const statusEvents: Array<{ pluginId: string; status: string }> = []
  const manager = new PluginRuntimeManager({
    db,
    installer,
    publish: async () => undefined,
    onStatusChanged: (pluginId, status) => statusEvents.push({ pluginId, status }),
    // 测试环境缩短握手超时，避免 slow-init 场景等待 10s。
    initializeTimeoutMs: 500,
  })
  return { root, db, installer, repo, manager, statusEvents }
}

/** 安装一个 process runner 包（fixture runner 副本），信任并 enable。 */
const installRunner = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  input: {
    id?: string
    version?: string
    mode?: string
    extraFiles?: Array<{ path: string; content: string }>
    manifestOverrides?: Record<string, unknown>
  } = {},
) => {
  const id = input.id ?? "acme.hello"
  const runner = (await runnerSource()).replace(
    'process.env.CPX_MODE ?? "normal"',
    JSON.stringify(input.mode ?? "normal"),
  )
  const files: Array<{ path: string; content: string }> = [
    { path: "runner.ts", content: runner },
    ...(input.extraFiles ?? []),
  ]
  const built = makePluginPackage(files, {
    id,
    version: input.version ?? "1.0.0",
    runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "runner.ts" },
    ...input.manifestOverrides,
  })
  const archive = join(installer.packagesRoot(), `${id}.cpxplugin`)
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant(id, installed.digest, "__digest__", true)
  repo.setActivation(id, "", true)
  return installed
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor 超时")
    await Bun.sleep(50)
  }
}

describe("PluginRuntimeManager 生命周期", () => {
  test("正常启动：reconcile 后 active，acquire 返回 lease", async () => {
    const { db, installer, repo, manager } = await fixture()
    await installRunner(installer, repo)
    const result = await manager.reconcile()
    expect(result.activated).toContain("acme.hello")
    expect(manager.status("acme.hello")).toBe("active")
    const leases = await manager.acquireForRequest({ threadID: "t", turnID: "u", agentID: "a", sessionID: "s" })
    expect(leases).toHaveLength(1)
    expect(leases[0]!.generation).toBeGreaterThan(0)
    await leases[0]!.release()
    await manager.dispose()
    db.close()
  })

  test("同一 turn 固定 generation；更新后旧 generation 等 leases 清零才关闭", async () => {
    const { db, installer, repo, manager } = await fixture()
    const first = await installRunner(installer, repo)
    await manager.reconcile()
    const lease = (await manager.acquireForRequest({ threadID: "t", turnID: "u", agentID: "a", sessionID: "s" }))[0]!
    const generationBefore = lease.generation

    // 更新到 v2（新 digest 新 generation）
    await installRunner(installer, repo, { version: "1.0.1" })
    expect(repo.getPackage("acme.hello")?.digest).not.toBe(first.digest)
    const result = await manager.reconcile()
    expect(result.activated).toContain("acme.hello")
    // 新 lease 是新 generation
    const lease2 = (await manager.acquireForRequest({ threadID: "t", turnID: "u", agentID: "a", sessionID: "s" }))[0]!
    expect(lease2.generation).not.toBe(generationBefore)
    // 旧 lease 未释放：旧 generation 处于 retiring（进程保留）
    expect(manager.status("acme.hello")).toBe("active")
    // 释放旧 lease → 旧进程关闭，仍 active（新 generation）
    await lease.release()
    await lease2.release()
    expect(manager.status("acme.hello")).toBe("active")
    await manager.dispose()
    db.close()
  })

  test("staging 失败保留 last-good：坏 v2 更新不影响已激活的 v1", async () => {
    const { db, installer, repo, manager } = await fixture()
    await installRunner(installer, repo)
    await manager.reconcile()
    expect(manager.status("acme.hello")).toBe("active")

    // 安装坏 v2（slow-init：握手超时）
    await installRunner(installer, repo, { version: "1.0.2", mode: "slow-init" })
    const result = await manager.reconcile()
    expect(result.failed.some((item) => item.pluginId === "acme.hello")).toBe(true)
    // last-good 保留：v1 仍 active
    expect(manager.status("acme.hello")).toBe("active")
    await manager.dispose()
    db.close()
  })

  test("service missing → waiting；provider 就绪后自动恢复 active", async () => {
    const { db, installer, repo, manager } = await fixture()
    // consumer 先装（provider 缺失）
    await installRunner(installer, repo, {
      id: "acme.consumer",
      manifestOverrides: { requires: { services: { "acme.counter@1": "^1.0.0" } } },
    })
    const result = await manager.reconcile()
    expect(result.waiting.some((item) => item.pluginId === "acme.consumer")).toBe(true)
    expect(manager.status("acme.consumer")).toBe("waiting")

    // provider 就绪 → 恢复
    await installRunner(installer, repo, {
      id: "acme.provider",
      manifestOverrides: {
        contributes: { services: [{ key: "acme.counter@1", version: "1.0.0", methods: { get: { input: { type: "object" }, output: { type: "object" } } } }] },
      },
    })
    const result2 = await manager.reconcile()
    expect(result2.activated).toContain("acme.consumer")
    expect(manager.status("acme.consumer")).toBe("active")
    expect(manager.status("acme.provider")).toBe("active")
    await manager.dispose()
    db.close()
  })

  test("service cycle 拒绝 staging 并返回循环路径", async () => {
    const { db, installer, repo, manager } = await fixture()
    const service = (key: string) => ({
      contributes: { services: [{ key, version: "1.0.0", methods: { get: { input: { type: "object" }, output: { type: "object" } } } }] },
    })
    await installRunner(installer, repo, {
      id: "acme.a",
      manifestOverrides: {
        ...service("acme.a@1"),
        requires: { services: { "acme.b@1": "^1.0.0" } },
      },
    })
    await installRunner(installer, repo, {
      id: "acme.b",
      manifestOverrides: {
        ...service("acme.b@1"),
        requires: { services: { "acme.a@1": "^1.0.0" } },
      },
    })
    const result = await manager.reconcile()
    expect(result.cycles.length).toBeGreaterThan(0)
    const cyclePlugins = result.cycles.flatMap((cycle) => cycle.pluginIds)
    expect(cyclePlugins).toContain("acme.a")
    expect(cyclePlugins).toContain("acme.b")
    expect(manager.status("acme.a")).toBe("waiting")
    expect(manager.status("acme.b")).toBe("waiting")
    await manager.dispose()
    db.close()
  })

  test("singleton provider conflict 拒绝", async () => {
    const { db, installer, repo, manager } = await fixture()
    const singleton = {
      contributes: { services: [{ key: "acme.counter@1", version: "1.0.0", singleton: true, methods: { get: { input: { type: "object" }, output: { type: "object" } } } }] },
    }
    await installRunner(installer, repo, { id: "acme.p1", manifestOverrides: singleton })
    await installRunner(installer, repo, { id: "acme.p2", manifestOverrides: singleton })
    const result = await manager.reconcile()
    expect(result.conflicts.some((conflict) => conflict.key === "acme.counter@1")).toBe(true)
    await manager.dispose()
    db.close()
  })

  test("crash loop 达到阈值自动 disable", async () => {
    const { db, installer, repo, manager } = await fixture()
    await installRunner(installer, repo, { mode: "crash-immediately" })
    await manager.reconcile()
    // 等待重试周期内崩溃累计到阈值
    await waitFor(() => repo.getActivation("acme.hello", "")?.enabled === false, PLUGIN_CRASH_RETRY_DELAY_MS * 4 + 2_000)
    expect(manager.status("acme.hello")).toBe("disabled")
    await manager.dispose()
    db.close()
  }, 15_000)

  test("强制 disable 立即终止进程", async () => {
    const { db, installer, repo, manager } = await fixture()
    await installRunner(installer, repo)
    await manager.reconcile()
    expect(manager.status("acme.hello")).toBe("active")
    manager.forceDisable("acme.hello")
    expect(manager.status("acme.hello")).toBe("disabled")
    await manager.dispose()
    db.close()
  })
})

describe("Runner 环境与图校验", () => {
  test("runner 环境使用最小 allowlist：不含 Agent token、Provider key 与 SQLite 路径", () => {
    const previous = { ...process.env }
    process.env.CODEPILOTX_AUTH_TOKEN = "secret-token"
    process.env.OPENAI_API_KEY = "sk-secret"
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret"
    process.env.CODEPILOTX_DATA_DIR = "C:/Users/secret/.codepilotx"
    try {
      const env = buildRunnerEnvironment({ extra: { CPX_INSTANCE_TOKEN: "handshake" } })
      const keys = Object.keys(env).map((key) => key.toLowerCase())
      expect(keys).not.toContain("codepilotx_auth_token")
      expect(keys).not.toContain("openai_api_key")
      expect(keys).not.toContain("anthropic_api_key")
      expect(keys).not.toContain("codepilotx_data_dir")
      expect(JSON.stringify(env)).not.toContain("sk-secret")
      expect(JSON.stringify(env)).not.toContain("sk-ant-secret")
      expect(JSON.stringify(env)).not.toContain(".codepilotx")
      expect(env.CPX_INSTANCE_TOKEN).toBe("handshake")
      // 最小集包含必要运行键
      expect(keys).toContain("path")
      expect(keys).toContain("systemroot")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      delete process.env.CODEPILOTX_AUTH_TOKEN
      delete process.env.OPENAI_API_KEY
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.CODEPILOTX_DATA_DIR
    }
  })

  test("service graph：拓扑序 provider 先于 consumer", () => {
    const result = buildServiceGraph([
      {
        pluginId: "consumer",
        provides: [],
        requires: [{ pluginId: "consumer", kind: "required", key: "acme.counter@1", range: "^1.0.0" }],
      },
      {
        pluginId: "provider",
        provides: [{ pluginId: "provider", key: "acme.counter@1", version: "1.0.0", singleton: true }],
        requires: [],
      },
    ])
    expect(result.activationOrder).toEqual(["provider", "consumer"])
    expect(result.providersByKey.get("acme.counter@1")).toBe("provider")
  })

  test("shutdown 超时后清理完整进程树", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-sd-"))
    roots.push(root)
    const runner = (await runnerSource()).replace(
      'process.env.CPX_MODE ?? "normal"',
      '"ignore-quiesce"',
    )
    await writeFile(join(root, "runner.ts"), runner)
    const { ProcessSupervisor } = await import("../src/plugin/runtime/supervisor")
    let exited = false
    const supervisor = new ProcessSupervisor({
      pluginId: "acme.hello",
      generationId: "g-sd",
      packageRoot: root,
      executable: "runner.ts",
      instanceToken: "token-sd",
      onExit: () => { exited = true },
    })
    const started = Date.now()
    const handshake = await supervisor.start({ id: "acme.hello" }, 2_000)
    expect(handshake.initialize).toBeDefined()
    // runner 不响应 quiesce：close 在短超时后必须仍然完成（taskkill 进程树）。
    await supervisor.close(400)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(exited).toBe(true)
  })
})

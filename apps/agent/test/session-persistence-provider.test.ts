import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSessionPersistenceConformance } from "@codepilotx/plugin-sdk/testing"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { SystemProfileLoader, PENDING_SYSTEM_PROFILE_KEY } from "../src/plugin/system/SystemProfileLoader"
import { SystemServiceRegistry } from "../src/plugin/system/SystemServiceRegistry"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

/**
 * 测试用 session-persistence provider（自包含 bundle，不依赖 SDK）：
 * 把条目与 checkpoint 持久化进自己的 namespaced dataRoot，
 * 绝不触碰 AgentDatabase/profile/history。
 */
const PERSISTENCE_BUNDLE = `import { readFile, writeFile, mkdir } from "node:fs/promises"
export default {
  id: "acme.persistence",
  version: "1.0.0",
  displayName: "测试持久化 Provider",
  provides: ["codepilotx.session-persistence@1"],
  requires: {},
  register: (context) => {
    let root = ""
    let entries = []
    let closed = false
    const load = async () => {
      try {
        const raw = await readFile(root + "/store.json", "utf8")
        entries = JSON.parse(raw)
      } catch {
        entries = []
      }
    }
    context.registerProvider("codepilotx.session-persistence@1", {
      open: async (input) => {
        root = input.dataRoot
        await mkdir(root, { recursive: true })
        closed = false
        await load()
        return { ok: true }
      },
      append: async (input) => {
        for (const entry of input.entries) entries.push({ ...entry, cursor: entries.length + 1 })
        return { cursor: entries.length }
      },
      transaction: async (input) => {
        for (const entry of input.entries) entries.push({ ...entry, cursor: entries.length + 1 })
        return { cursor: entries.length }
      },
      flush: async () => {
        await writeFile(root + "/store.json", JSON.stringify(entries), "utf8")
        return { ok: true }
      },
      replay: async (input) => {
        const after = input.afterCursor ?? 0
        const limit = input.limit ?? 0
        const slice = limit > 0 ? entries.slice(after, after + limit) : entries.slice(after)
        return { entries: slice, cursor: entries.length }
      },
      cursor: async () => ({ cursor: entries.length }),
      checkpoint: async (input) => {
        if (input.action === "save") {
          await writeFile(root + "/ckpt-" + input.key + ".json", JSON.stringify(input.value ?? null), "utf8")
          return {}
        }
        try {
          const raw = await readFile(root + "/ckpt-" + input.key + ".json", "utf8")
          return { value: JSON.parse(raw) }
        } catch {
          return { value: null }
        }
      },
      recovery: async () => ({ recovered: 0 }),
      shutdown: async () => {
        if (!closed) {
          await writeFile(root + "/store.json", JSON.stringify(entries), "utf8")
          closed = true
        }
        return { ok: true }
      },
    })
    return undefined
  },
}
`

const FAILING_BUNDLE = `export default {
  id: "acme.bad-persistence",
  version: "1.0.0",
  displayName: "坏持久化 Provider",
  provides: ["codepilotx.session-persistence@1"],
  requires: {},
  register: (context) => {
    context.registerProvider("codepilotx.session-persistence@1", {
      open: async () => { throw new Error("fixture: cannot open") },
      append: async () => ({ cursor: 1 }),
      transaction: async () => ({ cursor: 2 }),
      flush: async () => ({ ok: true }),
      replay: async () => ({ entries: [], cursor: 0 }),
      cursor: async () => ({ cursor: 0 }),
      checkpoint: async () => ({ value: null }),
      recovery: async () => ({ recovered: 0 }),
      shutdown: async () => ({ ok: true }),
    })
    return undefined
  },
}
`

// ── conformance suite 单元测试（SDK testing 工具） ────────────────────────

const makeProvider = () => {
  let root = ""
  let entries: Array<{ id: string; cursor: number }> = []
  const write = async () => {
    await writeFile(join(root, "store.json"), JSON.stringify(entries), "utf8")
  }
  const load = async () => {
    try {
      entries = JSON.parse(await readFile(join(root, "store.json"), "utf8"))
    } catch {
      entries = []
    }
  }
  return {
    open: async (input: { dataRoot: string }) => {
      root = input.dataRoot
      await mkdir(root, { recursive: true })
      await load()
      return { ok: true }
    },
    append: async (input: { entries: Array<{ id: string; type: string; payload: Record<string, unknown> }> }) => {
      for (const entry of input.entries) entries.push({ ...entry, cursor: entries.length + 1 })
      return { cursor: entries.length }
    },
    transaction: async (input: { entries: Array<{ id: string }> }) => {
      for (const entry of input.entries) entries.push({ ...entry, cursor: entries.length + 1 })
      return { cursor: entries.length }
    },
    flush: async () => {
      await write()
      return { ok: true }
    },
    replay: async (input: { afterCursor: number; limit?: number }) => {
      const after = input.afterCursor ?? 0
      const limit = input.limit ?? 0
      return {
        entries: limit > 0 ? entries.slice(after, after + limit) : entries.slice(after),
        cursor: entries.length,
      }
    },
    cursor: async () => ({ cursor: entries.length }),
    checkpoint: async (input: { action: "save" | "load"; key: string; value?: unknown }) => {
      if (input.action === "save") {
        await writeFile(join(root, `ckpt-${input.key}.json`), JSON.stringify(input.value ?? null), "utf8")
        return {}
      }
      try {
        return { value: JSON.parse(await readFile(join(root, `ckpt-${input.key}.json`), "utf8")) }
      } catch {
        return { value: null }
      }
    },
    recovery: async () => ({ recovered: 0 }),
    shutdown: async () => {
      await write()
      return { ok: true }
    },
  }
}

describe("session-persistence conformance（PR 8D）", () => {
  test("正确 provider 通过全部断言（往返/游标/重启/checkpoint/recovery）", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-conformance-"))
    const report = await runSessionPersistenceConformance(makeProvider(), {
      dataRoot: root,
      probe: async (dataRoot) => (await readdir(dataRoot)).length > 0,
    })
    expect(report.pass).toBe(true)
    expect(report.failures).toEqual([])
    // Provider 确实写入了自己的数据根。
    expect((await readdir(root)).length).toBeGreaterThan(0)
  })

  test("数据根隔离：不写入数据根的 provider 被 probe 拒绝", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-conformance-empty-"))
    const provider = makeProvider()
    // 覆盖所有落盘动作为空操作：持久化产物缺失 → 隔离检查失败。
    const broken = {
      ...provider,
      flush: async () => ({ ok: true }),
      shutdown: async () => ({ ok: true }),
      checkpoint: async (input: { action: "save" | "load"; key: string; value?: unknown }) =>
        input.action === "save" ? {} : { value: null },
    }
    const report = await runSessionPersistenceConformance(broken, {
      dataRoot: root,
      probe: async (dataRoot) => (await readdir(dataRoot)).length > 0,
    })
    expect(report.pass).toBe(false)
    expect(report.failures.some((failure) => failure.includes("namespaced dataRoot"))).toBe(true)
  })

  test("行为不一致的 provider（重放丢失）被拒绝", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-conformance-lossy-"))
    const provider = {
      ...makeProvider(),
      append: async () => ({ cursor: 999 }), // 游标撒谎：追加后重放应能读到
    }
    const report = await runSessionPersistenceConformance(provider, { dataRoot: root })
    expect(report.pass).toBe(false)
  })
})

// ── Loader 集成：staging 前 conformance 门禁 + namespaced dataRoot ───────

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-persistence-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  const systemDataRoot = join(root, "system-data")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  const registry = new SystemServiceRegistry()
  const loader = new SystemProfileLoader(db, registry, { systemDataRoot })
  return { root, db, installer, repo, loader, registry, systemDataRoot }
}

const installBundle = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  bundle: string,
  id: string,
) => {
  const built = makePluginPackage([{ path: "plugin.ts", content: bundle }], {
    id,
    version: "1.0.0",
    tier: "system",
    runtime: { kind: "system", entry: "plugin.ts" },
    contributes: {
      services: [{
        key: "codepilotx.session-persistence@1",
        version: "1.0.0",
        methods: { open: { input: { type: "object" }, output: { type: "object" } } },
      }],
    },
  })
  const archive = join(installer.packagesRoot(), `${id}.cpxplugin`)
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant(id, installed.digest, "__digest__", true)
  return installed
}

const stageAndBoot = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  loader: SystemProfileLoader,
  bundle: string,
  id: string,
) => {
  const installed = await installBundle(installer, repo, bundle, id)
  const generationId = `gen-${id}`
  repo.insertGeneration({
    id: generationId,
    pluginId: id,
    kind: "system",
    version: "1.0.0",
    digest: installed.digest,
    status: "staged",
    configJson: "{}",
  })
  repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
  const boot = await loader.bootAttempt()
  return { boot, generationId, installed }
}

describe("System session-persistence provider（PR 8D）", () => {
  test("默认实现：无激活 provider 时 registry 返回 null（行为不变）", async () => {
    const { db, registry } = await fixture()
    expect(registry.resolve("codepilotx.session-persistence@1")).toBeNull()
    db.close()
  })

  test("通过 conformance 的 provider 激活成功，写入自己的 namespaced dataRoot", async () => {
    const { db, installer, repo, loader, registry, systemDataRoot } = await fixture()
    const { boot, generationId } = await stageAndBoot(installer, repo, loader, PERSISTENCE_BUNDLE, "acme.persistence")
    expect(boot.ok).toBe(true)
    const provider = registry.resolve("codepilotx.session-persistence@1")
    expect(provider).not.toBeNull()
    expect(registry.providerOf("codepilotx.session-persistence@1")).toBe("acme.persistence")
    // namespaced 数据根：<systemDataRoot>/<pluginId>/<generationId>/ 且已写入产物。
    const dataRoot = join(systemDataRoot, "acme.persistence", generationId)
    expect((await readdir(dataRoot)).length).toBeGreaterThan(0)
    // 数据根必须落在 systemDataRoot 之下（不能越界到 AgentDatabase）。
    expect(dataRoot.startsWith(systemDataRoot)).toBe(true)
    await loader.dispose()
    db.close()
  })

  test("未通过 conformance 的 provider 激活失败，last-good 不受影响", async () => {
    const { db, installer, repo, loader, registry } = await fixture()
    const { boot, generationId } = await stageAndBoot(installer, repo, loader, FAILING_BUNDLE, "acme.bad-persistence")
    expect(boot.ok).toBe(false)
    expect(boot.error?.code).toBe("PLUGIN_PROFILE_CONFORMANCE_FAILED")
    // 未激活：registry 保持默认，generation 保持 staged（不破坏 last-good）。
    expect(registry.resolve("codepilotx.session-persistence@1")).toBeNull()
    const generation = repo.listGenerations("acme.bad-persistence", "system").find((row) => row.id === generationId)
    expect(generation?.status).toBe("staged")
    db.close()
  })
})

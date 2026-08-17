import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "bun:test"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-repo-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  return { root, db, repo: new PluginRepository(db) }
}

describe("PluginRepository", () => {
  test("包 upsert/list/get/remove", async () => {
    const { db, repo } = await fixture()
    const installed = repo.upsertPackage({
      pluginId: "acme.hello",
      version: "1.0.0",
      displayName: "Hello",
      description: "示例",
      publisher: "acme",
      tier: "application",
      manifestJson: "{}",
      digest: "d1",
      source: "package",
      linkedPath: null,
      directoryDigest: null,
      stagedDirectoryDigest: null,
      installedPath: "C:/plugins/packages/acme.hello@1.0.0-d1",
    })
    expect(installed.pluginId).toBe("acme.hello")
    expect(repo.getPackage("acme.hello")?.digest).toBe("d1")
    // 更新（新 digest）
    repo.upsertPackage({ ...installed, version: "1.0.1", digest: "d2", installedPath: "C:/plugins/packages/acme.hello@1.0.1-d2" })
    expect(repo.getPackage("acme.hello")?.digest).toBe("d2")
    expect(repo.listPackages()).toHaveLength(1)
    repo.removePackage("acme.hello")
    expect(repo.getPackage("acme.hello")).toBeNull()
    db.close()
  })

  test("激活默认 disabled，global/workspace 可分别设置", async () => {
    const { db, repo } = await fixture()
    repo.upsertPackage({
      pluginId: "acme.hello",
      version: "1.0.0",
      displayName: "Hello",
      description: "",
      publisher: "acme",
      tier: "application",
      manifestJson: "{}",
      digest: "d1",
      source: "package",
      linkedPath: null,
      directoryDigest: null,
      stagedDirectoryDigest: null,
      installedPath: "p",
    })
    repo.resetActivation("acme.hello")
    expect(repo.getActivation("acme.hello")?.enabled).toBe(false)
    repo.setActivation("acme.hello", "", true)
    repo.setActivation("acme.hello", "ws:abc", false)
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(true)
    expect(repo.getActivation("acme.hello", "ws:abc")?.enabled).toBe(false)
    // digest 变化 → 重置 disabled
    repo.resetActivation("acme.hello")
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(false)
    db.close()
  })

  test("grants 按 digest 隔离，新 digest 不继承信任", async () => {
    const { db, repo } = await fixture()
    repo.setGrant("acme.hello", "digest-a", "filesystem.read", true)
    expect(repo.hasGrant("acme.hello", "digest-a", "filesystem.read")).toBe(true)
    // 新 digest 无记录 = 未批准
    expect(repo.hasGrant("acme.hello", "digest-b", "filesystem.read")).toBe(false)
    repo.setGrant("acme.hello", "digest-b", "filesystem.read", true)
    expect(repo.listGrants("acme.hello")).toHaveLength(2)
    db.close()
  })

  test("operations 幂等：重复 operationId 返回原行", async () => {
    const { db, repo } = await fixture()
    const first = repo.createOperation({ operationId: "op-1", pluginId: "acme.hello", method: "plugin/install", requestHash: "h1" })
    expect(first.status).toBe("pending")
    const second = repo.createOperation({ operationId: "op-1", pluginId: "acme.hello", method: "plugin/install", requestHash: "h1" })
    expect(second.operationId).toBe("op-1")
    repo.completeOperation("op-1", "completed", { ok: true }, null)
    expect(repo.getOperation("op-1")?.status).toBe("completed")
    expect(repo.getOperation("op-1")?.result).toBe('{"ok":true}')
    db.close()
  })

  test("KV 按 plugin/scope 隔离且 CAS 生效", async () => {
    const { db, repo } = await fixture()
    const put = repo.kvPut("acme.hello", "global", "", "counter", "1")
    expect(put.ok).toBe(true)
    expect(repo.kvGet("acme.hello", "global", "", "counter")?.value).toBe("1")
    // 跨插件不可读
    expect(repo.kvGet("acme.other", "global", "", "counter")).toBeNull()
    // CAS：错误版本拒绝
    expect(repo.kvPut("acme.hello", "global", "", "counter", "99", 42).ok).toBe(false)
    expect(repo.kvGet("acme.hello", "global", "", "counter")?.value).toBe("1")
    // 正确版本写入
    const updated = repo.kvPut("acme.hello", "global", "", "counter", "2", 1)
    expect(updated.ok).toBe(true)
    expect(updated.version).toBe(2)
    expect(repo.listKv("acme.hello")).toHaveLength(1)
    expect(repo.kvDelete("acme.hello", "global", "", "counter")).toBe(true)
    expect(repo.kvGet("acme.hello", "global", "", "counter")).toBeNull()
    db.close()
  })

  test("generations 生命周期与 latest 查询", async () => {
    const { db, repo } = await fixture()
    repo.insertGeneration({ id: "g1", pluginId: "acme.system", kind: "system", version: "1.0.0", digest: "d1", status: "staged", configJson: "{}" })
    repo.insertGeneration({ id: "g2", pluginId: "acme.system", kind: "system", version: "1.0.0", digest: "d1", status: "active", configJson: "{}" })
    expect(repo.latestGeneration("acme.system", "system", ["active", "last-good"])?.id).toBe("g2")
    repo.updateGenerationStatus("g2", "retired")
    expect(repo.latestGeneration("acme.system", "system", ["active", "last-good"])).toBeNull()
    expect(repo.listGenerations("acme.system", "system")).toHaveLength(2)
    db.close()
  })
})

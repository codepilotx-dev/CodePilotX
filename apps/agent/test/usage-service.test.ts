import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { Credential } from "@codepilotx/model-schema"
import { EncryptedCredentialRepository, type MasterKeyStore } from "../src/auth/EncryptedCredentialRepository"
import { ApiKeyService } from "../src/provider/ApiKeyService"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { UsageRepository } from "../src/storage/repositories/usage-repository"
import { UsageService } from "../src/usage/UsageService"
import { emptySource, type ProviderUsageAdapter } from "../src/usage/types"

const roots: string[] = []
const databases: AgentDatabase[] = []
const removePath = async (root: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map(removePath))
})

const memoryKeyStore = (): MasterKeyStore & { value: string | null } => ({
  value: null,
  async get() { return this.value },
  async set(value) { this.value = value },
})

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-usage-service-"))
  roots.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  return { db, credentials: new EncryptedCredentialRepository(db, memoryKeyStore()) }
}

const catalog = {
  list: async () => [],
  models: async () => [],
  resolve: async () => { throw new Error("unused") },
  getModel: async () => { throw new Error("unused") },
  refresh: async () => {},
  reload: async () => {},
  dispose: async () => {},
}
const integrations = {
  list: async () => [],
  credentialSource: () => ({ get: async () => undefined }),
}

describe("UsageService", () => {
  test("单来源失败不影响其他来源，并执行缓存、force 与 in-flight dedupe", async () => {
    const { db, credentials } = await repository()
    let calls = 0
    const good: ProviderUsageAdapter = {
      sourceId: "good",
      providerIds: ["good"],
      displayName: "Good",
      scope: "api-key",
      stability: "official",
      cacheMs: 60_000,
      matches: () => false,
      query: async () => {
        calls += 1
        await Bun.sleep(5)
        return { ...emptySource(good, "available"), checkedAt: 100 }
      },
    }
    const bad: ProviderUsageAdapter = {
      ...good,
      sourceId: "bad",
      displayName: "Bad",
      query: async () => { throw new Error("raw secret/path must not escape") },
    }
    const invalid: ProviderUsageAdapter = {
      ...good,
      sourceId: "invalid",
      displayName: "Invalid",
      query: async () => ({
        ...emptySource(invalid, "available"),
        groups: [{
          id: "invalid",
          label: "Invalid",
          balances: [],
          quotaWindows: [{
            id: "invalid",
            label: "Invalid",
            unit: "requests",
            remaining: Number.POSITIVE_INFINITY,
            state: "normal",
          }],
        }],
      }),
    }
    const service = new UsageService(
      new UsageRepository(db),
      catalog as never,
      integrations as never,
      credentials,
      { adapters: [good, bad, invalid], now: () => 100 },
    )
    const [first, concurrent] = await Promise.all([
      service.providerUsage({ range: "7d", timeZone: "UTC" }),
      service.providerUsage({ range: "7d", timeZone: "UTC" }),
    ])
    expect(first.sources.map((item) => item.status)).toEqual(["available", "unavailable", "unavailable"])
    expect(first.sources[2]?.error?.category).toBe("invalid-response")
    expect(concurrent.sources[0]?.status).toBe("available")
    expect(JSON.stringify(first)).not.toContain("raw secret")
    expect(calls).toBe(1)
    await service.providerUsage({ range: "7d", timeZone: "UTC" })
    expect(calls).toBe(1)
    await Promise.all([
      service.providerUsage({ range: "7d", timeZone: "UTC", force: true }),
      service.providerUsage({ range: "7d", timeZone: "UTC", force: true }),
    ])
    expect(calls).toBe(2)
  })

  test("计费 Reporting 仅由完整计费页查询或显式 force 触发", async () => {
    const { db, credentials } = await repository()
    let calls = 0
    const vercel: ProviderUsageAdapter = {
      sourceId: "vercel-ai-gateway",
      providerIds: ["vercel"],
      displayName: "Vercel",
      scope: "account",
      stability: "official",
      matches: () => false,
      query: async () => {
        calls += 1
        return { ...emptySource(vercel, "available"), checkedAt: 100 }
      },
    }
    const service = new UsageService(
      new UsageRepository(db),
      catalog as never,
      integrations as never,
      credentials,
      { adapters: [vercel], now: () => 100 },
    )
    expect((await service.providerUsage({
      range: "7d",
      timeZone: "UTC",
      providerIds: ["vercel"],
    })).sources).toEqual([])
    expect(calls).toBe(0)
    expect((await service.providerUsage({ range: "7d", timeZone: "UTC" })).sources).toHaveLength(1)
    expect(calls).toBe(1)
    expect((await service.providerUsage({
      range: "7d",
      timeZone: "UTC",
      providerIds: ["vercel"],
      force: true,
    })).sources).toHaveLength(1)
    expect(calls).toBe(2)
  })

  test("计费 Key 与 Team ID 只加密落库，并从推理 Key API 完全隔离", async () => {
    const { db, credentials } = await repository()
    const service = new UsageService(
      new UsageRepository(db),
      catalog as never,
      integrations as never,
      credentials,
      { adapters: [] },
    )
    const connected = await service.connect({
      sourceId: "xai-management",
      key: "mgmt-super-secret",
      teamId: "team-super-secret",
      operationId: "op-1",
    })
    expect(await service.connect({
      sourceId: "xai-management",
      key: "mgmt-super-secret",
      teamId: "team-super-secret",
      operationId: "op-1",
    })).toEqual(connected)
    await expect(service.connect({
      sourceId: "openai-admin",
      key: "different",
      operationId: "op-1",
    })).rejects.toThrow("operationId")
    const row = db.encryptedCredential("usage.xai.management")!
    expect(row.ciphertext).not.toContain("mgmt-super-secret")
    expect(row.ciphertext).not.toContain("team-super-secret")
    const stored = await Effect.runPromise(credentials.get<Credential.Value>("usage.xai.management"))
    expect(stored?.value).toEqual(Credential.Key.make({
      type: "key",
      key: "mgmt-super-secret",
      metadata: { teamId: "team-super-secret" },
    }))
    const apiKeys = new ApiKeyService(catalog as never, integrations as never, credentials)
    expect(await apiKeys.list()).toEqual([])
    await expect(apiKeys.copyMaterial(String(connected.connection.credentialId))).rejects.toThrow("未找到 API Key")
    await expect(apiKeys.setEnabled(String(connected.connection.credentialId), false)).rejects.toThrow("未找到 API Key")
    expect(await service.disconnect({ sourceId: "xai-management", operationId: "op-2" })).toEqual({
      sourceId: "xai-management",
      disconnected: true,
    })
    expect(db.encryptedCredential("usage.xai.management")).toBeNull()
  })
})

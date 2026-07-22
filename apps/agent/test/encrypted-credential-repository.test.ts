import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { EncryptedCredentialRepository, type MasterKeyStore } from "../src/auth/EncryptedCredentialRepository"
import { AgentDatabase } from "../src/storage/Database"

const paths: string[] = []
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}
afterEach(async () => Promise.all(paths.splice(0).map(removePath)))

const memoryKeyStore = (): MasterKeyStore & { value: string | null } => ({
  value: null,
  async get() { return this.value },
  async set(value) { this.value = value },
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-credential-"))
  paths.push(root)
  return { db: new AgentDatabase(join(root, "agent.sqlite")), keys: memoryKeyStore() }
}

describe("加密凭据仓库", () => {
  test("使用 AES-GCM 往返保存 API Key", async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    await Effect.runPromise(repository.set({ integrationID: "openai", value: { type: "key", key: "secret" } }))
    const stored = db.encryptedCredential("openai")
    expect(stored?.ciphertext).not.toContain("secret")
    expect((await Effect.runPromise(repository.get<{ type: "key"; key: string }>("openai")))?.value.key).toBe("secret")
    db.close()
  })

  test("密文被篡改时拒绝解密", async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    await Effect.runPromise(repository.set({ integrationID: "openai", value: { type: "key", key: "secret" } }))
    db.sqlite.query("UPDATE credentials SET ciphertext = ? WHERE integration_id = ?").run("AAAA", "openai")
    await expect(Effect.runPromise(repository.get("openai"))).rejects.toMatchObject({ code: "CREDENTIAL_READ_FAILED" })
    db.close()
  })

  test("已有密文但主密钥丢失时不生成新密钥", async () => {
    const { db, keys } = await setup()
    await Effect.runPromise(new EncryptedCredentialRepository(db, keys).set({ integrationID: "openai", value: { type: "key", key: "secret" } }))
    const missing = memoryKeyStore()
    await expect(Effect.runPromise(new EncryptedCredentialRepository(db, missing).get("openai"))).rejects.toMatchObject({ code: "CREDENTIAL_KEY_UNAVAILABLE" })
    expect(missing.value).toBeNull()
    db.close()
  })

  test("同一集成可保存多条 API Key 并切换、排序和删除当前项", async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    const first = await Effect.runPromise(repository.createApiKey({ integrationID: "openai", label: "主 Key", key: "sk-first" }))
    const second = await Effect.runPromise(repository.createApiKey({ integrationID: "openai", label: "备用 Key", key: "sk-second" }))
    await expect(Effect.runPromise(repository.createApiKey({
      integrationID: "openai", label: "重复 Key", key: "sk-first",
    }))).rejects.toMatchObject({ code: "CONFLICT" })

    expect(repository.listApiKeys("openai").map(({ label, active }) => ({ label, active }))).toEqual([
      { label: "主 Key", active: true },
      { label: "备用 Key", active: false },
    ])
    await Effect.runPromise(repository.reorder("openai", [second.id, first.id]))
    expect(repository.listApiKeys("openai").map((item) => item.id)).toEqual([second.id, first.id])
    await Effect.runPromise(repository.setActive("openai", second.id))
    expect(await Effect.runPromise(repository.compareAndSetActive("openai", first.id, first.id))).toBeFalse()
    expect(repository.listApiKeys("openai").find(item => item.active)?.id).toBe(second.id)
    await Effect.runPromise(repository.deleteApiKey(second.id))
    expect(repository.listApiKeys("openai")).toHaveLength(1)
    expect(repository.listApiKeys("openai")[0]).toMatchObject({ id: first.id, active: true })
    expect((await Effect.runPromise(repository.activeCredential<{ key: string }>("openai")))?.value.key).toBe("sk-first")
    db.close()
  })

  test("API Key 摘要不泄露明文且更换时刷新 nonce 和健康状态", async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    const created = await Effect.runPromise(repository.createApiKey({ integrationID: "anthropic", label: "生产", key: "secret-old" }))
    const before = db.encryptedCredentialByID(created.id)!
    await Effect.runPromise(repository.updateHealth(created.id, { status: "auth-failed", lastErrorCategory: "authentication" }))
    await expect(Effect.runPromise(repository.setActive("anthropic", created.id))).rejects.toMatchObject({ code: "CONFLICT" })
    const replaced = await Effect.runPromise(repository.replaceApiKey(created.id, "secret-new"))
    const after = db.encryptedCredentialByID(created.id)!

    expect(JSON.stringify(replaced)).not.toContain("secret-new")
    expect(replaced.maskedValue).toBe("••••-new")
    expect(replaced.health.status).toBe("untested")
    expect(after.nonce).not.toBe(before.nonce)
    expect((await Effect.runPromise(repository.getById<{ key: string }>(created.id)))?.value.key).toBe("secret-new")
    db.close()
  })

  test("v13 凭据迁移保持密文与 AAD 并可补齐尾号和指纹", async () => {
    const { db, keys } = await setup()
    const repository = new EncryptedCredentialRepository(db, keys)
    await Effect.runPromise(repository.set({ integrationID: "openai", label: "旧 Key", value: { type: "key", key: "sk-legacy-1234" } }))
    const original = db.encryptedCredential("openai")!
    const path = db.sqlite.filename
    db.sqlite.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE credential_health;
      DROP TABLE integration_credential_bindings;
      ALTER TABLE credentials RENAME TO credentials_v14_test;
      CREATE TABLE credentials (
        id TEXT PRIMARY KEY, integration_id TEXT NOT NULL UNIQUE, method_id TEXT, label TEXT NOT NULL,
        ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO credentials SELECT id, integration_id, method_id, label, ciphertext, nonce, key_version, created_at, updated_at FROM credentials_v14_test;
      DROP TABLE credentials_v14_test;
      PRAGMA user_version = 13;
      PRAGMA foreign_keys = ON;
    `)
    db.close()

    const migrated = new AgentDatabase(path)
    const migratedRepository = new EncryptedCredentialRepository(migrated, keys)
    const beforeBackfill = migrated.encryptedCredential("openai")!
    expect(beforeBackfill).toMatchObject({ id: original.id, ciphertext: original.ciphertext, nonce: original.nonce, kind: "api-key" })
    expect((await Effect.runPromise(migratedRepository.get<{ key: string }>("openai")))?.value.key).toBe("sk-legacy-1234")
    expect(await Effect.runPromise(migratedRepository.backfillApiKeyMetadata())).toBe(1)
    expect(migratedRepository.listApiKeys("openai")[0]?.maskedValue).toBe("••••1234")
    expect(migrated.encryptedCredential("openai")?.fingerprint).not.toBeNull()
    migrated.close()
  })
})

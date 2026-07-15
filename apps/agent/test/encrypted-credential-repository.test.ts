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
})

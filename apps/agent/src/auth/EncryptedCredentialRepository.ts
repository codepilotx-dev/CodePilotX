import { Buffer } from "node:buffer"
import { Effect } from "effect"
import { AgentError } from "../domain"
import type { AgentDatabase } from "../storage/Database"

const SERVICE = "com.codepilotx.credentials"
const MASTER_KEY_NAME = "master-key-v1"
const KEY_VERSION = 1
const KEY_BYTES = 32
const NONCE_BYTES = 12

export interface MasterKeyStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
}

const systemMasterKeyStore: MasterKeyStore = {
  get: () => Bun.secrets.get({ service: SERVICE, name: MASTER_KEY_NAME }),
  set: async (value) => {
    await Bun.secrets.set({ service: SERVICE, name: MASTER_KEY_NAME, value })
  },
}

const encodeBase64 = (value: Uint8Array | ArrayBuffer) => Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString("base64")
const decodeBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"))
const aad = (id: string, integrationID: string) => new TextEncoder().encode(`credential:${id}:${integrationID}:v${KEY_VERSION}`)

export type CredentialSummary = {
  id: string
  integrationID: string
  methodID: string | null
  label: string
  keyVersion: number
  createdAt: number
  updatedAt: number
}

export class EncryptedCredentialRepository {
  constructor(
    private readonly db: AgentDatabase,
    private readonly keyStore: MasterKeyStore = systemMasterKeyStore,
  ) {}

  list() {
    return this.db.listEncryptedCredentials().map(({ ciphertext: _ciphertext, nonce: _nonce, ...summary }) => summary)
  }

  get<T = unknown>(integrationID: string) {
    return Effect.tryPromise({
      try: async () => {
        const row = this.db.encryptedCredential(integrationID)
        if (!row) return null
        if (row.keyVersion !== KEY_VERSION) {
          throw new AgentError("CREDENTIAL_KEY_VERSION_UNSUPPORTED", `不支持凭据密钥版本 ${row.keyVersion}`, 500)
        }
        const key = await this.masterKey(false)
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: decodeBase64(row.nonce), additionalData: aad(row.id, row.integrationID) },
          key,
          decodeBase64(row.ciphertext),
        )
        return {
          id: row.id,
          integrationID: row.integrationID,
          methodID: row.methodID,
          label: row.label,
          value: JSON.parse(new TextDecoder().decode(plaintext)) as T,
        }
      },
      catch: (cause) => this.error("CREDENTIAL_READ_FAILED", "无法读取加密凭据", cause),
    })
  }

  set(input: { integrationID: string; methodID?: string; label?: string; value: unknown }) {
    return Effect.tryPromise({
      try: async () => {
        const previous = this.db.encryptedCredential(input.integrationID)
        const id = previous?.id ?? `cred_${crypto.randomUUID()}`
        const key = await this.masterKey(true)
        const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
        const plaintext = new TextEncoder().encode(JSON.stringify(input.value))
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad(id, input.integrationID) },
          key,
          plaintext,
        )
        const row = this.db.upsertEncryptedCredential({
          id,
          integrationID: input.integrationID,
          methodID: input.methodID ?? null,
          label: input.label?.trim() || "default",
          ciphertext: encodeBase64(ciphertext),
          nonce: encodeBase64(nonce),
          keyVersion: KEY_VERSION,
        })
        const { ciphertext: _ciphertext, nonce: _nonce, ...summary } = row
        return summary
      },
      catch: (cause) => this.error("CREDENTIAL_WRITE_FAILED", "无法写入加密凭据", cause),
    })
  }

  remove(integrationID: string) {
    return Effect.sync(() => this.db.removeEncryptedCredential(integrationID))
  }

  private async masterKey(create: boolean) {
    const stored = await this.keyStore.get()
    if (stored) {
      const bytes = decodeBase64(stored)
      if (bytes.byteLength === KEY_BYTES) return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
      if (this.db.credentialCount() > 0) throw new AgentError("CREDENTIAL_KEY_UNAVAILABLE", "系统主密钥无效，无法解密现有凭据", 500)
    }
    if (!create || this.db.credentialCount() > 0) {
      throw new AgentError("CREDENTIAL_KEY_UNAVAILABLE", "系统主密钥不存在，无法解密现有凭据", 500)
    }
    const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
    await this.keyStore.set(encodeBase64(bytes))
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"])
  }

  private error(code: string, message: string, cause: unknown) {
    if (cause instanceof AgentError) return cause
    return new AgentError(code, message, 500, cause)
  }
}

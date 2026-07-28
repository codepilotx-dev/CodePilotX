import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Model, Provider } from "@codepilotx/model-schema"
import { Effect } from "effect"
import {
  EncryptedCredentialRepository,
  type MasterKeyStore,
} from "../src/auth/EncryptedCredentialRepository"
import { ApiKeyService } from "../src/provider/ApiKeyService"
import type { PiModelService } from "../src/provider/pi"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"

const paths: string[] = []
const databases: AgentDatabase[] = []

const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(paths.splice(0).map(removePath))
})

const memoryKeyStore = (): MasterKeyStore & { value: string | null } => ({
  value: null,
  async get() { return this.value },
  async set(value) { this.value = value },
})

const setup = async (
  completeSimple: () => Promise<unknown>,
  options: { modelAvailable?: boolean } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-api-key-service-"))
  paths.push(root)
  const database = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(database)
  const credentials = new EncryptedCredentialRepository(database, memoryKeyStore())
  const key = "test-key-with-unusual.characters"
  const summary = await Effect.runPromise(credentials.createApiKey({
    integrationID: "openai",
    label: "测试 Key",
    key,
  }))
  const providerID = Provider.ID.make("openai")
  const providers = {
    list: async () => [{ id: providerID, integrationID: "openai" }],
    models: async () => options.modelAvailable === false ? [] : [{
      providerID,
      id: Model.ID.make("test-model"),
      enabled: true,
    }],
    getPiModel: async () => ({ provider: "openai", id: "test-model" }),
    pi: { completeSimple },
  } as unknown as PiModelService
  const service = new ApiKeyService(
    providers,
    credentials,
  )
  return { credentials, key, service, credentialID: String(summary.id) }
}

describe("API Key 测试", () => {
  test("鉴权失败作为普通结果返回并脱敏厂商回显的当前 Key", async () => {
    let currentKey = ""
    const fixture = await setup(async () => ({
      stopReason: "error",
      errorMessage: `401 unauthorized: invalid API key ${currentKey}`,
    }))
    currentKey = fixture.key

    const result = await fixture.service.test(fixture.credentialID)

    expect(result).toMatchObject({
      ok: false,
      message: "API Key 鉴权失败：401 unauthorized: invalid API key <redacted>",
      credential: {
        health: {
          status: "auth-failed",
          errorCategory: "authentication",
        },
      },
    })
    expect(result.message).not.toContain(fixture.key)
  })

  test("限流失败只记录显式测试结果，不建立自动冷却", async () => {
    const fixture = await setup(async () => {
      throw Object.assign(new Error("429 rate limit exceeded"), { status: 429 })
    })

    const result = await fixture.service.test(fixture.credentialID)

    expect(result.ok).toBeFalse()
    expect(result.message).toBe("API Key 当前受到限流：429 rate limit exceeded")
    expect(result.credential.health).toMatchObject({
      status: "rate-limited",
      errorCategory: "rate-limit",
    })
    expect(result.credential.health).not.toHaveProperty("cooldownUntil")
  })

  test("aborted 超时响应不会被标记为健康", async () => {
    const fixture = await setup(async () => ({
      stopReason: "aborted",
      errorMessage: "request timeout",
    }))

    const result = await fixture.service.test(fixture.credentialID)

    expect(result).toMatchObject({
      ok: false,
      message: "API Key 网络请求失败：request timeout",
      credential: {
        health: {
          status: "error",
          errorCategory: "network",
        },
      },
    })
  })

  test("成功响应返回可用结果并更新健康状态", async () => {
    const fixture = await setup(async () => ({ stopReason: "stop" }))

    const result = await fixture.service.test(fixture.credentialID)

    expect(result).toMatchObject({
      ok: true,
      message: "API Key 可用。",
      credential: { health: { status: "healthy" } },
    })
    expect(result.credential.health).not.toHaveProperty("lastUsedAt")
  })

  test("没有可用模型时返回配置失败而不发起请求", async () => {
    let requests = 0
    const fixture = await setup(async () => {
      requests += 1
      return { stopReason: "stop" }
    }, { modelAvailable: false })

    const result = await fixture.service.test(fixture.credentialID)

    expect(result).toMatchObject({
      ok: false,
      message: "配置不可用：Provider openai 没有可用模型",
      credential: { health: { status: "untested" } },
    })
    expect(requests).toBe(0)
  })
})

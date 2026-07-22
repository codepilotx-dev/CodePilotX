import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Credential, Integration, Provider } from "@codepilotx/model-schema"
import { createPluginHost, define } from "@codepilotx/provider-plugin"
import { Effect } from "effect"
import { EncryptedCredentialRepository, type MasterKeyStore } from "../src/auth/EncryptedCredentialRepository"
import { IntegrationService } from "../src/provider/IntegrationService"
import { AgentDatabase } from "../src/storage/Database"

const paths: string[] = []
const databases: AgentDatabase[] = []
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
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

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-integration-"))
  paths.push(root)
  const db = new AgentDatabase(join(root, "agent.sqlite"))
  databases.push(db)
  return { db, credentials: new EncryptedCredentialRepository(db, memoryKeyStore()) }
}

const provider = (id: string, integrationID = id) => ({
  id: Provider.ID.make(id),
  integrationID: Integration.ID.make(integrationID),
  name: id,
  api: { type: "native" as const, settings: {} },
  request: { headers: {}, body: {} },
})

describe("Agent IntegrationService", () => {
  test("只列连接摘要，并为 runtime provider 解析 key/env 凭据", async () => {
    const { db, credentials } = await repository()
    const integrationID = Integration.ID.make("shared")
    const host = createPluginHost({
      builtins: [define({
        id: "shared-integration",
        init: (context) => context.integration.register({
          id: integrationID,
          name: "Shared",
          methods: [],
          connections: [],
        }).pipe(Effect.asVoid),
      })],
    })
    await Effect.runPromise(host.init())
    const service = new IntegrationService(
      { list: async () => [provider("runtime-provider", "shared")] },
      host,
      credentials,
      { env: { SHARED_API_KEY: "env-secret" } },
    )

    const initial = await service.list()
    expect(initial[0]?.methods).toEqual([
      { type: "key" },
      { type: "env", names: ["SHARED_API_KEY", "RUNTIME_PROVIDER_API_KEY"] },
    ])
    expect(initial[0]?.connections).toEqual([{ type: "env", name: "SHARED_API_KEY" }])
    expect(JSON.stringify(initial)).not.toContain("env-secret")

    const connection = await service.connect({ integrationID: "shared", key: "stored-secret", label: "Primary" })
    expect(connection).toMatchObject({ type: "credential", label: "Primary" })
    expect(db.encryptedCredential("shared")?.ciphertext).not.toContain("stored-secret")
    expect(JSON.stringify(await service.list())).not.toContain("stored-secret")
    expect(await service.credentialSource().get(Provider.ID.make("runtime-provider"))).toEqual({
      type: "key",
      key: "stored-secret",
    })

    await service.disconnect({ integrationID: "shared", credentialID: connection.type === "credential" ? connection.id : "" })
    expect(db.encryptedCredential("shared")).toBeNull()
    expect((await service.list())[0]?.connections).toEqual([{ type: "env", name: "SHARED_API_KEY" }])
    await Effect.runPromise(host.dispose())
  })

  test("为 Amazon Bedrock 使用上游 AWS env 名称", async () => {
    const { credentials } = await repository()
    const host = createPluginHost({ builtins: [] })
    await Effect.runPromise(host.init())
    const service = new IntegrationService(
      { list: async () => [provider("amazon-bedrock")] },
      host,
      credentials,
      { env: { AWS_ACCESS_KEY_ID: "access-secret", AWS_REGION: "us-east-1" } },
    )

    const [integration] = await service.list()
    expect(integration?.methods).toEqual([
      { type: "key" },
      {
        type: "env",
        names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
      },
    ])
    expect(integration?.connections).toEqual([
      { type: "env", name: "AWS_ACCESS_KEY_ID" },
      { type: "env", name: "AWS_REGION" },
    ])
    expect(JSON.stringify(integration)).not.toContain("access-secret")
    expect(JSON.stringify(integration)).not.toContain("AMAZON_BEDROCK_API_KEY")
    await Effect.runPromise(host.dispose())
  })

  test("MiniMax 密钥地区不匹配时提示正确 Provider 且不保存凭据", async () => {
    const { db, credentials } = await repository()
    const host = createPluginHost({ builtins: [] })
    await Effect.runPromise(host.init())
    const requested: string[] = []
    const service = new IntegrationService(
      { list: async () => [provider("minimax")] },
      host,
      credentials,
      {
        fetch: async (input) => {
          const url = String(input)
          requested.push(url)
          return new Response(null, { status: url.includes("api.minimaxi.com") ? 200 : 401 })
        },
      },
    )

    await expect(service.connect({
      integrationID: "minimax",
      key: "region-secret",
    })).rejects.toMatchObject({
      code: "INTEGRATION_REGION_MISMATCH",
      message: expect.stringContaining("minimaxi.com"),
    })
    expect(requested).toEqual([
      "https://api.minimax.io/anthropic/v1/models",
      "https://api.minimaxi.com/anthropic/v1/models",
    ])
    expect(db.encryptedCredential("minimax")).toBeNull()
    await Effect.runPromise(host.dispose())
  })

  test("自动完成 OAuth attempt，并明确拒绝未注册的方法", async () => {
    const { credentials } = await repository()
    const integrationID = Integration.ID.make("oauth-provider")
    const method: Integration.OAuthMethod = {
      id: Integration.MethodID.make("oauth-default"),
      type: "oauth",
      label: "OAuth",
    }
    const host = createPluginHost({
      builtins: [define({
        id: "oauth-integration",
        init: (context) => Effect.gen(function* () {
          yield* context.integration.register({ id: integrationID, name: "OAuth", methods: [method], connections: [] })
          yield* context.auth.register({
            integrationID,
            method,
            authorize: () => Effect.succeed({
              mode: "auto" as const,
              url: "https://example.test/oauth",
              instructions: "Authorize",
              callback: Effect.succeed(Credential.Value.make({
                type: "oauth",
                methodID: method.id,
                refresh: "refresh-secret",
                access: "access-secret",
                expires: 0,
              })),
            }),
          })
        }),
      })],
    })
    await Effect.runPromise(host.init())
    const service = new IntegrationService({ list: async () => [provider("oauth-provider")] }, host, credentials)

    const attempt = await service.authorize({
      integrationID: "oauth-provider",
      methodID: "oauth-default",
      inputs: {},
    })
    let status = await service.status(attempt.attemptID)
    for (let index = 0; index < 10 && status.status === "pending"; index += 1) {
      await Bun.sleep(0)
      status = await service.status(attempt.attemptID)
    }
    expect(status.status).toBe("complete")
    expect(await service.credentialSource().get(Provider.ID.make("oauth-provider"))).toMatchObject({ type: "oauth" })
    await expect(service.authorize({
      integrationID: "oauth-provider",
      methodID: "missing",
      inputs: {},
    })).rejects.toMatchObject({ code: "INTEGRATION_OAUTH_UNSUPPORTED" })
    await Effect.runPromise(host.dispose())
  })

  test("过期的 code OAuth attempt 不执行 callback", async () => {
    const { credentials } = await repository()
    const integrationID = Integration.ID.make("code-provider")
    const method: Integration.OAuthMethod = {
      id: Integration.MethodID.make("oauth-code"),
      type: "oauth",
      label: "OAuth code",
    }
    let callbackCount = 0
    let now = 1_000
    const host = createPluginHost({
      builtins: [define({
        id: "code-integration",
        init: (context) => Effect.gen(function* () {
          yield* context.integration.register({ id: integrationID, name: "Code", methods: [method], connections: [] })
          yield* context.auth.register({
            integrationID,
            method,
            authorize: () => Effect.succeed({
              mode: "code" as const,
              url: "https://example.test/code",
              instructions: "Enter code",
              callback: () => Effect.sync(() => {
                callbackCount += 1
                return Credential.Value.make({ type: "key", key: "oauth-key" })
              }),
            }),
          })
        }),
      })],
    })
    await Effect.runPromise(host.init())
    const service = new IntegrationService(
      { list: async () => [provider("code-provider")] },
      host,
      credentials,
      { now: () => now, attemptTtlMs: 100 },
    )
    const attempt = await service.authorize({ integrationID: "code-provider", methodID: "oauth-code", inputs: {} })
    now = 1_101

    expect(await service.status(attempt.attemptID)).toMatchObject({ status: "expired" })
    await expect(service.complete({ attemptID: attempt.attemptID, code: "1234" })).rejects.toMatchObject({
      code: "OAUTH_ATTEMPT_EXPIRED",
    })
    expect(callbackCount).toBe(0)
    await Effect.runPromise(host.dispose())
  })
})

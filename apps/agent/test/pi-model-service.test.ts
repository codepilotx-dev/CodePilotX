import { describe, expect, test } from "bun:test"
import { Model, type Credential } from "@codepilotx/model-schema"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EncryptedCredentialRepository } from "../src/auth/EncryptedCredentialRepository"
import { EncryptedCredentialStore, ModelsDevCatalogStore, PiModelService } from "../src/provider/pi"

type Stored = {
  id: string
  integrationID: string
  methodID: string | null
  label: string
  value: Credential.Value
}

const repository = (initial: Stored[] = []) => {
  const values = new Map(initial.map((value) => [value.integrationID, value]))
  return {
    values,
    adapter: {
      list: () => [...values.values()].map(({ value: _value, ...summary }) => ({
        ...summary,
        keyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      })),
      get: <T>(integrationID: string) => Effect.succeed((values.get(integrationID) ?? null) as ({
        id: string
        integrationID: string
        kind: "api-key" | "oauth"
        methodID: string | null
        label: string
        value: T
      } | null)),
      set: (input: { integrationID: string; methodID?: string; label?: string; value: unknown }) => Effect.sync(() => {
        const current = values.get(input.integrationID)
        const next: Stored = {
          id: current?.id ?? `cred_${input.integrationID}`,
          integrationID: input.integrationID,
          methodID: input.methodID ?? null,
          label: input.label ?? "default",
          value: input.value as Credential.Value,
        }
        values.set(input.integrationID, next)
        return { ...next, keyVersion: 1, createdAt: 1, updatedAt: 1 }
      }),
      upsertOAuth: (input: {
        providerID: string
        methodID: string
        label?: string
        value: Credential.Value
      }) => Effect.sync(() => {
        const current = values.get(input.providerID)
        const next: Stored = {
          id: current?.id ?? `cred_${input.providerID}`,
          integrationID: input.providerID,
          methodID: input.methodID,
          label: input.label ?? current?.label ?? "OAuth",
          value: input.value,
        }
        values.set(input.providerID, next)
        return { ...next, keyVersion: 1, createdAt: 1, updatedAt: 1 }
      }),
      remove: (integrationID: string) => Effect.sync(() => values.delete(integrationID)),
    } as unknown as EncryptedCredentialRepository,
  }
}

describe("EncryptedCredentialStore", () => {
  test("converts encrypted CodePilotX credentials without exposing secrets in list", async () => {
    const key = "sk-not-in-metadata"
    const fake = repository([{
      id: "cred_openai",
      integrationID: "openai",
      methodID: null,
      label: "default",
      value: { type: "key", key },
    }])
    const store = new EncryptedCredentialStore(fake.adapter)

    expect(await store.read("openai")).toEqual({ type: "api_key", key })
    expect(await store.list()).toEqual([{ providerId: "openai", type: "api_key" }])
    expect(JSON.stringify(await store.list())).not.toContain(key)
  })

  test("serializes OAuth refreshes per provider and preserves method metadata", async () => {
    const fake = repository([{
      id: "cred_anthropic",
      integrationID: "anthropic",
      methodID: "oauth-default",
      label: "account",
      value: { type: "oauth", methodID: "oauth-default" as never, refresh: "r0", access: "a0", expires: 1 },
    }])
    const store = new EncryptedCredentialStore(fake.adapter)
    const seen: string[] = []

    await Promise.all([
      store.modify("anthropic", async (current) => {
        seen.push(current?.type === "oauth" ? current.access : "missing")
        await Bun.sleep(5)
        return { type: "oauth", refresh: "r1", access: "a1", expires: 2 }
      }),
      store.modify("anthropic", async (current) => {
        seen.push(current?.type === "oauth" ? current.access : "missing")
        return { type: "oauth", refresh: "r2", access: "a2", expires: 3 }
      }),
    ])

    expect(seen).toEqual(["a0", "a1"])
    expect(fake.values.get("anthropic")?.methodID).toBe("oauth-default")
    expect(fake.values.get("anthropic")?.value).toMatchObject({ type: "oauth", access: "a2" })
  })
})

describe("PiModelService", () => {
  test("reload advances catalog revision and re-evaluates OAuth model availability", async () => {
    const fake = repository()
    const service = new PiModelService(fake.adapter, { env: {} })
    const beforeRevision = service.catalogRevision()

    expect((await service.models("openai-codex" as never)).some((model) => model.enabled)).toBe(false)
    fake.values.set("openai-codex", {
      id: "cred_openai_codex",
      integrationID: "openai-codex",
      methodID: "openai-codex:oauth",
      label: "OAuth",
      value: {
        type: "oauth",
        methodID: "openai-codex:oauth" as never,
        refresh: "oauth-refresh-secret",
        access: "oauth-access-secret",
        expires: Date.now() + 60_000,
      },
    })

    await service.reload()

    expect(service.catalogRevision()).toBeGreaterThan(beforeRevision)
    expect((await service.models("openai-codex" as never)).some((model) => model.enabled)).toBe(true)
  })

  test("reports configured API key, OAuth, environment, and auth-free providers", async () => {
    const fake = repository([
      {
        id: "cred_deepseek",
        integrationID: "deepseek",
        methodID: null,
        label: "DeepSeek",
        value: { type: "key", key: "sk-deepseek-secret" },
      },
      {
        id: "cred_openai_codex",
        integrationID: "openai-codex",
        methodID: null,
        label: "OpenAI Codex",
        value: {
          type: "oauth",
          methodID: "oauth-default" as never,
          refresh: "oauth-refresh-secret",
          access: "oauth-access-secret",
          expires: Date.now() + 60_000,
        },
      },
    ])
    const service = new PiModelService(fake.adapter, {
      env: { OPENAI_API_KEY: "sk-openai-environment-secret" },
      config: {
        schemaVersion: 2,
        providers: {
          local: {
            kind: "custom",
            name: "Local",
            enabled: true,
            base_url: "http://127.0.0.1:11434/v1",
            auth: "none",
            env: [],
            allow_insecure_http: false,
            models: {
              chat: { api: "openai-completions" },
            },
          },
        },
      },
    })

    expect(await service.isAuthConfigured("deepseek")).toBe(true)
    expect(await service.isAuthConfigured("openai-codex")).toBe(true)
    expect(await service.isAuthConfigured("openai")).toBe(true)
    expect(await service.isAuthConfigured("local")).toBe(true)
    expect(await service.isAuthConfigured("anthropic")).toBe(false)
    expect(await service.isAuthConfigured("missing")).toBe(false)
  })

  test("maps Pi models to the existing RPC-facing model schema", async () => {
    const key = "sk-model-secret"
    const fake = repository([{
      id: "cred_openai",
      integrationID: "openai",
      methodID: null,
      label: "default",
      value: { type: "key", key },
    }])
    const service = new PiModelService(fake.adapter, {
      config: {
        providers: {
          openai: {
            kind: "builtin",
            enabled: true,
            allow_models: [],
            deny_models: [],
          },
        },
      },
      env: {},
    })
    const piModel = service.pi.getModels("openai")[0]
    expect(piModel).toBeDefined()

    const resolved = await service.resolve({
      providerID: piModel!.provider as never,
      id: Model.ID.make(piModel!.id),
    })

    expect(String(resolved.providerID)).toBe("openai")
    expect(resolved.api.type).toBe("pi")
    expect(resolved.capabilities.tools).toBe(true)
    expect(resolved.enabled).toBe(true)
    expect(JSON.stringify(resolved)).not.toContain(key)
  })

  test("maps Pi reasoning levels to existing model variants and resolves a selected level", async () => {
    const fake = repository([{
      id: "cred_openai",
      integrationID: "openai",
      methodID: null,
      label: "default",
      value: { type: "key", key: "sk-test" },
    }])
    const service = new PiModelService(fake.adapter, {
      config: {
        providers: {
          openai: {
            kind: "builtin",
            enabled: true,
            allow_models: [],
            deny_models: [],
          },
        },
      },
      env: {},
    })
    const piModel = service.pi.getModels("openai").find((candidate) => candidate.reasoning)
    expect(piModel).toBeDefined()

    const info = await service.resolve({
      providerID: piModel!.provider as never,
      id: Model.ID.make(piModel!.id),
      variant: Model.VariantID.make("medium"),
    })

    expect(info.variants.map((variant) => String(variant.id))).toContain("medium")
    expect(info.variant).toBe("medium")
    expect(await service.getPiModel({
      providerID: piModel!.provider as never,
      id: Model.ID.make(piModel!.id),
      variant: Model.VariantID.make("medium"),
    })).toBe(piModel!)
  })

  test("loads models.dev providers through Pi while preserving custom-provider precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-models-dev-service-"))
    const fake = repository([{
      id: "cred_catalog_gateway",
      integrationID: "catalog-gateway",
      methodID: null,
      label: "default",
      value: { type: "key", key: "sk-models-dev-secret" },
    }])
    const catalog = {
      "catalog-gateway": {
        id: "catalog-gateway",
        name: "Catalog Gateway",
        npm: "@ai-sdk/openai-compatible",
        api: "https://catalog-gateway.example/v1",
        env: ["CATALOG_GATEWAY_API_KEY"],
        models: {
          chat: {
            id: "chat",
            name: "Catalog Chat",
            reasoning: false,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 64_000, output: 8_000 },
          },
        },
      },
      unsupported: {
        id: "unsupported",
        name: "Unsupported Native SDK",
        npm: "@ai-sdk/example",
        env: ["UNSUPPORTED_API_KEY"],
        models: {
          chat: {
            id: "chat",
            name: "Unsupported Chat",
            reasoning: false,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 32_000, output: 4_000 },
          },
        },
      },
      "custom-shadow": {
        id: "custom-shadow",
        name: "Remote Shadow",
        npm: "@ai-sdk/openai-compatible",
        api: "https://remote-shadow.example/v1",
        env: ["REMOTE_SHADOW_API_KEY"],
        models: {
          remote: {
            id: "remote",
            name: "Remote",
            reasoning: false,
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 32_000, output: 4_000 },
          },
        },
      },
    }
    const service = new PiModelService(fake.adapter, {
      modelsDevStore: new ModelsDevCatalogStore(join(root, "catalog.json")),
      modelsDevFetch: async () => new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { "content-type": "application/json", etag: '"catalog-v1"' },
      }),
      config: {
        schemaVersion: 2,
        providers: {
          "custom-shadow": {
            kind: "custom",
            name: "User Shadow",
            enabled: true,
            base_url: "https://user-shadow.example/v1",
            auth: "none",
            env: [],
            models: { local: { api: "openai-completions" } },
          },
        },
      },
      env: {},
    })

    try {
      await service.refresh(true)
      const providers = await service.list()
      expect(providers.find((provider) => provider.id === "catalog-gateway")).toMatchObject({
        source: { kind: "models-dev" },
        catalogOrigin: "models-dev",
        availability: { status: "ready" },
      })
      expect(providers.find((provider) => provider.id === "unsupported")).toMatchObject({
        disabled: true,
        availability: { status: "unavailable", reason: "unsupported-protocol" },
      })
      expect(providers.find((provider) => provider.id === "custom-shadow")).toMatchObject({
        name: "User Shadow",
        source: { kind: "custom" },
        catalogOrigin: "user",
      })
      expect((await service.models()).some((model) =>
        model.providerID === "catalog-gateway" && model.id === "chat" && model.enabled
      )).toBe(true)
      expect(service.catalogStatus()).toMatchObject({
        source: "models-dev",
        mode: "live",
        stale: false,
      })
      expect(await service.isAuthConfigured("catalog-gateway")).toBe(true)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

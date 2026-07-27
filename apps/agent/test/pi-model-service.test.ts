import { describe, expect, test } from "bun:test"
import { Model, type Credential } from "@codepilotx/model-schema"
import { Effect } from "effect"
import type { EncryptedCredentialRepository } from "../src/auth/EncryptedCredentialRepository"
import { EncryptedCredentialStore, PiModelService } from "../src/provider/pi"

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
})

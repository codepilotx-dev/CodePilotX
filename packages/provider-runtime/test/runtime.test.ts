import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Integration, Model, Provider } from "@codepilotx/model-schema"
import { createProviderRuntime, ProviderRuntimeError, type ModelsDev } from "../src"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const catalog = (name: string, npm = "@ai-sdk/openai"): ModelsDev.Catalog => ({
  openai: {
    id: "openai",
    name,
    env: ["OPENAI_API_KEY"],
    npm,
    api: "https://catalog.example/v1",
    models: {
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        family: "gpt-5",
        release_date: "2025-12-04",
        attachment: true,
        reasoning: true,
        temperature: true,
        tool_call: true,
        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
        limit: { context: 400_000, output: 128_000 },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
      alpha: {
        id: "alpha", name: "Alpha", release_date: "2026-01-01", attachment: false, reasoning: false,
        temperature: true, tool_call: true, status: "alpha", limit: { context: 1, output: 1 },
      },
      old: {
        id: "old", name: "Old", release_date: "2020-01-01", attachment: false, reasoning: false,
        temperature: true, tool_call: true, status: "deprecated", limit: { context: 1, output: 1 },
      },
    },
  },
})

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "provider-runtime-"))
  roots.push(root)
  return { root, cachePath: join(root, "cache", "models.json") }
}

describe("catalog cache", () => {
  test("uses disk before snapshot/network and refreshes only after five-minute freshness", async () => {
    const { cachePath } = await temporary()
    await mkdir(join(cachePath, ".."), { recursive: true })
    await writeFile(cachePath, JSON.stringify(catalog("Disk")), "utf8")
    let requests = 0
    const runtime = createProviderRuntime({
      cachePath,
      snapshot: catalog("Snapshot"),
      env: { OPENAI_API_KEY: "env-key" },
      refreshIntervalMs: false,
      fetch: async () => {
        requests++
        return Response.json(catalog("Network"))
      },
    })
    expect((await runtime.list())[0]).toMatchObject({ name: "Disk", integrationID: "openai" })
    await runtime.refresh()
    expect(requests).toBe(0)
    const stale = new Date(Date.now() - 6 * 60_000)
    await utimes(cachePath, stale, stale)
    await runtime.refresh()
    expect(requests).toBe(1)
    expect((await runtime.list())[0]?.name).toBe("Network")
    await runtime.dispose()
  })
})

describe("merge and resolver", () => {
  test("keeps unconfigured providers discoverable while disabling execution", async () => {
    const { cachePath } = await temporary()
    const runtime = createProviderRuntime({ cachePath, snapshot: catalog("Discoverable"), env: {}, refreshIntervalMs: false })
    expect((await runtime.list()).map((provider) => provider.id)).toContain(Provider.ID.openai)
    expect((await runtime.models(Provider.ID.openai))[0]?.enabled).toBe(false)
    await expect(runtime.resolve({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5") }))
      .rejects.toMatchObject({ code: "MODEL_NOT_FOUND" })
    await runtime.dispose()
  })

  test("applies plugin then final config, filters status, and isolates variants in the language cache", async () => {
    const { cachePath } = await temporary()
    const calls: string[] = []
    const language = (kind: string) => ({ specificationVersion: "v3", provider: "test", modelId: kind }) as never
    const runtime = createProviderRuntime({
      cachePath,
      snapshot: catalog("Catalog"),
      env: { OPENAI_API_KEY: "env-key" },
      refreshIntervalMs: false,
      pluginHost: {
        init: () => Promise.resolve(),
        transformProviderCatalog: async (value) => {
          const providers = new Map(value.providers)
          const current = providers.get(Provider.ID.openai)!
          providers.set(Provider.ID.openai, { ...current, provider: { ...current.provider, name: "Plugin" } })
          return { ...value, providers }
        },
      },
      config: {
        providers: {
          openai: {
            name: "User",
            options: { baseURL: "https://user.example/v1" },
            models: {
              "gpt-5": {
                variants: {
                  high: { body: { reasoningEffort: "high", marker: "high" } },
                  low: { body: { reasoningEffort: "low", marker: "low" } },
                  xhigh: { disabled: true },
                },
              },
            },
          },
          local: {
            name: "Local",
            npm: "@ai-sdk/openai-compatible",
            api: "http://127.0.0.1:11434/v1",
            models: { local: { name: "Local Model" } },
          },
        },
      },
      extensions: [{ providerOptions: async () => ({ baseURL: "https://custom.example/v1" }) }],
      providerLoaders: {
        "@ai-sdk/openai": async () => (options) => ({
          languageModel: (id) => language(`language:${id}`),
          responses: (id) => {
            calls.push(`${id}:${String(options.baseURL)}`)
            return language(`${id}:${calls.length}`)
          },
        }),
      },
    })

    expect((await runtime.list())[0]?.name).toBe("User")
    expect((await runtime.list()).find((provider) => provider.id === "local")?.integrationID).toBe(Integration.ID.make("local"))
    expect((await runtime.models(Provider.ID.openai)).map((model) => model.id)).toEqual([Model.ID.make("gpt-5")])
    const high = await runtime.resolve({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("high") })
    expect(high.request.body.marker).toBe("high")
    const highLanguage = await runtime.getLanguage({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("high") })
    const lowLanguage = await runtime.getLanguage({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("low") })
    expect(highLanguage).not.toBe(lowLanguage)
    expect(await runtime.getLanguage({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5"), variant: Model.VariantID.make("high") })).toBe(highLanguage)
    expect(calls).toEqual(["gpt-5:https://user.example/v1", "gpt-5:https://user.example/v1"])
    await runtime.dispose()
  })

  test("rejects sensitive config headers and unknown provider packages", async () => {
    const first = await temporary()
    const unsafe = createProviderRuntime({
      cachePath: first.cachePath,
      snapshot: catalog("Unsafe"),
      refreshIntervalMs: false,
      config: { providers: { openai: { headers: { Authorization: "secret" } } } },
    })
    await expect(unsafe.list()).rejects.toMatchObject({ code: "SENSITIVE_HEADER" })

    const second = await temporary()
    const unknown = createProviderRuntime({
      cachePath: second.cachePath,
      snapshot: catalog("Unknown", "untrusted-provider-package"),
      env: { OPENAI_API_KEY: "key" },
      refreshIntervalMs: false,
    })
    await expect(unknown.getLanguage({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5") }))
      .rejects.toEqual(expect.objectContaining({ code: "PROVIDER_NOT_BUNDLED" }))
    await unknown.dispose()
  })
})

describe("lifecycle", () => {
  test("runs the background refresh and stops it on dispose", async () => {
    const { cachePath } = await temporary()
    let requests = 0
    const runtime = createProviderRuntime({
      cachePath,
      snapshot: catalog("Snapshot"),
      env: { OPENAI_API_KEY: "key" },
      freshnessMs: 0,
      refreshIntervalMs: 5,
      fetch: async () => {
        requests++
        return Response.json(catalog("Remote"))
      },
    })
    await runtime.list()
    await Bun.sleep(25)
    expect(requests).toBeGreaterThan(0)
    await runtime.dispose()
    const stoppedAt = requests
    await Bun.sleep(20)
    expect(requests).toBe(stoppedAt)
    await expect(runtime.list()).rejects.toMatchObject({ code: "DISPOSED" })
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { Credential, Model, Provider } from "@codepilotx/model-schema"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createProviderRuntime,
  type CredentialCandidate,
  type CredentialOutcome,
  type CredentialPoolSource,
  type ModelsDev,
} from "../src"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const snapshot: ModelsDev.Catalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
    models: {
      test: {
        id: "test",
        name: "Test",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 1_000, output: 100 },
      },
    },
  },
}

const ref = { providerID: Provider.ID.openai, id: Model.ID.make("test") }
const result = (): LanguageModelV3GenerateResult => ({
  content: [],
  finishReason: { unified: "stop", raw: "stop" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
})

const apiError = (statusCode: number, headers?: Record<string, string>) => Object.assign(new Error(`HTTP ${statusCode}`), {
  statusCode,
  ...(headers ? { responseHeaders: headers } : {}),
})

function language(input: {
  generate?: () => LanguageModelV3GenerateResult | Promise<LanguageModelV3GenerateResult>
  parts?: readonly LanguageModelV3StreamPart[]
}): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate: async () => input.generate?.() ?? result(),
    doStream: async (): Promise<LanguageModelV3StreamResult> => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of input.parts ?? []) controller.enqueue(part)
          controller.close()
        },
      }),
    }),
  }
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const parts: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) return parts
      parts.push(item.value)
    }
  } finally {
    reader.releaseLock()
  }
}

async function fixture(behaviors: Record<string, Parameters<typeof language>[0]>) {
  const root = await mkdtemp(join(tmpdir(), "provider-runtime-failover-"))
  roots.push(root)
  const outcomes: CredentialOutcome[] = []
  const candidates: CredentialCandidate[] = [
    { credentialId: Credential.ID.make("primary"), revision: 1, value: { type: "key", key: "key-1" }, active: true, priority: 10 },
    { credentialId: Credential.ID.make("backup"), revision: 2, value: { type: "key", key: "key-2" }, active: false, priority: 20 },
  ]
  const source: CredentialPoolSource = {
    get: () => candidates[0]!.value,
    candidates: () => candidates,
    report: (outcome) => { outcomes.push(outcome) },
  }
  const creations: string[] = []
  const runtime = createProviderRuntime({
    cachePath: join(root, "models.json"),
    snapshot,
    credentials: source,
    env: {},
    refreshIntervalMs: false,
    providerLoaders: {
      "@ai-sdk/openai": async () => (options) => ({
        languageModel: () => {
          const key = String(options.apiKey)
          creations.push(key)
          return language(behaviors[key] ?? {})
        },
      }),
    },
  })
  return { runtime, candidates, outcomes, creations }
}

describe("credential pool failover", () => {
  test("switches on authentication errors, reports the outcome, and caches by credential id/revision", async () => {
    const { runtime, outcomes, creations } = await fixture({
      "key-1": { generate: async () => { throw apiError(401) } },
      "key-2": { generate: result },
    })
    const model = await runtime.getLanguage(ref)
    await model.doGenerate({ prompt: [] })
    await model.doGenerate({ prompt: [] })
    expect(outcomes.map(({ credentialId, result }) => [String(credentialId), result])).toEqual([
      ["primary", "authentication"], ["backup", "success"],
      ["primary", "authentication"], ["backup", "success"],
    ])
    expect(creations).toEqual(["key-1", "key-2"])
    await runtime.dispose()
  })

  test("reports Retry-After for 429 but does not switch for 5xx", async () => {
    const rateLimited = await fixture({
      "key-1": { generate: async () => { throw apiError(429, { "Retry-After": "2" }) } },
      "key-2": { generate: result },
    })
    await (await rateLimited.runtime.getLanguage(ref)).doGenerate({ prompt: [] })
    expect(rateLimited.outcomes[0]).toMatchObject({ credentialId: "primary", result: "rate-limit", retryAfterMs: 2_000 })
    await rateLimited.runtime.dispose()

    const serverError = await fixture({
      "key-1": { generate: async () => { throw apiError(500) } },
      "key-2": { generate: result },
    })
    await expect((await serverError.runtime.getLanguage(ref)).doGenerate({ prompt: [] })).rejects.toMatchObject({ statusCode: 500 })
    expect(serverError.creations).toEqual(["key-1"])
    expect(serverError.outcomes).toEqual([])
    await serverError.runtime.dispose()
  })

  test("switches on a pre-output stream error and never switches after visible output", async () => {
    const beforeOutput = await fixture({
      "key-1": { parts: [{ type: "stream-start", warnings: [] }, { type: "error", error: apiError(403) }] },
      "key-2": { parts: [{ type: "text-start", id: "1" }, { type: "text-delta", id: "1", delta: "ok" }] },
    })
    const firstParts = await collect((await (await beforeOutput.runtime.getLanguage(ref)).doStream({ prompt: [] })).stream)
    expect(firstParts.some((part) => part.type === "text-delta")).toBe(true)
    expect(beforeOutput.outcomes.map(({ credentialId, result }) => [String(credentialId), result])).toEqual([
      ["primary", "authentication"], ["backup", "success"],
    ])
    await beforeOutput.runtime.dispose()

    const afterOutput = await fixture({
      "key-1": { parts: [{ type: "text-start", id: "1" }, { type: "error", error: apiError(401) }] },
      "key-2": { parts: [{ type: "text-delta", id: "1", delta: "wrong" }] },
    })
    const secondParts = await collect((await (await afterOutput.runtime.getLanguage(ref)).doStream({ prompt: [] })).stream)
    expect(secondParts.map((part) => part.type)).toEqual(["text-start", "error"])
    expect(afterOutput.creations).toEqual(["key-1"])
    await afterOutput.runtime.dispose()
  })

  test("allows a specified credential to bypass the pool", async () => {
    const { runtime, candidates, outcomes, creations } = await fixture({ "key-2": { generate: result } })
    await (await runtime.getLanguageForCredential(ref, candidates[1]!)).doGenerate({ prompt: [] })
    expect(creations).toEqual(["key-2"])
    expect(outcomes).toEqual([])
    await runtime.dispose()
  })
})

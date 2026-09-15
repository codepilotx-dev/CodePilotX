import { afterAll, describe, expect, test } from "bun:test";
import type { Api, Provider } from "@earendil-works/pi-ai";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildModelsDevProviders,
  fetchModelsDevCatalog,
  MODELS_DEV_CATALOG_MAX_BYTES,
  ModelsDevCatalogStore,
  validateModelsDevCatalog,
} from "../src/provider/pi";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const rawCatalog = (overrides: Record<string, unknown> = {}) => ({
  compatible: {
    id: "compatible",
    name: "Compatible",
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.example.com/v1/",
    env: ["COMPATIBLE_API_KEY"],
    models: {
      chat: {
        id: "chat",
        name: "Chat",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: "low high unknown" }],
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 64_000, output: 16_000 },
        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
      },
    },
    ...overrides,
  },
});

describe("models.dev catalog source", () => {
  test("sends conditional headers and accepts a validated UTF-8 catalog", async () => {
    let request: RequestInit | undefined;
    const result = await fetchModelsDevCatalog({
      etag: 'W/"old"',
      lastModified: "Thu, 20 Aug 2026 00:00:00 GMT",
      now: () => 42,
      fetch: async (_input, init) => {
        request = init;
        return new Response(JSON.stringify(rawCatalog()), {
          headers: { etag: 'W/"new"' },
        });
      },
    });
    expect(result.status).toBe("success");
    expect(result.status === "success" && result.fetchedAt).toBe(42);
    expect(result.status === "success" && result.etag).toBe('W/"new"');
    expect(new Headers(request?.headers).get("if-none-match")).toBe('W/"old"');
    expect(new Headers(request?.headers).get("if-modified-since")).toBe(
      "Thu, 20 Aug 2026 00:00:00 GMT",
    );
  });

  test("distinguishes 304, offline, malformed, and oversized responses", async () => {
    expect(
      await fetchModelsDevCatalog({
        etag: "old",
        now: () => 7,
        fetch: async () => new Response(null, { status: 304 }),
      }),
    ).toEqual({ status: "not-modified", fetchedAt: 7, etag: "old" });
    expect(
      await fetchModelsDevCatalog({
        fetch: async () => {
          throw new Error("credential-bearing network error");
        },
      }),
    ).toEqual({ status: "failure", issue: "offline" });
    expect(
      await fetchModelsDevCatalog({
        fetch: async () => new Response("not-json"),
      }),
    ).toEqual({ status: "failure", issue: "invalid-response" });
    expect(
      await fetchModelsDevCatalog({
        fetch: async () =>
          new Response("{}", {
            headers: {
              "content-length": String(MODELS_DEV_CATALOG_MAX_BYTES + 1),
            },
          }),
      }),
    ).toEqual({ status: "failure", issue: "invalid-response" });
  });

  test("keeps valid providers when unrelated entries or optional costs are invalid", () => {
    const catalog = validateModelsDevCatalog({
      ...rawCatalog(),
      broken: { id: "different-id", models: {} },
      noCost: {
        id: "noCost",
        name: "No cost",
        env: [],
        models: {
          chat: {
            id: "chat",
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 1_024, output: 256 },
          },
        },
      },
    });
    expect(Object.keys(catalog)).toEqual(["compatible", "noCost"]);
    expect(catalog.noCost?.models.chat?.cost).toEqual({});
  });
});

describe("ModelsDevCatalogStore", () => {
  test("writes atomically in UTF-8 and repairs an owned invalid document", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-models-dev-store-"));
    roots.push(root);
    const path = join(root, "models-dev-catalog.cache.json");
    const store = new ModelsDevCatalogStore(path);
    expect(await store.read()).toEqual({ status: "missing" });
    await writeFile(
      path,
      JSON.stringify({
        owner: "codepilotx",
        formatVersion: 1,
        source: "https://models.dev/api.json",
        fetchedAt: 1,
        catalog: {},
      }),
      "utf8",
    );
    expect(await store.read()).toEqual({ status: "invalid" });
    const catalog = validateModelsDevCatalog(rawCatalog());
    await store.write({ fetchedAt: 2, etag: "etag", catalog });
    const stored = JSON.parse(await readFile(path, "utf8"));
    expect(stored.owner).toBe("codepilotx");
    expect(stored.formatVersion).toBe(2);
    expect(stored.catalog.compatible.name).toBe("Compatible");
    expect(stored.catalog.compatible.models.chat.tool_call).toBe(true);
    expect(stored.catalog.compatible.models.chat.toolCall).toBeUndefined();
    const reloaded = await store.read();
    expect(reloaded.status).toBe("valid");
    expect(
      reloaded.status === "valid"
        ? reloaded.value.catalog.compatible?.models.chat
        : undefined,
    ).toMatchObject({
      toolCall: true,
      reasoningOptions: ["low", "high", "unknown"],
      cost: { cacheRead: 0.1, cacheWrite: 0.2 },
    });
  });

  test("replaces the lossy v1 cache after a successful refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-models-dev-v1-"));
    roots.push(root);
    const path = join(root, "models-dev-catalog.cache.json");
    const store = new ModelsDevCatalogStore(path);
    await writeFile(
      path,
      JSON.stringify({
        owner: "codepilotx",
        formatVersion: 1,
        source: "https://models.dev/api.json",
        fetchedAt: 1,
        catalog: rawCatalog(),
      }),
      "utf8",
    );
    expect(await store.read()).toEqual({ status: "invalid" });

    await store.write({
      fetchedAt: 2,
      catalog: validateModelsDevCatalog(rawCatalog()),
    });
    expect(JSON.parse(await readFile(path, "utf8")).formatVersion).toBe(2);
    expect((await store.read()).status).toBe("valid");
  });

  test("does not overwrite foreign or future cache formats", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-models-dev-future-"));
    roots.push(root);
    const path = join(root, "models-dev-catalog.cache.json");
    const store = new ModelsDevCatalogStore(path);
    const catalog = validateModelsDevCatalog(rawCatalog());
    const future = JSON.stringify({
      owner: "codepilotx",
      formatVersion: 99,
      catalog: {},
    });
    await writeFile(path, future, "utf8");
    expect(await store.read()).toEqual({ status: "future-version", formatVersion: 99 });
    await expect(store.write({ fetchedAt: 2, catalog })).rejects.toThrow(
      "future format",
    );
    expect(await readFile(path, "utf8")).toBe(future);
    await writeFile(path, JSON.stringify({ owner: "somebody-else" }), "utf8");
    expect(await store.read()).toEqual({ status: "foreign" });
    await expect(store.write({ fetchedAt: 2, catalog })).rejects.toThrow(
      "unknown ownership",
    );
  });
});

describe("models.dev Pi provider factory", () => {
  test("generates only safe OpenAI-compatible providers and maps model metadata", () => {
    const catalog = validateModelsDevCatalog({
      ...rawCatalog(),
      templated: {
        ...rawCatalog().compatible,
        id: "templated",
        api: "https://${ACCOUNT_ID}.example.com/v1",
      },
      unsupported: {
        ...rawCatalog().compatible,
        id: "unsupported",
        npm: "@ai-sdk/anthropic",
      },
    });
    const built = buildModelsDevProviders(catalog, []);
    expect(built.generatedProviders.map((provider) => provider.id)).toEqual([
      "compatible",
    ]);
    const model = built.generatedProviders[0]?.getModels()[0];
    expect(model).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      input: ["text", "image"],
      contextWindow: 64_000,
      maxTokens: 16_000,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    });
    expect(model?.thinkingLevelMap).toMatchObject({ low: "low", high: "high" });
    expect(
      built.descriptors.find((provider) => provider.id === "templated")
        ?.availability,
    ).toEqual({ status: "unavailable", reason: "unresolved-endpoint" });
    expect(
      built.descriptors.find((provider) => provider.id === "unsupported")
        ?.availability,
    ).toEqual({ status: "unavailable", reason: "unsupported-protocol" });
  });

  test("preserves native runtime hooks and only inherits a single API for new models", () => {
    const stream = () => {
      throw new Error("not called");
    };
    const nativeModels = [
      {
        id: "native",
        name: "Native",
        api: "openai-completions",
        provider: "compatible",
        baseUrl: "https://native.example/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_024,
        maxTokens: 256,
        headers: { "x-native-only": "true" },
        compat: { supportsStore: false },
      },
    ];
    const native = {
      id: "compatible",
      name: "Native",
      auth: { apiKey: { name: "Native key", resolve: async () => ({ auth: {} }) } },
      getModels: () => nativeModels,
      stream,
      streamSimple: stream,
    } as unknown as Provider<Api>;
    const built = buildModelsDevProviders(
      validateModelsDevCatalog(rawCatalog()),
      [native],
    );
    const wrapper = built.nativeProviders[0]!;
    expect(wrapper.auth).toBe(native.auth);
    expect(wrapper.stream).not.toBe(native.stream);
    const added = wrapper.getModels().find((model) => model.id === "chat")!;
    expect(added.api).toBe("openai-completions");
    expect(added.baseUrl).toBe("https://native.example/v1");
    expect(added.headers).toBeUndefined();
    expect(added.compat).toBeUndefined();
    expect(wrapper.getModels().find((model) => model.id === "native")).toBe(
      native.getModels()[0],
    );
  });
});

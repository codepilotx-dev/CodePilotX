export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";
export const MODELS_DEV_CATALOG_MAX_BYTES = 16 * 1024 * 1024;
export const MODELS_DEV_CATALOG_TIMEOUT_MS = 10_000;

export type ModelsDevInputModality = "text" | "image" | "pdf" | "audio" | "video";

export interface ModelsDevCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly reasoningOptions: readonly string[];
  readonly toolCall: boolean;
  readonly modalities: {
    readonly input: readonly ModelsDevInputModality[];
    readonly output: readonly string[];
  };
  readonly limit: {
    readonly context?: number;
    readonly output?: number;
  };
  readonly cost: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
}

export interface ModelsDevCatalogProvider {
  readonly id: string;
  readonly name: string;
  readonly npm?: string;
  readonly api?: string;
  readonly env: readonly string[];
  readonly models: Readonly<Record<string, ModelsDevCatalogModel>>;
}

export type ModelsDevCatalog = Readonly<Record<string, ModelsDevCatalogProvider>>;

export type ModelsDevCatalogIssue =
  | "offline"
  | "invalid-response";

export type ModelsDevCatalogFetchResult =
  | {
      readonly status: "success";
      readonly catalog: ModelsDevCatalog;
      readonly fetchedAt: number;
      readonly etag?: string;
      readonly lastModified?: string;
    }
  | {
      readonly status: "not-modified";
      readonly fetchedAt: number;
      readonly etag?: string;
      readonly lastModified?: string;
    }
  | {
      readonly status: "failure";
      readonly issue: ModelsDevCatalogIssue;
    };

export interface ModelsDevCatalogFetchOptions {
  readonly etag?: string;
  readonly lastModified?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validProviderID = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

const validModelID = (value: string) =>
  value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

const parseStringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...new Set(value)]
    : undefined;

const parseReasoningOptions = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  const options = new Set<string>();
  for (const candidate of value) {
    if (!isObject(candidate) || candidate.type !== "effort") continue;
    const values = candidate.values;
    if (typeof values === "string") {
      for (const option of values.split(/\s+/)) {
        if (option) options.add(option);
      }
    } else if (Array.isArray(values)) {
      for (const option of values) {
        if (typeof option === "string" && option) options.add(option);
      }
    }
  }
  return [...options];
};

const parseModel = (key: string, value: unknown): ModelsDevCatalogModel => {
  if (!validModelID(key) || !isObject(value)) {
    throw new Error("models.dev catalog contains an invalid model");
  }
  const id = typeof value.id === "string" ? value.id : key;
  if (id !== key || !validModelID(id)) {
    throw new Error("models.dev catalog contains an invalid model id");
  }
  const modalities = isObject(value.modalities) ? value.modalities : {};
  const input = parseStringArray(modalities.input) ?? [];
  const output = parseStringArray(modalities.output) ?? [];
  const allowedInput = new Set<ModelsDevInputModality>([
    "text",
    "image",
    "pdf",
    "audio",
    "video",
  ]);
  const supportedInput = input.filter((entry) =>
    allowedInput.has(entry as ModelsDevInputModality),
  );
  const limit = isObject(value.limit) ? value.limit : {};
  const cost = isObject(value.cost) ? value.cost : {};
  const context = positiveInteger(limit.context);
  const maxOutput = positiveInteger(limit.output);
  const inputCost = finiteNonNegative(cost.input);
  const outputCost = finiteNonNegative(cost.output);
  const cacheRead = finiteNonNegative(cost.cache_read);
  const cacheWrite = finiteNonNegative(cost.cache_write);
  return {
    id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : id,
    reasoning: value.reasoning === true,
    reasoningOptions: parseReasoningOptions(value.reasoning_options),
    toolCall: value.tool_call === true,
    modalities: {
      input: supportedInput as readonly ModelsDevInputModality[],
      output,
    },
    limit: {
      ...(context !== undefined ? { context } : {}),
      ...(maxOutput !== undefined ? { output: maxOutput } : {}),
    },
    cost: {
      ...(inputCost !== undefined ? { input: inputCost } : {}),
      ...(outputCost !== undefined ? { output: outputCost } : {}),
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    },
  };
};

const parseProvider = (
  key: string,
  value: unknown,
): ModelsDevCatalogProvider => {
  if (!validProviderID(key) || !isObject(value)) {
    throw new Error("models.dev catalog contains an invalid provider");
  }
  const id = typeof value.id === "string" ? value.id : key;
  if (id !== key || !validProviderID(id) || !isObject(value.models)) {
    throw new Error("models.dev catalog contains an invalid provider id");
  }
  const env = value.env === undefined ? [] : parseStringArray(value.env);
  if (
    !env ||
    env.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  ) {
    throw new Error("models.dev catalog contains invalid environment names");
  }
  if (
    (value.api !== undefined && typeof value.api !== "string") ||
    (value.npm !== undefined && typeof value.npm !== "string")
  ) {
    throw new Error("models.dev catalog contains invalid provider metadata");
  }
  return {
    id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : id,
    ...(typeof value.npm === "string" ? { npm: value.npm } : {}),
    ...(typeof value.api === "string" ? { api: value.api } : {}),
    env,
    models: Object.fromEntries(
      Object.entries(value.models).flatMap(([modelID, model]) => {
        try {
          return [[modelID, parseModel(modelID, model)] as const];
        } catch {
          return [];
        }
      }),
    ),
  };
};

export const validateModelsDevCatalog = (value: unknown): ModelsDevCatalog => {
  if (!isObject(value) || Object.keys(value).length === 0) {
    throw new Error("models.dev catalog root is invalid");
  }
  const catalog = Object.fromEntries(
    Object.entries(value).flatMap(([providerID, provider]) => {
      try {
        return [[providerID, parseProvider(providerID, provider)] as const];
      } catch {
        return [];
      }
    }),
  );
  if (Object.keys(catalog).length === 0) {
    throw new Error("models.dev catalog has no valid providers");
  }
  return catalog;
};

/** Encodes the normalized runtime catalog back into models.dev's wire shape. */
export const encodeModelsDevCatalog = (catalog: ModelsDevCatalog): unknown =>
  Object.fromEntries(
    Object.entries(catalog).map(([providerID, provider]) => [
      providerID,
      {
        id: provider.id,
        name: provider.name,
        ...(provider.npm !== undefined ? { npm: provider.npm } : {}),
        ...(provider.api !== undefined ? { api: provider.api } : {}),
        env: [...provider.env],
        models: Object.fromEntries(
          Object.entries(provider.models).map(([modelID, model]) => [
            modelID,
            {
              id: model.id,
              name: model.name,
              reasoning: model.reasoning,
              ...(model.reasoningOptions.length > 0
                ? {
                    reasoning_options: [
                      { type: "effort", values: [...model.reasoningOptions] },
                    ],
                  }
                : {}),
              tool_call: model.toolCall,
              modalities: {
                input: [...model.modalities.input],
                output: [...model.modalities.output],
              },
              limit: {
                ...(model.limit.context !== undefined
                  ? { context: model.limit.context }
                  : {}),
                ...(model.limit.output !== undefined
                  ? { output: model.limit.output }
                  : {}),
              },
              cost: {
                ...(model.cost.input !== undefined
                  ? { input: model.cost.input }
                  : {}),
                ...(model.cost.output !== undefined
                  ? { output: model.cost.output }
                  : {}),
                ...(model.cost.cacheRead !== undefined
                  ? { cache_read: model.cost.cacheRead }
                  : {}),
                ...(model.cost.cacheWrite !== undefined
                  ? { cache_write: model.cost.cacheWrite }
                  : {}),
              },
            },
          ]),
        ),
      },
    ]),
  );

const readLimitedBody = async (response: Response): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MODELS_DEV_CATALOG_MAX_BYTES
  ) {
    throw new Error("models.dev response exceeds the size limit");
  }
  if (!response.body) throw new Error("models.dev returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MODELS_DEV_CATALOG_MAX_BYTES) {
      await reader.cancel();
      throw new Error("models.dev response exceeds the size limit");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

/** Fetches and validates the public models.dev catalog without exposing failures. */
export const fetchModelsDevCatalog = async (
  options: ModelsDevCatalogFetchOptions = {},
): Promise<ModelsDevCatalogFetchResult> => {
  const timeout = AbortSignal.timeout(MODELS_DEV_CATALOG_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(MODELS_DEV_CATALOG_URL, {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json",
        ...(options.etag ? { "If-None-Match": options.etag } : {}),
        ...(options.lastModified
          ? { "If-Modified-Since": options.lastModified }
          : {}),
      },
    });
  } catch {
    return { status: "failure", issue: "offline" };
  }
  const fetchedAt = (options.now ?? Date.now)();
  const etag = response.headers.get("etag") ?? options.etag;
  const lastModified =
    response.headers.get("last-modified") ?? options.lastModified;
  if (response.status === 304) {
    return {
      status: "not-modified",
      fetchedAt,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  }
  if (!response.ok) return { status: "failure", issue: "offline" };
  try {
    const bytes = await readLimitedBody(response);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const catalog = validateModelsDevCatalog(JSON.parse(text));
    return {
      status: "success",
      catalog,
      fetchedAt,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  } catch {
    return { status: "failure", issue: "invalid-response" };
  }
};

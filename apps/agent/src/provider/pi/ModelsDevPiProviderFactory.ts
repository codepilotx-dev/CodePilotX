import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { createPiCustomProvider } from "./PiCustomProvider";
import type { PiCustomModelConfig, PiCustomProviderConfig } from "./PiProviderConfig";
import type {
  ModelsDevCatalog,
  ModelsDevCatalogModel,
  ModelsDevCatalogProvider,
} from "./ModelsDevCatalogSource";

export type ModelsDevProviderProtocol =
  | "pi-native"
  | "openai-compatible"
  | "unsupported";

export type ModelsDevProviderUnavailableReason =
  | "unsupported-protocol"
  | "missing-api"
  | "unsafe-endpoint"
  | "unresolved-endpoint"
  | "no-compatible-models";

export type ModelsDevProviderAvailability =
  | { readonly status: "ready" }
  | {
      readonly status: "unavailable";
      readonly reason: ModelsDevProviderUnavailableReason;
    };

export interface ModelsDevProviderDescriptor {
  readonly kind: "models-dev";
  readonly id: string;
  readonly name: string;
  readonly protocol: ModelsDevProviderProtocol;
  readonly readOnly: true;
  readonly availability: ModelsDevProviderAvailability;
  readonly env: readonly string[];
  readonly modelIDs: readonly string[];
  readonly baseUrl?: string;
}

export interface ModelsDevModelMetadata {
  readonly name: string;
  readonly reasoning: boolean;
  readonly reasoningOptions: readonly string[];
  readonly input: readonly ("text" | "image")[];
  readonly cost: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly limit: {
    readonly context?: number;
    readonly output?: number;
  };
}

export interface ModelsDevPiProviderBuildResult {
  /** Pi-native wrappers followed by newly generated OpenAI-compatible providers. */
  readonly providers: readonly Provider<Api>[];
  readonly nativeProviders: readonly Provider<Api>[];
  readonly generatedProviders: readonly Provider<Api>[];
  readonly descriptors: readonly ModelsDevProviderDescriptor[];
  readonly modelMetadata: Readonly<
    Record<string, Readonly<Record<string, ModelsDevModelMetadata>>>
  >;
}

const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";
const FALLBACK_CONTEXT_WINDOW = 32_768;
const FALLBACK_MAX_TOKENS = 8_192;
const THINKING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const executableModel = (model: ModelsDevCatalogModel) =>
  model.toolCall && model.modalities.output.includes("text");

const inputModalities = (
  model: ModelsDevCatalogModel,
): readonly ("text" | "image")[] => {
  const input = model.modalities.input.filter(
    (entry): entry is "text" | "image" =>
      entry === "text" || entry === "image",
  );
  return input.length ? [...new Set(input)] : ["text"];
};

const thinkingLevelMap = (
  model: ModelsDevCatalogModel,
): Model<Api>["thinkingLevelMap"] | undefined => {
  if (!model.reasoning) return undefined;
  const supported = new Set(
    model.reasoningOptions.filter((level) =>
      (THINKING_LEVELS as readonly string[]).includes(level),
    ),
  );
  if (supported.size === 0) return undefined;
  return Object.fromEntries([
    ["off", null],
    ...THINKING_LEVELS.map((level) => [
      level,
      supported.has(level) ? level : null,
    ] as const),
  ]) as Model<Api>["thinkingLevelMap"];
};

const toMetadata = (model: ModelsDevCatalogModel): ModelsDevModelMetadata => ({
  name: model.name,
  reasoning: model.reasoning,
  reasoningOptions: [...model.reasoningOptions],
  input: inputModalities(model),
  cost: { ...model.cost },
  limit: { ...model.limit },
});

const unsafeHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^10(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^169\.254(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(normalized)
  );
};

const endpoint = (
  value: string | undefined,
):
  | { readonly status: "ready"; readonly baseUrl: string }
  | {
      readonly status: "unavailable";
      readonly reason: "missing-api" | "unsafe-endpoint" | "unresolved-endpoint";
    } => {
  if (!value?.trim()) return { status: "unavailable", reason: "missing-api" };
  if (/\$\{[^}]+\}/.test(value)) {
    return { status: "unavailable", reason: "unresolved-endpoint" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { status: "unavailable", reason: "unsafe-endpoint" };
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    unsafeHostname(url.hostname)
  ) {
    return { status: "unavailable", reason: "unsafe-endpoint" };
  }
  return { status: "ready", baseUrl: url.toString().replace(/\/$/, "") };
};

const toCustomModel = (
  model: ModelsDevCatalogModel,
): PiCustomModelConfig => ({
  id: model.id,
  api: "openai-completions",
  name: model.name,
  enabled: true,
  contextWindow: model.limit.context ?? FALLBACK_CONTEXT_WINDOW,
  maxTokens: model.limit.output ?? FALLBACK_MAX_TOKENS,
  reasoning: model.reasoning,
  input: inputModalities(model),
  cost: {
    input: model.cost.input ?? 0,
    output: model.cost.output ?? 0,
    cacheRead: model.cost.cacheRead ?? 0,
    cacheWrite: model.cost.cacheWrite ?? 0,
  },
  headers: {},
  ...(thinkingLevelMap(model)
    ? { thinkingLevelMap: thinkingLevelMap(model) }
    : {}),
});

const nativeWrapper = (
  provider: Provider<Api>,
  catalogProvider: ModelsDevCatalogProvider | undefined,
): Provider<Api> => {
  if (!catalogProvider) return provider;
  return {
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    ...(provider.headers ? { headers: provider.headers } : {}),
    auth: provider.auth,
    getModels: () => {
      const nativeModels = provider.getModels();
      const nativeIDs = new Set(nativeModels.map((model) => model.id));
      const apis = new Set(nativeModels.map((model) => model.api));
      if (nativeModels.length === 0 || apis.size !== 1) return nativeModels;
      const template = nativeModels[0]!;
      const additions = Object.values(catalogProvider.models)
        .filter((model) => !nativeIDs.has(model.id) && executableModel(model))
        .map((model): Model<Api> => {
          const mappedThinkingLevels = thinkingLevelMap(model);
          return {
            id: model.id,
            name: model.name,
            api: template.api,
            provider: provider.id,
            baseUrl: template.baseUrl,
            reasoning: model.reasoning,
            input: [...inputModalities(model)],
            cost: {
              input: model.cost.input ?? 0,
              output: model.cost.output ?? 0,
              cacheRead: model.cost.cacheRead ?? 0,
              cacheWrite: model.cost.cacheWrite ?? 0,
            },
            contextWindow: model.limit.context ?? FALLBACK_CONTEXT_WINDOW,
            maxTokens: model.limit.output ?? FALLBACK_MAX_TOKENS,
            ...(mappedThinkingLevels
              ? { thinkingLevelMap: mappedThinkingLevels }
              : {}),
          };
        });
      return [...nativeModels, ...additions];
    },
    ...(provider.refreshModels
      ? {
          refreshModels: (context) =>
            provider.refreshModels!.call(provider, context),
        }
      : {}),
    ...(provider.filterModels
      ? {
          filterModels: (models, credential) =>
            provider.filterModels!.call(provider, models, credential),
        }
      : {}),
    stream: provider.stream.bind(provider),
    streamSimple: provider.streamSimple.bind(provider),
  };
};

const descriptor = (
  provider: ModelsDevCatalogProvider,
  native: boolean,
): ModelsDevProviderDescriptor => {
  const compatibleModels = Object.values(provider.models).filter(executableModel);
  if (native) {
    return {
      kind: "models-dev",
      id: provider.id,
      name: provider.name,
      protocol: "pi-native",
      readOnly: true,
      availability: { status: "ready" },
      env: [...provider.env],
      modelIDs: compatibleModels.map((model) => model.id),
      ...(provider.api ? { baseUrl: provider.api } : {}),
    };
  }
  if (provider.npm !== OPENAI_COMPATIBLE_NPM) {
    return {
      kind: "models-dev",
      id: provider.id,
      name: provider.name,
      protocol: "unsupported",
      readOnly: true,
      availability: { status: "unavailable", reason: "unsupported-protocol" },
      env: [...provider.env],
      modelIDs: [],
      ...(provider.api ? { baseUrl: provider.api } : {}),
    };
  }
  const resolvedEndpoint = endpoint(provider.api);
  const availability: ModelsDevProviderAvailability =
    resolvedEndpoint.status === "unavailable"
      ? resolvedEndpoint
      : compatibleModels.length === 0
        ? { status: "unavailable", reason: "no-compatible-models" }
        : { status: "ready" };
  return {
    kind: "models-dev",
    id: provider.id,
    name: provider.name,
    protocol: "openai-compatible",
    readOnly: true,
    availability,
    env: [...provider.env],
    modelIDs: compatibleModels.map((model) => model.id),
    ...(resolvedEndpoint.status === "ready"
      ? { baseUrl: resolvedEndpoint.baseUrl }
      : provider.api
        ? { baseUrl: provider.api }
        : {}),
  };
};

/** Builds Pi runtime providers and read-only catalog descriptions from models.dev. */
export const buildModelsDevProviders = (
  catalog: ModelsDevCatalog,
  builtinProviders: readonly Provider<Api>[],
): ModelsDevPiProviderBuildResult => {
  const nativeIDs = new Set(builtinProviders.map((provider) => provider.id));
  const nativeProviders = builtinProviders.map((provider) =>
    nativeWrapper(provider, catalog[provider.id]),
  );
  const descriptors = Object.values(catalog)
    .map((provider) => descriptor(provider, nativeIDs.has(provider.id)))
    .sort((left, right) => left.id.localeCompare(right.id));
  const descriptorByID = new Map(descriptors.map((item) => [item.id, item]));
  const generatedProviders = Object.values(catalog).flatMap((provider) => {
    if (nativeIDs.has(provider.id)) return [];
    const definition = descriptorByID.get(provider.id);
    if (definition?.availability.status !== "ready") return [];
    const models = Object.values(provider.models).filter(executableModel);
    const baseUrl = definition.baseUrl;
    if (!baseUrl) return [];
    const config: PiCustomProviderConfig = {
      kind: "custom",
      name: provider.name,
      enabled: true,
      baseUrl,
      auth: provider.env.length > 0 ? "api-key" : "none",
      env: [...provider.env],
      allowInsecureHttp: false,
      headers: {},
      models: Object.fromEntries(
        models.map((model) => [model.id, toCustomModel(model)]),
      ),
    };
    return [createPiCustomProvider(provider.id, config)];
  });
  const modelMetadata = Object.fromEntries(
    Object.values(catalog).map((provider) => [
      provider.id,
      Object.fromEntries(
        Object.values(provider.models).map((model) => [
          model.id,
          toMetadata(model),
        ]),
      ),
    ]),
  );
  return {
    providers: [...nativeProviders, ...generatedProviders],
    nativeProviders,
    generatedProviders,
    descriptors,
    modelMetadata,
  };
};

import { Models } from "@opencode-ai/models";
import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderStreams,
  createModels,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export interface ModelsDevCatalogInput {
  readonly providers: Record<string, {
    readonly id: string;
    readonly name: string;
    readonly env?: readonly string[];
    readonly npm?: string;
    readonly api?: string;
    readonly doc?: string;
    readonly models: Record<string, {
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly attachment?: boolean;
      readonly reasoning?: boolean;
      readonly tool_call?: boolean;
      readonly structured_output?: boolean;
      readonly temperature?: boolean;
      readonly knowledge?: string;
      readonly release_date?: string;
      readonly last_updated?: string;
      readonly modalities?: {
        readonly input?: readonly string[];
        readonly output?: readonly string[];
      };
      readonly open_weights?: boolean;
      readonly limit?: {
        readonly context?: number;
        readonly input?: number;
        readonly output?: number;
      };
      readonly cost?: {
        readonly input?: number;
        readonly output?: number;
        readonly reasoning?: number;
        readonly cache_read?: number;
        readonly cache_write?: number;
      };
      readonly provider?: {
        readonly api?: string;
        readonly shape?: "responses" | "completions";
      };
    }>;
  }>;
  readonly models?: Record<string, unknown>;
}

const streamsByApi: Record<string, () => ProviderStreams> = {
  "anthropic-messages": anthropicMessagesApi,
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
};

const normalizeModelApi = (providerId: string, model: ModelsDevCatalogInput["providers"][string]["models"][string]): Api => {
  const shape = model.provider?.shape ?? model.provider?.api;
  if (providerId === "anthropic" || providerId === "claude" || model.provider?.api?.includes("anthropic")) {
    return "anthropic-messages";
  }
  if (shape === "responses" || model.provider?.api?.includes("responses")) {
    return "openai-responses";
  }
  if (shape === "completions" || model.provider?.api?.includes("completions")) {
    return "openai-completions";
  }
  return providerId === "openai" || providerId === "openrouter" || providerId === "deepseek" || providerId === "groq"
    ? "openai-responses"
    : "openai-completions";
};

const toPiModel = (
  providerId: string,
  chunk: ModelsDevCatalogInput["providers"][string]["models"][string],
): Model<Api> => {
  const api = normalizeModelApi(providerId, chunk);
  const cost = {
    input: chunk.cost?.input ?? 0,
    output: chunk.cost?.output ?? 0,
    cacheRead: chunk.cost?.cache_read ?? 0,
    cacheWrite: chunk.cost?.cache_write ?? 0,
  };

  return {
    id: chunk.id,
    name: chunk.name,
    api,
    provider: providerId,
    baseUrl: "https://api.openai.com/v1",
    reasoning: Boolean(chunk.reasoning),
    input: chunk.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
    cost,
    contextWindow: chunk.limit?.context ?? 128000,
    maxTokens: chunk.limit?.output ?? 4096,
  };
};

const toPiProvider = (
  providerId: string,
  provider: ModelsDevCatalogInput["providers"][string],
): Provider<Api> => {
  const models = Object.values(provider.models ?? {}).map((model) => toPiModel(providerId, model));
  const api = Object.fromEntries(
    [...new Set(models.map((model) => model.api))].map((apiType) => [apiType, streamsByApi[apiType] ? streamsByApi[apiType]() : openAIResponsesApi()]),
  ) as Partial<Record<Api, ProviderStreams>>;

  return createProvider({
    id: providerId,
    name: provider.name,
    baseUrl: "https://api.openai.com/v1",
    auth: {
      apiKey: envApiKeyAuth(`${provider.name} API key`, provider.env ?? []),
    },
    models,
    api,
  });
};

export const convertModelsDevCatalog = (
  catalog: ModelsDevCatalogInput,
): MutableModels => {
  const models = createModels();
  for (const [providerId, provider] of Object.entries(catalog.providers ?? {})) {
    models.setProvider(toPiProvider(providerId, provider));
  }
  return models;
};

export const createModelsDevClient = (baseUrl = "https://models.dev") => {
  const client = Models.make({ baseUrl });
  return {
    async providers() {
      return client.providers();
    },
    async catalog() {
      return client.catalog();
    },
  };
};

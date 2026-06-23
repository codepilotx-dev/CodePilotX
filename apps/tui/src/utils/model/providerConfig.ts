import { getSecureStorage } from "../secureStorage/index.js";
import { proxyFetch } from "../proxy.js";
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from "../settings/settings.js";

export type ModelProviderID = string;

export type ModelProviderKind = "anthropic" | "openai-compatible" | "minimax";

export type ProviderModelMetadata = {
  id: string;
  name?: string;
  label?: string;
  description?: string;
  badge?: string;
  iconURL?: string;
  contextWindow?: number;
  outputTokens?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  reasoning?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  vision?: boolean;
  modalities?: {
    input: string[];
    output: string[];
  };
  catalogSources?: Array<"models.dev" | "gateway">;
  gatewayModelId?: string;
  modelsDevProviderId?: string;
  modelType?: string;
  tags?: string[];
};

export type ProviderConfig = {
  providerID: ModelProviderID;
  kind: ModelProviderKind;
  displayName: string;
  baseURL?: string;
  apiKeyEnvVar?: string;
  envVars?: string[];
  defaultModels: string[];
  modelMetadata?: Record<string, ProviderModelMetadata>;
  docURL?: string;
  logoURL?: string;
  npmPackage?: string;
  modelsDevSource?: boolean;
  gatewaySource?: boolean;
  requiresBaseURL?: boolean;
};

export type ProviderModelListResult = {
  models: string[];
  error?: string;
};

export type ProviderBalanceInfo = {
  currency: string;
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
};

export type ProviderTokenPlanUsageInfo = {
  modelName: string;
  currentIntervalTotalCount: number | null;
  currentIntervalRemainingCount: number | null;
  currentIntervalStartTime: number | null;
  currentIntervalEndTime: number | null;
  currentIntervalRemainingTime: number | null;
  currentIntervalStatus: number | null;
  currentIntervalRemainingPercent: number | null;
  currentWeeklyTotalCount: number | null;
  currentWeeklyRemainingCount: number | null;
  currentWeeklyStatus: number | null;
  currentWeeklyRemainingPercent: number | null;
  weeklyStartTime: number | null;
  weeklyEndTime: number | null;
  weeklyRemainingTime: number | null;
  weeklyBoostPermille: number | null;
};

export type ProviderBalanceResult = {
  isAvailable: boolean;
  balances: ProviderBalanceInfo[];
  tokenPlanUsages?: ProviderTokenPlanUsageInfo[];
  error?: string;
};

const MODELS_DEV_CATALOG_URL = "https://models.dev/catalog.json";
const MODELS_DEV_LOGO_BASE_URL = "https://models.dev/logos";
const AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const AI_GATEWAY_PROVIDER_ID = "ai-gateway";
const MINIMAX_TOKEN_PLAN_BASE_URL = "https://www.minimaxi.com";

const providerModelCache = new Map<string, string[]>();
let providerCatalogCache: Record<string, ProviderConfig> | null = null;
let providerCatalogPromise: Promise<Record<string, ProviderConfig>> | null =
  null;

export type ProviderCatalogDiagnostics = {
  modelsDev: {
    status: "idle" | "fulfilled" | "rejected";
    providerCount?: number;
    usableProviderCount?: number;
    filteredMissingApiCount?: number;
    error?: string;
  };
  gateway: {
    status: "idle" | "fulfilled" | "rejected";
    modelCount?: number;
    error?: string;
  };
  providerCount: number;
  providerIds: string[];
};

let providerCatalogDiagnostics: ProviderCatalogDiagnostics = {
  modelsDev: { status: "idle" },
  gateway: { status: "idle" },
  providerCount: 0,
  providerIds: [],
};

export const DEEPSEEK_MODEL_METADATA: Record<string, ProviderModelMetadata> = {
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    label: "V4 Pro",
    description: "Complex agent and high-quality coding tasks",
    badge: "Quality",
    catalogSources: ["models.dev"],
    modelsDevProviderId: "deepseek",
  },
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    label: "V4 Flash",
    description: "Fast responses, light tasks, and economical usage",
    badge: "Fast",
    catalogSources: ["models.dev"],
    modelsDevProviderId: "deepseek",
  },
};

export const ZHIPU_MODEL_METADATA: Record<string, ProviderModelMetadata> = {
  "glm-5.2": {
    id: "glm-5.2",
    label: "GLM-5.2",
    description: "Flagship coding and long-context agent model",
    badge: "Flagship",
    contextWindow: 1_000_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-5.1": {
    id: "glm-5.1",
    label: "GLM-5.1",
    description: "High-intelligence base model for long-running agent work",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-5": {
    id: "glm-5",
    label: "GLM-5",
    description: "Agentic planning and coding model",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-5-turbo": {
    id: "glm-5-turbo",
    label: "GLM-5-Turbo",
    description: "Fast model for complex long tasks",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4.7": {
    id: "glm-4.7",
    label: "GLM-4.7",
    description: "General conversation, reasoning, coding, and agent model",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4.7-flash": {
    id: "glm-4.7-flash",
    label: "GLM-4.7-Flash",
    description: "Free general model based on GLM-4.7",
    badge: "Free",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4.6": {
    id: "glm-4.6",
    label: "GLM-4.6",
    description: "Advanced coding, complex reasoning, and tool-use model",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4.5-air": {
    id: "glm-4.5-air",
    label: "GLM-4.5-Air",
    description: "Cost-effective lightweight reasoning and coding model",
    contextWindow: 128_000,
    outputTokens: 98_304,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-4-flash-250414": {
    id: "glm-4-flash-250414",
    label: "GLM-4-Flash-250414",
    description: "Free long-context model for multilingual and tool-use tasks",
    badge: "Free",
    contextWindow: 128_000,
    outputTokens: 32_768,
    reasoning: false,
    toolCall: true,
    structuredOutput: true,
    vision: false,
    modalities: { input: ["text"], output: ["text"] },
  },
  "glm-5v-turbo": {
    id: "glm-5v-turbo",
    label: "GLM-5V-Turbo",
    description: "Multimodal coding model with vision support",
    contextWindow: 200_000,
    outputTokens: 131_072,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
  "glm-4.6v-flash": {
    id: "glm-4.6v-flash",
    label: "GLM-4.6V-Flash",
    description: "Free visual reasoning model with tool use and long context",
    badge: "Free",
    contextWindow: 128_000,
    outputTokens: 32_768,
    reasoning: true,
    toolCall: true,
    structuredOutput: true,
    vision: true,
    modalities: { input: ["text", "image", "video", "file"], output: ["text"] },
  },
  "glm-4.1v-thinking-flash": {
    id: "glm-4.1v-thinking-flash",
    label: "GLM-4.1V-Thinking-Flash",
    description: "Free visual reasoning model for multimodal understanding",
    badge: "Free",
    contextWindow: 64_000,
    outputTokens: 32_768,
    reasoning: true,
    toolCall: false,
    structuredOutput: false,
    vision: true,
    modalities: { input: ["text", "image", "video", "file"], output: ["text"] },
  },
  "glm-4v-flash": {
    id: "glm-4v-flash",
    label: "GLM-4V-Flash",
    description: "Free lightweight image understanding model",
    badge: "Free",
    contextWindow: 16_000,
    outputTokens: 1_024,
    reasoning: false,
    toolCall: false,
    structuredOutput: false,
    vision: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  },
};

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {};

export function isModelProviderID(value: string): value is ModelProviderID {
  return typeof value === "string" && value.trim().length > 0;
}

export async function getProviderConfigCatalog(): Promise<
  Record<string, ProviderConfig>
> {
  if (providerCatalogCache) return providerCatalogCache;
  providerCatalogPromise ??= fetchProviderConfigCatalog();
  providerCatalogCache = await providerCatalogPromise;
  return providerCatalogCache;
}

export async function listProviderConfigs(): Promise<ProviderConfig[]> {
  const catalog = await getProviderConfigCatalog();
  return Object.values(catalog).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export async function getProviderConfig(
  providerID: ModelProviderID,
): Promise<ProviderConfig> {
  const catalog = await getProviderConfigCatalog();
  const normalizedProviderID = normalizeLegacyProviderID(providerID);
  return (
    catalog[normalizedProviderID] ??
    firstProviderConfig(catalog) ??
    buildFallbackProviderConfig(normalizedProviderID)
  );
}

function getCachedProviderConfig(providerID: ModelProviderID): ProviderConfig {
  const normalizedProviderID = normalizeLegacyProviderID(providerID);
  return (
    providerCatalogCache?.[normalizedProviderID] ??
    firstProviderConfig(providerCatalogCache ?? {}) ??
    buildFallbackProviderConfig(normalizedProviderID)
  );
}

async function fetchProviderConfigCatalog(): Promise<
  Record<string, ProviderConfig>
> {
  const catalog: Record<string, ProviderConfig> = {};
  const [modelsDevResult, gatewayResult] = await Promise.allSettled([
    fetchModelsDevCatalog(),
    fetchGatewayModels(),
  ]);

  if (modelsDevResult.status === "fulfilled") {
    const modelsDevStats = mergeModelsDevCatalog(
      catalog,
      modelsDevResult.value,
    );
    providerCatalogDiagnostics.modelsDev = {
      status: "fulfilled",
      providerCount: modelsDevStats.providerCount,
      usableProviderCount: modelsDevStats.usableProviderCount,
      filteredMissingApiCount: modelsDevStats.filteredMissingApiCount,
    };
  } else {
    providerCatalogDiagnostics.modelsDev = {
      status: "rejected",
      error: errorMessageOf(modelsDevResult.reason),
    };
  }
  if (gatewayResult.status === "fulfilled") {
    mergeGatewayCatalog(catalog, gatewayResult.value);
    providerCatalogDiagnostics.gateway = {
      status: "fulfilled",
      modelCount: gatewayResult.value.length,
    };
  } else {
    providerCatalogDiagnostics.gateway = {
      status: "rejected",
      error: errorMessageOf(gatewayResult.reason),
    };
  }
  providerCatalogDiagnostics.providerCount = Object.keys(catalog).length;
  providerCatalogDiagnostics.providerIds = Object.keys(catalog).slice(0, 20);
  return catalog;
}

async function fetchModelsDevCatalog(): Promise<ModelsDevCatalog> {
  const response = await proxyFetch(MODELS_DEV_CATALOG_URL);
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as ModelsDevCatalog;
}

async function fetchGatewayModels(): Promise<GatewayModel[]> {
  const response = await proxyFetch(AI_GATEWAY_MODELS_URL);
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  const parsed = (await response.json()) as { data?: GatewayModel[] };
  return Array.isArray(parsed.data) ? parsed.data : [];
}

function mergeModelsDevCatalog(
  catalog: Record<string, ProviderConfig>,
  modelsDevCatalog: ModelsDevCatalog,
): {
  providerCount: number;
  usableProviderCount: number;
  filteredMissingApiCount: number;
} {
  const modelsDevProviders = modelsDevCatalog.providers ?? {};
  const modelsDevModels = modelsDevCatalog.models ?? {};
  let usableProviderCount = 0;
  let filteredMissingApiCount = 0;
  for (const [providerID, provider] of Object.entries(modelsDevProviders)) {
    if (providerID === "anthropic") continue;
    if (!provider || typeof provider !== "object") continue;
    if (!hasModelsDevAPI(provider)) {
      filteredMissingApiCount += 1;
      continue;
    }
    usableProviderCount += 1;
    const fromModelsDev = providerFromModelsDev(
      providerID,
      provider,
      modelsDevModels,
    );
    const existing = catalog[providerID];
    catalog[providerID] = existing
      ? {
          ...existing,
          displayName: fromModelsDev.displayName || existing.displayName,
          baseURL: fromModelsDev.baseURL ?? existing.baseURL,
          envVars: fromModelsDev.envVars?.length
            ? fromModelsDev.envVars
            : existing.envVars,
          apiKeyEnvVar: fromModelsDev.apiKeyEnvVar ?? existing.apiKeyEnvVar,
          docURL: fromModelsDev.docURL ?? existing.docURL,
          logoURL: fromModelsDev.logoURL ?? existing.logoURL,
          npmPackage: fromModelsDev.npmPackage ?? existing.npmPackage,
          defaultModels: fromModelsDev.defaultModels.length
            ? fromModelsDev.defaultModels
            : existing.defaultModels,
          modelMetadata: mergeModelMetadata(
            existing.modelMetadata,
            fromModelsDev.modelMetadata,
          ),
          modelsDevSource: true,
        }
      : fromModelsDev;
  }
  return {
    providerCount: Object.keys(modelsDevProviders).length,
    usableProviderCount,
    filteredMissingApiCount,
  };
}

function mergeGatewayCatalog(
  catalog: Record<string, ProviderConfig>,
  gatewayModels: GatewayModel[],
): void {
  for (const model of gatewayModels.filter(
    (model) => model.type === "language",
  )) {
    if (typeof model.id !== "string" || !model.id.trim()) continue;
    const split = splitProviderModel(model.id);
    if (!split) continue;
    const provider = catalog[split.providerID];
    if (!provider) continue;
    catalog[split.providerID] = {
      ...provider,
      modelMetadata: mergeModelMetadata(provider.modelMetadata, {
        [split.modelID]: normalizeGatewayModelIconMetadata(model, split),
      }),
    };
  }
}

function mergeModelMetadata(
  first: Record<string, ProviderModelMetadata> | undefined,
  second: Record<string, ProviderModelMetadata> | undefined,
): Record<string, ProviderModelMetadata> | undefined {
  if (!first && !second) return undefined;
  const merged = { ...(first ?? {}) };
  for (const [modelID, metadata] of Object.entries(second ?? {})) {
    const current = merged[modelID];
    merged[modelID] = current
      ? {
          ...current,
          ...metadata,
          catalogSources: mergeSources(
            current.catalogSources,
            metadata.catalogSources,
          ),
          tags: Array.from(
            new Set([...(current.tags ?? []), ...(metadata.tags ?? [])]),
          ),
        }
      : metadata;
  }
  return merged;
}

function providerFromModelsDev(
  providerID: string,
  provider: ModelsDevProvider,
  globalModels: Record<string, ModelsDevModel>,
): ProviderConfig {
  const apiKeyEnvVar = getProviderApiKeyEnvVar(providerID);
  const modelMetadata = normalizeProviderModels(
    providerID,
    provider.models,
    globalModels,
  );
  return {
    providerID,
    kind: inferProviderKind(providerID, provider),
    displayName:
      typeof provider.name === "string" && provider.name.trim()
        ? provider.name
        : providerID,
    baseURL:
      typeof provider.api === "string" && provider.api.trim()
        ? provider.api.trim()
        : undefined,
    apiKeyEnvVar,
    envVars: [apiKeyEnvVar],
    defaultModels: Object.keys(modelMetadata),
    modelMetadata,
    docURL: typeof provider.doc === "string" ? provider.doc : undefined,
    logoURL: `${MODELS_DEV_LOGO_BASE_URL}/${providerID}.svg`,
    npmPackage: typeof provider.npm === "string" ? provider.npm : undefined,
    modelsDevSource: true,
  };
}

function normalizeProviderModels(
  providerID: string,
  models: unknown,
  globalModels: Record<string, ModelsDevModel>,
): Record<string, ProviderModelMetadata> {
  if (!models || typeof models !== "object") return {};
  const normalized: Record<string, ProviderModelMetadata> = {};
  for (const [modelID, model] of Object.entries(
    models as Record<string, ModelsDevModel>,
  )) {
    const globalModel = globalModels[`${providerID}/${modelID}`];
    normalized[modelID] = normalizeModelsDevModelMetadata(providerID, modelID, {
      ...(globalModel ?? {}),
      ...(model ?? {}),
    });
  }
  return normalized;
}

function normalizeModelsDevModelMetadata(
  providerID: string,
  modelID: string,
  model: ModelsDevModel,
): ProviderModelMetadata {
  const inputModalities = normalizeModalities(model?.modalities?.input);
  const outputModalities = normalizeModalities(model?.modalities?.output);
  return {
    id: modelID,
    name: typeof model?.name === "string" ? model.name : undefined,
    label: typeof model?.name === "string" ? model.name : modelID,
    contextWindow: numberOrUndefined(model?.limit?.context),
    outputTokens: numberOrUndefined(model?.limit?.output),
    inputCost: numberOrUndefined(model?.cost?.input),
    outputCost: numberOrUndefined(model?.cost?.output),
    cacheReadCost: numberOrUndefined(model?.cost?.cache_read),
    reasoning: model?.reasoning === true,
    toolCall: model?.tool_call === true,
    structuredOutput: model?.structured_output === true,
    vision: inputModalities.includes("image"),
    modalities: { input: inputModalities, output: outputModalities },
    catalogSources: ["models.dev"],
    modelsDevProviderId: providerID,
  };
}

function normalizeGatewayModelIconMetadata(
  model: GatewayModel,
  split: { providerID: ModelProviderID; modelID: string },
): ProviderModelMetadata {
  const owner =
    typeof model.owned_by === "string" && model.owned_by.trim()
      ? model.owned_by.trim().toLowerCase()
      : split.providerID;
  return {
    id: split.modelID,
    iconURL: `${MODELS_DEV_LOGO_BASE_URL}/${owner}.svg`,
    catalogSources: ["gateway"],
    gatewayModelId: model.id,
    modelsDevProviderId: owner,
  };
}

function inferProviderKind(
  providerID: string,
  provider?: ModelsDevProvider,
): ModelProviderKind {
  if (isMiniMaxProviderID(providerID) || provider?.npm === "@ai-sdk/anthropic") {
    return "minimax";
  }
  return "openai-compatible";
}

function hasModelsDevAPI(provider: ModelsDevProvider): boolean {
  return typeof provider.api === "string" && provider.api.trim().length > 0;
}

function normalizeLegacyProviderID(
  providerID: ModelProviderID,
): ModelProviderID {
  if (providerID === "zhipu") return "zhipuai";
  if (providerID === "custom") return "minimax";
  return providerID;
}

function firstProviderConfig(
  catalog: Record<string, ProviderConfig>,
): ProviderConfig | undefined {
  return Object.values(catalog).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )[0];
}

export function resetProviderCatalogForTest(): void {
  providerCatalogCache = null;
  providerCatalogPromise = null;
  providerModelCache.clear();
  providerCatalogDiagnostics = {
    modelsDev: { status: "idle" },
    gateway: { status: "idle" },
    providerCount: 0,
    providerIds: [],
  };
}

export function getProviderCatalogDiagnostics(): ProviderCatalogDiagnostics {
  return {
    modelsDev: { ...providerCatalogDiagnostics.modelsDev },
    gateway: { ...providerCatalogDiagnostics.gateway },
    providerCount: providerCatalogDiagnostics.providerCount,
    providerIds: [...providerCatalogDiagnostics.providerIds],
  };
}

function buildFallbackProviderConfig(providerID: string): ProviderConfig {
  const settings = getSettings_DEPRECATED() || {};
  const baseURL =
    typeof settings.providerBaseURL === "string"
      ? settings.providerBaseURL
      : undefined;
  const apiKeyEnvVar = getProviderApiKeyEnvVar(providerID);

  return {
    providerID,
    kind: "openai-compatible",
    displayName: providerID,
    baseURL,
    apiKeyEnvVar,
    envVars: [apiKeyEnvVar],
    defaultModels: [],
    requiresBaseURL: true,
  };
}

export function getSelectedProviderID(): ModelProviderID {
  const settings = getSettings_DEPRECATED() || {};
  const provider = settings.provider;
  if (provider === AI_GATEWAY_PROVIDER_ID) return "minimax";
  if (provider === "zhipu") return "zhipuai";
  if (provider === "custom") return "minimax";
  return typeof provider === "string" && provider.trim() ? provider : "minimax";
}

export function getSelectedProviderConfig(): ProviderConfig {
  const settings = getSettings_DEPRECATED() || {};
  const providerID = getSelectedProviderID();
  const provider = getCachedProviderConfig(providerID);
  return {
    ...provider,
    ...(provider.requiresBaseURL && settings.providerBaseURL
      ? { baseURL: settings.providerBaseURL }
      : {}),
  };
}

export function getProviderDisplayName(
  providerID = getSelectedProviderID(),
): string {
  return getCachedProviderConfig(providerID).displayName ?? providerID;
}

export function getProviderModelMetadata(
  providerID: ModelProviderID,
  modelID: string,
): ProviderModelMetadata | undefined {
  return getCachedProviderConfig(providerID).modelMetadata?.[modelID];
}

export function getSelectedProviderModelMetadata(
  modelID: string,
): ProviderModelMetadata | undefined {
  return getProviderModelMetadata(getSelectedProviderID(), modelID);
}

export function splitProviderModel(input: string): {
  providerID: ModelProviderID;
  modelID: string;
} | null {
  const slash = input.indexOf("/");
  if (slash <= 0 || slash === input.length - 1) return null;
  const provider = input.slice(0, slash).toLowerCase();
  if (!isModelProviderID(provider)) return null;
  return { providerID: provider, modelID: input.slice(slash + 1) };
}

export function formatProviderModel(
  providerID: ModelProviderID,
  modelID: string | null | undefined,
): string {
  return `${providerID}/${modelID || "default"}`;
}

export function saveSelectedProvider(params: {
  providerID: ModelProviderID;
  modelID?: string;
  baseURL?: string;
}): { error: Error | null } {
  const provider = getCachedProviderConfig(params.providerID);
  return updateSettingsForSource("userSettings", {
    provider: normalizeLegacyProviderID(params.providerID),
    providerBaseURL: undefined,
    ...(params.modelID !== undefined ? { model: params.modelID } : {}),
  });
}

export function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage();
  const data = storage.read() || {};
  const providerApiKeys = {
    ...(data.providerApiKeys ?? {}),
    [getProviderCredentialKey(providerID)]: apiKey,
  };
  return storage.update({ ...data, providerApiKeys });
}

export function deleteProviderApiKey(
  providerID: ModelProviderID,
): { success: boolean; warning?: string } {
  const storage = getSecureStorage();
  const data = storage.read() || {};
  const existing = data.providerApiKeys ?? {};
  const credentialKey = getProviderCredentialKey(providerID);
  if (!(credentialKey in existing) && !(providerID in existing)) {
    return { success: true };
  }
  const providerApiKeys = { ...existing };
  delete providerApiKeys[credentialKey];
  delete providerApiKeys[providerID];
  return storage.update({ ...data, providerApiKeys });
}

export function getProviderApiKey(
  providerID = getSelectedProviderID(),
): string | undefined {
  const provider = getCachedProviderConfig(providerID);
  for (const envKey of getProviderEnvVars(provider)) {
    if (process.env[envKey]) return process.env[envKey];
  }
  const storedKeys = getSecureStorage().read()?.providerApiKeys;
  return (
    storedKeys?.[getProviderCredentialKey(providerID)] ??
    storedKeys?.[providerID]
  );
}

export function getProviderApiKeySource(
  providerID = getSelectedProviderID(),
): string | undefined {
  const provider = getCachedProviderConfig(providerID);
  for (const envKey of getProviderEnvVars(provider)) {
    if (process.env[envKey]) return envKey;
  }
  const storedKeys = getSecureStorage().read()?.providerApiKeys;
  return storedKeys?.[getProviderCredentialKey(providerID)] ??
    storedKeys?.[providerID]
    ? "secureStorage"
    : undefined;
}

function getProviderEnvVars(provider: ProviderConfig): string[] {
  return [getProviderApiKeyEnvVar(provider.providerID)];
}

function getProviderCredentialKey(providerID: ModelProviderID): string {
  return getProviderApiKeyEnvVar(providerID);
}

function getProviderApiKeyEnvVar(providerID: ModelProviderID): string {
  return `${providerID
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}_API_KEY`;
}

export function shouldUseOpenAICompatibleProvider(): boolean {
  return getSelectedProviderConfig().kind === "openai-compatible";
}

export function shouldUseMiniMaxProvider(): boolean {
  return getSelectedProviderConfig().kind === "minimax";
}

export function getCachedProviderModels(
  providerID = getSelectedProviderID(),
): string[] | undefined {
  return providerModelCache.get(providerID);
}

export async function fetchProviderModels(
  params: {
    providerID?: ModelProviderID;
    apiKey?: string;
    baseURL?: string;
  } = {},
): Promise<ProviderModelListResult> {
  const providerID = params.providerID ?? getSelectedProviderID();
  const provider =
    providerID === getSelectedProviderID()
      ? getSelectedProviderConfig()
      : await getProviderConfig(providerID);

  if (provider.kind !== "openai-compatible")
    return { models: provider.defaultModels };

  const baseURL = params.baseURL ?? provider.baseURL;
  const apiKey = params.apiKey ?? getProviderApiKey(providerID);
  if (!baseURL) {
    return {
      models: provider.defaultModels,
      error: `${provider.displayName} needs an OpenAI-compatible Base URL before connection testing.`,
    };
  }
  if (!apiKey) {
    return {
      models: provider.defaultModels,
      error: `${provider.displayName} API key is not configured.`,
    };
  }

  try {
    const response = await proxyFetch(joinURL(baseURL, "/models"), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return {
        models: provider.defaultModels,
        error: await formatProviderHTTPError(providerID, response),
      };
    }
    const parsed = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = Array.from(
      new Set(
        (parsed.data ?? [])
          .map((model) => model.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    if (models.length === 0) {
      return {
        models: provider.defaultModels,
        error: "Provider returned no models.",
      };
    }
    const mergedModels = mergeProviderModels(models, provider.defaultModels);
    providerModelCache.set(providerID, mergedModels);
    return { models: mergedModels };
  } catch (error) {
    return {
      models: provider.defaultModels,
      error: errorMessageOf(error),
    };
  }
}

function mergeProviderModels(
  liveModels: string[],
  curatedModels: string[],
): string[] {
  return Array.from(new Set([...liveModels, ...curatedModels]));
}

export async function fetchProviderBalance(
  params: {
    providerID?: ModelProviderID;
    apiKey?: string;
    baseURL?: string;
  } = {},
): Promise<ProviderBalanceResult> {
  const providerID = params.providerID ?? getSelectedProviderID();
  const provider =
    providerID === getSelectedProviderID()
      ? getSelectedProviderConfig()
      : await getProviderConfig(providerID);

  if (isMiniMaxProviderID(providerID)) {
    return fetchMiniMaxTokenPlanUsage({
      apiKey: params.apiKey ?? getProviderApiKey(providerID),
      baseURL: params.baseURL ?? provider.baseURL,
    });
  }

  if (providerID !== "deepseek") {
    return {
      isAvailable: false,
      balances: [],
      error: `${provider.displayName} does not support balance checking yet.`,
    };
  }

  const baseURL = params.baseURL ?? provider.baseURL;
  const apiKey = params.apiKey ?? getProviderApiKey(providerID);
  if (!baseURL)
    return {
      isAvailable: false,
      balances: [],
      error: "DeepSeek Base URL is not configured.",
    };
  if (!apiKey)
    return {
      isAvailable: false,
      balances: [],
      error: "DeepSeek API key is not configured.",
    };

  try {
    const response = await proxyFetch(joinURL(baseURL, "/user/balance"), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      return {
        isAvailable: false,
        balances: [],
        error: await formatProviderHTTPError(providerID, response),
      };
    }
    const parsed = (await response.json()) as {
      is_available?: unknown;
      balance_infos?: Array<{
        currency?: unknown;
        total_balance?: unknown;
        granted_balance?: unknown;
        topped_up_balance?: unknown;
      }>;
    };
    return {
      isAvailable: parsed.is_available === true,
      balances: (parsed.balance_infos ?? []).flatMap((info) => {
        if (typeof info.currency !== "string") return [];
        return [
          {
            currency: info.currency,
            totalBalance:
              typeof info.total_balance === "string" ? info.total_balance : "",
            grantedBalance:
              typeof info.granted_balance === "string"
                ? info.granted_balance
                : "",
            toppedUpBalance:
              typeof info.topped_up_balance === "string"
                ? info.topped_up_balance
                : "",
          },
        ];
      }),
    };
  } catch (error) {
    return {
      isAvailable: false,
      balances: [],
      error: errorMessageOf(error),
    };
  }
}

async function fetchMiniMaxTokenPlanUsage({
  apiKey,
  baseURL,
}: {
  apiKey?: string;
  baseURL?: string;
}): Promise<ProviderBalanceResult> {
  if (!apiKey) {
    return {
      isAvailable: false,
      balances: [],
      tokenPlanUsages: [],
      error: "MiniMax API key is not configured.",
    };
  }

  try {
    const response = await proxyFetch(
      joinURL(
        getMiniMaxTokenPlanBaseURL(baseURL),
        "/v1/token_plan/remains",
      ),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      return {
        isAvailable: false,
        balances: [],
        tokenPlanUsages: [],
        error: await formatProviderHTTPError("minimax", response),
      };
    }
    const parsed = (await response.json()) as MiniMaxTokenPlanResponse;
    const baseRespError = extractMiniMaxBaseRespError(parsed);
    if (baseRespError) {
      return {
        isAvailable: false,
        balances: [],
        tokenPlanUsages: [],
        error: baseRespError,
      };
    }
    return {
      isAvailable: true,
      balances: [],
      tokenPlanUsages: (parsed.model_remains ?? []).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const modelName =
          typeof item.model_name === "string" && item.model_name.trim()
            ? item.model_name
            : "MiniMax Token Plan";
        return [
          {
            modelName,
            currentIntervalTotalCount: numberOrNull(
              item.current_interval_total_count,
            ),
            currentIntervalRemainingCount: numberOrNull(
              item.current_interval_usage_count,
            ),
            currentIntervalStartTime: numberOrNull(item.start_time),
            currentIntervalEndTime: numberOrNull(item.end_time),
            currentIntervalRemainingTime: numberOrNull(item.remains_time),
            currentIntervalStatus: numberOrNull(item.current_interval_status),
            currentIntervalRemainingPercent: numberOrNull(
              item.current_interval_remaining_percent,
            ),
            currentWeeklyTotalCount: numberOrNull(
              item.current_weekly_total_count,
            ),
            currentWeeklyRemainingCount: numberOrNull(
              item.current_weekly_usage_count,
            ),
            currentWeeklyStatus: numberOrNull(item.current_weekly_status),
            currentWeeklyRemainingPercent: numberOrNull(
              item.current_weekly_remaining_percent,
            ),
            weeklyStartTime: numberOrNull(item.weekly_start_time),
            weeklyEndTime: numberOrNull(item.weekly_end_time),
            weeklyRemainingTime: numberOrNull(item.weekly_remains_time),
            weeklyBoostPermille: numberOrNull(item.weekly_boost_permille),
          },
        ];
      }),
    };
  } catch (error) {
    return {
      isAvailable: false,
      balances: [],
      tokenPlanUsages: [],
      error: errorMessageOf(error),
    };
  }
}

function getMiniMaxTokenPlanBaseURL(baseURL: string | undefined): string {
  if (!baseURL) return MINIMAX_TOKEN_PLAN_BASE_URL;
  try {
    const url = new URL(baseURL);
    if (url.hostname === "api.minimax.io") return "https://api.minimax.io";
    if (url.hostname === "api.minimaxi.com") return "https://api.minimaxi.com";
    if (url.hostname === "www.minimax.io") return "https://www.minimax.io";
    if (url.hostname === "www.minimaxi.com") return "https://www.minimaxi.com";
  } catch {
    return MINIMAX_TOKEN_PLAN_BASE_URL;
  }
  return MINIMAX_TOKEN_PLAN_BASE_URL;
}

function mergeSources(
  first: ProviderModelMetadata["catalogSources"],
  second: ProviderModelMetadata["catalogSources"],
): ProviderModelMetadata["catalogSources"] {
  return Array.from(new Set([...(first ?? []), ...(second ?? [])]));
}

function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function formatProviderHTTPError(
  providerID: ModelProviderID,
  response: Response,
): Promise<string> {
  const rawText = await response.text();
  const apiError = extractProviderError(rawText);
  const prefix =
    providerID === "deepseek"
      ? formatDeepSeekHTTPStatus(response.status)
      : isZhipuProviderID(providerID)
        ? formatZhipuHTTPStatus(response.status, apiError.code)
        : `${response.status} ${response.statusText}`;
  const message = apiError.message;
  if (!message) return prefix;
  return `${prefix}: ${apiError.code ? `${apiError.code} ` : ""}${message}`;
}

function extractProviderError(rawText: string): {
  code?: string;
  message: string | null;
} {
  if (!rawText.trim()) return { message: null };
  try {
    const parsed = JSON.parse(rawText) as {
      error?: { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    const message = parsed.error?.message ?? parsed.message;
    const code = parsed.error?.code ?? parsed.code;
    return {
      ...(typeof code === "string" && code.trim() ? { code: code.trim() } : {}),
      message:
        typeof message === "string" && message.trim() ? message.trim() : null,
    };
  } catch {
    return { message: rawText.trim() };
  }
}

function errorMessageOf(error: unknown): string {
  const message = baseErrorMessageOf(error);
  const cause = errorCauseOf(error);
  if (!cause) return message;
  return `${message}; cause: ${errorMessageOf(cause)}`;
}

function baseErrorMessageOf(error: unknown): string {
  const metadata = errorMetadataOf(error);
  if (error instanceof Error) {
    const message = error.message || error.name;
    return metadata.length ? `${message} (${metadata.join(" ")})` : message;
  }
  if (typeof error === "string") return error;
  try {
    const message = JSON.stringify(error);
    return metadata.length ? `${message} (${metadata.join(" ")})` : message;
  } catch {
    const message = String(error);
    return metadata.length ? `${message} (${metadata.join(" ")})` : message;
  }
}

function errorCauseOf(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return undefined;
  }
  return (error as { cause?: unknown }).cause;
}

function errorMetadataOf(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const candidate = error as Record<string, unknown>;
  const metadata: string[] = [];
  for (const key of ["code", "syscall", "address", "port", "errno"]) {
    const value = candidate[key];
    if (typeof value === "string" || typeof value === "number") {
      metadata.push(`${key}=${value}`);
    }
  }
  return metadata;
}

function formatDeepSeekHTTPStatus(status: number): string {
  switch (status) {
    case 400:
      return "400 request format error";
    case 401:
      return "401 invalid or unauthorized API key";
    case 402:
      return "402 insufficient DeepSeek balance";
    case 422:
      return "422 request parameter error";
    case 429:
      return "429 rate limit exceeded";
    case 500:
      return "500 DeepSeek service error";
    case 503:
      return "503 DeepSeek service busy";
    default:
      return `${status} DeepSeek request failed`;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeModalities(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function formatZhipuHTTPStatus(status: number, businessCode?: string): string {
  switch (businessCode) {
    case "1000":
    case "1002":
      return `${status} authentication failed`;
    case "1211":
      return `${status} model not found`;
    case "1261":
      return `${status} prompt too long`;
    case "1302":
    case "1303":
      return `${status} rate limit exceeded`;
    case "1311":
      return `${status} model access unavailable`;
    case "1312":
      return `${status} model overloaded`;
    case "1313":
      return `${status} fair-use rate limited`;
  }
  switch (status) {
    case 400:
      return "400 request parameter error";
    case 401:
      return "401 authentication failed";
    case 429:
      return "429 rate limit or account quota exceeded";
    case 500:
      return "500 Zhipu service error";
    default:
      return `${status} Zhipu request failed`;
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractMiniMaxBaseRespError(
  parsed: MiniMaxTokenPlanResponse,
): string | null {
  const baseResp = parsed.base_resp;
  if (!baseResp || typeof baseResp !== "object") return null;
  const statusCode = baseResp.status_code;
  if (statusCode === 0 || statusCode === "0" || statusCode == null) return null;
  const statusMessage =
    typeof baseResp.status_msg === "string" && baseResp.status_msg.trim()
      ? baseResp.status_msg.trim()
      : "MiniMax Token Plan request failed";
  return `${statusCode} ${statusMessage}`;
}

type ModelsDevProvider = {
  id?: string;
  api?: unknown;
  env?: unknown;
  npm?: unknown;
  name?: unknown;
  doc?: unknown;
  models?: unknown;
};

type ModelsDevCatalog = {
  models?: Record<string, ModelsDevModel>;
  providers?: Record<string, ModelsDevProvider>;
};

type ModelsDevModel = {
  id?: unknown;
  name?: unknown;
  family?: unknown;
  reasoning?: unknown;
  tool_call?: unknown;
  structured_output?: unknown;
  modalities?: {
    input?: unknown;
    output?: unknown;
  };
  limit?: {
    context?: unknown;
    output?: unknown;
  };
  cost?: {
    input?: unknown;
    output?: unknown;
    cache_read?: unknown;
  };
};

function isZhipuProviderID(providerID: ModelProviderID): boolean {
  return providerID === "zhipuai" || providerID === "zhipu";
}

function isMiniMaxProviderID(providerID: ModelProviderID): boolean {
  return providerID === "minimax" || providerID.startsWith("minimax-");
}

type GatewayModel = {
  id: string;
  owned_by?: unknown;
  name?: unknown;
  description?: unknown;
  context_window?: unknown;
  max_tokens?: unknown;
  type?: unknown;
  tags?: unknown;
};

type MiniMaxTokenPlanResponse = {
  model_remains?: MiniMaxTokenPlanRemain[];
  base_resp?: {
    status_code?: unknown;
    status_msg?: unknown;
  };
};

type MiniMaxTokenPlanRemain = {
  model_name?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  remains_time?: unknown;
  current_interval_total_count?: unknown;
  current_interval_usage_count?: unknown;
  current_interval_status?: unknown;
  current_interval_remaining_percent?: unknown;
  current_weekly_total_count?: unknown;
  current_weekly_usage_count?: unknown;
  current_weekly_status?: unknown;
  current_weekly_remaining_percent?: unknown;
  weekly_start_time?: unknown;
  weekly_end_time?: unknown;
  weekly_remains_time?: unknown;
  weekly_boost_permille?: unknown;
};

import type {
  Api,
  Model as PiModel,
  Models,
  ModelsStore,
  MutableModels,
  Provider as PiProvider,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Model, Provider } from "@codepilotx/model-schema";
import type { ProviderCredentialRepository } from "../../auth/ProviderCredentialRepository";
import {
  EncryptedCredentialStore,
  type EncryptedCredentialStoreOptions,
} from "./EncryptedCredentialStore";
import {
  parsePiProviderCatalog,
  PI_PROVIDER_CONFIG_SCHEMA_VERSION,
  type ParsedPiProviderCatalog,
  type PiModelCatalogConfig,
  type PiProviderConfig,
  type PiProviderConfigIssue,
  type PiProviderDefinitionInput,
} from "./PiProviderConfig";
import {
  createPiCustomProvider,
  discoverOpenAIModels,
  type DiscoveredOpenAIModel,
} from "./PiCustomProvider";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  type ModelsDevCatalogFetchOptions,
  type ModelsDevCatalogIssue,
} from "./ModelsDevCatalogSource";
import {
  ModelsDevCatalogStore,
  type ModelsDevCatalogCache,
} from "./ModelsDevCatalogStore";
import {
  buildModelsDevProviders,
  type ModelsDevModelMetadata,
  type ModelsDevProviderDescriptor,
} from "./ModelsDevPiProviderFactory";

const MODELS_DEV_FRESH_MS = 6 * 60 * 60 * 1_000;

export interface PiModelServiceOptions extends EncryptedCredentialStoreOptions {
  readonly models?: Models;
  readonly modelsStore?: ModelsStore;
  readonly config?:
    | PiModelCatalogConfig
    | (() => PiModelCatalogConfig | PromiseLike<PiModelCatalogConfig>);
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly modelsDevStore?: ModelsDevCatalogStore;
  readonly modelsDevFetch?: ModelsDevCatalogFetchOptions["fetch"];
  readonly now?: () => number;
}

export class PiModelServiceError extends Error {
  constructor(
    readonly code:
      | "CATALOG_REFRESH_FAILED"
      | "PROVIDER_NOT_FOUND"
      | "MODEL_NOT_FOUND"
      | "VARIANT_NOT_FOUND"
      | "PROVIDER_NOT_CONFIGURED"
      | "DISPOSED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PiModelServiceError";
  }
}

const clone = <T>(value: T): T => structuredClone(value);

const piProviderToInfo = (
  provider: PiProvider,
  kind: Provider.SourceKind,
  apis: readonly string[],
  disabled: boolean,
  configured?: PiProviderConfig,
  catalogOrigin: Provider.CatalogOrigin = "pi-bundled",
): Provider.Info => ({
  id: Provider.ID.make(provider.id),
  name: provider.name,
  ...(disabled ? { disabled: true } : {}),
  source: {
    type: "pi",
    kind,
    apis: [...new Set(apis)],
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
  },
  catalogOrigin,
  availability: { status: "ready" },
  auth: {
    apiKey:
      configured?.kind === "custom"
        ? configured.auth === "api-key"
        : provider.auth.apiKey !== undefined,
    oauth: provider.auth.oauth !== undefined,
  },
});

const cost = (model: PiModel<Api>): Model.Cost[] => [
  {
    input: model.cost.input,
    output: model.cost.output,
    cache: { read: model.cost.cacheRead, write: model.cost.cacheWrite },
  },
  ...(model.cost.tiers ?? []).map((tier) => ({
    tier: { type: "context" as const, size: tier.inputTokensAbove },
    input: tier.input,
    output: tier.output,
    cache: { read: tier.cacheRead, write: tier.cacheWrite },
  })),
];

const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const supportedThinkingLevels = (model: PiModel<Api>) =>
  model.reasoning
    ? thinkingLevels.filter((level) => model.thinkingLevelMap?.[level] !== null)
    : [];

const piModelToInfo = (
  model: PiModel<Api>,
  enabled: boolean,
  variant?: string,
  metadata?: ModelsDevModelMetadata,
): Model.Info => ({
  id: Model.ID.make(model.id),
  providerID: Provider.ID.make(model.provider),
  name: metadata?.name ?? model.name,
  api: {
    id: Model.ID.make(model.id),
    type: "pi",
    name: model.api,
    baseUrl: model.baseUrl,
  },
  ...(variant ? { variant } : {}),
  capabilities: {
    tools: true,
    input: [...(metadata?.input ?? model.input)],
    output: ["text"],
  },
  variants: supportedThinkingLevels(model).map((level) => ({
    id: Model.VariantID.make(level),
  })),
  time: { released: 0 },
  cost: metadata
    ? [{
        input: metadata.cost.input ?? model.cost.input,
        output: metadata.cost.output ?? model.cost.output,
        cache: {
          read: metadata.cost.cacheRead ?? model.cost.cacheRead,
          write: metadata.cost.cacheWrite ?? model.cost.cacheWrite,
        },
      }]
    : cost(model),
  status: "active",
  enabled,
  limit: {
    context: metadata?.limit.context ?? model.contextWindow,
    output: metadata?.limit.output ?? model.maxTokens,
  },
});

export type ProviderDefinition = PiProviderDefinitionInput | {
  readonly kind: "models-dev";
  readonly id: string;
  readonly protocol: "pi-native" | "openai-compatible" | "unsupported";
  readonly readOnly: true;
};

/** Pi-backed model catalog with the existing CodePilotX catalog shape. */
export class PiModelService {
  readonly pi: Models;
  readonly credentials: EncryptedCredentialStore;
  private readonly mutablePi: MutableModels | undefined;
  private readonly configSource: PiModelServiceOptions["config"];
  private readonly baseProviders: ReadonlyMap<string, PiProvider>;
  private readonly modelsDevStore: ModelsDevCatalogStore | undefined;
  private readonly modelsDevFetch: ModelsDevCatalogFetchOptions["fetch"];
  private readonly now: () => number;
  private readonly builtinProviderIDs: ReadonlySet<string>;
  private configuredCustomProviderIDs = new Set<string>();
  private generatedModelsDevProviderIDs = new Set<string>();
  private modelsDevDescriptors: readonly ModelsDevProviderDescriptor[] = [];
  private modelsDevMetadata: Readonly<Record<string, Readonly<Record<string, ModelsDevModelMetadata>>>> = {};
  private modelsDevCache: ModelsDevCatalogCache | undefined;
  private modelsDevStatus: Provider.CatalogSourceStatus = {
    source: "models-dev",
    mode: "pi-bundled",
    stale: true,
  };
  private catalogVersion = 0;
  private modelsDevOperation: Promise<void> = Promise.resolve();
  private readonly modelsDevAbort = new AbortController();
  private configFingerprint = "";
  private parsedConfig: ParsedPiProviderCatalog = {
    schemaVersion: PI_PROVIDER_CONFIG_SCHEMA_VERSION,
    providers: {},
    issues: [],
  };
  private syncOperation: Promise<ParsedPiProviderCatalog> = Promise.resolve(
    this.parsedConfig,
  );
  private disposed = false;

  constructor(
    repository: ProviderCredentialRepository,
    options: PiModelServiceOptions = {},
  ) {
    this.credentials = new EncryptedCredentialStore(repository, options);
    this.pi =
      options.models ??
      builtinModels({
        credentials: this.credentials,
        ...(options.modelsStore ? { modelsStore: options.modelsStore } : {}),
        authContext: {
          env: async (name) => options.env?.[name] ?? process.env[name],
          // CodePilotX intentionally does not let Pi discover auth files.
          fileExists: async () => false,
        },
      });
    this.mutablePi = isMutableModels(this.pi) ? this.pi : undefined;
    this.baseProviders = new Map(
      this.pi.getProviders().map((provider) => [provider.id, provider]),
    );
    this.builtinProviderIDs = new Set(
      this.pi.getProviders().map((provider) => provider.id),
    );
    this.configSource = options.config;
    this.modelsDevStore = options.modelsDevStore;
    this.modelsDevFetch = options.modelsDevFetch;
    this.now = options.now ?? Date.now;
  }

  async list(): Promise<readonly Provider.Info[]> {
    this.assertActive();
    const config = await this.syncProviders();
    const descriptorByID = new Map(
      this.modelsDevDescriptors.map((descriptor) => [descriptor.id, descriptor]),
    );
    const runtime = this.pi
      .getProviders()
      .map((provider) => {
        const configured = config.providers[provider.id];
        const descriptor = descriptorByID.get(provider.id);
        const kind = configured?.kind === "custom"
          ? "custom"
          : this.generatedModelsDevProviderIDs.has(provider.id)
            ? "models-dev"
            : "builtin";
        const origin: Provider.CatalogOrigin = configured?.kind === "custom"
          ? "user"
          : descriptor
            ? "models-dev"
            : "pi-bundled";
        return piProviderToInfo(
          provider,
          kind,
          this.pi.getModels(provider.id).map((model) => model.api),
          !this.providerEnabled(provider.id, config),
          configured,
          origin,
        );
      });
    const runtimeIDs = new Set(runtime.map((provider) => String(provider.id)));
    const unavailable = this.modelsDevDescriptors
      .filter((descriptor) =>
        !runtimeIDs.has(descriptor.id) && config.providers[descriptor.id]?.kind !== "custom"
      )
      .map((descriptor): Provider.Info => ({
        id: Provider.ID.make(descriptor.id),
        name: descriptor.name,
        disabled: true,
        source: {
          type: "pi",
          kind: "models-dev",
          apis: descriptor.protocol === "openai-compatible"
            ? ["openai-completions"]
            : [],
          ...(descriptor.baseUrl ? { baseUrl: descriptor.baseUrl } : {}),
        },
        catalogOrigin: "models-dev",
        availability: descriptor.availability,
        auth: { apiKey: descriptor.env.length > 0, oauth: false },
      }));
    return [...runtime, ...unavailable].map(clone);
  }

  async isAuthConfigured(providerID: string): Promise<boolean> {
    this.assertActive();
    await this.syncProviders();
    const provider = this.pi
      .getProviders()
      .find((candidate) => candidate.id === providerID);
    if (!provider) return false;
    if (!provider.auth.apiKey && !provider.auth.oauth) return true;
    return (await this.pi.checkAuth(providerID)) !== undefined;
  }

  async providerDefinitions(): Promise<readonly ProviderDefinition[]> {
    this.assertActive();
    const config = await this.syncProviders();
    const descriptorByID = new Map(
      this.modelsDevDescriptors.map((descriptor) => [descriptor.id, descriptor]),
    );
    const definitions = this.pi.getProviders().map((provider): ProviderDefinition => {
      const configured = config.providers[provider.id];
      if (configured?.kind === "custom") {
        return {
          kind: "custom",
          id: provider.id,
          name: configured.name,
          enabled: configured.enabled,
          baseUrl: configured.baseUrl,
          auth: configured.auth,
          env: [...configured.env],
          allowInsecureHttp: configured.allowInsecureHttp,
          headers: { ...configured.headers },
          models: Object.values(configured.models).map((model) => ({
            id: model.id,
            api: model.api,
            name: model.name,
            enabled: model.enabled,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
            input: [...model.input],
            cost: { ...model.cost },
            ...(Object.keys(model.headers).length
              ? { headers: { ...model.headers } }
              : {}),
            ...(model.thinkingLevelMap
              ? { thinkingLevelMap: { ...model.thinkingLevelMap } }
              : {}),
            ...(model.compat
              ? { compat: structuredClone(model.compat) }
              : {}),
          })),
        };
      }
      const descriptor = descriptorByID.get(provider.id);
      if (descriptor && this.generatedModelsDevProviderIDs.has(provider.id)) {
        return {
          kind: "models-dev",
          id: descriptor.id,
          protocol: descriptor.protocol,
          readOnly: true,
        };
      }
      const builtin = configured?.kind === "builtin"
        ? configured
        : undefined;
      return {
        kind: "builtin",
        id: provider.id,
        enabled: builtin?.enabled ?? true,
        allowModels: [...(builtin?.allowModels ?? [])],
        denyModels: [...(builtin?.denyModels ?? [])],
        models: Object.entries(builtin?.models ?? {}).map(([id, model]) => ({
          id,
          enabled: model.enabled,
        })),
      };
    });
    const defined = new Set(definitions.map((definition) => definition.id));
    for (const descriptor of this.modelsDevDescriptors) {
      if (defined.has(descriptor.id) || config.providers[descriptor.id]?.kind === "custom") continue;
      definitions.push({
        kind: "models-dev",
        id: descriptor.id,
        protocol: descriptor.protocol,
        readOnly: true,
      });
    }
    return definitions.map(clone);
  }

  async models(providerID?: Provider.ID): Promise<readonly Model.Info[]> {
    this.assertActive();
    const config = await this.syncProviders();
    const available = new Set(
      (
        await this.pi.getAvailable(providerID ? String(providerID) : undefined)
      ).map((model) => `${model.provider}/${model.id}`),
    );
    return this.pi
      .getModels(providerID ? String(providerID) : undefined)
      .filter((model) => this.modelEnabled(model, config))
      .map((model) =>
        piModelToInfo(
          model,
          available.has(`${model.provider}/${model.id}`),
          undefined,
          this.modelsDevMetadata[model.provider]?.[model.id],
        ),
      )
      .map(clone);
  }

  async resolve(ref: Model.Ref): Promise<Model.Info> {
    const model = await this.getPiModel(ref);
    const auth = await this.pi.checkAuth(model.provider);
    return clone(
      piModelToInfo(
        model,
        auth !== undefined,
        ref.variant ? String(ref.variant) : undefined,
        this.modelsDevMetadata[model.provider]?.[model.id],
      ),
    );
  }

  async getPiModel(ref: Model.Ref): Promise<PiModel<Api>> {
    this.assertActive();
    const config = await this.syncProviders();
    const providerID = String(ref.providerID);
    const modelID = String(ref.id);
    if (!this.providerEnabled(providerID, config)) {
      throw new PiModelServiceError(
        "PROVIDER_NOT_FOUND",
        `Provider ${providerID} was not found`,
      );
    }
    const model = this.pi.getModel(providerID, modelID);
    if (!model || !this.modelEnabled(model, config)) {
      throw new PiModelServiceError(
        "MODEL_NOT_FOUND",
        `Model ${providerID}/${modelID} was not found`,
      );
    }
    if (
      ref.variant &&
      !supportedThinkingLevels(model).includes(
        String(ref.variant) as (typeof thinkingLevels)[number],
      )
    ) {
      throw new PiModelServiceError(
        "VARIANT_NOT_FOUND",
        `Variant ${providerID}/${modelID}/${ref.variant} was not found`,
      );
    }
    const auth = await this.pi.checkAuth(providerID);
    if (!auth)
      throw new PiModelServiceError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider ${providerID} is not configured`,
      );
    return model;
  }

  async refresh(force = false): Promise<void> {
    this.assertActive();
    await this.syncProviders();
    await this.refreshModelsDev(force);
    const result = await this.pi.refresh({ allowNetwork: true, force });
    if (result.errors.size > 0) {
      throw new PiModelServiceError(
        "CATALOG_REFRESH_FAILED",
        "Failed to refresh one or more Pi providers",
        {
          cause: new AggregateError(result.errors.values()),
        },
      );
    }
  }

  async reload(): Promise<void> {
    this.assertActive();
    await this.syncProviders();
    await this.pi.refresh({ allowNetwork: false });
    await this.restoreModelsDevCache();
    this.catalogVersion += 1;
  }

  catalogStatus(): Provider.CatalogSourceStatus {
    return clone(this.modelsDevStatus);
  }

  catalogRevision(): number {
    return this.catalogVersion;
  }

  modelsDevModelCount(providerID: string): number | undefined {
    const models = this.modelsDevMetadata[providerID];
    return models ? Object.keys(models).length : undefined;
  }

  async discoverModels(
    providerID: string,
    options: {
      readonly signal?: AbortSignal;
      readonly fetch?: (
        input: string | URL | Request,
        init?: RequestInit,
      ) => Promise<Response>;
    } = {},
  ): Promise<readonly DiscoveredOpenAIModel[]> {
    const config = await this.syncProviders();
    const provider = config.providers[providerID];
    if (!provider || provider.kind !== "custom" || !provider.enabled) {
      throw new PiModelServiceError(
        "PROVIDER_NOT_FOUND",
        `Custom provider ${providerID} was not found`,
      );
    }
    if (
      !Object.values(provider.models).some(
        (model) =>
          model.api === "openai-completions" ||
          model.api === "openai-responses",
      )
    ) {
      throw new PiModelServiceError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider ${providerID} does not use an OpenAI-compatible API`,
      );
    }
    const auth = await this.pi.getAuth(providerID);
    if (provider.auth === "api-key" && !auth) {
      throw new PiModelServiceError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider ${providerID} is not configured`,
      );
    }
    return discoverOpenAIModels({
      baseUrl: provider.baseUrl,
      headers: {
        ...provider.headers,
        ...Object.fromEntries(
          Object.entries(auth?.auth.headers ?? {}).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string",
          ),
        ),
      },
      ...(auth?.auth.apiKey ? { apiKey: auth.auth.apiKey } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async configIssues(): Promise<readonly PiProviderConfigIssue[]> {
    return [...(await this.syncProviders()).issues];
  }

  async catalogConfig(): Promise<ParsedPiProviderCatalog> {
    return structuredClone(await this.syncProviders());
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.modelsDevAbort.abort();
    await this.modelsDevOperation.catch(() => undefined);
  }

  private async rawConfig(): Promise<PiModelCatalogConfig> {
    return typeof this.configSource === "function"
      ? await this.configSource()
      : (this.configSource ?? {});
  }

  private syncProviders(force = false): Promise<ParsedPiProviderCatalog> {
    const operation = async () => {
      const raw = await this.rawConfig();
      const fingerprint = JSON.stringify(raw);
      if (!force && fingerprint === this.configFingerprint) return this.parsedConfig;
      const parsed = parsePiProviderCatalog(raw);
      const custom = Object.entries(parsed.providers).filter(
        (entry): entry is [
          string,
          Extract<(typeof entry)[1], { kind: "custom" }>,
        ] => entry[1].kind === "custom",
      );
      if (custom.length > 0 && !this.mutablePi) {
        throw new PiModelServiceError(
          "CATALOG_REFRESH_FAILED",
          "The configured Pi Models collection is not mutable",
        );
      }
      for (const providerID of this.configuredCustomProviderIDs) {
        this.mutablePi?.deleteProvider(providerID);
      }
      const nextCustomProviderIDs = new Set<string>();
      for (const [providerID, provider] of custom) {
        this.mutablePi?.setProvider(createPiCustomProvider(providerID, provider));
        nextCustomProviderIDs.add(providerID);
      }
      this.configuredCustomProviderIDs = nextCustomProviderIDs;
      this.parsedConfig = parsed;
      this.configFingerprint = fingerprint;
      return parsed;
    };
    this.syncOperation = this.syncOperation.then(operation, operation);
    return this.syncOperation;
  }

  private restoreModelsDevCache(): Promise<void> {
    if (!this.modelsDevStore) return Promise.resolve();
    return this.enqueueModelsDev(async () => {
      const result = await this.modelsDevStore!.read();
      if (result.status === "valid") {
        if (this.modelsDevCache?.fetchedAt !== result.value.fetchedAt) {
          await this.applyModelsDevCatalog(result.value.catalog);
        }
        this.modelsDevCache = result.value;
        const stale = this.now() - result.value.fetchedAt >= MODELS_DEV_FRESH_MS;
        this.updateCatalogStatus({
          source: "models-dev",
          mode: "cache",
          stale,
          refreshedAt: result.value.fetchedAt,
        });
        return;
      }
      this.modelsDevCache = undefined;
      this.updateCatalogStatus({
        source: "models-dev",
        mode: "pi-bundled",
        stale: true,
        ...(result.status === "future-version" || result.status === "foreign"
          ? { issue: "cache-unsupported" as const }
          : result.status === "invalid"
            ? { issue: "invalid-response" as const }
            : {}),
      });
    });
  }

  private refreshModelsDev(force: boolean): Promise<void> {
    if (!this.modelsDevStore) return Promise.resolve();
    return this.enqueueModelsDev(async () => {
      const current = this.modelsDevCache;
      const result = await fetchModelsDevCatalog({
        ...(current?.etag ? { etag: current.etag } : {}),
        ...(current?.lastModified ? { lastModified: current.lastModified } : {}),
        signal: this.modelsDevAbort.signal,
        now: this.now,
        ...(this.modelsDevFetch ? { fetch: this.modelsDevFetch } : {}),
      });
      if (result.status === "failure") {
        this.markModelsDevFailure(result.issue);
        return;
      }
      if (result.status === "not-modified") {
        if (!current) {
          this.markModelsDevFailure("invalid-response");
          return;
        }
        const next: ModelsDevCatalogCache = {
          ...current,
          fetchedAt: result.fetchedAt,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        };
        this.modelsDevCache = next;
        const cacheIssue = await this.writeModelsDevCache(next);
        this.updateCatalogStatus({
          source: "models-dev",
          mode: "live",
          stale: false,
          refreshedAt: next.fetchedAt,
          ...(cacheIssue ? { issue: cacheIssue } : {}),
        });
        return;
      }
      await this.applyModelsDevCatalog(result.catalog);
      const next: ModelsDevCatalogCache = {
        catalog: result.catalog,
        fetchedAt: result.fetchedAt,
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}),
      };
      this.modelsDevCache = next;
      const cacheIssue = await this.writeModelsDevCache(next);
      this.updateCatalogStatus({
        source: "models-dev",
        mode: "live",
        stale: false,
        refreshedAt: next.fetchedAt,
        ...(cacheIssue ? { issue: cacheIssue } : {}),
      });
    });
  }

  private async writeModelsDevCache(
    cache: ModelsDevCatalogCache,
  ): Promise<"cache-unsupported" | undefined> {
    try {
      await this.modelsDevStore!.write(cache);
      return undefined;
    } catch {
      return "cache-unsupported";
    }
  }

  private async applyModelsDevCatalog(catalog: ModelsDevCatalog): Promise<void> {
    if (!this.mutablePi) {
      throw new PiModelServiceError(
        "CATALOG_REFRESH_FAILED",
        "The configured Pi Models collection is not mutable",
      );
    }
    for (const providerID of this.generatedModelsDevProviderIDs) {
      this.mutablePi.deleteProvider(providerID);
    }
    for (const provider of this.baseProviders.values()) {
      this.mutablePi.setProvider(provider);
    }
    const built = buildModelsDevProviders(catalog, [...this.baseProviders.values()]);
    for (const provider of built.providers) this.mutablePi.setProvider(provider);
    this.generatedModelsDevProviderIDs = new Set(
      built.generatedProviders.map((provider) => provider.id),
    );
    this.modelsDevDescriptors = built.descriptors;
    this.modelsDevMetadata = built.modelMetadata;
    await this.syncProviders(true);
    this.catalogVersion += 1;
  }

  private markModelsDevFailure(issue: ModelsDevCatalogIssue) {
    this.updateCatalogStatus({
      source: "models-dev",
      mode: this.modelsDevCache ? "cache" : "pi-bundled",
      stale: true,
      ...(this.modelsDevCache ? { refreshedAt: this.modelsDevCache.fetchedAt } : {}),
      issue,
    });
  }

  private updateCatalogStatus(status: Provider.CatalogSourceStatus) {
    if (JSON.stringify(status) === JSON.stringify(this.modelsDevStatus)) return;
    this.modelsDevStatus = status;
    this.catalogVersion += 1;
  }

  private enqueueModelsDev(operation: () => Promise<void>): Promise<void> {
    const next = this.modelsDevOperation.then(operation, operation);
    this.modelsDevOperation = next.catch(() => undefined);
    return next;
  }

  private providerEnabled(
    providerID: string,
    config: ParsedPiProviderCatalog,
  ) {
    if (config.schemaVersion > PI_PROVIDER_CONFIG_SCHEMA_VERSION) return false;
    const provider = config.providers[providerID];
    if (!provider) {
      return this.builtinProviderIDs.has(providerID)
        || this.generatedModelsDevProviderIDs.has(providerID);
    }
    return provider.enabled;
  }

  private modelEnabled(
    model: PiModel<Api>,
    config: ParsedPiProviderCatalog,
  ) {
    if (!this.providerEnabled(model.provider, config)) return false;
    const provider = config.providers?.[model.provider];
    if (!provider) return true;
    if (provider.kind === "custom") {
      return (
        provider.models[model.id]?.enabled !== false &&
        Object.values(provider.models).some(
          (configured) => configured.id === model.id && configured.enabled,
        )
      );
    }
    if (
      provider.allowModels.length > 0 &&
      !provider.allowModels.includes(model.id)
    )
      return false;
    if (provider.denyModels.includes(model.id)) return false;
    return provider.models[model.id]?.enabled !== false;
  }

  private assertActive() {
    if (this.disposed)
      throw new PiModelServiceError(
        "DISPOSED",
        "Pi model service has been disposed",
      );
  }
}

const isMutableModels = (models: Models): models is MutableModels =>
  "setProvider" in models &&
  typeof (models as Partial<MutableModels>).setProvider === "function" &&
  "deleteProvider" in models &&
  typeof (models as Partial<MutableModels>).deleteProvider === "function";

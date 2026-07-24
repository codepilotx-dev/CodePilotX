import type {
  Api,
  Model as PiModel,
  Models,
  Provider as PiProvider,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { Integration, Model, Provider } from "@codepilotx/model-schema";
import type { EncryptedCredentialRepository } from "../../auth/EncryptedCredentialRepository";
import {
  EncryptedCredentialStore,
  type EncryptedCredentialStoreOptions,
} from "./EncryptedCredentialStore";

export interface PiModelCatalogConfig {
  readonly enabledProviders?: readonly string[];
  readonly disabledProviders?: readonly string[];
  readonly providers?: Readonly<
    Record<
      string,
      {
        readonly disabled?: boolean;
        readonly whitelist?: readonly string[];
        readonly blacklist?: readonly string[];
        readonly models?: Readonly<
          Record<string, { readonly enabled?: boolean }>
        >;
      }
    >
  >;
}

export interface PiModelServiceOptions extends EncryptedCredentialStoreOptions {
  readonly models?: Models;
  readonly config?:
    | PiModelCatalogConfig
    | (() => PiModelCatalogConfig | PromiseLike<PiModelCatalogConfig>);
  readonly env?: Readonly<Record<string, string | undefined>>;
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

const piProviderToInfo = (provider: PiProvider): Provider.Info => ({
  id: Provider.ID.make(provider.id),
  integrationID: Integration.ID.make(provider.id),
  name: provider.name,
  api: {
    type: "native",
    ...(provider.baseUrl ? { url: provider.baseUrl } : {}),
    settings: {},
  },
  request: {
    headers: Object.fromEntries(
      Object.entries(provider.headers ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    body: {},
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
): Model.Info => ({
  id: Model.ID.make(model.id),
  providerID: Provider.ID.make(model.provider),
  name: model.name,
  api: {
    id: Model.ID.make(model.id),
    type: "native",
    url: model.baseUrl,
    settings: { api: model.api },
  },
  capabilities: {
    tools: true,
    input: [...model.input],
    output: ["text"],
  },
  request: {
    headers: { ...model.headers },
    body: {},
    ...(variant ? { variant } : {}),
  },
  variants: supportedThinkingLevels(model).map((level) => ({
    id: Model.VariantID.make(level),
    headers: {},
    body: {},
  })),
  time: { released: 0 },
  cost: cost(model),
  status: "active",
  enabled,
  limit: { context: model.contextWindow, output: model.maxTokens },
});

/** Pi-backed model catalog with the existing CodePilotX catalog shape. */
export class PiModelService {
  readonly pi: Models;
  readonly credentials: EncryptedCredentialStore;
  private readonly configSource: PiModelServiceOptions["config"];
  private disposed = false;

  constructor(
    repository: EncryptedCredentialRepository,
    options: PiModelServiceOptions = {},
  ) {
    this.credentials = new EncryptedCredentialStore(repository, options);
    this.pi =
      options.models ??
      builtinModels({
        credentials: this.credentials,
        authContext: {
          env: async (name) => options.env?.[name] ?? process.env[name],
          // CodePilotX intentionally does not let Pi discover auth files.
          fileExists: async () => false,
        },
      });
    this.configSource = options.config;
  }

  async list(): Promise<readonly Provider.Info[]> {
    this.assertActive();
    const config = await this.config();
    return this.pi
      .getProviders()
      .filter((provider) => this.providerEnabled(provider.id, config))
      .map(piProviderToInfo)
      .map(clone);
  }

  async models(providerID?: Provider.ID): Promise<readonly Model.Info[]> {
    this.assertActive();
    const config = await this.config();
    const available = new Set(
      (
        await this.pi.getAvailable(providerID ? String(providerID) : undefined)
      ).map((model) => `${model.provider}/${model.id}`),
    );
    return this.pi
      .getModels(providerID ? String(providerID) : undefined)
      .filter((model) => this.modelEnabled(model, config))
      .map((model) =>
        piModelToInfo(model, available.has(`${model.provider}/${model.id}`)),
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
      ),
    );
  }

  async getPiModel(ref: Model.Ref): Promise<PiModel<Api>> {
    this.assertActive();
    const config = await this.config();
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
    await this.pi.refresh({ allowNetwork: false });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  private async config(): Promise<PiModelCatalogConfig> {
    return typeof this.configSource === "function"
      ? await this.configSource()
      : (this.configSource ?? {});
  }

  private providerEnabled(providerID: string, config: PiModelCatalogConfig) {
    if (
      config.enabledProviders &&
      !config.enabledProviders.includes(providerID)
    )
      return false;
    if (config.disabledProviders?.includes(providerID)) return false;
    return !config.providers?.[providerID]?.disabled;
  }

  private modelEnabled(model: PiModel<Api>, config: PiModelCatalogConfig) {
    if (!this.providerEnabled(model.provider, config)) return false;
    const provider = config.providers?.[model.provider];
    if (provider?.whitelist && !provider.whitelist.includes(model.id))
      return false;
    if (provider?.blacklist?.includes(model.id)) return false;
    return provider?.models?.[model.id]?.enabled !== false;
  }

  private assertActive() {
    if (this.disposed)
      throw new PiModelServiceError(
        "DISPOSED",
        "Pi model service has been disposed",
      );
  }
}

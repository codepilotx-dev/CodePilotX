import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  encodeModelsDevCatalog,
  MODELS_DEV_CATALOG_URL,
  validateModelsDevCatalog,
  type ModelsDevCatalog,
} from "./ModelsDevCatalogSource";

const OWNER = "codepilotx";
const FORMAT_VERSION = 2;

export interface ModelsDevCatalogCache {
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly catalog: ModelsDevCatalog;
}

interface StoreDocument {
  readonly owner: typeof OWNER;
  readonly formatVersion: typeof FORMAT_VERSION;
  readonly source: typeof MODELS_DEV_CATALOG_URL;
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly catalog: unknown;
}

export type ModelsDevCatalogStoreReadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly value: ModelsDevCatalogCache }
  | { readonly status: "invalid" }
  | { readonly status: "foreign" }
  | { readonly status: "future-version"; readonly formatVersion: number };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validOptionalString = (value: unknown) =>
  value === undefined || typeof value === "string";

const parseDocument = (value: unknown): ModelsDevCatalogStoreReadResult => {
  if (!isObject(value) || value.owner !== OWNER) return { status: "foreign" };
  if (
    typeof value.formatVersion === "number" &&
    Number.isSafeInteger(value.formatVersion) &&
    value.formatVersion > FORMAT_VERSION
  ) {
    return { status: "future-version", formatVersion: value.formatVersion };
  }
  if (
    value.formatVersion !== FORMAT_VERSION ||
    value.source !== MODELS_DEV_CATALOG_URL ||
    typeof value.fetchedAt !== "number" ||
    !Number.isFinite(value.fetchedAt) ||
    value.fetchedAt < 0 ||
    !validOptionalString(value.etag) ||
    !validOptionalString(value.lastModified)
  ) {
    return { status: "invalid" };
  }
  try {
    const catalog = validateModelsDevCatalog(value.catalog);
    return {
      status: "valid",
      value: {
        fetchedAt: value.fetchedAt,
        ...(typeof value.etag === "string" ? { etag: value.etag } : {}),
        ...(typeof value.lastModified === "string"
          ? { lastModified: value.lastModified }
          : {}),
        catalog,
      },
    };
  } catch {
    return { status: "invalid" };
  }
};

/** UTF-8, ownership-checked, atomically replaced models.dev catalog cache. */
export class ModelsDevCatalogStore {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async read(): Promise<ModelsDevCatalogStoreReadResult> {
    return this.serial(() => this.readDocument());
  }

  async write(value: ModelsDevCatalogCache): Promise<void> {
    await this.serial(async () => {
      const existing = await this.readDocument();
      if (existing.status === "future-version") {
        throw new Error(
          "models.dev cache uses an unsupported future format; refusing to overwrite it",
        );
      }
      if (existing.status === "foreign") {
        throw new Error(
          "models.dev cache has unknown ownership; refusing to overwrite it",
        );
      }
      const catalog = encodeModelsDevCatalog(value.catalog);
      validateModelsDevCatalog(catalog);
      if (
        !Number.isFinite(value.fetchedAt) ||
        value.fetchedAt < 0 ||
        !validOptionalString(value.etag) ||
        !validOptionalString(value.lastModified)
      ) {
        throw new Error("models.dev cache value is invalid");
      }
      await this.writeDocument({
        owner: OWNER,
        formatVersion: FORMAT_VERSION,
        source: MODELS_DEV_CATALOG_URL,
        fetchedAt: value.fetchedAt,
        ...(value.etag ? { etag: value.etag } : {}),
        ...(value.lastModified ? { lastModified: value.lastModified } : {}),
        catalog,
      });
    });
  }

  private async readDocument(): Promise<ModelsDevCatalogStoreReadResult> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        return { status: "missing" };
      }
      return { status: "foreign" };
    }
    try {
      return parseDocument(JSON.parse(text));
    } catch {
      return { status: "foreign" };
    }
  }

  private async writeDocument(document: StoreDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(document, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, this.path);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => undefined);
    return next;
  }
}

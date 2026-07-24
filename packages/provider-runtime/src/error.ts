export class ProviderRuntimeError extends Error {
  constructor(
    readonly code:
      | "CATALOG_INVALID"
      | "CATALOG_REFRESH_FAILED"
      | "PROVIDER_NOT_FOUND"
      | "MODEL_NOT_FOUND"
      | "VARIANT_NOT_FOUND"
      | "PROVIDER_NOT_CONFIGURED"
      | "PROVIDER_NOT_BUNDLED"
      | "SENSITIVE_HEADER"
      | "DISPOSED"
      | "LANGUAGE_MODEL_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "ProviderRuntimeError"
  }
}

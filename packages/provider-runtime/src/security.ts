import { ProviderRuntimeError } from "./error"

const SENSITIVE_HEADERS = new Set(["authorization", "x-api-key", "api-key"])

export function assertSafeHeaders(headers: Readonly<Record<string, string>> | undefined, source: string) {
  for (const name of Object.keys(headers ?? {})) {
    if (!SENSITIVE_HEADERS.has(name.toLowerCase())) continue
    throw new ProviderRuntimeError(
      "SENSITIVE_HEADER",
      `${source} must not contain sensitive header ${name}; use env or the credential store`,
    )
  }
}

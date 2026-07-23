import type { Credential } from "@codepilotx/model-schema"
import type { CredentialOutcome, CredentialPoolSource, ProviderRuntimeOptions } from "../types"
import { isObject } from "./internal"

export function credentialKey(value: Credential.Value | string | undefined) {
  if (typeof value === "string") return value
  if (value?.type === "key") return value.key
  if (value?.type === "oauth") return value.access
  return undefined
}

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000
const DEFAULT_RETRY_AFTER_MS = 60_000

export function credentialPool(source: ProviderRuntimeOptions["credentials"]): CredentialPoolSource | undefined {
  if (!source || !("candidates" in source) || typeof source.candidates !== "function" || !("report" in source) || typeof source.report !== "function") {
    return undefined
  }
  return source as unknown as CredentialPoolSource
}

function errorStatus(error: unknown): number | undefined {
  let current = error
  const visited = new Set<object>()
  while (isObject(current) && !visited.has(current)) {
    visited.add(current)
    if (typeof current.statusCode === "number") return current.statusCode
    if (typeof current.status === "number") return current.status
    current = current.cause
  }
  return undefined
}

function errorHeaders(error: unknown): Headers | Readonly<Record<string, string>> | undefined {
  let current = error
  const visited = new Set<object>()
  while (isObject(current) && !visited.has(current)) {
    visited.add(current)
    const headers = current.responseHeaders ?? current.headers
    if (headers instanceof Headers || isObject(headers)) return headers as Headers | Readonly<Record<string, string>>
    current = current.cause
  }
  return undefined
}

function retryAfterMs(error: unknown, now: number): number {
  const headers = errorHeaders(error)
  const value = headers instanceof Headers
    ? headers.get("retry-after")
    : Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "retry-after")?.[1]
  if (!value) return DEFAULT_RETRY_AFTER_MS
  const seconds = Number(value)
  const parsed = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Number.isFinite(parsed) ? parsed : DEFAULT_RETRY_AFTER_MS))
}

export function retryableCredentialError(error: unknown, now: number): Pick<CredentialOutcome, "result" | "retryAfterMs"> | undefined {
  const status = errorStatus(error)
  if (status === 401 || status === 403) return { result: "authentication" }
  if (status === 429) return { result: "rate-limit", retryAfterMs: retryAfterMs(error, now) }
  return undefined
}

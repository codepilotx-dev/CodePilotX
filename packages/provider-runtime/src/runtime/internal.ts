import { Effect } from "effect"
import type { Credential, Provider, Model } from "@codepilotx/model-schema"
import type { ProviderCatalog } from "@codepilotx/provider-plugin"
import type { ValueSource } from "../types"

export type Mutable<Value> = Value extends string | number | boolean | bigint | symbol | null | undefined
  ? Value
  : Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value
export type MutableRecord = { provider: Mutable<Provider.Info>; models: Map<Model.ID, Mutable<Model.Info>> }
export interface RuntimeState {
  readonly catalog: ProviderCatalog
  readonly options: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  readonly credentials: ReadonlyMap<string, Credential.Value | string | undefined>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly configurationErrors: ReadonlyMap<string, string>
}

export const clone = <Value>(value: Value): Value => structuredClone(value)
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function merge<Value>(base: Value, patch: unknown): Value {
  if (!isObject(base) || !isObject(patch)) return clone(patch as Value)
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    result[key] = isObject(result[key]) && isObject(value) ? merge(result[key], value) : clone(value)
  }
  return result as Value
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") return `[function:${item.name || "anonymous"}]`
    if (!isObject(item)) return item
    if (seen.has(item)) return "[circular]"
    seen.add(item)
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
  })
}

export async function sourceValue<Value>(source: ValueSource<Value> | undefined, fallback: Value): Promise<Value> {
  if (source === undefined) return fallback
  return typeof source === "function" ? await (source as () => PromiseLike<Value> | Value)() : source
}

export async function runEffectOrPromise<Value>(value: unknown): Promise<Value> {
  if (Effect.isEffect(value)) return Effect.runPromise(value as Effect.Effect<Value, unknown>)
  return await value as Value
}

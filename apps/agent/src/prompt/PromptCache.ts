import type { LanguageModel, LanguageModelMiddleware } from "ai"
import { wrapLanguageModel } from "ai"
import type { PromptBundle } from "./types"

export type PromptCacheCapability =
  | { provider: "openai"; strategy: "prompt-cache-key" }
  | { provider: "anthropic"; strategy: "explicit-ephemeral"; maxBreakpoints: 4 }
  | { provider: "other"; strategy: "stable-prefix" }

export const inferPromptCacheCapability = (providerID: string): PromptCacheCapability => {
  const normalized = providerID.trim().toLowerCase()
  if (/^openai(?:\.|$)/.test(normalized)) return { provider: "openai", strategy: "prompt-cache-key" }
  if (/^anthropic(?:\.|$)/.test(normalized)) return { provider: "anthropic", strategy: "explicit-ephemeral", maxBreakpoints: 4 }
  return { provider: "other", strategy: "stable-prefix" }
}

type ProviderOptions = Record<string, Record<string, unknown>>
const providerOptions = (value: unknown): ProviderOptions => value && typeof value === "object" ? value as ProviderOptions : {}

const withOpenAICacheKey = <T extends { providerOptions?: unknown }>(params: T, cacheKey: string): T => ({
  ...params,
  providerOptions: {
    ...providerOptions(params.providerOptions),
    openai: { ...providerOptions(params.providerOptions).openai, promptCacheKey: cacheKey },
  },
})

const anthropicOptions = { anthropic: { cacheControl: { type: "ephemeral" } } } as const

const splitStableSystemPrompt = <T extends { prompt: Array<Record<string, unknown>> }>(
  params: T,
  bundle: PromptBundle,
  instructions: string,
  maxBreakpoints: number,
): T => {
  const instructionSegments = bundle.cacheSegments.filter((segment) => segment.role === "instructions")
  if (instructionSegments.map((segment) => segment.content).join("") !== instructions) return params
  const firstSystem = params.prompt.findIndex((message) => message.role === "system" && message.content === instructions)
  if (firstSystem < 0) return params
  const offsets = bundle.cacheBoundaries.map((boundary) => boundary.offset).filter((offset) => offset > 0 && offset <= instructions.length).slice(-maxBreakpoints)
  if (!offsets.length) return params
  const messages: Array<Record<string, unknown>> = []
  let start = 0
  for (const offset of offsets) {
    messages.push({ role: "system", content: instructions.slice(start, offset), providerOptions: anthropicOptions })
    start = offset
  }
  if (start < instructions.length) messages.push({ role: "system", content: instructions.slice(start) })
  return { ...params, prompt: [...params.prompt.slice(0, firstSystem), ...messages, ...params.prompt.slice(firstSystem + 1)] }
}

export interface PromptCacheMiddlewareOptions {
  bundle: PromptBundle
  capability: PromptCacheCapability
}

export const createPromptCacheMiddleware = ({ bundle, capability }: PromptCacheMiddlewareOptions): LanguageModelMiddleware => ({
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    if (capability.strategy === "prompt-cache-key") return withOpenAICacheKey(params, bundle.cacheKey)
    if (capability.strategy === "explicit-ephemeral") {
      return splitStableSystemPrompt(params as typeof params & { prompt: Array<Record<string, unknown>> }, bundle, bundle.instructions, capability.maxBreakpoints) as typeof params
    }
    return params
  },
})

export const wrapLanguageModelForPromptCache = (
  model: LanguageModel,
  bundle: PromptBundle,
  capability = inferPromptCacheCapability(languageModelProvider(model)),
): LanguageModel => {
  if (!model || typeof model !== "object" || !("specificationVersion" in model) || model.specificationVersion !== "v3") return model
  return wrapLanguageModel({ model: model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: createPromptCacheMiddleware({ bundle, capability }) })
}

export const languageModelProvider = (model: LanguageModel): string => model && typeof model === "object" && "provider" in model && typeof model.provider === "string"
  ? model.provider
  : ""

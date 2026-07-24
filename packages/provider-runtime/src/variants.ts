import type { JsonValue } from "./types"

interface VariantModel {
  readonly id: string
  readonly providerID: string
  readonly api: { readonly id: string; readonly npm: string }
  readonly reasoning: boolean
  readonly releaseDate: string
  readonly outputLimit: number
}

type Variants = Record<string, Record<string, JsonValue>>
const COMMON = ["low", "medium", "high"] as const
const OPENAI_ALL = ["none", "minimal", ...COMMON, "xhigh"] as const
const ENCRYPTED_REASONING: JsonValue[] = ["reasoning.encrypted_content"]
const GPT5 = /(?:^|\/)gpt-5(?:[.-]|$)/
const GPT5_VERSION = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/
const GPT5_PRO = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/
const GPT5_VERSIONED_PRO = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/

const entries = (efforts: readonly string[], make: (effort: string) => Record<string, JsonValue>): Variants =>
  Object.fromEntries(efforts.map((effort) => [effort, make(effort)]))

function openaiEfforts(apiID: string, releaseDate: string): readonly string[] {
  const id = apiID.toLowerCase()
  if (id.includes("deep-research")) return ["medium"]
  if (GPT5.test(id) && id.includes("-chat")) return GPT5_VERSION.test(id) ? ["medium"] : []
  if (GPT5_PRO.test(id)) return GPT5_VERSIONED_PRO.test(id) ? ["medium", "high", "xhigh"] : ["high"]
  if (GPT5.test(id) && id.includes("codex")) {
    const version = Number(GPT5_VERSION.exec(id)?.[1]) || 0
    if (version >= 3) return ["none", ...COMMON, "xhigh"]
    if (id.includes("codex-max") || version >= 2) return [...COMMON, "xhigh"]
    return COMMON
  }
  const version = Number(GPT5_VERSION.exec(id)?.[1]) || 0
  if (version === 1) return ["none", ...COMMON]
  if (version >= 2) return ["none", ...COMMON, "xhigh"]
  const result: string[] = [...COMMON]
  if (GPT5.test(id)) result.unshift("minimal")
  if (releaseDate >= "2025-11-13") result.unshift("none")
  if (releaseDate >= "2025-12-04") result.push("xhigh")
  return result
}

function compatibleEfforts(apiID: string): readonly string[] {
  const id = apiID.toLowerCase()
  if (GPT5.test(id) && id.includes("-chat")) return GPT5_VERSION.test(id) ? ["medium"] : []
  if (GPT5_PRO.test(id)) return GPT5_VERSIONED_PRO.test(id) ? ["medium", "high", "xhigh"] : ["high"]
  return openaiEfforts(id, "9999-12-31").length ? openaiEfforts(id, "9999-12-31") : OPENAI_ALL
}

function adaptiveAnthropic(apiID: string): readonly string[] | undefined {
  const version = /opus-(\d+)[.-](\d+)|claude-(\d+)[.-](\d+)-opus/i.exec(apiID)
  const opus47 = version && (Number(version[1] ?? version[3]) > 4 || Number(version[2] ?? version[4]) >= 7)
  if (opus47 || /sonnet-(?:[5-9]|\d{2,})|claude-(?:[5-9]|\d{2,})-sonnet|fable-5/i.test(apiID)) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
  if (/opus-4[.-]6|4[.-]6-opus|sonnet-4[.-]6|4[.-]6-sonnet/i.test(apiID)) return ["low", "medium", "high", "max"]
  return undefined
}

function googleVariants(apiID: string): Variants {
  const id = apiID.toLowerCase()
  if (id.includes("2.5")) {
    const max = id.includes("pro") && !id.includes("flash") ? 32_768 : 24_576
    return {
      high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_000 } },
      max: { thinkingConfig: { includeThoughts: true, thinkingBudget: max } },
    }
  }
  const efforts = !id.includes("gemini-3") ? ["low", "high"]
    : id.includes("flash-image") ? ["minimal", "high"]
      : id.includes("pro-image") ? ["high"]
        : id.includes("flash") ? ["minimal", "low", "medium", "high"]
          : ["low", "medium", "high"]
  return entries(efforts, (effort) => ({ thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }))
}

export function modelVariants(model: VariantModel): Variants {
  if (!model.reasoning) return {}
  const id = model.id.toLowerCase()
  const apiID = model.api.id.toLowerCase()
  const npm = model.api.npm
  const glm52 = ["glm-5.2", "glm-5-2", "glm-5p2"].some((part) => id.includes(part) || apiID.includes(part))

  if (apiID.includes("minimax-m3") && ["@ai-sdk/anthropic", "@ai-sdk/openai-compatible"].includes(npm)) {
    return { none: { thinking: { type: "disabled" } }, thinking: { thinking: { type: "adaptive" } } }
  }
  if (glm52) {
    if (npm === "@openrouter/ai-sdk-provider") return { high: { reasoning: { effort: "high" } }, xhigh: { reasoning: { effort: "xhigh" } } }
    if (npm === "@ai-sdk/anthropic") return { high: { effort: "high" }, max: { effort: "max" } }
    return { high: { reasoningEffort: "high" }, max: { reasoningEffort: "max" } }
  }
  if (["deepseek-chat", "deepseek-reasoner", "deepseek-r1", "deepseek-v3", "minimax", "kimi", "k2p", "qwen", "big-pickle"].some((part) => id.includes(part)) || (id.includes("glm") && !glm52)) return {}
  if (id.includes("grok-3-mini")) return npm === "@openrouter/ai-sdk-provider"
    ? entries(["low", "high"], (effort) => ({ reasoning: { effort } }))
    : entries(["low", "high"], (effort) => ({ reasoningEffort: effort }))
  if (id.includes("grok")) return {}

  if (npm === "@openrouter/ai-sdk-provider") {
    return entries(model.api.id.startsWith("openai/") || id.includes("gpt") ? compatibleEfforts(apiID) : COMMON, (effort) => ({ reasoning: { effort } }))
  }
  if (npm === "@ai-sdk/gateway") {
    if (id.includes("anthropic")) {
      const adaptive = adaptiveAnthropic(apiID)
      if (adaptive) return entries(adaptive, (effort) => ({ thinking: { type: "adaptive", display: "summarized" }, effort }))
      return { high: { thinking: { type: "enabled", budgetTokens: 16_000 } }, max: { thinking: { type: "enabled", budgetTokens: 31_999 } } }
    }
    if (id.includes("google")) return googleVariants(apiID)
    return entries(compatibleEfforts(apiID), (effort) => ({ reasoningEffort: effort }))
  }
  if (npm === "@ai-sdk/github-copilot") {
    if (id.includes("gemini")) return {}
    if (id.includes("claude")) return entries(COMMON, (effort) => ({ reasoningEffort: effort }))
    return entries(compatibleEfforts(apiID), (effort) => ({ reasoningEffort: effort, reasoningSummary: "auto", include: ENCRYPTED_REASONING }))
  }
  if (["@ai-sdk/cerebras", "@ai-sdk/togetherai", "@ai-sdk/xai", "@ai-sdk/deepinfra", "venice-ai-sdk-provider", "@ai-sdk/openai-compatible"].includes(npm)) {
    const efforts = apiID.includes("north-mini-code") ? ["none", "high"] : apiID.includes("deepseek-v4") ? [...COMMON, "max"] : COMMON
    return entries(efforts, (effort) => ({ reasoningEffort: effort }))
  }
  if (["@ai-sdk/azure", "@ai-sdk/openai", "@ai-sdk/amazon-bedrock/mantle"].includes(npm)) {
    if (npm === "@ai-sdk/azure" && id === "o1-mini") return {}
    return entries(openaiEfforts(apiID, model.releaseDate), (effort) => ({ reasoningEffort: effort, reasoningSummary: "auto", include: ENCRYPTED_REASONING }))
  }
  if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") {
    const adaptive = adaptiveAnthropic(apiID)
    if (adaptive) return entries(adaptive, (effort) => ({ thinking: { type: "adaptive", display: "summarized" }, effort }))
    if (/opus-4[.-]5/i.test(apiID)) return entries(COMMON, (effort) => ({ effort }))
    return {
      high: { thinking: { type: "enabled", budgetTokens: Math.min(16_000, Math.floor(model.outputLimit / 2 - 1)) } },
      max: { thinking: { type: "enabled", budgetTokens: Math.min(31_999, model.outputLimit - 1) } },
    }
  }
  if (npm === "@ai-sdk/amazon-bedrock") {
    const adaptive = adaptiveAnthropic(apiID)
    if (adaptive) return entries(adaptive, (effort) => ({ reasoningConfig: { type: "adaptive", maxReasoningEffort: effort, display: "summarized" } }))
    if (apiID.includes("anthropic")) return { high: { reasoningConfig: { type: "enabled", budgetTokens: 16_000 } }, max: { reasoningConfig: { type: "enabled", budgetTokens: 31_999 } } }
    return entries(COMMON, (effort) => ({ reasoningConfig: { type: "enabled", maxReasoningEffort: effort } }))
  }
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") return googleVariants(apiID)
  if (npm === "@ai-sdk/mistral") return ["mistral-small-2603", "mistral-small-latest", "mistral-medium-3.5", "mistral-medium-2604"].some((part) => apiID.includes(part)) ? { high: { reasoningEffort: "high" } } : {}
  if (npm === "@ai-sdk/groq") return entries(["none", ...COMMON], (effort) => ({ reasoningEffort: effort }))
  return {}
}

import type { LanguageModel } from "ai"
import { aisdk } from "@openai/agents-extensions/ai-sdk"
import type { PromptBundle } from "../prompt/types"
import { inferPromptCacheCapability, languageModelProvider, wrapLanguageModelForPromptCache } from "../prompt/PromptCache"

export const asAgentModel = (model: LanguageModel, prompt?: PromptBundle) => aisdk(
  (prompt ? wrapLanguageModelForPromptCache(model, prompt, inferPromptCacheCapability(languageModelProvider(model))) : model) as never,
)

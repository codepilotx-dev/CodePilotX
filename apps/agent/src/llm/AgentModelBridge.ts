import type { LanguageModel } from "ai"
import { aisdk } from "@openai/agents-extensions/ai-sdk"

export const asAgentModel = (model: LanguageModel) => aisdk(model as never)

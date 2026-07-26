import type { Plugin } from "../plugin"
import {
  createGitHubCopilotBuiltin,
  type GitHubCopilotBuiltinOptions,
} from "./github-copilot"
import {
  createOpenAICodexBuiltin,
  type OpenAICodexBuiltinOptions,
} from "./openai-codex"
import type { BuiltinClock, BuiltinFetch } from "./shared"
import {
  createAnthropicUsageBuiltin,
  type AnthropicUsageBuiltinOptions,
} from "./anthropic-usage"

export interface BuiltinProviderPluginsOptions {
  readonly fetch?: BuiltinFetch
  readonly clock?: BuiltinClock
  readonly openaiCodex?: Omit<OpenAICodexBuiltinOptions, "fetch" | "clock">
  readonly githubCopilot?: Omit<GitHubCopilotBuiltinOptions, "fetch" | "clock">
  readonly anthropicUsage?: Omit<AnthropicUsageBuiltinOptions, "fetch" | "clock">
}

export function createBuiltinProviderPlugins(options: BuiltinProviderPluginsOptions = {}): readonly Plugin[] {
  const dependencies = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  }
  return [
    createOpenAICodexBuiltin({ ...dependencies, ...options.openaiCodex }),
    createGitHubCopilotBuiltin({ ...dependencies, ...options.githubCopilot }),
    createAnthropicUsageBuiltin({ ...dependencies, ...options.anthropicUsage }),
  ]
}

export {
  createGitHubCopilotBuiltin,
  createOpenAICodexBuiltin,
  createAnthropicUsageBuiltin,
  type AnthropicUsageBuiltinOptions,
  type BuiltinClock,
  type BuiltinFetch,
  type GitHubCopilotBuiltinOptions,
  type OpenAICodexBuiltinOptions,
}

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

export interface BuiltinProviderPluginsOptions {
  readonly fetch?: BuiltinFetch
  readonly clock?: BuiltinClock
  readonly openaiCodex?: Omit<OpenAICodexBuiltinOptions, "fetch" | "clock">
  readonly githubCopilot?: Omit<GitHubCopilotBuiltinOptions, "fetch" | "clock">
}

export function createBuiltinProviderPlugins(options: BuiltinProviderPluginsOptions = {}): readonly Plugin[] {
  const dependencies = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  }
  return [
    createOpenAICodexBuiltin({ ...dependencies, ...options.openaiCodex }),
    createGitHubCopilotBuiltin({ ...dependencies, ...options.githubCopilot }),
  ]
}

export {
  createGitHubCopilotBuiltin,
  createOpenAICodexBuiltin,
  type BuiltinClock,
  type BuiltinFetch,
  type GitHubCopilotBuiltinOptions,
  type OpenAICodexBuiltinOptions,
}

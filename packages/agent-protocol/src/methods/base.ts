import { ConfigRpcMethods } from "./config"
import { CoreRpcMethods } from "./core"
import { ExtendedRpcMethods } from "./extended"
import { GitRpcMethods } from "./git"
import { GithubRpcMethods } from "./github"
import { McpRpcMethods } from "./mcp"
import { PetRpcMethods } from "./pet"
import { ReleaseNotesRpcMethods } from "./release-notes"
import { ReviewRpcMethods } from "./review"
import { SkillRpcMethods } from "./skills"
import { SuggestionRpcMethods } from "./suggestions"
import { ToolingRpcMethods } from "./tooling"
import { UsageRpcMethods } from "./usage"

/**
 * Public methods required by the always-loaded desktop session client. Optional
 * environment/worktree/Handoff schemas are resolved lazily by runtime/client.
 */
export const BaseRpcMethods = {
  ...CoreRpcMethods,
  ...ConfigRpcMethods,
  ...ExtendedRpcMethods,
  ...GitRpcMethods,
  ...GithubRpcMethods,
  ...McpRpcMethods,
  ...PetRpcMethods,
  ...ReleaseNotesRpcMethods,
  ...ReviewRpcMethods,
  ...SkillRpcMethods,
  ...SuggestionRpcMethods,
  ...ToolingRpcMethods,
  ...UsageRpcMethods,
} as const

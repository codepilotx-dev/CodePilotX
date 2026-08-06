import { createAgentSessionDesktopClient } from './agent-session-client.js'
import { createBrowserMockDesktopClient } from './browser-mock-client.js'
import { defaultDesktopClientEnvironment } from './environment.js'
import type {
  CodePilotXDesktopClient,
  DesktopClientEnvironment,
} from './types.js'

export {
  CONFIG_UPDATED_EVENT,
  WORKSPACE_FILE_CHANGED_EVENT,
  WORKSPACE_GIT_CHANGED_EVENT,
} from './agent-session-client.js'
export { startGithubLoginFlow } from './github-login.js'
export type { DesktopTerminalClient } from './terminal-client.js'

let terminalClientPromise:
  | Promise<import('./terminal-client.js').DesktopTerminalClient>
  | null = null

export function loadDesktopTerminalClient(): Promise<
  import('./terminal-client.js').DesktopTerminalClient
> {
  terminalClientPromise ??= import('./terminal-client.js').then(
    module => module.terminalClient,
  )
  return terminalClientPromise
}
export type { GithubLoginClient } from './github-login.js'

export type {
  CodePilotXDesktopClient,
  DesktopAgentEventEnvelopeApi,
  DesktopAgentReviewApi,
  DesktopAgentThreadTitleApi,
  DesktopClientEnvironment,
  DesktopReleaseNotesApi,
  DesktopRuntimeCapabilityApi,
  DesktopUsageApi,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentFileSummary,
  DesktopReviewAgentSummary,
  DesktopReviewAgentSummaryResult,
} from './types.js'

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
): CodePilotXDesktopClient {
  const fallbackClient =
    createBrowserMockDesktopClient(environment.localStorage)
  return createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    environment.window?.codePilotXDesktop === undefined,
  )
}

export const desktopClient: CodePilotXDesktopClient = createDesktopClient()

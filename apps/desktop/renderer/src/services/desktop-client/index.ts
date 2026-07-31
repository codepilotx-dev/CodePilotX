import type { DesktopApi } from '../../../shared/types.js'
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
export type { GithubLoginClient } from './github-login.js'

export type {
  CodePilotXDesktopClient,
  DesktopAgentEventEnvelopeApi,
  DesktopAgentReviewApi,
  DesktopAgentThreadTitleApi,
  DesktopClientEnvironment,
  DesktopReleaseNotesApi,
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
  const fallbackClient: DesktopApi =
    createBrowserMockDesktopClient(environment.localStorage)
  return createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    environment.window?.codePilotXDesktop === undefined,
  )
}

export const desktopClient: CodePilotXDesktopClient = createDesktopClient()

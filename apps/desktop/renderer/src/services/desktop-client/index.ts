import type { DesktopApi } from '../../../shared/types.js'
import { createAgentSessionDesktopClient } from './agent-session-client.js'
import { createSwitchingBrowserDesktopClient } from './browser-debug-client.js'
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

export {
  readDesktopBrowserDebugMode,
  writeDesktopBrowserDebugMode,
  DESKTOP_BROWSER_DEBUG_MODE_EVENT,
  DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY,
} from './browser-debug-client.js'

export type {
  CodePilotXDesktopClient,
  DesktopAgentEventEnvelopeApi,
  DesktopAgentReviewApi,
  DesktopClientEnvironment,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentFileSummary,
  DesktopReviewAgentSummary,
  DesktopReviewAgentSummaryResult,
} from './types.js'

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
): CodePilotXDesktopClient {
  const productionClient = environment.window?.desktopApi
  const fallbackClient: DesktopApi =
    productionClient ?? createSwitchingBrowserDesktopClient(environment)
  return createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    productionClient === undefined &&
      environment.window?.codePilotXDesktop === undefined,
  )
}

export const desktopClient: CodePilotXDesktopClient = createDesktopClient()

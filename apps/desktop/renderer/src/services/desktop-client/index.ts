import { createAgentSessionDesktopClient } from './agent-session-client.js'
import { createLazyBrowserMockClient } from './lazy-browser-mock-client.js'
import { defaultDesktopClientEnvironment } from './environment.js'
import { createGithubAccountCache } from './github-account-cache.js'
import type {
  DesktopAttachmentApi,
  DesktopLocalContextApi,
  DesktopClientEnvironment,
} from './types.js'

export {
  CONFIG_UPDATED_EVENT,
  WORKSPACE_FILE_CHANGED_EVENT,
  WORKSPACE_GIT_CHANGED_EVENT,
} from './agent-session-client.js'
export { startGithubLoginFlow } from './github-login.js'
export { desktopClipboard } from './clipboard-client.js'
export type { DesktopClipboard } from './clipboard-client.js'
export type { DesktopTerminalClient } from './terminal-client.js'
export type { DesktopBrowserClient } from './desktop-browser-client.js'

let terminalClientPromise: Promise<import('./terminal-client.js').DesktopTerminalClient> | null =
  null

export function loadDesktopTerminalClient(): Promise<
  import('./terminal-client.js').DesktopTerminalClient
> {
  terminalClientPromise ??= import('./terminal-client.js')
    .then((module) => module.terminalClient)
    .catch((error) => {
      terminalClientPromise = null
      throw error
    })
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
  DesktopAutomationApi,
  DesktopCalendarApi,
  DesktopPluginApi,
  DesktopMiniMaxCliApi,
  DesktopSessionGroupApi,
  DesktopSessionGroup,
  DesktopSessionGroupDetail,
  DesktopSessionGroupStep,
  DesktopLocalContextApi,
  DesktopSpeechApi,
  DesktopSpeechStatus,
  DesktopUsageApi,
  DesktopReviewAgentComment,
  DesktopReviewAgentFileDiff,
  DesktopReviewAgentFileSummary,
  DesktopReviewAgentSummary,
  DesktopReviewAgentSummaryResult,
} from './types.js'

export function createDesktopClient(
  environment: DesktopClientEnvironment = defaultDesktopClientEnvironment(),
) {
  const fallbackClient = createLazyBrowserMockClient(environment.localStorage)
  const client = createAgentSessionDesktopClient(
    environment,
    fallbackClient,
    environment.window?.codePilotXDesktop === undefined,
  )
  return { ...client, ...createGithubAccountCache(client) }
}

export const desktopClient = createDesktopClient()

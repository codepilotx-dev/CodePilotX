import type { DesktopApi } from './types.js'

export type DesktopApiMethod = Exclude<
  keyof DesktopApi,
  'onAgentEvent' | 'onUiCommand'
>

export const DESKTOP_API_METHODS = [
  'getAuthStatus',
  'getRuntimeStatus',
  'getDesktopSettings',
  'saveDesktopSettings',
  'listBuiltinPlugins',
  'setBuiltinPluginEnabled',
  'listMcpServers',
  'saveMcpServer',
  'removeMcpServer',
  'setMcpServerEnabled',
  'listOpenTargets',
  'openPathWithDefaultTarget',
  'listModelProviders',
  'getModelProviderState',
  'fetchProviderModels',
  'fetchProviderBalance',
  'saveModelProvider',
  'saveProviderApiKey',
  'chooseWorkspace',
  'openWorkspace',
  'getWorkspaceContext',
  'checkoutWorkspaceBranch',
  'listWorkspaceFiles',
  'readWorkspaceFile',
  'getWorkspaceDiff',
  'getThemeSettings',
  'saveThemeSettings',
  'createSession',
  'listSessions',
  'getSession',
  'getActiveSessionId',
  'setActiveSession',
  'updateSessionMetadata',
  'openExternalURL',
  'sendUserMessage',
  'respondToPermission',
  'interruptSession',
  'disposeSession',
  'minimizeWindow',
  'toggleWindowMaximized',
  'closeWindow',
  'isWindowMaximized',
  'newWindow',
  'openDevTools',
  'openSettings',
  'logOut',
  'exitApp',
] as const satisfies readonly DesktopApiMethod[]

export function desktopApiChannel(method: DesktopApiMethod): string {
  return `desktop:${method}`
}

export const DESKTOP_AGENT_EVENT_CHANNEL = 'desktop:agent-event'
export const DESKTOP_UI_COMMAND_CHANNEL = 'desktop:ui-command'

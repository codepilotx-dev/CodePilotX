import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../../shared/ipcChannels.js'
import type { DesktopApi, DesktopUpdateStatus } from '../../../shared/types.js'

export function createInvokingDesktopClient(
  invoke: (method: DesktopApiMethod, args: unknown[]) => Promise<unknown>,
  subscribe: <T>(channel: string, callback: (event: T) => void) => () => void,
): DesktopApi {
  const client = {} as DesktopApi
  for (const method of DESKTOP_API_METHODS) {
    client[method] = ((...args: unknown[]) => invoke(method, args)) as never
  }
  client.onAgentEvent = callback =>
    subscribe(DESKTOP_AGENT_EVENT_CHANNEL, callback)
  client.onWorkflowEvent = callback =>
    subscribe(DESKTOP_WORKFLOW_EVENT_CHANNEL, callback)
  client.onUiCommand = callback =>
    subscribe(DESKTOP_UI_COMMAND_CHANNEL, callback)
  client.onSessionStoreChange = callback =>
    subscribe(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, callback)
  client.onDesktopSettingsChange = callback =>
    subscribe(DESKTOP_SETTINGS_CHANGE_CHANNEL, callback)
  client.onUpdateStatusChange = callback =>
    subscribe<DesktopUpdateStatus>(DESKTOP_UPDATE_STATUS_CHANNEL, callback)
  return client
}

import { DESKTOP_API_METHODS } from '../../../shared/ipcChannels.js'
import type { DesktopApi } from '../../../shared/types.js'
import { createBrowserMockDesktopClient } from './browser-mock-client.js'
import { getDefaultLocalStorage } from './environment.js'
import type { DesktopClientEnvironment } from './types.js'

export const DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY =
  'codepilotx.desktop.browserDebugMode'
export const DESKTOP_BROWSER_DEBUG_MODE_EVENT =
  'desktop-browser-debug-mode-change'

export function readDesktopBrowserDebugMode(
  _storage: Storage | undefined = getDefaultLocalStorage(),
): boolean {
  return false
}

export function writeDesktopBrowserDebugMode(
  _storage: Storage | undefined = getDefaultLocalStorage(),
  _enabled: boolean,
): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DESKTOP_BROWSER_DEBUG_MODE_EVENT))
  }
}

export function createSwitchingBrowserDesktopClient(
  environment: DesktopClientEnvironment,
): DesktopApi {
  let mockClient: DesktopApi | null = null
  let debugClient: DesktopApi | null = null

  function currentClient(): DesktopApi {
    if (readDesktopBrowserDebugMode(environment.localStorage)) {
      debugClient ??= createBrowserDebugDesktopClient(environment)
      return debugClient
    }
    mockClient ??= createBrowserMockDesktopClient(environment.localStorage)
    return mockClient
  }

  const client = {} as DesktopApi
  for (const method of DESKTOP_API_METHODS) {
    client[method] = ((...args: unknown[]) => {
      const target = currentClient()[method] as (...methodArgs: unknown[]) => unknown
      return target(...args)
    }) as never
  }
  client.readRuntimeSkill = (...args) =>
    currentClient().readRuntimeSkill(...args)
  client.setRuntimeSkillEnabled = (...args) =>
    currentClient().setRuntimeSkillEnabled(...args)
  client.listProjects = (...args) =>
    currentClient().listProjects(...args)
  client.onAgentEvent = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onAgentEvent(callback),
    )
  client.onWorkflowEvent = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onWorkflowEvent(callback),
    )
  client.onUiCommand = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onUiCommand(callback),
    )
  client.onSessionStoreChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onSessionStoreChange(callback),
    )
  client.onDesktopSettingsChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onDesktopSettingsChange(callback),
    )
  client.onUpdateStatusChange = callback =>
    subscribeWithModeSwitch(environment, () =>
      currentClient().onUpdateStatusChange(callback),
    )
  return client
}

function subscribeWithModeSwitch(
  environment: DesktopClientEnvironment,
  subscribe: () => () => void,
): () => void {
  let unsubscribe = subscribe()
  const targetWindow =
    environment.window ?? (typeof window === 'undefined' ? undefined : window)
  const reconnect = () => {
    unsubscribe()
    unsubscribe = subscribe()
  }
  targetWindow?.addEventListener?.(DESKTOP_BROWSER_DEBUG_MODE_EVENT, reconnect)
  return () => {
    targetWindow?.removeEventListener?.(DESKTOP_BROWSER_DEBUG_MODE_EVENT, reconnect)
    unsubscribe()
  }
}

function createBrowserDebugDesktopClient(
  environment: DesktopClientEnvironment,
): DesktopApi {
  return createBrowserMockDesktopClient(environment.localStorage)
}

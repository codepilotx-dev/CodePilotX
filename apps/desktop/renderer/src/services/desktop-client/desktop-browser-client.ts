import { defaultDesktopClientEnvironment } from './environment.js'
import { createDesktopBrowserClient } from './browser-client-service.js'
export { createDesktopBrowserClient, type DesktopBrowserClient } from './browser-client-service.js'
const environment = defaultDesktopClientEnvironment()
export const desktopBrowserClient = createDesktopBrowserClient(
  environment.window?.codePilotXDesktop,
  typeof document === 'undefined' ? undefined : document,
)

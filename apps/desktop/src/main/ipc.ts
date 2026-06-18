import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  DESKTOP_API_METHODS,
  desktopApiChannel,
  type DesktopApiMethod,
} from '../shared/ipcChannels.js'
import type { DesktopApi } from '../shared/types.js'

export type DesktopApiHandlers = Omit<
  DesktopApi,
  'onAgentEvent' | 'onUiCommand'
>

const WINDOW_CHROME_DEBUG_METHODS = new Set<DesktopApiMethod>([
  'minimizeWindow',
  'toggleWindowMaximized',
  'closeWindow',
  'isWindowMaximized',
  'newWindow',
  'openDevTools',
  'openSettings',
  'logOut',
  'exitApp',
])

export function registerDesktopIpcHandlers(
  handlers: DesktopApiHandlers,
  assertTrustedSender: (senderUrl: string | undefined) => void,
): void {
  for (const method of DESKTOP_API_METHODS) {
    const handler = handlers[method]
    ipcMain.handle(
      desktopApiChannel(method),
      (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        assertTrustedSender(event.senderFrame?.url)
        if (WINDOW_CHROME_DEBUG_METHODS.has(method)) {
          console.log('[desktop-window-chrome-debug]', 'ipc_invoke', {
            method,
            argsCount: args.length,
            senderUrl: event.senderFrame?.url,
          })
        }
        return (handler as (...handlerArgs: unknown[]) => unknown)(...args)
      },
    )
  }
}

export function createDesktopApiHandlers(
  handlers: DesktopApiHandlers,
): DesktopApiHandlers {
  return handlers
}

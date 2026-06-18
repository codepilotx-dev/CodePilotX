import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  DESKTOP_API_METHODS,
  desktopApiChannel,
} from '../shared/ipcChannels.js'
import { validateDesktopApiArgs } from '../shared/desktopApiSchema.js'
import type { DesktopApi } from '../shared/types.js'

export type DesktopApiHandlers = Omit<
  DesktopApi,
  'onAgentEvent' | 'onUiCommand'
>

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
        const parsedArgs = validateDesktopApiArgs(method, args)
        return (handler as (...handlerArgs: unknown[]) => unknown)(
          ...parsedArgs,
        )
      },
    )
  }
}

export function createDesktopApiHandlers(
  handlers: DesktopApiHandlers,
): DesktopApiHandlers {
  return handlers
}

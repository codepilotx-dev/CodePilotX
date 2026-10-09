import type { DesktopTerminalSnapshot } from '@pidex/shared/desktop-terminal-ipc'

export const OPEN_TERMINAL_EVENT = 'codepilotx-open-integrated-terminal'

export type OpenTerminalEventDetail = {
  threadId: string
  snapshot?: DesktopTerminalSnapshot
}

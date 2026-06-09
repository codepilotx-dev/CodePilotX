import { useEffect } from 'react'
import type { DesktopUiCommand } from '../../../shared/types.js'

export type UseDesktopCommandsOptions = {
  onNewConversation: () => void
  onChooseWorkspace: () => void
  onRefreshWorkspace: () => void
}

function routeCommand(
  command: DesktopUiCommand,
  options: UseDesktopCommandsOptions,
): void {
  if (command === 'newConversation') {
    options.onNewConversation()
    return
  }
  if (command === 'chooseWorkspace') {
    options.onChooseWorkspace()
    return
  }
  if (command === 'refreshWorkspace') {
    options.onRefreshWorkspace()
  }
}

export function useDesktopCommands(options: UseDesktopCommandsOptions): void {
  useEffect(() => {
    const unsubscribe = window.desktopApi.onUiCommand(command =>
      routeCommand(command, options),
    )
    return () => {
      unsubscribe()
    }
  }, [options])
}

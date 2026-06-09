import { useEffect } from 'react'
import type { DesktopUiCommand } from '../../../shared/types.js'

export type UseDesktopCommandsOptions = {
  onNewConversation: () => void
  onChooseWorkspace: () => void
  onRefreshWorkspace: () => void
  onOpenSettings: () => void
  onLogOut: () => void
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
    return
  }
  if (command === 'openSettings') {
    options.onOpenSettings()
    return
  }
  if (command === 'logOut') {
    options.onLogOut()
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

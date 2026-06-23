export type LastWorkspaceRestoreState = {
  settingsLoaded: boolean
  isQuickChatPage: boolean
  hasCurrentWorkspace: boolean
  hasAttemptedRestore: boolean
  recentWorkspaceCount: number
}

export function shouldRestoreLastWorkspace(
  state: LastWorkspaceRestoreState,
): boolean {
  return (
    state.settingsLoaded &&
    state.isQuickChatPage &&
    !state.hasCurrentWorkspace &&
    !state.hasAttemptedRestore &&
    state.recentWorkspaceCount > 0
  )
}

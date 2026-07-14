export type {
  DesktopAuthStatus,
  DesktopDrawerTab,
  DesktopStoredSettings,
} from './types.js'
export {
  defaultDesktopStoredSettings,
  DESKTOP_DRAWER_TABS,
  DESKTOP_PERMISSION_MODES,
  DESKTOP_THINKING_MODES,
  isDesktopDrawerTab,
  isDesktopPermissionMode,
  isDesktopThinkingMode,
  isModelProviderID,
  MAX_RECENT_WORKSPACES,
  normalizeDesktopStoredSettings,
  normalizeDesktopWorkspaces,
  upsertRecentWorkspace,
} from './settingsSchema.js'

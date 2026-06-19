export type AppInfo = {
  bundleId: string
  displayName: string
}

export type AppList = Array<{
  requestedName: string
  resolved?: AppInfo
  alreadyGranted?: boolean
}>

export type CoordinateMode = 'pixels' | 'normalized'

export type CuSubGates = {
  pixelValidation: boolean
  clipboardPasteMultiline: boolean
  mouseAnimation: boolean
  hideBeforeAction: boolean
  autoTargetDisplay: boolean
  clipboardGuard: boolean
}

export type ComputerUseEvent = unknown
export type ComputerUseResult = unknown

export type CuPermissionRequest = {
  apps: AppList
  reason?: string
  requestedFlags: Partial<Record<keyof typeof DEFAULT_GRANT_FLAGS, boolean>>
  willHide?: AppInfo[]
  tccState?: {
    accessibility: boolean
    screenRecording: boolean
  }
}

export type CuPermissionResponse = {
  granted: Array<AppInfo & { grantedAt: number }>
  denied: Array<{
    bundleId: string
    reason: 'user_denied' | 'not_installed'
  }>
  flags: typeof DEFAULT_GRANT_FLAGS
}

export type ScreenshotDims = {
  width: number
  height: number
  displayId: number
  originX: number
  originY: number
}

export type ComputerUseSessionContext = {
  [key: string]: any
  getAllowedApps: () => Array<AppInfo & { grantedAt: number }>
  getGrantFlags: () => typeof DEFAULT_GRANT_FLAGS
  getUserDeniedBundleIds: () => string[]
  getSelectedDisplayId: () => number | undefined
  getDisplayPinnedByModel: () => boolean
  getDisplayResolvedForApps: () => unknown
  getLastScreenshotDims: () => ScreenshotDims | undefined
  onPermissionRequest: (
    req: CuPermissionRequest,
    dialogSignal?: AbortSignal,
  ) => Promise<CuPermissionResponse>
  onAllowedAppsChanged: (
    apps: Array<AppInfo & { grantedAt: number }>,
    flags: typeof DEFAULT_GRANT_FLAGS,
  ) => void
  onAppsHidden: (ids: string[]) => void
  onAppsUnhidden: () => void
  onSelectedDisplayChanged: (displayId: number | undefined) => void
  onDisplayPinnedByModelChanged: (pinned: boolean) => void
  onDisplayResolvedForAppsChanged: (value: unknown) => void
  onLastScreenshotDimsChanged: (dims: ScreenshotDims | undefined) => void
  onBeforeAction: () => Promise<void>
  onAfterAction: () => Promise<void>
  formatLockHeldMessage: (holder: string) => string
}

export type CuCallToolResult = {
  content?: Array<
    | { type: 'image'; mimeType?: string; data: string }
    | { type: 'text'; text: string }
    | { type: string }
  >
  telemetry?: {
    error_kind?: string
  }
}

export type ComputerExecutor = {
  capabilities: any
  listInstalledApps: () => Promise<string[]>
}

export type DisplayGeometry = any
export type FrontmostApp = any
export type InstalledApp = any
export type ResolvePrepareCaptureResult = any
export type RunningApp = any
export type ScreenshotResult = any

export type ComputerUseHostAdapter = {
  serverName: string
  logger: Logger
  executor: ComputerExecutor
  ensureOsPermissions: () => Promise<
    | { granted: true }
    | { granted: false; accessibility: boolean; screenRecording: boolean }
  >
  isDisabled: () => boolean
  getSubGates: () => CuSubGates
  getAutoUnhideEnabled: () => boolean
  cropRawPatch: () => null
}

export type Logger = {
  silly: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

export const DEFAULT_GRANT_FLAGS = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
}

const SENTINEL_CATEGORIES: Record<
  string,
  'shell' | 'filesystem' | 'system_settings'
> = {}

export function getSentinelCategory(
  bundleId: string,
): 'shell' | 'filesystem' | 'system_settings' | undefined {
  return SENTINEL_CATEGORIES[bundleId]
}

import type {
  DesktopBrowserSitePermission,
  DesktopStoredSettings,
} from '../shared/types.js'
import { browserSiteKeyForURL } from './browserUrlPolicy.js'

export function upsertBrowserSitePermission(
  current: readonly DesktopBrowserSitePermission[],
  rawURL: string,
  decision: DesktopBrowserSitePermission['decision'],
  updatedAt = new Date().toISOString(),
): DesktopBrowserSitePermission[] {
  const origin = browserSiteKeyForURL(rawURL)
  return [
    {
      origin,
      decision,
      updatedAt,
    },
    ...current.filter(item => item.origin !== origin),
  ]
}

export function browserSitePermissionForURL(
  settings: Pick<DesktopStoredSettings, 'browserSitePermissions'>,
  rawURL: string,
): DesktopBrowserSitePermission | null {
  const origin = browserSiteKeyForURL(rawURL)
  return settings.browserSitePermissions.find(item => item.origin === origin) ?? null
}

import { join, resolve } from "node:path"
import type { DataLocationLaunch } from "../settings/data-location-store.js"

export function resolveDesktopLogDirectory(
  launch: DataLocationLaunch,
  configuredDirectory: string | undefined,
): string {
  const configured = configuredDirectory?.trim()
  if (configured) return resolve(configured)
  const dataDirectory = launch.relocation?.sourceDataDir ?? launch.dataDir
  return resolve(join(dataDirectory, "logs"))
}

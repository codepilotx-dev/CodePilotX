import type { DesktopApiMethod } from './ipcChannels.js'

const undefinedMarkerKey = '__desktopBrowserDebugUndefined'
const undefinedMarker = { [undefinedMarkerKey]: true } as const

const optionalArgumentIndexes: Partial<Record<DesktopApiMethod, readonly number[]>> = {
  openBrowser: [0],
  listSkillsCatalog: [0],
  listSlashCommands: [0],
  startGithubLogin: [0],
  sendUserMessage: [2],
}

export function encodeDesktopBridgeArgs(
  method: DesktopApiMethod,
  args: unknown[],
): unknown[] {
  const optionalIndexes = new Set(optionalArgumentIndexes[method] ?? [])
  return args.map((arg, index) =>
    encodeDesktopBridgeValue(
      arg === null && optionalIndexes.has(index) ? undefined : arg,
    ),
  )
}

export function decodeDesktopBridgeArgs(args: unknown[]): unknown[] {
  return args.map(decodeDesktopBridgeValue)
}

function encodeDesktopBridgeValue(value: unknown): unknown {
  if (value === undefined) return undefinedMarker
  if (Array.isArray(value)) return value.map(encodeDesktopBridgeValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      encodeDesktopBridgeValue(entry),
    ]),
  )
}

function decodeDesktopBridgeValue(value: unknown): unknown {
  if (isUndefinedMarker(value)) return undefined
  if (Array.isArray(value)) return value.map(decodeDesktopBridgeValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      decodeDesktopBridgeValue(entry),
    ]),
  )
}

function isUndefinedMarker(value: unknown): boolean {
  return (
    isRecord(value) &&
    value[undefinedMarkerKey] === true &&
    Object.keys(value).length === 1
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

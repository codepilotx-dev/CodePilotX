export function normalizeOrigin(value: string): string {
  return new URL(value).origin
}

export function isAllowedApplicationUrl(
  value: string,
  allowedApplicationOrigin: string | undefined,
): boolean {
  if (value.startsWith("data:text/html")) return true
  try {
    const target = new URL(value)
    return allowedApplicationOrigin !== undefined
      && target.origin === allowedApplicationOrigin
  } catch {
    return false
  }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

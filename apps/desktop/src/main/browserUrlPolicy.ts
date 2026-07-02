const ALLOWED_BROWSER_PROTOCOLS = new Set(['http:', 'https:'])

export function normalizeBrowserURL(rawURL: string): string {
  const value = rawURL.trim()
  if (!value) {
    throw new Error('Browser URL cannot be empty.')
  }
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    ? value
    : `https://${value}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Browser URL is invalid.')
  }
  if (!ALLOWED_BROWSER_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Only http and https URLs can be opened.')
  }
  return parsed.toString()
}

export function browserSiteKeyForURL(rawURL: string): string {
  const parsed = new URL(normalizeBrowserURL(rawURL))
  return parsed.origin
}

export function isAllowedBrowserURL(rawURL: string): boolean {
  try {
    normalizeBrowserURL(rawURL)
    return true
  } catch {
    return false
  }
}

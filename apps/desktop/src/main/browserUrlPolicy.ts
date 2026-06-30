const ALLOWED_BROWSER_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

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
    throw new Error('Only http, https, and file URLs can be opened.')
  }
  return parsed.toString()
}

export function browserSiteKeyForURL(rawURL: string): string {
  const parsed = new URL(normalizeBrowserURL(rawURL))
  if (parsed.protocol === 'file:') {
    return 'file://'
  }
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

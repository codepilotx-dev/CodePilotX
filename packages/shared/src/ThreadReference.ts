const DEEP_LINK_SCHEME = 'pidex'
// Links created before the rename still resolve, and the Windows installer keeps
// registering the old scheme so existing shortcuts and shared links keep working.
const LEGACY_DEEP_LINK_SCHEME = 'codepilotx'
const DEEP_LINK_HOST = 'threads'
const DEEP_LINK_PREFIXES = [`${DEEP_LINK_SCHEME}://`, `${LEGACY_DEEP_LINK_SCHEME}://`] as const
const DEEP_LINK_AUTHORITY = `${DEEP_LINK_PREFIXES[0]}${DEEP_LINK_HOST}/`

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function buildThreadDeepLink(threadId: string): string {
  if (typeof threadId !== 'string' || threadId.trim() === '') {
    throw new Error('Cannot build a thread deep link from a blank thread id.')
  }
  return `${DEEP_LINK_AUTHORITY}${encodeURIComponent(threadId)}`
}

export function parseThreadDeepLink(value: string): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  const prefix = DEEP_LINK_PREFIXES.find((candidate) => trimmed.startsWith(candidate))
  if (prefix === undefined) {
    return null
  }
  const rest = trimmed.slice(prefix.length)
  const slashIndex = rest.indexOf('/')
  const queryIndex = rest.indexOf('?')
  const hashIndex = rest.indexOf('#')
  let authorityEnd = rest.length
  for (const index of [slashIndex, queryIndex, hashIndex]) {
    if (index !== -1 && index < authorityEnd) {
      authorityEnd = index
    }
  }
  if (authorityEnd === rest.length) {
    return null
  }
  const authority = rest.slice(0, authorityEnd)
  if (authority !== DEEP_LINK_HOST) {
    return null
  }
  const pathWithSlash = rest.slice(authorityEnd)
  if (pathWithSlash[0] !== '/') {
    return null
  }
  const path = pathWithSlash.slice(1)
  if (path === '' || path.includes('/') || path.includes('?') || path.includes('#')) {
    return null
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (encodeURIComponent(decoded) !== path) {
    return null
  }
  return decoded
}

export function resolveThreadReference(value: string): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return parseThreadDeepLink(trimmed)
  }
  return trimmed
}

export type ProviderLogoResponseHeaders = Record<string, string[]>

export const PROVIDER_LOGO_CACHE_CONTROL =
  'public, max-age=604800, stale-while-revalidate=86400'

type HeadersReceivedDetails = {
  url: string
  statusCode: number
  resourceType: string
  responseHeaders?: ProviderLogoResponseHeaders
}

type HeadersReceivedCallback = (response: {
  responseHeaders?: ProviderLogoResponseHeaders
}) => void

type ProviderLogoCacheSession = object & {
  webRequest: {
    onHeadersReceived(
      filter: { urls: string[] },
      listener: (
        details: HeadersReceivedDetails,
        callback: HeadersReceivedCallback,
      ) => void,
    ): void
  }
}

const configuredSessions = new WeakSet<object>()
const PROVIDER_LOGO_CONTENT_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/gif',
  'image/avif',
])

export function registerProviderLogoCachePolicy(
  target: ProviderLogoCacheSession,
): void {
  if (configuredSessions.has(target)) return
  target.webRequest.onHeadersReceived(
    { urls: ['https://models.dev/logos/*'] },
    (details, callback) => {
      if (
        !isProviderLogoRequestUrl(details.url) ||
        details.statusCode < 200 ||
        details.statusCode >= 300 ||
        details.resourceType !== 'image' ||
        !details.responseHeaders ||
        !hasProviderLogoContentType(details.responseHeaders)
      ) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      callback({
        responseHeaders: withProviderLogoCacheHeaders(details.responseHeaders),
      })
    },
  )
  configuredSessions.add(target)
}

function hasProviderLogoContentType(headers: ProviderLogoResponseHeaders): boolean {
  for (const [name, values] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'content-type') continue
    return values.some(value =>
      PROVIDER_LOGO_CONTENT_TYPES.has(value.split(';', 1)[0]!.trim().toLowerCase()),
    )
  }
  return false
}

export function isProviderLogoRequestUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'models.dev' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith('/logos/') &&
      url.pathname.length > '/logos/'.length
    )
  } catch {
    return false
  }
}

export function withProviderLogoCacheHeaders(
  headers: ProviderLogoResponseHeaders,
): ProviderLogoResponseHeaders {
  const nextHeaders: ProviderLogoResponseHeaders = {}
  for (const [name, values] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (
      lowerName === 'cache-control' ||
      lowerName === 'pragma' ||
      lowerName === 'expires'
    ) {
      continue
    }
    nextHeaders[name] = values
  }
  nextHeaders['Cache-Control'] = [PROVIDER_LOGO_CACHE_CONTROL]
  return nextHeaders
}

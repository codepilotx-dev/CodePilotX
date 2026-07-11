import { describe, expect, test } from 'bun:test'
import {
  isProviderLogoRequestUrl,
  PROVIDER_LOGO_CACHE_CONTROL,
  registerProviderLogoCachePolicy,
  withProviderLogoCacheHeaders,
} from './providerLogoCachePolicy.js'

describe('provider logo cache policy', () => {
  test('only allows HTTPS models.dev logo paths', () => {
    expect(isProviderLogoRequestUrl('https://models.dev/logos/openai.svg')).toBe(true)
    expect(isProviderLogoRequestUrl('http://models.dev/logos/openai.svg')).toBe(false)
    expect(isProviderLogoRequestUrl('https://models.dev/api.json')).toBe(false)
    expect(isProviderLogoRequestUrl('https://evil.example/logos/openai.svg')).toBe(false)
    expect(isProviderLogoRequestUrl('not a URL')).toBe(false)
  })

  test('replaces conflicting cache headers and preserves unrelated headers', () => {
    expect(
      withProviderLogoCacheHeaders({
        'Content-Type': ['image/svg+xml'],
        'cache-control': ['no-cache'],
        Pragma: ['no-cache'],
        Expires: ['0'],
        ETag: ['logo-v1'],
      }),
    ).toEqual({
      'Content-Type': ['image/svg+xml'],
      ETag: ['logo-v1'],
      'Cache-Control': [
        'public, max-age=604800, stale-while-revalidate=86400',
      ],
    })
  })

  test('registers the session listener only once', () => {
    let registrations = 0
    let filter: { urls: string[] } | undefined
    let listener:
      | ((
          details: {
            url: string
            statusCode: number
            resourceType: string
            responseHeaders?: Record<string, string[]>
          },
          callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
        ) => void)
      | undefined
    const target = {
      webRequest: {
        onHeadersReceived: (nextFilter: { urls: string[] }, nextListener: typeof listener) => {
          registrations += 1
          filter = nextFilter
          listener = nextListener
        },
      },
    }

    registerProviderLogoCachePolicy(target)
    registerProviderLogoCachePolicy(target)

    expect(registrations).toBe(1)
    expect(filter).toEqual({ urls: ['https://models.dev/logos/*'] })

    const invoke = (details: Parameters<NonNullable<typeof listener>>[0]) => {
      let result: { responseHeaders?: Record<string, string[]> } | undefined
      listener!(details, response => {
        result = response
      })
      return result
    }
    const imageHeaders = {
      'content-type': ['image/svg+xml; charset=utf-8'],
      'cache-control': ['no-cache'],
    }
    expect(
      invoke({
        url: 'https://models.dev/logos/openai.svg',
        statusCode: 200,
        resourceType: 'image',
        responseHeaders: imageHeaders,
      }),
    ).toEqual({
      responseHeaders: {
        'content-type': ['image/svg+xml; charset=utf-8'],
        'Cache-Control': [PROVIDER_LOGO_CACHE_CONTROL],
      },
    })
    for (const details of [
      {
        url: 'https://evil.example/logos/openai.svg',
        statusCode: 200,
        resourceType: 'image',
        responseHeaders: imageHeaders,
      },
      {
        url: 'https://models.dev/logos/missing.svg',
        statusCode: 404,
        resourceType: 'image',
        responseHeaders: imageHeaders,
      },
      {
        url: 'https://models.dev/logos/openai.svg',
        statusCode: 200,
        resourceType: 'image',
        responseHeaders: { 'Content-Type': ['text/html'] },
      },
      {
        url: 'https://models.dev/logos/openai.svg',
        statusCode: 200,
        resourceType: 'xhr',
        responseHeaders: imageHeaders,
      },
      {
        url: 'https://models.dev/logos/openai.svg',
        statusCode: 200,
        resourceType: 'image',
      },
    ]) {
      expect(invoke(details)).toEqual({ responseHeaders: details.responseHeaders })
    }
  })

  test('allows registration to retry after the Electron listener throws', () => {
    let attempts = 0
    const target = {
      webRequest: {
        onHeadersReceived: () => {
          attempts += 1
          if (attempts === 1) throw new Error('listener slot unavailable')
        },
      },
    }

    expect(() => registerProviderLogoCachePolicy(target)).toThrow()
    registerProviderLogoCachePolicy(target)

    expect(attempts).toBe(2)
  })
})

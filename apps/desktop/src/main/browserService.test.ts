import { describe, expect, test } from 'bun:test'
import {
  browserSiteKeyForURL,
  normalizeBrowserURL,
} from './browserUrlPolicy.js'
import { upsertBrowserSitePermission } from './browserSitePermissions.js'
import {
  mergeDesktopBrowserAllowedSites,
  normalizeDesktopStoredSettings,
} from '../shared/settingsSchema.js'

describe('normalizeBrowserURL', () => {
  test('allows http, https, and file URLs', () => {
    expect(normalizeBrowserURL('http://localhost:3000/settings')).toBe(
      'http://localhost:3000/settings',
    )
    expect(normalizeBrowserURL('https://example.com/page')).toBe(
      'https://example.com/page',
    )
    expect(normalizeBrowserURL('file:///C:/preview/index.html')).toBe(
      'file:///C:/preview/index.html',
    )
  })

  test('adds https to host-like input', () => {
    expect(normalizeBrowserURL('example.com/docs')).toBe(
      'https://example.com/docs',
    )
  })

  test('rejects unsupported protocols', () => {
    expect(() => normalizeBrowserURL('javascript:alert(1)')).toThrow(
      'Only http, https, and file URLs can be opened.',
    )
  })
})

describe('browserSiteKeyForURL', () => {
  test('normalizes web origins and file URLs for allow lists', () => {
    expect(browserSiteKeyForURL('https://example.com/path')).toBe(
      'https://example.com',
    )
    expect(browserSiteKeyForURL('http://localhost:5173/page')).toBe(
      'http://localhost:5173',
    )
    expect(browserSiteKeyForURL('file:///C:/preview/index.html')).toBe(
      'file://',
    )
  })
})

describe('mergeDesktopBrowserAllowedSites', () => {
  test('preserves sites recorded by the browser service during settings saves', () => {
    expect(
      mergeDesktopBrowserAllowedSites(
        ['https://example.com', 'file://'],
        ['https://example.com', 'http://localhost:5173'],
      ),
    ).toEqual([
      'https://example.com',
      'file://',
      'http://localhost:5173',
    ])
  })
})

describe('browser site permissions', () => {
  test('migrates legacy browserAllowedSites into allow permissions', () => {
    const settings = normalizeDesktopStoredSettings({
      browserAllowedSites: ['https://example.com', 'file://'],
    })

    expect(settings.browserSitePermissions).toEqual([
      {
        origin: 'https://example.com',
        decision: 'allow',
        updatedAt: '',
      },
      {
        origin: 'file://',
        decision: 'allow',
        updatedAt: '',
      },
    ])
  })

  test('normalizes explicit allow and deny permissions', () => {
    const settings = normalizeDesktopStoredSettings({
      browserAllowedSites: ['https://legacy.example'],
      browserSitePermissions: [
        {
          origin: 'https://example.com/path',
          decision: 'deny',
          updatedAt: '2026-06-30T00:00:00.000Z',
        },
        {
          origin: 'javascript:alert(1)',
          decision: 'allow',
          updatedAt: 'bad',
        },
      ],
    })

    expect(settings.browserSitePermissions).toEqual([
      {
        origin: 'https://example.com',
        decision: 'deny',
        updatedAt: '2026-06-30T00:00:00.000Z',
      },
    ])
  })

  test('upserts a browser site permission by origin', () => {
    expect(
      upsertBrowserSitePermission(
        [
          {
            origin: 'https://example.com',
            decision: 'deny',
            updatedAt: 'old',
          },
        ],
        'https://example.com/path',
        'allow',
        'now',
      ),
    ).toEqual([
      {
        origin: 'https://example.com',
        decision: 'allow',
        updatedAt: 'now',
      },
    ])
  })
})

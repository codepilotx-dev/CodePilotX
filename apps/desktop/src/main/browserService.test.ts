import { describe, expect, test } from 'bun:test'
import {
  browserSiteKeyForURL,
  normalizeBrowserURL,
} from './browserUrlPolicy.js'
import { mergeDesktopBrowserAllowedSites } from '../shared/settingsSchema.js'

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

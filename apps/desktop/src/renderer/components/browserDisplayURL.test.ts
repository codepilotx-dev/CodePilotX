import { describe, expect, test } from 'bun:test'
import { formatBrowserDisplayURL } from './browserDisplayURL.js'

describe('formatBrowserDisplayURL', () => {
  test('removes http and https protocols for compact display', () => {
    expect(formatBrowserDisplayURL('http://localhost:3000/plan')).toBe(
      'localhost:3000/plan',
    )
    expect(formatBrowserDisplayURL('https://example.com/docs')).toBe(
      'example.com/docs',
    )
  })

  test('keeps file URLs fully qualified', () => {
    expect(formatBrowserDisplayURL('file:///C:/preview/index.html')).toBe(
      'file:///C:/preview/index.html',
    )
  })
})

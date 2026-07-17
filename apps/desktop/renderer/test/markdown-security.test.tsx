import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderSafeHtml } from '../src/features/markdown/safeHtml.js'

const actions = {
  openExternal: () => undefined,
  openFile: () => undefined,
}

describe('basic Markdown HTML safety', () => {
  test('keeps only the basic formatting allowlist and strips attributes', () => {
    const html = renderToStaticMarkup(
      renderSafeHtml(
        '<strong onclick="alert(1)" style="color:red">safe</strong><a href="https://example.com">link</a>',
        'test',
        actions,
      ),
    )

    expect(html).toBe('<strong>safe</strong>link')
  })

  test('drops executable element bodies', () => {
    const html = renderToStaticMarkup(
      renderSafeHtml(
        '<script>alert(1)</script><style>body{display:none}</style><em>ok</em>',
        'test',
        actions,
      ),
    )

    expect(html).toBe('<em>ok</em>')
  })
})

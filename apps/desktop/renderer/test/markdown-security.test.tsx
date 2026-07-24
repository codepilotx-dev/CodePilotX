import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderSafeHtml } from '../src/features/markdown/safeHtml.js'
import { MarkdownMessage } from '../src/features/markdown/MarkdownMessage.js'

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

describe('Markdown code comments', () => {
  test('renders a file-target button instead of an unknown directive block', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        text={'::code-comment{title="空值处理" body="建议提前返回" file="src/main.ts" start=12 priority=2}\n'}
        onOpenFileReference={() => undefined}
      />,
    )

    expect(html).toContain('data-md-directive="code-comment"')
    expect(html).toContain('<button')
    expect(html).toContain('src/main.ts:12')
    expect(html).not.toContain('md-directive-unknown')
  })
})

describe('Markdown file references', () => {
  test('renders inline file paths as accessible file references instead of code pills', () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage cwd="C:\\repo" text={'`src/main.ts`'} />,
    )

    expect(html).toContain('data-file-reference=""')
    expect(html).toContain('role="button"')
    expect(html).toContain('md-file-reference__icon')
    expect(html).toContain('md-file-reference__label')
    expect(html).toContain('src/main.ts')
    expect(html).not.toContain('<code>')
  })
})

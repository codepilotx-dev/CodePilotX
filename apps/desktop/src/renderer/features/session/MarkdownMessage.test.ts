import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from './MarkdownMessage.js'

const source = readFileSync(
  fileURLToPath(new URL('./MarkdownMessage.tsx', import.meta.url)),
  'utf8',
)

test('renders safe inline svg copy and success icons without react-dom/server', () => {
  const html = renderMarkdown('```ts\nconst value = 1\n```', false)

  expect(source).not.toContain('react-dom/server')
  expect(html).toContain('class="md-code-copy-default"')
  expect(html).toContain('class="md-code-copy-done"')
  expect(html.match(/<svg/g)).toHaveLength(2)
  expect(html).toContain('width="14"')
  expect(html).toContain('stroke-width="2"')
  expect(html).toContain('data-md-copy')
})

test('sanitizes script tags and javascript links while preserving copied code text', () => {
  const html = renderMarkdown(
    '[unsafe](javascript:alert(1))<script>alert(2)</script>\n\n```html\n<div>safe</div>\n```',
    false,
  )

  expect(html).not.toContain('<script')
  expect(html).not.toContain('javascript:')
  expect(html).toContain('data-md-code-text="&lt;div&gt;safe&lt;\\/div&gt;')
})

test('removes untrusted markdown copy buttons while keeping generated code copy controls', () => {
  const html = renderMarkdown(
    '<button class="md-code-copy" data-md-copy data-md-code-text="attacker">copy</button>\n\n```ts\ntrusted()\n```',
    false,
  )

  expect(html).not.toContain('attacker')
  expect(html).not.toContain('>copy</button>')
  expect(html.match(/data-md-copy/g)).toHaveLength(1)
  expect(html).toContain('data-md-code-text="trusted()')
})

test('preserves replacement-pattern characters in copied code attributes', () => {
  for (const [code, escapedCode] of [
    ['$&', '$&amp;'],
    ['$$', '$$'],
    ['$`', '$`'],
  ]) {
    const html = renderMarkdown(`\`\`\`text\n${code}\n\`\`\``, false)

    expect(html).toContain(`data-md-code-text="${escapedCode}"`)
  }
})

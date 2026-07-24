import { describe, expect, test } from 'bun:test'
import type { Tokens } from 'marked'
import {
  classifyMarkdownTarget,
  lexMarkdown,
  parseMarkdown,
  parseMarkdownFileReference,
  segmentStreamingMarkdown,
} from '../src/features/markdown/index.js'
import type {
  MarkdownDirectiveToken,
  MarkdownMathToken,
} from '../src/features/markdown/types.js'

describe('markdown parser', () => {
  test('enables GFM and treats a soft line break as a rendered break', () => {
    const [paragraph] = lexMarkdown('first\nsecond')
    expect(paragraph?.type).toBe('paragraph')
    expect(
      (paragraph as Tokens.Paragraph).tokens.map(token => token.type),
    ).toEqual(['text', 'br', 'text'])

    const [table] = lexMarkdown('| A | B |\n| - | - |\n| 1 | 2 |')
    expect(table?.type).toBe('table')
  })

  test('emits structural inline and display math tokens', () => {
    const [paragraph, , displayMath] = lexMarkdown(
      'Value is $x + y$.\n\n$$\nE = mc^2\n$$\n',
    )
    const inlineMath = (paragraph as Tokens.Paragraph).tokens.find(
      token => token.type === 'math',
    ) as unknown as MarkdownMathToken
    expect(inlineMath).toMatchObject({
      display: false,
      text: 'x + y',
      type: 'math',
    })
    expect(displayMath).toMatchObject({
      display: true,
      text: 'E = mc^2',
      type: 'math',
    })

    const [latexParagraph] = lexMarkdown(
      'Inline \\(a + b\\) and display \\[c + d\\].',
    )
    const latexMath = (latexParagraph as Tokens.Paragraph).tokens.filter(
      token => token.type === 'math',
    ) as unknown as MarkdownMathToken[]
    expect(latexMath.map(token => [token.display, token.text])).toEqual([
      [false, 'a + b'],
      [true, 'c + d'],
    ])
  })

  test('parses registered directive-shaped blocks without interpreting raw HTML', () => {
    const [directive] = lexMarkdown(
      ':::warning Check this\n**Careful**\n:::\n',
    )
    expect(directive).toMatchObject({
      argument: 'Check this',
      name: 'warning',
      text: '**Careful**\n',
      type: 'directive',
    })
    expect((directive as MarkdownDirectiveToken).tokens[0]?.type).toBe(
      'paragraph',
    )

    const [leaf, inline] = lexMarkdown(':badge ready\n::mention user\n')
    expect(leaf).toMatchObject({
      argument: 'ready',
      name: 'badge',
      type: 'directive',
    })
    expect(inline).toMatchObject({
      argument: 'user',
      name: 'mention',
      type: 'directive',
    })
  })

  test('parses code-comment directive attributes without treating it as prose', () => {
    const [directive] = lexMarkdown(
      '::code-comment{title="空值处理" body="这里可能抛错，建议提前返回。" file="src/main.ts" start=12 end=14 priority=2}\n',
    )

    expect(directive).toMatchObject({
      type: 'directive',
      name: 'code-comment',
      argument: '',
      attributes: {
        title: '空值处理',
        body: '这里可能抛错，建议提前返回。',
        file: 'src/main.ts',
        start: '12',
        end: '14',
        priority: '2',
      },
    })
  })

  test('keeps completed streaming prefixes separate from pending prose', () => {
    expect(segmentStreamingMarkdown('done\n\npending')).toEqual({
      kind: 'text',
      stableText: 'done\n\n',
      pendingText: 'pending',
    })
    const result = parseMarkdown('done\n\npending', true)
    expect(result.stableText).toBe('done\n\n')
    expect(result.pendingText).toBe('pending')
    expect(result.tokens.map(token => token.type)).toEqual([
      'paragraph',
      'space',
      'paragraph',
    ])
  })
})

describe('streaming fenced code', () => {
  test('recognizes an unclosed backtick fence and preserves its code', () => {
    expect(segmentStreamingMarkdown('intro\n\n```ts\nconst value = 1')).toEqual({
      kind: 'code',
      stableText: 'intro\n\n',
      pendingText: '```ts\nconst value = 1',
      language: 'ts',
      code: 'const value = 1',
      marker: '```',
    })
  })

  test('recognizes tilde fences and a closing fence at least as long as opener', () => {
    expect(segmentStreamingMarkdown('~~~python\nprint(1)')).toMatchObject({
      kind: 'code',
      language: 'python',
      marker: '~~~',
    })
    expect(segmentStreamingMarkdown('~~~python\nprint(1)\n~~~~\n')).toEqual({
      kind: 'complete',
      stableText: '~~~python\nprint(1)\n~~~~\n',
      pendingText: '',
    })
  })

  test('does not close a fence with the other marker character', () => {
    expect(segmentStreamingMarkdown('```text\nvalue\n~~~\n')).toMatchObject({
      kind: 'code',
      marker: '```',
      code: 'value\n~~~\n',
    })
  })
})

describe('safe markdown targets', () => {
  test('routes web URLs, file references, and anchors through distinct paths', () => {
    expect(classifyMarkdownTarget('https://example.com/a')).toMatchObject({
      kind: 'external',
    })
    expect(classifyMarkdownTarget('C:\\repo\\file.ts:42')).toEqual({
      kind: 'file',
      path: 'C:\\repo\\file.ts',
      line: 42,
    })
    expect(classifyMarkdownTarget('./src/file.ts#L10-L12')).toEqual({
      kind: 'file',
      path: './src/file.ts',
      line: 10,
      endLine: 12,
    })
    expect(classifyMarkdownTarget('src/file.ts#L10-L12')).toEqual({
      kind: 'file',
      path: 'src/file.ts',
      line: 10,
      endLine: 12,
    })
    expect(classifyMarkdownTarget('#section')).toEqual({
      kind: 'anchor',
      href: '#section',
    })
  })

  test('preserves line, column, and range locations on file references', () => {
    expect(parseMarkdownFileReference('src/file.ts:10:4')).toEqual({
      path: 'src/file.ts',
      line: 10,
      column: 4,
    })
    expect(parseMarkdownFileReference('C:\\repo\\file.ts#L10C4-L20C8')).toEqual({
      path: 'C:\\repo\\file.ts',
      line: 10,
      column: 4,
      endLine: 20,
      endColumn: 8,
    })
    expect(
      classifyMarkdownTarget('file:///C:/repo/file.ts#L7-L9'),
    ).toEqual({
      kind: 'file',
      path: 'C:/repo/file.ts',
      line: 7,
      endLine: 9,
    })
  })

  test('rejects executable and embedded-data schemes', () => {
    expect(classifyMarkdownTarget('javascript:alert(1)')).toEqual({
      kind: 'unsafe',
    })
    expect(classifyMarkdownTarget('data:text/html,hello')).toEqual({
      kind: 'unsafe',
    })
    expect(classifyMarkdownTarget('http://example.com')).toEqual({
      kind: 'unsafe',
    })
  })
})

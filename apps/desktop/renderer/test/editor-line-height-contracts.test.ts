import { describe, expect, test } from 'bun:test'

import { codeEditorLineHeight } from '../src/features/editor/codeMirrorTheme.js'
import { markdownRichThemeSpec } from '../src/features/editor/markdownRichExtensions.js'

describe('editor line-height contracts', () => {
  test('CodeMirror keeps the shared code density ratio with explicit pixels', () => {
    expect(codeEditorLineHeight(8)).toBe(12)
    expect(codeEditorLineHeight(12)).toBe(19)
    expect(codeEditorLineHeight(14)).toBe(22)
    expect(codeEditorLineHeight(24)).toBe(37)
  })

  test('rich Markdown uses the semantic type tokens for body and headings', () => {
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line'].lineHeight,
    ).toBe('var(--cpx-sys-line-height-normal)')
    expect(markdownRichThemeSpec['&.cm-markdown-rich .cm-md-rich-h1']).toEqual(
      {
        fontSize: 'var(--cpx-sys-font-size-3xl)',
        lineHeight: 'var(--cpx-sys-line-height-relaxed)',
      },
    )
    expect(markdownRichThemeSpec['&.cm-markdown-rich .cm-md-rich-h2']).toEqual(
      {
        fontSize: 'var(--cpx-sys-font-size-2xl)',
        lineHeight: 'var(--cpx-sys-line-height-relaxed)',
      },
    )
    expect(markdownRichThemeSpec['&.cm-markdown-rich .cm-md-rich-h3']).toEqual(
      {
        fontSize: 'var(--cpx-sys-font-size-xl)',
        lineHeight: 'var(--cpx-sys-line-height-relaxed)',
      },
    )
    expect(
      markdownRichThemeSpec[
        '&.cm-markdown-rich .cm-md-rich-h4, &.cm-markdown-rich .cm-md-rich-h5, &.cm-markdown-rich .cm-md-rich-h6'
      ],
    ).toEqual({
      fontSize: 'var(--cpx-sys-font-size-md)',
      lineHeight: 'var(--cpx-sys-line-height-normal)',
    })
  })

  test('rich Markdown code blocks keep the shared code line token', () => {
    const codeBlock =
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line.cm-md-rich-code-block']
    expect(codeBlock.fontSize).toBe('var(--cpx-sys-font-size-code)')
    expect(codeBlock.lineHeight).toBe('var(--cpx-sys-line-height-code)')
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-md-rich-code-block-widget'],
    ).toEqual({
      display: 'block',
      boxSizing: 'border-box',
      margin: '14px 0',
    })
    expect(
      markdownRichThemeSpec[
        '&.cm-markdown-rich .cm-md-rich-code-block-widget .md-code-block'
      ],
    ).toEqual({
      margin: '0',
    })
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line.cm-md-rich-horizontal-rule'],
    ).toEqual({
      minHeight: '1lh',
      borderTop: '1px solid var(--cpx-sys-color-border-default)',
      color: 'transparent',
      transform: 'translateY(0.5lh)',
    })
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line.cm-md-rich-alert'],
    ).toEqual({
      boxSizing: 'border-box',
      borderLeft: '3.5px solid var(--cpx-sys-color-border-default)',
      paddingLeft: '12px',
      color: 'var(--cpx-sys-color-fg-primary)',
    })
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line.cm-md-rich-alert--important'],
    ).toEqual({
      borderLeftColor: '#a855f7',
      background: 'color-mix(in srgb, #a855f7 6%, transparent)',
    })
    // List items no longer add padding on top of the semantic line height.
    expect(
      markdownRichThemeSpec['&.cm-markdown-rich .cm-line.cm-md-rich-list-item'],
    ).toBeUndefined()
  })
})

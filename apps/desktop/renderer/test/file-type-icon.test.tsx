import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTypeIcon } from '../src/features/layout/FileTypeIcon.js'

describe('FileTypeIcon', () => {
  test('renders a local currentColor glyph without text for a known type', () => {
    const html = renderToStaticMarkup(
      <FileTypeIcon
        aria-hidden="true"
        className="fixture-icon"
        path="C:\\repo\\src\\Component.tsx"
        size={14}
        strokeWidth={9}
      />,
    )

    expect(html).toContain('data-file-icon-kind="react"')
    expect(html).toContain('class="file-type-icon file-type-icon--react fixture-icon"')
    expect(html).toContain('height="14"')
    expect(html).toContain('width="14"')
    expect(html).toContain('currentColor')
    expect(html).not.toContain('<text')
    expect(html).not.toContain('stroke-width="9"')
    expect(html).not.toContain('absoluteStrokeWidth')
  })

  test('keeps Lucide as the fallback for unknown and extensionless files', () => {
    const unknown = renderToStaticMarkup(
      <FileTypeIcon path="/repo/source.unknown" size={16} />,
    )
    const extensionless = renderToStaticMarkup(
      <FileTypeIcon path="/repo/LICENSE-CUSTOM" size={16} />,
    )

    expect(unknown).toContain('data-file-icon-kind="code"')
    expect(unknown).toContain('lucide-file-code2')
    expect(extensionless).toContain('data-file-icon-kind="file"')
    expect(extensionless).toContain('lucide-file')
  })

  test('renders special file names with their dedicated glyph', () => {
    const skill = renderToStaticMarkup(
      <FileTypeIcon path="/repo/SKILL.md" />,
    )
    const build = renderToStaticMarkup(
      <FileTypeIcon path="/repo/package.json" />,
    )

    expect(skill).toContain('data-file-icon-kind="skill"')
    expect(build).toContain('data-file-icon-kind="build"')
  })
})

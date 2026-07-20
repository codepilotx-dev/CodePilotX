import type React from 'react'
import type { LucideProps } from 'lucide-react'
import { File, FileCode2 } from 'lucide-react'
import { FileIconGlyph } from './fileIconGlyphs.js'
import { resolveFileIconKind } from './fileIconKind.js'

export type FileTypeIconProps = LucideProps & {
  path?: string | null
}

export function FileTypeIcon({
  path,
  ...props
}: FileTypeIconProps): React.ReactNode {
  const kind = resolveFileIconKind(path)
  if (kind === 'file' || kind === 'code') {
    const Icon = kind === 'code' ? FileCode2 : File
    const className = `file-type-icon file-type-icon--${kind}${
      props.className ? ` ${props.className}` : ''
    }`
    return (
      <Icon
        {...props}
        className={className}
        data-file-icon-kind={kind}
      />
    )
  }

  const {
    size = 16,
    strokeWidth: _strokeWidth,
    absoluteStrokeWidth: _absoluteStrokeWidth,
    className,
    ...svgProps
  } = props
  return (
    <FileIconGlyph
      {...svgProps}
      className={className}
      focusable="false"
      kind={kind}
      size={size}
    />
  )
}

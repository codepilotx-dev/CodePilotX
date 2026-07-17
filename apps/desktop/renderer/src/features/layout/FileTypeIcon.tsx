import type React from 'react'
import type { LucideProps } from 'lucide-react'
import {
  Atom,
  Database,
  File,
  FileCode2,
  FileText,
  Image,
} from 'lucide-react'

export type FileTypeIconProps = LucideProps & {
  path?: string | null
}

export function FileTypeIcon({
  path,
  ...props
}: FileTypeIconProps): React.ReactNode {
  const extension = path
    ?.replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.split('.')
    .pop()
    ?.toLowerCase()
  const badge = getFileTypeBadge(extension)
  if (badge) {
    const {
      size = 16,
      strokeWidth: _strokeWidth,
      absoluteStrokeWidth: _absoluteStrokeWidth,
      className,
      ...svgProps
    } = props
    return (
      <svg
        {...svgProps}
        className={`file-type-icon file-type-icon--${badge.kind}${className ? ` ${className}` : ''}`}
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <rect
          fill="currentColor"
          fillOpacity="0.16"
          height="14"
          rx="3"
          width="14"
          x="1"
          y="1"
        />
        <text
          fill="currentColor"
          fontFamily="var(--font-family-mono)"
          fontSize={badge.label.length > 2 ? 5.2 : 6.2}
          fontWeight="700"
          textAnchor="middle"
          x="8"
          y="10.4"
        >
          {badge.label}
        </text>
      </svg>
    )
  }
  const Icon =
    extension === 'tsx' || extension === 'jsx'
      ? Atom
      : extension === 'md' ||
            extension === 'mdx' ||
            extension === 'txt' ||
            extension === 'log'
          ? FileText
          : extension === 'png' ||
              extension === 'jpg' ||
              extension === 'jpeg' ||
              extension === 'gif' ||
              extension === 'svg' ||
              extension === 'webp'
            ? Image
            : extension === 'db' ||
                extension === 'sqlite' ||
                extension === 'sqlite3' ||
                extension === 'sql'
              ? Database
              : extension
                ? FileCode2
                : File
  return <Icon {...props} />
}

function getFileTypeBadge(
  extension: string | undefined,
): { kind: string; label: string } | null {
  if (extension === 'ts') return { kind: 'typescript', label: 'TS' }
  if (extension === 'js') return { kind: 'javascript', label: 'JS' }
  if (extension === 'json' || extension === 'jsonc') {
    return { kind: 'json', label: '{}' }
  }
  if (extension === 'md' || extension === 'mdx') {
    return { kind: 'markdown', label: 'MD' }
  }
  if (extension === 'css' || extension === 'scss' || extension === 'sass') {
    return { kind: 'css', label: 'CSS' }
  }
  if (extension === 'html' || extension === 'htm') {
    return { kind: 'html', label: '<>' }
  }
  if (extension === 'rs') return { kind: 'rust', label: 'RS' }
  return null
}

import type React from 'react'
import { lazy, Suspense } from 'react'
import { File, Folder, type LucideProps } from 'lucide-react'

const MaterialFileIcon = lazy(() =>
  import('@codepilotx/material-icon-theme').then(module => ({
    default: module.FileIcon,
  })),
)

const MaterialFolderIcon = lazy(() =>
  import('@codepilotx/material-icon-theme').then(module => ({
    default: module.FolderIcon,
  })),
)

export type FileTypeIconProps = LucideProps & {
  associationMode?: 'extension-only'
  path?: string | null
}

export function FileTypeIcon({
  path,
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...iconProps
}: FileTypeIconProps): React.ReactNode {
  return (
    <Suspense fallback={<File {...iconProps} />}>
      <MaterialFileIcon {...iconProps} path={path} />
    </Suspense>
  )
}

export type FolderTypeIconProps = LucideProps & {
  expanded?: boolean
  path?: string | null
}

export function FolderTypeIcon({
  path,
  expanded,
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...iconProps
}: FolderTypeIconProps): React.ReactNode {
  return (
    <Suspense fallback={<Folder {...iconProps} />}>
      <MaterialFolderIcon {...iconProps} expanded={expanded} path={path} />
    </Suspense>
  )
}

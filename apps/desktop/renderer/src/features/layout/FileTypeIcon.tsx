import type React from 'react'
import { lazy, Suspense } from 'react'
import { File, type LucideProps } from 'lucide-react'

const MaterialFileIcon = lazy(() =>
  import('@codepilotx/material-icon-theme').then(module => ({
    default: module.FileIcon,
  })),
)

export type FileTypeIconProps = LucideProps & {
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

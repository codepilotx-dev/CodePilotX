import type React from 'react'
import { FileIcon } from '@codepilotx/material-icon-theme'
import type { LucideProps } from 'lucide-react'

export type FileTypeIconProps = LucideProps & {
  path?: string | null
}

export function FileTypeIcon({
  path,
  strokeWidth: _strokeWidth,
  absoluteStrokeWidth: _absoluteStrokeWidth,
  ...iconProps
}: FileTypeIconProps): React.ReactNode {
  return <FileIcon {...iconProps} path={path} />
}

import type React from 'react'
import { ScrollArea } from '../../components/ui/ScrollArea.js'

type Props = {
  children: React.ReactNode
  className?: string
}

export function SettingsContentArea({
  children,
  className = '',
}: Props): React.ReactNode {
  return (
    <ScrollArea
      className={`settings-content-scroll-area tw:min-h-0 tw:min-w-0 tw:flex-1 tw:bg-app-canvas ${className}`.trim()}
      contentClassName="settings-content-scroll-content tw:min-w-0"
    >
      {children}
    </ScrollArea>
  )
}

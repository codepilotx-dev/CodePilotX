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
    <ScrollArea className={`settings-content-area ${className}`.trim()}>
      {children}
    </ScrollArea>
  )
}

import type React from 'react'
import { Bot, Minus, Square, X } from 'lucide-react'
import { IconButton } from './ui/IconButton.js'

type Props = {
  title: string
  isMaximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function WindowChrome({
  title,
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: Props): React.ReactNode {
  return (
    <div className="window-chrome">
      <div className="window-titlebar">
        <div className="window-titlebar-drag">
          <span className="window-app-mark" aria-hidden="true">
            <Bot size={16} strokeWidth={1.9} />
          </span>
          <span className="window-title">{title}</span>
        </div>

        <div className="window-controls">
          <IconButton
            className="window-control-button"
            onClick={onMinimize}
            title="最小化"
          >
            <Minus size={14} strokeWidth={2} />
          </IconButton>
          <IconButton
            className="window-control-button"
            onClick={onToggleMaximize}
            title={isMaximized ? '还原' : '最大化'}
          >
            <Square size={13} strokeWidth={1.9} />
          </IconButton>
          <IconButton
            className="window-control-button close"
            onClick={onClose}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

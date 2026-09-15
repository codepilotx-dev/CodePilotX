import type React from 'react'
import { memo } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { IconButton } from '../../../components/ui/IconButton.js'

export interface AuxiliaryTitlebarProps {
  title: string
  icon?: React.ReactNode
  onDockBack: () => void
}

export const AuxiliaryTitlebar = memo(function AuxiliaryTitlebar({
  title,
  icon,
  onDockBack,
}: AuxiliaryTitlebarProps): React.ReactNode {
  return (
    <header className="auxiliary-titlebar">
      {/* 标题与图标区域 */}
      <div className="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
        {icon && (
          <span className="tw:text-app-text-muted tw:flex tw:items-center tw:shrink-0">
            {icon}
          </span>
        )}
        <span className="u-type-control tw:text-app-text-primary tw:truncate">
          {title}
        </span>
      </div>

      {/* 操作按钮区域：右侧预留 Windows 原生控制按钮间隙 */}
      <div className="tw:flex tw:items-center tw:gap-1">
        <IconButton
          aria-label="停靠回主窗口"
          color="ghostSecondary"
          onClick={onDockBack}
          size="toolbar"
          title="停靠回主窗口"
        >
          <ArrowDownToLine size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </IconButton>
        <div aria-hidden="true" className="auxiliary-window-controls-spacer" />
      </div>
    </header>
  )
})

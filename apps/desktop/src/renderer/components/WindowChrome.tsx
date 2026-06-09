import type React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react'
import { IconButton } from './ui/IconButton.js'

type Props = {
  sidebarCollapsed: boolean
  isMaximized: boolean
  onToggleSidebar: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

const MENUS = ['文件', '编辑', '查看', '窗口', '帮助']

export function WindowChrome({
  sidebarCollapsed,
  isMaximized,
  onToggleSidebar,
  onMinimize,
  onToggleMaximize,
  onClose,
}: Props): React.ReactNode {
  return (
    <div className="window-chrome">
      <div className="window-titlebar">
        <div className="window-titlebar-left">
          <IconButton
            className="window-toolbar-icon"
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} />
            )}
          </IconButton>
          <IconButton className="window-toolbar-icon" title="后退">
            <ChevronLeft size={16} strokeWidth={1.8} />
          </IconButton>
          <IconButton className="window-toolbar-icon" title="前进">
            <ChevronRight size={16} strokeWidth={1.8} />
          </IconButton>

          <nav className="window-menu" aria-label="应用菜单">
            {MENUS.map(menu => (
              <button className="window-menu-item" key={menu} type="button">
                {menu}
              </button>
            ))}
          </nav>
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

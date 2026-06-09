import type React from 'react'
import {
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  Terminal,
} from 'lucide-react'
import { IconButton } from './ui/IconButton.js'

type Props = {
  sidebarCollapsed: boolean
  runtimeMissing: boolean
  onOpenSettings: () => void
  onToggleSidebar: () => void
}

export function MainToolbar({
  sidebarCollapsed,
  runtimeMissing,
  onOpenSettings,
  onToggleSidebar,
}: Props): React.ReactNode {
  return (
    <div className="desktop-main-toolbar">
      <div className="desktop-main-toolbar-left">
        <IconButton
          className="menubar-icon"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.8} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.8} />
          )}
        </IconButton>
        <IconButton className="menubar-icon" title="后退">
          <ChevronLeft size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton className="menubar-icon" title="前进">
          <ChevronRight size={16} strokeWidth={1.8} />
        </IconButton>
      </div>

      <div className="desktop-main-toolbar-right">
        {runtimeMissing ? (
          <span className="menubar-status warning">Agent 缺失</span>
        ) : null}
        <button className="vscode-pill" title="终端" type="button">
          <Terminal size={18} />
          <ChevronRight size={12} />
        </button>
        <IconButton className="menubar-icon" title="最小化面板">
          <ArrowUpCircle size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          className="menubar-icon"
          onClick={onOpenSettings}
          title="打开设置"
        >
          <PanelTop size={16} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  )
}

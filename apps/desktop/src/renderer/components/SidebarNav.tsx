import type React from 'react'
import {
  Bot,
  Boxes,
  Clock3,
  Search,
  Settings2,
  SquarePen,
} from 'lucide-react'
import type { AppView } from '../uiTypes.js'

type Props = {
  activeView: AppView
  onNewConversation: () => void
  onSelectView: (view: AppView) => void
  onOpenSettings: () => void
}

export function SidebarNav({
  activeView,
  onNewConversation,
  onSelectView,
  onOpenSettings,
}: Props): React.ReactNode {
  return (
    <nav className="sidebar-nav">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <Bot size={18} />
        </div>
        <div>
          <strong>ClaudeCode</strong>
          <span>本地桌面端</span>
        </div>
      </div>
      <div className="sidebar-nav-list">
        <button
          className={activeView === 'quickChat' ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
          onClick={onNewConversation}
        >
          <SquarePen size={18} />
          <span>新对话</span>
        </button>
        <button
          className={activeView === 'search' ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
          onClick={() => onSelectView('search')}
        >
          <Search size={18} />
          <span>搜索</span>
        </button>
        <button
          className={activeView === 'plugins' ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
          onClick={() => onSelectView('plugins')}
        >
          <Boxes size={18} />
          <span>插件</span>
        </button>
        <button
          className={activeView === 'automation' ? 'sidebar-nav-item active' : 'sidebar-nav-item'}
          onClick={() => onSelectView('automation')}
        >
          <Clock3 size={18} />
          <span>自动化</span>
        </button>
      </div>
      <button className="sidebar-settings-button" onClick={onOpenSettings}>
        <Settings2 size={18} />
        <span>设置</span>
      </button>
    </nav>
  )
}

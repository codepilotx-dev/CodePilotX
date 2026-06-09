import React from 'react'
import {
  ArrowLeft,
  Settings,
  User,
  Palette,
  Sliders,
  Sparkles,
  Keyboard,
  Server,
  Link,
  GitBranch,
  Box,
  FolderTree,
  Globe,
  Monitor,
  Archive,
  CreditCard,
  Anchor
} from 'lucide-react'

const MENU_ITEMS = [
  { id: 'general', label: '常规', icon: Settings },
  { id: 'profile', label: '个人资料', icon: User },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'config', label: '配置', icon: Sliders },
  { id: 'personalization', label: '个性化', icon: Sparkles },
  { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
  { id: 'mcp', label: 'MCP服务器', icon: Server },
  { id: 'hooks', label: '钩子', icon: Anchor },
  { id: 'connections', label: '连接', icon: Link },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'environment', label: '环境', icon: Box },
  { id: 'worktree', label: '工作树', icon: FolderTree },
  { id: 'browser', label: '浏览器', icon: Globe },
  { id: 'computer', label: '电脑操控', icon: Monitor },
  { id: 'archived', label: '已归档对话', icon: Archive },
  { id: 'billing', label: '使用情况和计费', icon: CreditCard },
]

type Props = {
  activeTab: string
  onTabChange: (tabId: string) => void
  onBack: () => void
}

export function SettingsNav({ activeTab, onTabChange, onBack }: Props) {
  return (
    <nav className="settings-nav">
      <div className="settings-nav-header">
        <button className="settings-back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>返回应用</span>
        </button>
      </div>
      <div className="settings-nav-menu">
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => onTabChange(item.id)}
          >
            <item.icon className="settings-nav-icon" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

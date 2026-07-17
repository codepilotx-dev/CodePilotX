import React, { useMemo, useState } from 'react'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import {
  ArrowLeft,
  Settings,
  User,
  Palette,
  Sliders,
  Sparkles,
  Keyboard,
  Link,
  GitBranch,
  Box,
  FolderTree,
  Search,
  Square,
  Archive,
  CreditCard,
  Anchor,
  Cat,
  Gauge,
  Network,
  Brain,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SidebarRow } from '../layout/sidebar/SidebarRow.js'

const SETTINGS_GROUPS = [
  {
    title: '个人',
    items: [
      { id: 'general', label: '常规', icon: Settings },
      { id: 'profile', label: '个人资料', icon: User },
      { id: 'appearance', label: '外观', icon: Palette },
      { id: 'config', label: '配置', icon: Sliders },
      { id: 'personalization', label: '个性化', icon: Gauge },
      { id: 'memory', label: '记忆', icon: Brain },
      { id: 'pets', label: 'Pets', icon: Cat },
      { id: 'shortcuts', label: '键盘快捷键', icon: Keyboard },
      { id: 'billing', label: '使用情况和计费', icon: CreditCard },
    ],
  },
  {
    title: '集成',
    items: [
      { id: 'mcp', label: 'MCP 服务器', icon: Link },
      { id: 'browser', label: '浏览器', icon: Square },
      { id: 'computer', label: '电脑操控', icon: Sparkles },
    ],
  },
  {
    title: '编码',
    items: [
      { id: 'hooks', label: '钩子', icon: Anchor },
      { id: 'connections', label: '模型', icon: Box },
      { id: 'git', label: 'Git', icon: GitBranch },
      { id: 'environment', label: '环境', icon: Box },
      { id: 'worktree', label: '工作树', icon: FolderTree },
    ],
  },
  {
    title: '已归档',
    items: [
      { id: 'archived', label: '已归档对话', icon: Archive },
    ],
  },
]

type Props = {
  activeTab: string
  onBack: () => void
  onTabChange: (tabId: string) => void
}

export function SettingsNav({ activeTab, onBack, onTabChange }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return SETTINGS_GROUPS
    return SETTINGS_GROUPS.map(group => ({
      ...group,
      items: group.items.filter(item =>
        item.label.toLocaleLowerCase().includes(normalizedQuery),
      ),
    })).filter(group => group.items.length > 0)
  }, [normalizedQuery])

  return (
    <ScrollArea
      aria-label="设置分类"
      className="settings-nav-scroll-area tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="settings-nav-scroll-content tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-1.5"
    >
      <div className="settings-nav-header tw:grid tw:shrink-0 tw:gap-3">
        <SidebarRow
          asChild
          className="settings-back-btn"
          leading={<ArrowLeft size={APP_ICON_SIZE} />}
        >
          <button onClick={onBack} type="button">
            <span>返回应用</span>
          </button>
        </SidebarRow>
        <label className="settings-nav-search tw:relative tw:flex tw:w-full tw:items-center">
          <Search className="settings-nav-search-icon tw:pointer-events-none tw:absolute tw:left-2.5 tw:size-4 tw:text-app-text-soft" />
          <input
            aria-label="搜索设置"
            className="tw:w-full tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:py-2 tw:pr-3 tw:pl-8.5 tw:text-sm tw:text-app-text tw:outline-none tw:transition-colors tw:duration-[var(--motion-fast)] tw:placeholder:text-app-text-soft tw:focus:border-app-accent tw:focus:ring-1 tw:focus:ring-app-accent"
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="搜索设置..."
            type="search"
            value={searchQuery}
          />
        </label>
      </div>
      <div className="settings-nav-menu tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:gap-4">
        {visibleGroups.map(group => (
          <section className="settings-nav-group tw:grid tw:gap-1" key={group.title}>
            <div className="settings-nav-group-title-row tw:grid tw:grid-cols-[auto_minmax(0,1fr)_var(--sidebar-trailing-width)] tw:items-center tw:gap-x-2 tw:px-2 tw:py-1">
              <h2 className="settings-nav-group-title tw:m-0 tw:text-xs tw:font-[var(--font-weight-label)] tw:text-app-text-soft">{group.title}</h2>
              <span aria-hidden="true" className="sidebar-row-main" />
              <span aria-hidden="true" className="sidebar-row-trailing" />
            </div>
            <div className="settings-nav-group-items tw:grid tw:gap-0.5">
              {group.items.map(item => (
                <SidebarRow
                  active={activeTab === item.id}
                  asChild
                  key={item.id}
                  className="settings-nav-item"
                  leading={<item.icon className="settings-nav-icon" />}
                >
                  <button onClick={() => onTabChange(item.id)} type="button">
                    <span>{item.label}</span>
                  </button>
                </SidebarRow>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ScrollArea>
  )
}

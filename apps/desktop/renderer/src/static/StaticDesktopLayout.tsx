import type React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderOpen,
  GalleryVerticalEnd,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  PanelLeftClose,
  Plug,
  Search,
  Settings2,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react'
import { staticSessions } from './fixtures'

const navItems = [
  { to: '/quick-chat', label: '快速聊天', icon: MessageSquarePlus },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/plugins', label: '插件', icon: Plug },
  { to: '/automation', label: '自动化', icon: Workflow },
  { to: '/settings', label: '设置', icon: Settings2 },
]

export function StaticDesktopLayout(): React.ReactNode {
  return (
    <div className="desktop-frame" style={{ '--sidebar-current-width': '292px' } as React.CSSProperties}>
      <StaticMenuBar />
      <div className="app-body">
        <aside className="desktop-sidebar">
          <div className="sidebar-layout">
            <nav className="sidebar-top-nav" aria-label="桌面导航">
              {navItems.map(item => {
                const Icon = item.icon
                return (
                  <NavLink
                    className={({ isActive }) => `sidebar-row sidebar-nav-link${isActive ? ' active' : ''}`}
                    key={item.to}
                    to={item.to}
                  >
                    <span className="sidebar-row-leading"><Icon className="sidebar-item-icon" size={16} /></span>
                    <span className="sidebar-row-main"><span className="sidebar-item-label">{item.label}</span></span>
                    <span className="sidebar-row-trailing" />
                  </NavLink>
                )
              })}
            </nav>

            <div className="sidebar-scroll-area">
              <div className="sidebar-scroll-content">
                <div className="sidebar-section-group">
                  <section className="sidebar-section">
                    <div className="sidebar-section-header">
                      <span className="sidebar-row-leading"><FolderOpen className="sidebar-item-icon" size={16} /></span>
                      <span className="sidebar-section-main"><span className="sidebar-section-title">工作区</span></span>
                      <span className="sidebar-section-trailing" />
                    </div>
                    <button className="sidebar-row sidebar-project-header" type="button">
                      <span className="sidebar-row-leading"><GalleryVerticalEnd className="sidebar-item-icon" size={16} /></span>
                      <span className="sidebar-row-main"><span className="sidebar-project-title-text">CodePilotX-Ts</span></span>
                      <span className="sidebar-row-trailing"><span className="sidebar-section-label">main</span></span>
                    </button>
                  </section>

                  <section className="sidebar-section">
                    <div className="sidebar-section-header">
                      <span className="sidebar-row-leading"><Clock3 className="sidebar-item-icon" size={16} /></span>
                      <span className="sidebar-section-main"><span className="sidebar-section-title">最近任务</span></span>
                      <span className="sidebar-section-trailing" />
                    </div>
                    {staticSessions.map(session => (
                      <NavLink
                        className={({ isActive }) => `sidebar-row sidebar-session-row${isActive ? ' active' : ''}`}
                        key={session.id}
                        to={`/sessions/${session.id}`}
                      >
                        <span className="sidebar-row-leading"><MessageSquare className="sidebar-item-icon" size={15} /></span>
                        <span className="sidebar-row-main"><span className="sidebar-session-title">{session.title}</span></span>
                        <span className="sidebar-row-trailing"><span className="sidebar-section-label">{session.updatedAt}</span></span>
                      </NavLink>
                    ))}
                  </section>
                </div>
              </div>
            </div>

            <div className="sidebar-footer">
              <div className="sidebar-row sidebar-empty-row">
                <span className="sidebar-row-leading"><Bot className="sidebar-item-icon" size={16} /></span>
                <span className="sidebar-row-main"><span className="sidebar-item-label">静态预览</span></span>
                <span className="sidebar-row-trailing"><Sparkles size={14} /></span>
              </div>
            </div>
          </div>
        </aside>

        <main className="desktop-main">
          <div className="desktop-main-stage">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function StaticMenuBar(): React.ReactNode {
  return (
    <header className="app-menubar">
      <div className="menubar-titlebar">
        <div className="menubar-left">
          <button className="window-toolbar-icon icon-button" type="button" aria-label="侧边栏">
            <PanelLeftClose size={16} />
          </button>
          <button className="window-toolbar-icon icon-button" type="button" aria-label="后退">
            <ChevronLeft size={16} />
          </button>
          <button className="window-toolbar-icon icon-button" type="button" aria-label="前进">
            <ChevronRight size={16} />
          </button>
          <div className="menubar-root" aria-label="应用菜单">
            {['文件', '编辑', '视图', '窗口', '帮助'].map(label => (
              <button className="menubar-trigger" disabled key={label} type="button">
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="window-controls">
          <button className="window-control-button" type="button" aria-label="最小化"><Minus size={14} /></button>
          <button className="window-control-button" type="button" aria-label="最大化"><Maximize2 size={13} /></button>
          <button className="window-control-button close" type="button" aria-label="关闭"><X size={14} /></button>
        </div>
      </div>
    </header>
  )
}

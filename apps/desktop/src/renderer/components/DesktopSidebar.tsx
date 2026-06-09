import type React from 'react'
import { useEffect, useState } from 'react'
import {
  Bot,
  Boxes,
  Clock3,
  Folder,
  FolderOpen,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SquarePen,
  X,
} from 'lucide-react'
import type { DesktopWorkspace } from '../../shared/types.js'
import type { AppView, SessionListItem } from '../uiTypes.js'
import { IconButton } from './ui/IconButton.js'

type Props = {
  activeSessionId: string | null
  activeView: AppView
  collapsed: boolean
  maxWidth: number
  minWidth: number
  recentWorkspaces: DesktopWorkspace[]
  sessions: SessionListItem[]
  width: number
  workspace: DesktopWorkspace | null
  onChooseWorkspace: () => void
  onCloseSession: (sessionId: string) => void
  onCreateSession: () => void
  onOpenSettings: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onRefreshWorkspace: () => void
  onSelectSession: (session: SessionListItem) => void
  onSelectView: (view: AppView) => void
  onSetWidth: (width: number) => void
  onToggleCollapsed: () => void
}

const PRIMARY_ITEMS: Array<{
  view: AppView
  label: string
  icon: React.ReactNode
}> = [
  { view: 'quickChat', label: '快速对话', icon: <SquarePen size={16} /> },
  { view: 'search', label: '搜索', icon: <Search size={16} /> },
  { view: 'plugins', label: '插件', icon: <Boxes size={16} /> },
  { view: 'automation', label: '自动化', icon: <Clock3 size={16} /> },
]

export function DesktopSidebar({
  activeSessionId,
  activeView,
  collapsed,
  maxWidth,
  minWidth,
  recentWorkspaces,
  sessions,
  width,
  workspace,
  onChooseWorkspace,
  onCloseSession,
  onCreateSession,
  onOpenSettings,
  onOpenWorkspace,
  onRefreshWorkspace,
  onSelectSession,
  onSelectView,
  onSetWidth,
  onToggleCollapsed,
}: Props): React.ReactNode {
  const [resizing, setResizing] = useState(false)
  const [start, setStart] = useState({ x: 0, width })

  useEffect(() => {
    if (!resizing) return

    function handlePointerMove(event: PointerEvent): void {
      onSetWidth(start.width + event.clientX - start.x)
    }

    function stopResize(): void {
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [onSetWidth, resizing, start.width, start.x])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed) return
    event.preventDefault()
    setStart({ x: event.clientX, width })
    setResizing(true)
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return
    const step = event.shiftKey ? 32 : 8
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSetWidth(width - step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSetWidth(width + step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onSetWidth(minWidth)
    } else if (event.key === 'End') {
      event.preventDefault()
      onSetWidth(maxWidth)
    }
  }

  return (
    <aside
      aria-label="侧边栏"
      className={[
        'desktop-sidebar',
        collapsed ? 'is-collapsed' : '',
        resizing ? 'is-resizing' : '',
      ].join(' ')}
      style={{ '--sidebar-current-w': `${width}px` } as React.CSSProperties}
    >
      <div className="sidebar-content">
        <section className="nav-section primary">
          {PRIMARY_ITEMS.map(item => (
            <button
              className={
                activeView === item.view ? 'nav-item active' : 'nav-item'
              }
              key={item.view}
              onClick={() => onSelectView(item.view)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </section>

        <section className="nav-section project-actions">
          <div className="sidebar-section-header">
            <h2 className="section-title">项目</h2>
            <div className="sidebar-action-row">
              <IconButton onClick={onChooseWorkspace} title="选择项目">
                <FolderOpen size={15} />
              </IconButton>
              <IconButton
                disabled={!workspace}
                onClick={onRefreshWorkspace}
                title="刷新项目"
              >
                <RefreshCw size={15} />
              </IconButton>
              <IconButton
                disabled={!workspace}
                onClick={onCreateSession}
                title="新建对话"
              >
                <Plus size={15} />
              </IconButton>
            </div>
          </div>

          {recentWorkspaces.length === 0 ? (
            <p className="sidebar-empty">暂无最近项目</p>
          ) : (
            recentWorkspaces.map(item => {
              const expanded = workspace?.path === item.path
              const workspaceSessions = sessions.filter(
                session => session.workspacePath === item.path,
              )
              return (
                <div className="project-block" key={item.path}>
                  <button
                    aria-expanded={expanded}
                    className={expanded ? 'project-row active' : 'project-row'}
                    onClick={() => onOpenWorkspace(item)}
                    title={item.path}
                    type="button"
                  >
                    <span className="nav-icon">
                      <Folder size={15} />
                    </span>
                    <span className="project-name">{item.name}</span>
                  </button>
                  {expanded && workspaceSessions.length > 0 ? (
                    <ul className="task-list">
                      {workspaceSessions.map(session => (
                        <li
                          className={
                            session.id === activeSessionId
                              ? 'task-row active'
                              : 'task-row'
                          }
                          key={session.id}
                        >
                          <button
                            className="task-button"
                            onClick={() => onSelectSession(session)}
                            title={session.sessionName ?? session.workspaceName}
                            type="button"
                          >
                            <span className="task-title">
                              {session.sessionName ?? session.workspaceName}
                            </span>
                            <span className="task-time">
                              {session.status === 'running'
                                ? '运行中'
                                : session.createdAt}
                            </span>
                          </button>
                          <IconButton
                            className="task-close-button"
                            onClick={() => onCloseSession(session.id)}
                            title="关闭对话"
                          >
                            <X size={12} />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })
          )}
        </section>

        <section className="nav-section conversations">
          <h2 className="section-title">对话</h2>
          {sessions.length === 0 ? (
            <p className="sidebar-empty">暂无对话</p>
          ) : (
            sessions.slice(0, 8).map(session => (
              <button
                className={
                  session.id === activeSessionId
                    ? 'conversation-item active'
                    : 'conversation-item'
                }
                key={session.id}
                onClick={() => onSelectSession(session)}
                type="button"
              >
                <span className="conversation-title">
                  {session.sessionName ?? session.workspaceName}
                </span>
                <span className="conversation-time">{session.createdAt}</span>
              </button>
            ))
          )}
        </section>
      </div>

      <div className="sidebar-footer">
        <button className="footer-button" onClick={onOpenSettings} type="button">
          <span className="nav-icon">
            <Settings2 size={17} />
          </span>
          <span>设置</span>
        </button>
        <IconButton
          className="collapse-button"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </IconButton>
      </div>

      <div
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemax={maxWidth}
        aria-valuemin={minWidth}
        aria-valuenow={width}
        className="sidebar-resizer"
        onKeyDown={handleResizeKey}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      />
      <div className="sidebar-brand-floating">
        <Bot size={16} />
      </div>
      <History className="sidebar-history-watermark" size={14} />
    </aside>
  )
}

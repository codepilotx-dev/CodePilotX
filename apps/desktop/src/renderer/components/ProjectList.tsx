import type React from 'react'
import { FolderOpen, Plus, RefreshCw, X } from 'lucide-react'
import { APP_ICON_SIZE } from './ui/iconTokens.js'
import type { DesktopWorkspace } from '../../shared/types.js'
import { sessionDisplayTitle, type SessionListItem } from '../uiTypes.js'

type Props = {
  workspace: DesktopWorkspace | null
  recentWorkspaces: DesktopWorkspace[]
  sessions: SessionListItem[]
  activeSessionId: string | null
  onChooseWorkspace: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onRefreshWorkspace: () => void
  onCreateSession: () => void
  onSelectSession: (session: SessionListItem) => void
  onCloseSession: (sessionId: string) => void
}

export function ProjectList({
  workspace,
  recentWorkspaces,
  sessions,
  activeSessionId,
  onChooseWorkspace,
  onOpenWorkspace,
  onRefreshWorkspace,
  onCreateSession,
  onSelectSession,
  onCloseSession,
}: Props): React.ReactNode {
  const workspaceSessions = workspace
    ? sessions.filter(
        session =>
          !session.standalone && session.workspacePath === workspace.path,
      )
    : []

  return (
    <section className="project-panel">
      <div className="project-panel-header">
        <div>
          <span className="section-label">项目</span>
          <h2>{workspace?.name ?? '未选择项目'}</h2>
        </div>
        <div className="project-panel-actions">
          <button className="ghost-icon-button" onClick={onChooseWorkspace} title="选择项目">
            <FolderOpen size={APP_ICON_SIZE} />
          </button>
          <button
            className="ghost-icon-button"
            onClick={onRefreshWorkspace}
            disabled={!workspace}
            title="刷新项目"
          >
            <RefreshCw size={APP_ICON_SIZE} />
          </button>
          <button
            className="ghost-icon-button"
            onClick={onCreateSession}
            disabled={!workspace}
            title="新建会话"
          >
            <Plus size={APP_ICON_SIZE} />
          </button>
        </div>
      </div>

      <div className="project-block">
        <h3>最近项目</h3>
        <div className="workspace-list">
          {recentWorkspaces.length === 0 ? (
            <p className="muted-copy">还没有最近项目。</p>
          ) : (
            recentWorkspaces.map(item => (
              <button
                className={workspace?.path === item.path ? 'workspace-item active' : 'workspace-item'}
                key={item.path}
                onClick={() => onOpenWorkspace(item)}
                title={item.path}
              >
                <span>{item.name}</span>
                <small>{item.branchName ?? '未检测到 Git 分支'}</small>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="project-block">
        <h3>会话</h3>
        <div className="session-list">
          {workspaceSessions.length === 0 ? (
            <p className="muted-copy">当前项目还没有会话。</p>
          ) : (
            workspaceSessions.map(session => (
              <div
                className={session.id === activeSessionId ? 'project-session-row active' : 'project-session-row'}
                key={session.id}
              >
                <button className="project-session-button" onClick={() => onSelectSession(session)}>
                  <span>{sessionDisplayTitle(session)}</span>
                  <small>
                    {session.createdAt} · {session.status}
                  </small>
                </button>
                <button
                  className="ghost-icon-button"
                  onClick={() => onCloseSession(session.id)}
                  title="关闭会话"
                >
                  <X size={APP_ICON_SIZE} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

import { Clock3, FolderOpen, Menu, MessageSquarePlus, MoreHorizontal, PanelLeft, PanelRight, Plug, Search, Settings2, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ProjectInfo } from '../api/agent-client'

interface DesktopShellProps {
  children: ReactNode
  composer: ReactNode
  projects: readonly ProjectInfo[]
  activeProjectID: string | null
  agentConnection?: 'connected' | 'disconnected' | 'unknown'
  streamConnection?: 'idle' | 'connecting' | 'connected' | 'reconnecting'
  busy?: boolean
  onOpenProject: () => void
  onSelectProject: (projectID: string) => void
  onNewConversation: () => void
  onOpenSettings?: () => void
}

export function DesktopShell({ children, composer, projects, activeProjectID, agentConnection = 'unknown', streamConnection = 'idle', busy = false, onOpenProject, onSelectProject, onNewConversation, onOpenSettings }: DesktopShellProps) {
  const activeProject = projects.find((project) => project.id === activeProjectID)
  return (
    <main className="desktop-shell">
      <aside className="sidebar">
        <div className="sidebar-top-actions">
          <button className="sidebar-action active-action" onClick={onNewConversation} disabled={!activeProjectID || busy}><MessageSquarePlus size={18} />新对话</button>
          <button className="sidebar-action" disabled><Search size={18} />搜索</button>
          <button className="sidebar-action" disabled><Plug size={18} />插件</button>
          <button className="sidebar-action" disabled><Clock3 size={18} />自动化</button>
        </div>

        <div className="sidebar-section-label project-label">项目</div>
        <div className="project-list" aria-label="最近项目">
          {projects.map((project) => (
            <button key={project.id} className={`project-link ${project.id === activeProjectID ? 'project-link-active' : ''}`} onClick={() => onSelectProject(project.id)} title={project.rootPath}>
              <FolderOpen size={16} /><span>{project.name}</span>
            </button>
          ))}
          {!projects.length ? <p className="project-empty">尚未打开项目</p> : null}
        </div>
        <button className="open-project-button" onClick={onOpenProject} disabled={busy}><FolderOpen size={16} />打开项目目录</button>

        <button className="conversation-link" onClick={onNewConversation} disabled={!activeProjectID || busy}><MessageSquarePlus size={16} />对话 <span>›</span></button>
        <button className="settings-link" onClick={onOpenSettings}><Settings2 size={17} />设置 <span>▯</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title"><span className={`status-dot status-dot-${agentConnection}`} title={`Agent 后端：${agentLabel(agentConnection)}`} />{activeProject ? activeProject.name : '选择项目'} <span className={`stream-status stream-status-${streamConnection}`}>{streamLabel(streamConnection)}</span><MoreHorizontal size={18} /></div>
          <div className="topbar-actions"><button aria-label="工作流"><Workflow size={17} /></button><button aria-label="显示左侧栏"><PanelLeft size={17} /></button><button aria-label="显示右侧栏"><PanelRight size={17} /></button><Menu size={18} /></div>
        </header>
        <div className="content-area">
          {children}
          {composer}
        </div>
      </section>
    </main>
  )
}

function agentLabel(state: 'connected' | 'disconnected' | 'unknown') { return state === 'connected' ? '已连接' : state === 'disconnected' ? '不可用' : '状态未知' }
function streamLabel(state: 'idle' | 'connecting' | 'connected' | 'reconnecting') { return state === 'connected' ? '事件流已连接' : state === 'reconnecting' ? '事件流重连中' : state === 'connecting' ? '正在连接事件流' : '等待事件流' }

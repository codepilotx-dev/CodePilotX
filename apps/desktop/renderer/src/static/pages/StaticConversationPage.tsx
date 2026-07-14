import type React from 'react'
import { CheckCircle2, CircleDashed, FileCode2, GitPullRequest, PanelRight, Play, ShieldCheck } from 'lucide-react'
import { staticMessages, staticSessions } from '../fixtures'
import { StaticComposer } from './StaticQuickChatView'

export function StaticConversationPage(): React.ReactNode {
  const session = staticSessions[0]

  return (
    <div className="desktop-workspace">
      <div className="desktop-main-browser-layout">
        <section className="desktop-main-route">
          <div className="conversation-page">
            <header className="chat-session-header">
              <div className="chat-session-title">
                <span>{session.title}</span>
              </div>
              <div className="chat-session-actions">
                <button className="message-action" type="button" disabled><GitPullRequest size={15} />审阅</button>
                <button className="message-action" type="button" disabled><PanelRight size={15} />右侧面板</button>
              </div>
            </header>

            <div className="quick-chat-content static-conversation-scroll">
              <div className="message-list">
                {staticMessages.map(message => (
                  <article className={`message-card ${message.role}`} key={message.id}>
                    <div className="message-card-header">
                      <strong>{message.title}</strong>
                      <small>{message.meta}</small>
                    </div>
                    <p>{message.body}</p>
                  </article>
                ))}
                <section className="message-card">
                  <div className="message-card-header">
                    <strong>实施阶段</strong>
                    <small>静态工作流</small>
                  </div>
                  <div className="static-workflow-grid">
                    <WorkflowStep icon={<CheckCircle2 size={16} />} label="计划" detail="迁移范围已锁定" />
                    <WorkflowStep icon={<CircleDashed size={16} />} label="执行" detail="复制样式与静态页面" />
                    <WorkflowStep icon={<ShieldCheck size={16} />} label="审阅" detail="类型检查与构建验证" />
                  </div>
                </section>
              </div>
            </div>

            <div className="chat-composer">
              <StaticComposer placeholder="静态预览不会发送消息" />
            </div>
          </div>
        </section>

        <aside className="right-dock" style={{ maxWidth: 420 }}>
          <header className="right-dock-header">
            <div className="right-dock-tab-list">
              <button className="right-dock-tab-wrap active" type="button">
                <span className="right-dock-tab"><FileCode2 className="right-dock-tab-icon" size={16} /><span>Review</span></span>
              </button>
            </div>
          </header>
          <div className="right-dock-body">
            <section className="review-sidebar">
              <div className="review-sidebar-header">
                <h2>工作区变更</h2>
                <p>静态预览不读取 Git diff。</p>
              </div>
              <div className="review-file-tree">
                <button className="review-file-row active" type="button"><FileCode2 size={15} />src/App.tsx</button>
                <button className="review-file-row" type="button"><FileCode2 size={15} />src/routes.tsx</button>
                <button className="review-file-row" type="button"><FileCode2 size={15} />src/styles/index.scss</button>
              </div>
              <button className="plugins-button is-primary" type="button" disabled><Play size={15} />开始审阅</button>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}

function WorkflowStep({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }): React.ReactNode {
  return (
    <div className="workflow-stage-card">
      <span>{icon}</span>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  )
}

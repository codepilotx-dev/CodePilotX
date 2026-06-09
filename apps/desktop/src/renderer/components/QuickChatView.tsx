import type React from 'react'
import { AlertCircle, Sparkles } from 'lucide-react'
import type { DesktopSessionStatus } from '../../shared/types.js'
import type { Message } from '../uiTypes.js'

type Props = {
  workspaceName: string | null
  messages: Message[]
  errorMessage: string | null
  onDismissError: () => void
  sessionStatus: DesktopSessionStatus
}

export function QuickChatView({
  workspaceName,
  messages,
  errorMessage,
  onDismissError,
  sessionStatus,
}: Props): React.ReactNode {
  const hasMessages = messages.length > 0

  return (
    <section className={hasMessages ? 'quick-chat-view active' : 'quick-chat-view'}>
      <div className="quick-chat-hero">
        <span className="section-label">快速对话</span>
        <h1>
          {workspaceName
            ? `我们应该在 ${workspaceName} 中构建什么？`
            : '我们应该构建什么？'}
        </h1>
        <p>
          {hasMessages
            ? `当前状态：${sessionStatus}`
            : '选择项目后即可开启新会话，底部输入卡片会保留当前模型、推理和权限模式。'}
        </p>
      </div>

      <div className="quick-chat-stream">
        {errorMessage ? (
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
            <button onClick={onDismissError}>关闭</button>
          </div>
        ) : null}
        {hasMessages ? (
          <div className="message-list">
            {messages.map(message => (
              <article key={message.id} className={`message-card ${message.role}`}>
                <span>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'ClaudeCode' : '系统'}</span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-canvas-card">
            <Sparkles size={22} />
            <p>从一个明确的问题开始，例如修复 bug、实现功能、或梳理当前项目结构。</p>
          </div>
        )}
      </div>
    </section>
  )
}

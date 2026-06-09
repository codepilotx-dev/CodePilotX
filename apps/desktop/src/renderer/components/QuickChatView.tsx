import type React from 'react'
import { AlertCircle } from 'lucide-react'
import { useQuickChatContext } from '../context/QuickChatContext.js'

export function QuickChatView(): React.ReactNode {
  const {
    workspaceName,
    messages,
    errorMessage,
    onDismissError,
    sessionStatus,
  } = useQuickChatContext()

  const hasMessages = messages.length > 0

  return (
    <section
      className={hasMessages ? 'quick-chat-view active' : 'quick-chat-view'}
    >
      <div className="quick-chat-hero">
        <h1>我们该做什么？</h1>
        {hasMessages ? <p>当前状态：{translateStatus(sessionStatus)}</p> : null}
      </div>

      <div className="quick-chat-stream">
        {errorMessage ? (
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
            <button onClick={onDismissError} type="button">
              关闭
            </button>
          </div>
        ) : null}
        {hasMessages ? (
          <div className="message-list">
            {messages.map(message => (
              <article
                className={`message-card ${message.role}`}
                key={message.id}
              >
                <span>{labelForRole(message.role)}</span>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function labelForRole(role: 'user' | 'assistant' | 'system'): string {
  if (role === 'user') return '你'
  if (role === 'assistant') return 'ClaudeCode'
  return '系统'
}

function translateStatus(status: string): string {
  if (status === 'running') return '运行中'
  if (status === 'waiting') return '等待确认'
  if (status === 'done') return '已完成'
  if (status === 'error') return '出错'
  return '空闲'
}

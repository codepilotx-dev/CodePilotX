import React from 'react'
import { AlertCircle } from 'lucide-react'
import { useQuickChatContext } from '../context/QuickChatContext.js'

export function QuickChatView(): React.ReactNode {
  const {
    workspaceName,
    messages,
    errorMessage,
    onDismissError,
    sessionStatus,
    composer,
  } = useQuickChatContext()

  const hasMessages = messages.length > 0

  return (
    <section
      className={hasMessages ? 'quick-chat-view active' : 'quick-chat-view'}
    >
      <div className="quick-chat-hero">
        <h1>我们应该在 ClaudeCode 中构建什么?</h1>
        {hasMessages ? <p>当前状态：{translateStatus(sessionStatus)}</p> : null}
      </div>

      {(errorMessage || hasMessages) ? (
        <div className="quick-chat-content">
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
                <div className="message-body">
                  {renderSafeMarkdown(message.text)}
                </div>
              </article>
            ))}
          </div>
          ) : null}
        </div>
      ) : null}
      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
  )
}

function renderSafeMarkdown(text: string): React.ReactNode {
  const parts = text.split(/```/)
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const lines = part.replace(/^\w+\r?\n/, '').trimEnd()
      return <pre key={index}><code>{lines}</code></pre>
    }
    return part
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((paragraph, paragraphIndex) => (
        <p key={`${index}-${paragraphIndex}`}>
          {paragraph.split(/\r?\n/).map((line, lineIndex) => (
            <React.Fragment key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {line}
            </React.Fragment>
          ))}
        </p>
      ))
  })
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

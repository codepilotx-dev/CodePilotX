import React from 'react'
import {
  AlertCircle,
  Copy,
  MoreHorizontal,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { useQuickChatContext } from '../context/QuickChatContext.js'
import type { Message } from '../uiTypes.js'

export function QuickChatView(): React.ReactNode {
  const {
    messages,
    errorMessage,
    onDismissError,
    sessionStatus,
    composer,
  } = useQuickChatContext()

  const conversationMessages = messages.filter(
    message => message.role !== 'system',
  )
  const hasMessages = conversationMessages.length > 0
  const showThinking =
    (sessionStatus === 'running' || sessionStatus === 'waiting') &&
    !conversationMessages.some(
      message =>
        message.role === 'assistant' &&
        message.streaming &&
        Boolean(message.text.trim()),
    )

  if (hasMessages) {
    return (
      <section className="quick-chat-view active">
        <header className="chat-session-header">
          <div className="chat-session-title">
            <span>{getConversationTitle(conversationMessages)}</span>
            <button
              aria-label="更多会话操作"
              className="message-action"
              type="button"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

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
          <div className="conversation-stream">
            {conversationMessages.map(message => (
              <ChatMessage message={message} key={message.id} />
            ))}
            {showThinking ? (
              <div className="assistant-thinking">正在思考</div>
            ) : null}
          </div>
        </div>

        {composer ? <div className="chat-composer">{composer}</div> : null}
      </section>
    )
  }

  return (
    <section className="quick-chat-view">
      <div className="quick-chat-hero">
        <h1>我们应该在 ClaudeCode 中构建什么?</h1>
      </div>

      {errorMessage ? (
        <div className="quick-chat-content">
          <div className="error-banner">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
            <button onClick={onDismissError} type="button">
              关闭
            </button>
          </div>
        </div>
      ) : null}
      {composer ? <div className="chat-composer">{composer}</div> : null}
    </section>
  )
}

function ChatMessage({ message }: { message: Message }): React.ReactNode {
  if (message.role === 'user') {
    return (
      <article className="chat-message-row user">
        <div className="user-message-bubble">{message.text}</div>
        <MessageActionButton label="复制" text={message.text}>
          <Copy size={14} />
        </MessageActionButton>
      </article>
    )
  }

  return (
    <article className={`chat-message-row ${message.role}`}>
      <div className="assistant-message-body">
        {renderSafeMarkdown(message.text)}
      </div>
      {message.role === 'assistant' && message.text.trim() ? (
        <div className="assistant-message-actions">
          <MessageActionButton label="复制" text={message.text}>
            <Copy size={14} />
          </MessageActionButton>
          <button aria-label="赞" className="message-action" type="button">
            <ThumbsUp size={14} />
          </button>
          <button aria-label="踩" className="message-action" type="button">
            <ThumbsDown size={14} />
          </button>
          <button
            aria-label="重新生成"
            className="message-action"
            type="button"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      ) : null}
    </article>
  )
}

function MessageActionButton({
  children,
  label,
  text,
}: {
  children: React.ReactNode
  label: string
  text: string
}): React.ReactNode {
  return (
    <button
      aria-label={label}
      className="message-action"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined)
      }}
      type="button"
    >
      {children}
    </button>
  )
}

function renderSafeMarkdown(text: string): React.ReactNode {
  const parts = text.split(/```/)
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const lines = part.replace(/^\w+\r?\n/, '').trimEnd()
      return (
        <pre key={index}>
          <code>{lines}</code>
        </pre>
      )
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

function getConversationTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user')
  const title = firstUserMessage?.text.trim().split(/\r?\n/)[0] ?? '新对话'
  return title.length > 28 ? `${title.slice(0, 28)}...` : title
}

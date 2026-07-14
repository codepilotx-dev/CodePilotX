import type { AiTask, ChatMessage } from '../domain/task-flow'
import { TaskMessage } from './TaskMessage'

interface ConversationTimelineProps {
  messages: ChatMessage[]
  tasks: AiTask[]
  queuedMessages: ChatMessage[]
  onToggleProcess: (taskId: string) => void
  onTogglePlan: (taskId: string) => void
  onToggleEditedFiles: (taskId: string) => void
  onUndoEditResult: (taskId: string) => void
  onSubmitEditReview: (taskId: string) => void
  onQuestionAnswer: (taskId: string, questionID: string, answer: string, ignored?: boolean) => Promise<void>
  onGenerateProposals: (taskId: string) => void
  onKeepPlan: (taskId: string) => void
}

export function ConversationTimeline({
  messages,
  tasks,
  queuedMessages,
  onToggleProcess,
  onTogglePlan,
  onToggleEditedFiles,
  onUndoEditResult,
  onSubmitEditReview,
  onQuestionAnswer,
  onGenerateProposals,
  onKeepPlan,
}: ConversationTimelineProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-conversation">
        <div className="empty-mark">✦</div>
        <h1>开始一次开发协作</h1>
        <p>描述你想查阅、设计或编写的内容，AI 会把处理过程展示在这里。</p>
      </div>
    )
  }

  return (
    <div className="conversation-timeline" aria-live="polite">
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === 'user' ? (
            <div className={`user-message user-${message.status ?? 'completed'}`}>
              <span>{message.content}</span>
              {message.status === 'queued' ? <small>等待处理</small> : null}
              {message.status === 'merged' ? <small>已追加</small> : null}
            </div>
          ) : (
            <div className="assistant-message">{message.content}</div>
          )}
          {tasks.find((task) => task.sourceMessageId === message.id) ? (
            <TaskMessage
              task={tasks.find((task) => task.sourceMessageId === message.id)!}
              messages={messages}
              onToggleProcess={() => onToggleProcess(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onTogglePlan={() => onTogglePlan(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onToggleEditedFiles={() => onToggleEditedFiles(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onUndoEditResult={() => onUndoEditResult(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onSubmitEditReview={() => onSubmitEditReview(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onQuestionAnswer={(questionID, answer, ignored) => onQuestionAnswer(tasks.find((task) => task.sourceMessageId === message.id)!.id, questionID, answer, ignored)}
              onGenerateProposals={() => onGenerateProposals(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
              onKeepPlan={() => onKeepPlan(tasks.find((task) => task.sourceMessageId === message.id)!.id)}
            />
          ) : null}
        </div>
      ))}
      {queuedMessages.length > 0 ? (
        <div className="queue-note">{queuedMessages.length} 条消息等待当前任务完成后处理</div>
      ) : null}
    </div>
  )
}

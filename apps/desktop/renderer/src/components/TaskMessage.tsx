import { Archive, ChevronDown, ChevronRight, CircleStop, Code2, Command, FileCode2, LoaderCircle, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { AiTask, ChatMessage, ProcessItem } from '../domain/task-flow'
import { EditResultCard } from './EditResultCard'
import { QuestionCard } from './QuestionCard'

interface TaskMessageProps {
  task: AiTask
  messages: ChatMessage[]
  onToggleProcess: () => void
  onTogglePlan: () => void
  onToggleEditedFiles: () => void
  onUndoEditResult: () => void
  onSubmitEditReview: () => void
  onQuestionAnswer: (questionID: string, answer: string, ignored?: boolean) => Promise<void>
  onGenerateProposals: () => void
  onKeepPlan: () => void
}

const processIcon = (item: ProcessItem) => {
  if (item.kind === 'powershell') return <Terminal size={14} strokeWidth={1.7} />
  if (item.kind === 'tool') return <Command size={14} strokeWidth={1.7} />
  if (item.kind === 'write') return <FileCode2 size={14} strokeWidth={1.7} />
  if (item.kind === 'context') return <Archive size={14} strokeWidth={1.7} />
  return <Code2 size={14} strokeWidth={1.7} />
}

function CommandDetails({ item }: { item: ProcessItem }) {
  if (!item.commands?.length) return <p>{item.detail}</p>

  return (
    <div className="command-details">
      <div className="command-details-title">
        <Terminal size={13} strokeWidth={1.7} />
        <span>只读提议／活动记录</span>
      </div>
      {item.commands.map((record, index) => (
        <div className="command-record" key={`${item.id}-command-${index}`}>
          <div className="command-shell-label">{item.kind === 'powershell' ? 'Shell' : 'Tool'}</div>
          <pre className="command-line">$ {record.command}</pre>
          <pre className="command-output">{record.output}</pre>
          <div className={`command-status command-${record.status ?? 'success'}`}>
            {record.status === 'running' ? '正在分析' : record.status === 'error' ? '发生错误' : record.status === 'interrupted' ? '已中断' : '已完成'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TaskMessage({
  task,
  messages,
  onToggleProcess,
  onTogglePlan,
  onToggleEditedFiles,
  onUndoEditResult,
  onSubmitEditReview,
  onQuestionAnswer,
  onGenerateProposals,
  onKeepPlan,
}: TaskMessageProps) {
  const [expandedProcessIds, setExpandedProcessIds] = useState<Set<string>>(new Set())
  const mergedCount = messages.filter((message) => task.mergedMessageIds.includes(message.id)).length
  const isRunning = task.phase === 'running'
  const isActive = isRunning || task.phase === 'waiting-question' || task.phase === 'waiting-permission' || task.phase === 'waiting-plan-confirmation'
  const timelineEntries = [
    ...task.narratives.map((narrative) => ({ type: 'narrative' as const, createdAt: narrative.createdAt, narrative })),
    ...task.processItems.map((item) => ({ type: 'process' as const, createdAt: item.createdAt, item })),
  ].sort((a, b) => a.createdAt - b.createdAt)
  const toggleProcessItem = (itemId: string) => {
    setExpandedProcessIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const renderProcessItem = (item: ProcessItem) => (
    <article className={`process-item process-${item.kind}`} key={item.id}>
      {item.kind === 'tool' || item.kind === 'powershell' ? (
        <button
          className="process-title process-title-button"
          onClick={() => toggleProcessItem(item.id)}
          aria-expanded={expandedProcessIds.has(item.id)}
        >
          {expandedProcessIds.has(item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="process-icon">{processIcon(item)}</span>
          <span>{item.title}</span>
        </button>
      ) : (
        <div className="process-title">
          <span className="process-icon">{processIcon(item)}</span>
          <span>{item.title}</span>
        </div>
      )}
      {item.kind === 'tool' || item.kind === 'powershell'
        ? expandedProcessIds.has(item.id) ? <CommandDetails item={item} /> : null
        : <p>{item.detail}</p>}
    </article>
  )

  return (
    <section className={`task-message task-${task.phase}`} aria-label="AI 任务进度">
      <button className="task-elapsed task-elapsed-toggle" onClick={onToggleProcess} aria-expanded={task.processExpanded}>
        <span>已处理 {task.elapsedSeconds}s</span>
        {task.processExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      <div className="task-body">
        {isActive ? (
          task.processExpanded ? (
            <div className="process-stream" aria-live="polite">
              {timelineEntries.map((entry) =>
                entry.type === 'narrative' ? (
                  <div className="assistant-message task-narrative" key={entry.narrative.id}>
                    {entry.narrative.content}
                  </div>
                ) : renderProcessItem(entry.item),
              )}
              <div className="thinking-indicator">
                <LoaderCircle size={15} className="spin" strokeWidth={1.7} />
                {task.phase === 'waiting-question' ? '等待你的选择' : task.phase === 'waiting-plan-confirmation' ? '等待计划确认' : task.phase === 'waiting-permission' ? '等待权限确认' : '正在分析'}
              </div>
            </div>
          ) : null
        ) : (
          <>
            <div className="task-result">
              <p className="task-summary">{task.summary}</p>
              {mergedCount > 0 ? <span className="merged-hint">已合并 {mergedCount} 条补充要求</span> : null}
            </div>
          </>
        )}

        {task.questions.map((question) => <QuestionCard key={question.id} question={question} onSubmit={(answer, ignored) => onQuestionAnswer(question.id, answer, ignored)} />)}

        {task.plan ? (
          <div className="plan-card">
            <div className="plan-card-header">
              <span>正式计划</span>
              <button className="plan-toggle" onClick={onTogglePlan} aria-expanded={task.planExpanded}>
                {task.planExpanded ? '收起计划' : '展开计划'}
                {task.planExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
            {task.planExpanded ? <div className="plan-content">{task.plan}</div> : null}
            {task.planAction === 'kept' ? <p className="plan-action-note">计划已保留，未生成任何修改提议。</p> : task.planAction === 'proposals-generated' ? <p className="plan-action-note">已请求生成只读修改提议。</p> : task.phase === 'waiting-plan-confirmation' ? <div className="plan-actions"><button className="implement-plan-button" onClick={onGenerateProposals}>生成修改提议</button><button className="keep-plan-button" onClick={onKeepPlan}>仅保留计划</button></div> : null}
          </div>
        ) : null}

        {task.phase === 'completed' && task.mode === 'chat' && task.editResult?.files.length ? (
          <EditResultCard
            result={task.editResult}
            onToggleFiles={onToggleEditedFiles}
            onUndo={onUndoEditResult}
            onSubmitReview={onSubmitEditReview}
          />
        ) : null}

        {task.phase === 'stopped' ? (
          <div className="stopped-note">
            <CircleStop size={14} /> 任务已停止，已保留当前执行过程。
          </div>
        ) : null}
      </div>
    </section>
  )
}

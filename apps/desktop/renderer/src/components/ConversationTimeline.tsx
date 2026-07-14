import type {
  ActivityRow,
  AssistantTextRow,
  PlanRow,
  QuestionRow,
  ReasoningRow,
  RunStatusRow,
  TimelineRow,
  TimelineView,
  ToolGroupItem,
  ToolGroupRow,
  ToolRow,
  UserMessageRow,
} from '@codepilotx/session-view'
import type React from 'react'
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  Code2,
  FileCode2,
  LoaderCircle,
  MessageSquareText,
  Sparkles,
  Terminal,
} from 'lucide-react'
import type { ViewPreferences } from '../domain/task-flow'
import { EditResultCard } from './EditResultCard'
import { QuestionCard } from './QuestionCard'

interface ConversationTimelineProps {
  view: TimelineView
  preferences: ViewPreferences
  onToggleRow: (rowID: string, defaultValue?: boolean) => void
  onToggleEditedFiles: (rowID: string) => void
  onUndoEditResult: (rowID: string) => void
  onSubmitEditReview: (rowID: string) => void
  onQuestionAnswer: (questionID: string, answer: string, ignored?: boolean) => Promise<void>
  onGenerateProposals: (runID: string) => void
  onKeepPlan: (runID: string) => void
}

export function ConversationTimeline(props: ConversationTimelineProps) {
  if (props.view.rows.length === 0) {
    return (
      <div className="empty-conversation">
        <div className="empty-mark"><Sparkles size={20} strokeWidth={1.7} /></div>
        <h1>开始一次开发协作</h1>
        <p>描述你想查阅、设计或编写的内容，AI 会把处理过程展示在这里。</p>
      </div>
    )
  }

  return (
    <div className="conversation-timeline" aria-live="polite">
      {props.view.rows.map((row) => <TimelineRowView key={row.id} row={row} {...props} />)}
    </div>
  )
}

function TimelineRowView({ row, ...props }: { row: TimelineRow } & ConversationTimelineProps) {
  switch (row.kind) {
    case 'user-message':
      return <UserMessageView row={row} />
    case 'assistant-text':
      return <AssistantTextView row={row} />
    case 'reasoning':
      return <ReasoningView row={row} expanded={props.preferences.expandedRows[row.id] ?? row.defaultExpanded} onToggle={() => props.onToggleRow(row.id, row.defaultExpanded)} />
    case 'tool-group':
      return <ToolGroupView row={row} preferences={props.preferences} onToggleRow={props.onToggleRow} />
    case 'plan':
      return <PlanView row={row} expanded={props.preferences.expandedRows[row.id] ?? false} actionState={props.preferences.planActions[row.runID] ?? 'idle'} onToggle={() => props.onToggleRow(row.id)} onGenerate={() => props.onGenerateProposals(row.runID)} onKeep={() => props.onKeepPlan(row.runID)} />
    case 'question':
      return <QuestionCard question={row} onSubmit={(answer, ignored) => props.onQuestionAnswer(row.partID, answer, ignored)} />
    case 'patch':
      return row.files.length > 0 ? <EditResultCard patch={row} filesExpanded={props.preferences.filesExpanded[row.partID] ?? false} actionState={props.preferences.editActions[row.partID] ?? 'idle'} onToggleFiles={() => props.onToggleEditedFiles(row.partID)} onUndo={() => props.onUndoEditResult(row.partID)} onSubmitReview={() => props.onSubmitEditReview(row.partID)} /> : null
    case 'run-status':
      return <RunStatusView row={row} />
    case 'queue-notice':
      return <div className="queue-note"><MessageSquareText size={14} />{row.inputIDs.length} 条消息等待当前任务完成后处理</div>
  }
}

function UserMessageView({ row }: { row: UserMessageRow }) {
  return (
    <div className={`timeline-row user-message user-${row.state}`}>
      <span>{row.content}</span>
      {row.mode === 'plan' ? <small>计划模式</small> : null}
      {row.state === 'queued' ? <small>等待处理</small> : null}
      {row.state === 'merged' ? <small>已追加到当前任务</small> : null}
    </div>
  )
}

function AssistantTextView({ row }: { row: AssistantTextRow }) {
  return <div className={`timeline-row assistant-message assistant-${row.placement} assistant-${row.status}`}>{row.text}</div>
}

function ReasoningView({ row, expanded, onToggle }: { row: ReasoningRow; expanded: boolean; onToggle: () => void }) {
  return (
    <section className={`timeline-row reasoning-row reasoning-${row.status}`}>
      <button className="row-toggle reasoning-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span>思考过程</span>
        {row.status === 'streaming' ? <LoaderCircle size={14} className="spin" /> : null}
      </button>
      {expanded ? <div className="reasoning-content">{row.text}</div> : null}
    </section>
  )
}

function ToolGroupView({ row, preferences, onToggleRow }: { row: ToolGroupRow; preferences: ViewPreferences; onToggleRow: (rowID: string, defaultValue?: boolean) => void }) {
  const status = toolGroupStatus(row)
  const count = commandCount(row)
  return (
    <section className={`timeline-row tool-group-row tool-group-${status}`}>
      <div className="tool-group-header">
        <span className="tool-group-icon"><Terminal size={15} /></span>
        <span>{statusLabel(status)} · {count} 条命令</span>
        {status === 'running' ? <LoaderCircle size={14} className="spin" /> : null}
      </div>
      <div className="tool-group-list">
        {row.items.map((item) => <ToolGroupItemView key={item.id} item={item} preferences={preferences} onToggleRow={onToggleRow} />)}
      </div>
    </section>
  )
}

function ToolGroupItemView({ item, preferences, onToggleRow }: { item: ToolGroupItem; preferences: ViewPreferences; onToggleRow: (rowID: string, defaultValue?: boolean) => void }) {
  if (item.kind === 'tool') {
    const key = `tool:${item.partID}`
    const expanded = preferences.expandedRows[key] ?? false
    const command = toolCommand(item)
    return <CommandRecordView id={key} title={item.title} command={command} output={item.output} error={item.error} status={item.state} icon={toolIcon(item)} expanded={expanded} onToggle={() => onToggleRow(key, false)} />
  }
  if (item.commands.length === 0) {
    const key = `activity:${item.partID}`
    const expanded = preferences.expandedRows[key] ?? false
    return <CommandRecordView id={key} title={item.title} command={item.detail || item.title} output={item.detail} status={item.status} icon={activityIcon(item)} expanded={expanded} onToggle={() => onToggleRow(key, false)} />
  }
  return (
    <>
      {item.commands.map((command, index) => {
        const key = `command:${item.partID}:${index}`
        const expanded = preferences.expandedRows[key] ?? false
        return (
          <CommandRecordView
            key={key}
            id={key}
            title={item.title}
            command={command.command}
            output={command.output}
            status={command.status ?? item.status}
            truncated={command.truncated}
            icon={activityIcon(item)}
            expanded={expanded}
            onToggle={() => onToggleRow(key, false)}
          />
        )
      })}
    </>
  )
}

function CommandRecordView({ id, title, command, output, error, status, truncated, icon, expanded, onToggle }: { id: string; title: string; command: string | null; output?: string | null; error?: string | null; status?: string; truncated?: boolean; icon: React.ReactNode; expanded: boolean; onToggle: () => void }) {
  return (
    <article className={`tool-row tool-${status ?? 'completed'}`}>
      <button className="tool-row-header" type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`${id}-body`}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="tool-icon">{icon}</span>
        <strong>{command ? `已运行命令 ${compactCommand(command)}` : title}</strong>
        {status ? <span className="tool-state">{statusLabel(status)}</span> : null}
      </button>
      {expanded ? (
        <div className="tool-row-body" id={`${id}-body`}>
          {command ? <pre className="command-line">$ {command}</pre> : null}
          {output ? <pre className="command-output">{output}</pre> : null}
          {error ? <pre className="command-error">{error}</pre> : null}
          {truncated ? <div className="command-status command-interrupted">输出已截断</div> : null}
        </div>
      ) : null}
    </article>
  )
}

function PlanView({ row, expanded, actionState, onToggle, onGenerate, onKeep }: { row: PlanRow; expanded: boolean; actionState: 'idle' | 'proposals-generated' | 'kept'; onToggle: () => void; onGenerate: () => void; onKeep: () => void }) {
  return (
    <section className={`timeline-row plan-card plan-${row.state}`}>
      <div className="plan-card-header">
        <span>{row.title}</span>
        <button className="plan-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {expanded ? '收起计划' : '展开计划'}
        </button>
      </div>
      {expanded ? <div className="plan-content">{row.markdown}</div> : null}
      {actionState === 'kept' ? <p className="plan-action-note">计划已保留，未生成任何修改提议。</p> : actionState === 'proposals-generated' ? <p className="plan-action-note">已请求生成只读修改提议。</p> : row.state === 'awaiting-confirmation' ? <div className="plan-actions"><button className="implement-plan-button" type="button" onClick={onGenerate}>生成修改提议</button><button className="keep-plan-button" type="button" onClick={onKeep}>仅保留计划</button></div> : null}
    </section>
  )
}

function RunStatusView({ row }: { row: RunStatusRow }) {
  const icon = row.status === 'failed' ? <CircleAlert size={15} /> : row.status === 'stopped' || row.status === 'interrupted' ? <CircleStop size={15} /> : row.terminal ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className="spin" />
  return (
    <div className={`timeline-row run-status-row run-status-${row.status}`}>
      {icon}
      <span>{runStatusText(row)}</span>
      {row.elapsedSeconds > 0 ? <time>{row.elapsedSeconds}s</time> : null}
    </div>
  )
}

function runStatusText(row: RunStatusRow) {
  if (row.error) return `运行失败：${row.error}`
  switch (row.status) {
    case 'queued': return '等待开始'
    case 'running': return row.currentStage ? `正在${stageLabel(row.currentStage)}` : '正在分析'
    case 'waiting-permission': return '等待权限确认'
    case 'waiting-question': return '等待你的回答'
    case 'waiting-plan-confirmation': return '等待计划确认'
    case 'completed': return '已完成'
    case 'failed': return '运行失败'
    case 'stopped': return '已停止，已保留当前执行过程'
    case 'interrupted': return '已中断，已保留当前执行过程'
  }
}

function stageLabel(stage: NonNullable<RunStatusRow['currentStage']>) {
  return stage === 'planner' ? '制定计划' : stage === 'developer' ? '执行修改' : '审核结果'
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending': return '等待中'
    case 'running': return '进行中'
    case 'waiting-permission': return '等待权限'
    case 'waiting-question': return '等待回答'
    case 'waiting-plan-confirmation': return '等待确认'
    case 'success': return '已完成'
    case 'completed': return '已完成'
    case 'error': return '发生错误'
    case 'failed': return '失败'
    case 'interrupted': return '已中断'
    case 'stopped': return '已停止'
    default: return status
  }
}

function toolGroupStatus(row: ToolGroupRow) {
  if (row.items.some((item) => item.kind === 'tool' ? item.state === 'error' : item.status === 'error')) return 'error'
  if (row.items.some((item) => item.kind === 'tool' ? item.state === 'running' || item.state === 'pending' || item.state === 'waiting-permission' : item.status === 'running')) return 'running'
  if (row.items.some((item) => item.kind === 'tool' ? item.state === 'interrupted' : item.status === 'interrupted')) return 'interrupted'
  return 'completed'
}

function commandCount(row: ToolGroupRow) {
  return row.items.reduce((count, item) => count + (item.kind === 'activity' && item.commands.length > 0 ? item.commands.length : 1), 0)
}

function toolCommand(item: ToolRow) {
  return item.command ?? (item.input == null ? null : stringify(item.input))
}

function compactCommand(command: string) {
  const normalized = command.replace(/\s+/g, ' ').trim()
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized
}

function toolIcon(item: ToolRow) {
  if (item.tool.toLowerCase().includes('powershell') || item.command) return <Terminal size={14} strokeWidth={1.7} />
  if (item.tool.toLowerCase().includes('edit') || item.tool.toLowerCase().includes('write')) return <FileCode2 size={14} strokeWidth={1.7} />
  return <Code2 size={14} strokeWidth={1.7} />
}

function activityIcon(item: ActivityRow) {
  if (item.activity === 'context-compression') return <Archive size={14} strokeWidth={1.7} />
  if (item.activity === 'file-edit') return <FileCode2 size={14} strokeWidth={1.7} />
  return <Code2 size={14} strokeWidth={1.7} />
}

function stringify(value: unknown) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

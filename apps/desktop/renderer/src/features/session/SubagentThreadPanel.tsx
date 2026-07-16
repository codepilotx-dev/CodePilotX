import React from 'react'
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Circle,
  Code2,
  FileDiff,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  Send,
  Square,
  Wrench,
  X,
} from 'lucide-react'
import type {
  ApprovalRequest,
  Item,
  SubagentRun,
  SubagentTask,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import {
  createThreadView,
  type ThreadTimelineRow,
} from '@codepilotx/session-view/thread'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { MarkdownMessage } from './MarkdownMessage.js'

export interface SubagentThreadCapabilities {
  canSend: boolean
  canStop: boolean
  canRetry: boolean
  canRespondToApprovals: boolean
  canRespondToQuestions: boolean
  canSubmitPlanDecision: boolean
  canApplyWorktree: boolean
  canDiscardWorktree: boolean
  canRestoreWorkspace: boolean
}

export interface SubagentThreadCallbacks {
  onStop?: (task: SubagentTask, run: SubagentRun) => void
  onRetry?: (task: SubagentTask, run: SubagentRun) => void
  onApplyWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onDiscardWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onRestoreWorkspace?: (task: SubagentTask, run: SubagentRun) => void
  onOpenSubagent?: (item: Extract<Item, { type: 'subagent' }>) => void
  onApprovalRespond?: (
    approval: ApprovalRequest,
    decision: 'allow-once' | 'deny' | 'stop',
  ) => void
  onQuestionRespond?: (
    question: Extract<Item, { type: 'question' }>,
    response: { answer: string | null; ignored: boolean },
  ) => void
  onPlanDecision?: (
    plan: Extract<Item, { type: 'plan' }>,
    decision: 'continue' | 'reject',
  ) => void
}

export interface SubagentThreadPanelProps {
  task: SubagentTask
  run: SubagentRun
  snapshot: ThreadSnapshot
  capabilities: SubagentThreadCapabilities
  callbacks: SubagentThreadCallbacks
  composer?: React.ReactNode
}

export function SubagentThreadPanel({
  task,
  run,
  snapshot,
  capabilities,
  callbacks,
  composer,
}: SubagentThreadPanelProps): React.ReactNode {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const view = React.useMemo(
    () => createThreadView(snapshot, { runId: run.id }),
    [run.id, snapshot],
  )
  const blocked = isBlockedRun(run) || view.blocked
  const canStop = capabilities.canStop && Boolean(callbacks.onStop) && isActiveRun(run)
  const canRetry = capabilities.canRetry && Boolean(callbacks.onRetry) && isTerminalRun(run)

  React.useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const key = `codepilotx.subagent.scroll.${task.childThreadId}`
    const stored = Number(window.sessionStorage.getItem(key) ?? 0)
    if (Number.isFinite(stored)) element.scrollTop = stored
    const persist = () => window.sessionStorage.setItem(key, String(element.scrollTop))
    element.addEventListener('scroll', persist, { passive: true })
    return () => {
      persist()
      element.removeEventListener('scroll', persist)
    }
  }, [task.childThreadId])

  return (
    <section
      aria-label={`${task.displayName} 子智能体线程`}
      className="subagent-thread-panel"
      data-blocked={blocked || undefined}
      data-status={run.status}
    >
      <header className="subagent-thread-panel__header">
        <div className="subagent-thread-panel__identity">
          <span className="subagent-thread-panel__avatar" aria-hidden="true">
            <Bot size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </span>
          <div className="subagent-thread-panel__title-block">
            <div className="subagent-thread-panel__title-line">
              <h2>{task.displayName}</h2>
              <StatusBadge status={run.status} />
            </div>
            <span>
              {profileLabel(task.profile)} · {run.model.id} · 第 {run.generation} 次运行
            </span>
          </div>
        </div>
        <div className="subagent-thread-panel__run-actions">
          {capabilities.canApplyWorktree && callbacks.onApplyWorktree ? (
            <button aria-label="应用子智能体变更" className="subagent-thread-panel__icon-button" title="应用变更" type="button" onClick={() => callbacks.onApplyWorktree?.(task, run)}>
              <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
          {capabilities.canDiscardWorktree && callbacks.onDiscardWorktree ? (
            <button aria-label="丢弃子智能体工作树" className="subagent-thread-panel__icon-button is-danger" title="丢弃工作树" type="button" onClick={() => callbacks.onDiscardWorktree?.(task, run)}>
              <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
          {capabilities.canRestoreWorkspace && callbacks.onRestoreWorkspace ? (
            <button aria-label="恢复子智能体共享变更" className="subagent-thread-panel__icon-button" title="恢复共享变更" type="button" onClick={() => callbacks.onRestoreWorkspace?.(task, run)}>
              <RotateCcw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
          {canRetry ? (
            <button
              aria-label="重试子智能体"
              className="subagent-thread-panel__icon-button"
              title="重试"
              type="button"
              onClick={() => callbacks.onRetry?.(task, run)}
            >
              <RotateCcw size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
          {canStop ? (
            <button
              aria-label="停止子智能体"
              className="subagent-thread-panel__icon-button is-danger"
              title="停止"
              type="button"
              onClick={() => callbacks.onStop?.(task, run)}
            >
              <Square size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </button>
          ) : null}
        </div>
      </header>

      <div ref={scrollRef} className="subagent-thread-panel__scroll-region">
        <div className="subagent-thread-panel__transcript">
          <article className="subagent-thread-panel__task">
            <span>任务</span>
            <p>{task.task}</p>
          </article>

          {run.queueReason ? (
            <div className="subagent-thread-panel__notice" role="status">
              <LoaderCircle className="is-spinning" size={APP_ICON_SIZE} />
              {queueReasonLabel(run.queueReason)}
            </div>
          ) : null}

          {view.rows.length > 0 ? (
            <div className="subagent-thread-panel__timeline">
              {view.rows.map((row) => (
                <ThreadRow
                  key={row.id}
                  row={row}
                  capabilities={capabilities}
                  callbacks={callbacks}
                />
              ))}
            </div>
          ) : (
            <div className="subagent-thread-panel__empty" role="status">
              {run.status === 'queued' || run.status === 'preparing'
                ? '等待开始执行'
                : '暂无运行记录'}
            </div>
          )}

          {view.pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              enabled={capabilities.canRespondToApprovals}
              onRespond={callbacks.onApprovalRespond}
            />
          ))}

          {blocked ? <BlockedNotice run={run} viewBlocked={view.blocked} /> : null}
          {run.error ? (
            <div className="subagent-thread-panel__error" role="alert">
              <AlertCircle size={APP_ICON_SIZE} />
              <span>{run.error}</span>
            </div>
          ) : null}
          {run.result ? <RunResult result={run.result} /> : null}
        </div>
      </div>

      {composer ? (
        <footer
          aria-disabled={!capabilities.canSend}
          className="subagent-thread-panel__composer-slot"
          data-disabled={!capabilities.canSend || undefined}
        >
          {composer}
        </footer>
      ) : null}
    </section>
  )
}

function ThreadRow({
  row,
  capabilities,
  callbacks,
}: {
  row: ThreadTimelineRow
  capabilities: SubagentThreadCapabilities
  callbacks: SubagentThreadCallbacks
}): React.ReactNode {
  if (row.kind === 'text') {
    return (
      <article className="subagent-thread-row subagent-thread-row--text">
        <MarkdownMessage
          text={row.item.text}
          streaming={row.item.status === 'streaming'}
        />
      </article>
    )
  }
  if (row.kind === 'reasoning') {
    return (
      <details
        className="subagent-thread-row subagent-thread-row--details"
        open={row.item.status === 'streaming'}
      >
        <summary>
          <Brain size={APP_ICON_SIZE} />
          <span>{row.item.status === 'streaming' ? '正在思考' : '思考过程'}</span>
          <ChevronDown size={APP_ICON_SIZE} />
        </summary>
        <div className="subagent-thread-row__detail-body">
          <MarkdownMessage
            text={row.item.text}
            streaming={row.item.status === 'streaming'}
          />
        </div>
      </details>
    )
  }
  if (row.kind === 'activity') {
    return <ActivityRow item={row.item} />
  }
  if (row.kind === 'tool') {
    return <ToolRow item={row.item} />
  }
  if (row.kind === 'plan') {
    return (
      <PlanRow
        item={row.item}
        enabled={capabilities.canSubmitPlanDecision}
        onDecision={callbacks.onPlanDecision}
      />
    )
  }
  if (row.kind === 'question') {
    return (
      <QuestionRow
        item={row.item}
        enabled={capabilities.canRespondToQuestions}
        onRespond={callbacks.onQuestionRespond}
      />
    )
  }
  if (row.kind === 'patch') {
    return <PatchRow item={row.item} />
  }
  return (
    <button
      className="subagent-thread-row subagent-thread-row--subagent"
      disabled={!callbacks.onOpenSubagent}
      type="button"
      onClick={() => callbacks.onOpenSubagent?.(row.item)}
    >
      <GitBranch size={APP_ICON_SIZE} />
      <span className="subagent-thread-row__main">
        <strong>{row.item.displayName}</strong>
        <small>{row.item.task}</small>
      </span>
      <span className="subagent-thread-row__status">
        {subagentStatusLabel(row.item.status)}
      </span>
    </button>
  )
}

function ActivityRow({
  item,
}: {
  item: Extract<Item, { type: 'activity' }>
}): React.ReactNode {
  const hasDetails = Boolean(item.detail || item.commands?.length)
  return (
    <details className="subagent-thread-row subagent-thread-row--details" open={item.status === 'running'}>
      <summary>
        <ActivityStatusIcon status={item.status} />
        <span>{item.title}</span>
        {hasDetails ? <ChevronDown size={APP_ICON_SIZE} /> : null}
      </summary>
      {hasDetails ? (
        <div className="subagent-thread-row__detail-body">
          {item.detail ? <p>{item.detail}</p> : null}
          {item.commands?.map((command, index) => (
            <div className="subagent-thread-row__command" key={`${item.id}:${index}`}>
              <code>{command.command}</code>
              {command.output ? <pre>{command.output}</pre> : null}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  )
}

function ToolRow({ item }: { item: Extract<Item, { type: 'tool' }> }): React.ReactNode {
  const input = formatUnknown(item.input)
  return (
    <details
      className="subagent-thread-row subagent-thread-row--details"
      open={item.state === 'running' || item.state === 'waiting-permission'}
    >
      <summary>
        <Wrench size={APP_ICON_SIZE} />
        <span>{item.title || item.tool}</span>
        <small>{toolStateLabel(item.state)}</small>
        <ChevronDown size={APP_ICON_SIZE} />
      </summary>
      <div className="subagent-thread-row__detail-body">
        {item.command ? <code className="subagent-thread-row__inline-code">{item.command}</code> : null}
        {!item.command && input ? <pre>{input}</pre> : null}
        {item.output ? <pre>{item.output}</pre> : null}
        {item.error ? <pre className="is-error">{item.error}</pre> : null}
      </div>
    </details>
  )
}

function PlanRow({
  item,
  enabled,
  onDecision,
}: {
  item: Extract<Item, { type: 'plan' }>
  enabled: boolean
  onDecision?: SubagentThreadCallbacks['onPlanDecision']
}): React.ReactNode {
  const pending = item.state === 'awaiting-confirmation'
  return (
    <article className="subagent-thread-row subagent-thread-row--plan">
      <header>
        <span>计划</span>
        <strong>{item.title}</strong>
      </header>
      <MarkdownMessage text={item.markdown} streaming={item.state === 'draft'} />
      {pending ? (
        <div className="subagent-thread-row__actions">
          <button
            className="subagent-thread-panel__button"
            disabled={!enabled || !onDecision}
            type="button"
            onClick={() => onDecision?.(item, 'reject')}
          >
            要求修改
          </button>
          <button
            className="subagent-thread-panel__button is-primary"
            disabled={!enabled || !onDecision}
            type="button"
            onClick={() => onDecision?.(item, 'continue')}
          >
            <Check size={APP_ICON_SIZE} />
            继续
          </button>
        </div>
      ) : null}
    </article>
  )
}

function QuestionRow({
  item,
  enabled,
  onRespond,
}: {
  item: Extract<Item, { type: 'question' }>
  enabled: boolean
  onRespond?: SubagentThreadCallbacks['onQuestionRespond']
}): React.ReactNode {
  const [selected, setSelected] = React.useState(item.choices[0]?.label ?? '')
  const [custom, setCustom] = React.useState('')
  if (item.status !== 'pending') {
    return (
      <article className="subagent-thread-row subagent-thread-row--answer">
        <strong>{item.prompt}</strong>
        <p>{item.answer ?? (item.status === 'ignored' ? '已跳过' : '未回答')}</p>
      </article>
    )
  }
  const answer = custom.trim() || selected
  return (
    <article className="subagent-thread-row subagent-thread-row--question">
      <header>
        <span>子智能体提问</span>
        <strong>{item.prompt}</strong>
      </header>
      {item.choices.length > 0 ? (
        <div className="subagent-thread-row__choices">
          {item.choices.map((choice) => (
            <label key={choice.id}>
              <input
                checked={selected === choice.label && !custom}
                disabled={!enabled}
                name={`subagent-question:${item.id}`}
                type="radio"
                value={choice.label}
                onChange={() => {
                  setSelected(choice.label)
                  setCustom('')
                }}
              />
              <span>
                <strong>{choice.label}</strong>
                {choice.description ? <small>{choice.description}</small> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <textarea
        aria-label="自定义回答"
        disabled={!enabled}
        placeholder="输入其他回答"
        rows={2}
        value={custom}
        onChange={(event) => setCustom(event.target.value)}
      />
      <div className="subagent-thread-row__actions">
        <button
          className="subagent-thread-panel__button"
          disabled={!enabled || !onRespond}
          type="button"
          onClick={() => onRespond?.(item, { answer: null, ignored: true })}
        >
          跳过
        </button>
        <button
          className="subagent-thread-panel__button is-primary"
          disabled={!enabled || !onRespond || !answer}
          type="button"
          onClick={() => onRespond?.(item, { answer, ignored: false })}
        >
          <Send size={APP_ICON_SIZE} />
          提交
        </button>
      </div>
    </article>
  )
}

function PatchRow({ item }: { item: Extract<Item, { type: 'patch' }> }): React.ReactNode {
  return (
    <article className="subagent-thread-row subagent-thread-row--patch">
      <header>
        <FileDiff size={APP_ICON_SIZE} />
        <strong>已编辑 {item.files.length} 个文件</strong>
        <small>
          <span className="diff-added">+{item.totalAdditions}</span>
          <span className="diff-removed">-{item.totalDeletions}</span>
        </small>
      </header>
      <ul>
        {item.files.map((file) => (
          <li key={file.path}>
            <span>{file.path}</span>
            <small>
              <span className="diff-added">+{file.additions}</span>
              <span className="diff-removed">-{file.deletions}</span>
            </small>
          </li>
        ))}
      </ul>
    </article>
  )
}

function ApprovalCard({
  approval,
  enabled,
  onRespond,
}: {
  approval: ApprovalRequest
  enabled: boolean
  onRespond?: SubagentThreadCallbacks['onApprovalRespond']
}): React.ReactNode {
  return (
    <article className="subagent-thread-row subagent-thread-row--approval" aria-label="审批请求">
      <header>
        <AlertCircle size={APP_ICON_SIZE} />
        <span>
          <strong>{approval.tool}</strong>
          <small>{approval.reason}</small>
        </span>
        <em data-risk={approval.risk}>{riskLabel(approval.risk)}</em>
      </header>
      {approval.command ? <pre>{approval.command}</pre> : null}
      {approval.paths.length > 0 ? <p>{approval.paths.join('\n')}</p> : null}
      <div className="subagent-thread-row__actions">
        <button
          className="subagent-thread-panel__button"
          disabled={!enabled || !onRespond}
          type="button"
          onClick={() => onRespond?.(approval, 'deny')}
        >
          拒绝
        </button>
        <button
          className="subagent-thread-panel__button is-primary"
          disabled={!enabled || !onRespond}
          type="button"
          onClick={() => onRespond?.(approval, 'allow-once')}
        >
          允许一次
        </button>
      </div>
    </article>
  )
}

function BlockedNotice({
  run,
  viewBlocked,
}: {
  run: SubagentRun
  viewBlocked: boolean
}): React.ReactNode {
  const label = run.status === 'waiting-permission'
    ? '等待审批后继续'
    : run.status === 'waiting-question'
      ? '等待回答后继续'
      : viewBlocked
        ? '此子智能体正在等待你的操作'
        : '此子智能体已阻塞'
  return (
    <div className="subagent-thread-panel__blocked" role="status">
      <AlertCircle size={APP_ICON_SIZE} />
      <span>{label}</span>
    </div>
  )
}

function RunResult({ result }: { result: NonNullable<SubagentRun['result']> }): React.ReactNode {
  return (
    <article className="subagent-thread-panel__result" data-outcome={result.outcome}>
      <header>
        {result.outcome === 'succeeded'
          ? <Check size={APP_ICON_SIZE} />
          : <AlertCircle size={APP_ICON_SIZE} />}
        <strong>{result.summary}</strong>
      </header>
      {result.findings.length > 0 ? (
        <ul>
          {result.findings.map((finding, index) => (
            <li key={`${finding.title}:${index}`}>
              <strong>{finding.title}</strong>
              <span>{finding.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

function StatusBadge({ status }: { status: SubagentRun['status'] }): React.ReactNode {
  return (
    <span className="subagent-thread-panel__status-badge" data-status={status}>
      {isActiveRunStatus(status)
        ? <LoaderCircle className="is-spinning" size={12} />
        : status === 'completed'
          ? <Check size={12} />
          : status === 'failed'
            ? <X size={12} />
            : <Circle size={12} />}
      {subagentStatusLabel(status)}
    </span>
  )
}

function ActivityStatusIcon({ status }: { status: Extract<Item, { type: 'activity' }>['status'] }): React.ReactNode {
  if (status === 'running') return <LoaderCircle className="is-spinning" size={APP_ICON_SIZE} />
  if (status === 'completed') return <Check size={APP_ICON_SIZE} />
  if (status === 'error') return <X size={APP_ICON_SIZE} />
  return <Circle size={APP_ICON_SIZE} />
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function profileLabel(profile: SubagentTask['profile']): string {
  if (profile === 'explorer') return '探索'
  if (profile === 'worker') return '执行'
  return '默认'
}

function subagentStatusLabel(status: SubagentRun['status'] | Extract<Item, { type: 'subagent' }>['status']): string {
  const labels: Record<string, string> = {
    queued: '排队中',
    preparing: '准备中',
    running: '运行中',
    steering: '调整中',
    'waiting-question': '等待回答',
    'waiting-permission': '等待审批',
    completed: '已完成',
    failed: '失败',
    stopped: '已停止',
    interrupted: '已中断',
  }
  return labels[status] ?? status
}

function queueReasonLabel(reason: NonNullable<SubagentRun['queueReason']>): string {
  if (reason === 'parent-limit') return '等待同一父智能体释放并发名额'
  if (reason === 'global-limit') return '等待全局并发名额'
  return '等待共享工作区写入锁'
}

function toolStateLabel(state: Extract<Item, { type: 'tool' }>['state']): string {
  const labels: Record<typeof state, string> = {
    pending: '等待中',
    'waiting-permission': '等待审批',
    running: '运行中',
    completed: '已完成',
    error: '失败',
    interrupted: '已中断',
  }
  return labels[state]
}

function riskLabel(risk: ApprovalRequest['risk']): string {
  return { low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险' }[risk]
}

function isBlockedRun(run: SubagentRun): boolean {
  return run.status === 'waiting-permission'
    || run.status === 'waiting-question'
    || run.result?.outcome === 'blocked'
}

function isActiveRun(run: SubagentRun): boolean {
  return isActiveRunStatus(run.status)
    || run.status === 'waiting-permission'
    || run.status === 'waiting-question'
}

function isActiveRunStatus(status: SubagentRun['status']): boolean {
  return status === 'queued'
    || status === 'preparing'
    || status === 'running'
    || status === 'steering'
}

function isTerminalRun(run: SubagentRun): boolean {
  return run.status === 'completed'
    || run.status === 'failed'
    || run.status === 'stopped'
    || run.status === 'interrupted'
}

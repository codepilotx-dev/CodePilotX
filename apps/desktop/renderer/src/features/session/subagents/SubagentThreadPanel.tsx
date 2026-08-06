import React from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  Circle,
  LoaderCircle,
  RotateCcw,
  Send,
  Square,
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
  createCanonicalThreadState,
  pageFromThreadSnapshot,
  selectRenderTurnEntries,
  selectVisibleTurnEntries,
} from '@codepilotx/session-view'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { approvalToRequest } from '../../../services/agentThreadAdapter.js'
import { InlineApprovalCard } from '../approvals/InlineApprovalCard.js'
import type { DesktopPermissionGrantScope } from '../../../../shared/types.js'
import {
  CanonicalConversationTurn,
  useTimelineDisclosureState,
} from '../timeline/CanonicalThreadView.js'
import { normalizePatchActionError } from '../timeline/patchActionError.js'
import { subagentStatusLabel } from './subagentStatusLabel.js'

export interface SubagentThreadCapabilities {
  canStop: boolean
  canRetry: boolean
  canRespondToApprovals: boolean
  canRespondToQuestions: boolean
  canApplyWorktree: boolean
  canDiscardWorktree: boolean
  canRestoreWorkspace: boolean
}

export interface SubagentThreadCallbacks {
  onPatchApplied?: () => Promise<void>
  onStop?: (task: SubagentTask, run: SubagentRun) => void
  onRetry?: (task: SubagentTask, run: SubagentRun) => void
  onApplyWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onDiscardWorktree?: (task: SubagentTask, run: SubagentRun) => void
  onRestoreWorkspace?: (task: SubagentTask, run: SubagentRun) => void
  onOpenSubagent?: (item: Extract<Item, { type: 'subagent' }>) => void
  onOpenPatchReview?: (path?: string) => void
  onApprovalRespond?: (
    approval: ApprovalRequest,
    decision: 'allow-once' | 'deny' | 'stop',
  ) => void
  onPermissionRespond?: (
    approval: ApprovalRequest,
    behavior: 'allow' | 'deny',
    grantScope?: DesktopPermissionGrantScope,
  ) => void
  onQuestionRespond?: (
    question: Extract<Item, { type: 'question' }>,
    response: { answer: string | null; ignored: boolean },
  ) => void
}

export interface SubagentThreadPanelProps {
  task: SubagentTask
  run: SubagentRun
  snapshot: ThreadSnapshot
  capabilities: SubagentThreadCapabilities
  callbacks: SubagentThreadCallbacks
  onBackToParent?: () => void
}

export function SubagentThreadPanel({
  task,
  run,
  snapshot,
  capabilities,
  callbacks,
  onBackToParent,
}: SubagentThreadPanelProps): React.ReactNode {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const disclosureState = useTimelineDisclosureState(task.childThreadId)
  const canonicalState = React.useMemo(
    () => createCanonicalThreadState(pageFromThreadSnapshot(snapshot)),
    [snapshot],
  )
  const canonicalTurns = React.useMemo(
    () => selectRenderTurnEntries(canonicalState, { type: 'subagent', runId: run.id }),
    [canonicalState, run.id],
  )
  const visibleTurns = React.useMemo(
    () => selectVisibleTurnEntries(canonicalState, { type: 'subagent', runId: run.id }),
    [canonicalState, run.id],
  )
  const pendingApprovals = React.useMemo(
    () => visibleTurns.flatMap((turn) => turn.approvals).filter((approval) => approval.status === 'pending'),
    [visibleTurns],
  )
  const permissionApprovals = React.useMemo(
    () => pendingApprovals.filter((approval) => Boolean(approval.permissionGrant)),
    [pendingApprovals],
  )
  const approvalApprovals = React.useMemo(
    () => pendingApprovals.filter((approval) => !approval.permissionGrant),
    [pendingApprovals],
  )
  const pendingQuestions = React.useMemo(
    () => visibleTurns.flatMap((turn) => turn.items).filter((item): item is Extract<Item, { type: 'question' }> => item.type === 'question' && item.status === 'pending'),
    [visibleTurns],
  )
  const viewBlocked = pendingApprovals.length + pendingQuestions.length > 0
  const blocked = isBlockedRun(run) || viewBlocked
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
          {onBackToParent ? (
            <IconButton
              className="subagent-thread-panel__back"
              title="返回主对话"
              variant="plain"
              onClick={onBackToParent}
            >
              <ArrowLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </IconButton>
          ) : null}
          <span className="subagent-thread-panel__avatar" aria-hidden="true">
            <Bot size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </span>
          <div className="subagent-thread-panel__title-block">
            <h2>{task.displayName}</h2>
          </div>
        </div>
        <div className="subagent-thread-panel__run-actions">
          <StatusBadge status={run.status} />
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
          {run.queueReason ? (
            <div className="subagent-thread-panel__notice" role="status">
              <LoaderCircle className="is-spinning" size={APP_ICON_SIZE} />
              {queueReasonLabel(run.queueReason)}
            </div>
          ) : null}

          {canonicalTurns.length > 0 ? (
            <div className="subagent-thread-panel__timeline">
              {canonicalTurns.map((turn) => (
                 <CanonicalConversationTurn
                   disclosureState={disclosureState}
                   entry={turn}
                  key={turn.id}
                  onApplyPatch={async (itemId, action, expectedVersion) => {
                    try {
                      await desktopClient.applyThreadPatch({
                        threadId: task.childThreadId,
                        itemId,
                        action,
                        expectedVersion,
                      })
                      await callbacks.onPatchApplied?.()
                    } catch (error) {
                      throw normalizePatchActionError(error, action)
                    }
                  }}
                  onOpenPatchReview={callbacks.onOpenPatchReview}
                  onOpenPlanInRightDock={() => undefined}
                  onOpenSubagent={(taskId) => {
                    const item = snapshot.items.find((candidate): candidate is Extract<Item, { type: 'subagent' }> => candidate.type === 'subagent' && candidate.subagentTaskId === taskId)
                    if (item) callbacks.onOpenSubagent?.(item)
                  }}
                  rightDockPlanEventId={null}
                  readThreadPatchDiff={desktopClient.readThreadPatchDiff}
                  threadId={task.childThreadId}
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

          {permissionApprovals.map((approval) => (
            <InlineApprovalCard
              key={approval.id}
              request={approvalToRequest(approval)}
              onDecide={(_request, behavior, _alwaysAllow, _updatedInput, extras) =>
                callbacks.onPermissionRespond?.(
                  approval,
                  behavior,
                  extras?.grantScope,
                )
              }
            />
          ))}

          {approvalApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              enabled={capabilities.canRespondToApprovals}
              onRespond={callbacks.onApprovalRespond}
            />
          ))}

          {pendingQuestions.map((question) => (
            <QuestionRow
              key={`response:${question.id}`}
              item={question}
              enabled={capabilities.canRespondToQuestions}
              onRespond={callbacks.onQuestionRespond}
            />
          ))}

          {blocked ? <BlockedNotice run={run} viewBlocked={viewBlocked} /> : null}
          {run.error ? (
            <div className="subagent-thread-panel__error" role="alert">
              <AlertCircle size={APP_ICON_SIZE} />
              <span>{run.error}</span>
            </div>
          ) : null}
          {run.result ? <RunResult result={run.result} /> : null}
        </div>
      </div>
    </section>
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
        <Button
          disabled={!enabled || !onRespond}
          onClick={() => onRespond?.(item, { answer: null, ignored: true })}
        >
          跳过
        </Button>
        <Button
          disabled={!enabled || !onRespond || !answer}
          onClick={() => onRespond?.(item, { answer, ignored: false })}
        >
          <Send size={APP_ICON_SIZE} />
          提交
        </Button>
      </div>
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
        <Button
          disabled={!enabled || !onRespond}
          tone="danger"
          onClick={() => onRespond?.(approval, 'deny')}
        >
          拒绝
        </Button>
        <Button
          disabled={!enabled || !onRespond}
          onClick={() => onRespond?.(approval, 'allow-once')}
        >
          允许一次
        </Button>
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

function queueReasonLabel(reason: NonNullable<SubagentRun['queueReason']>): string {
  if (reason === 'parent-limit') return '等待同一父智能体释放并发名额'
  if (reason === 'global-limit') return '等待全局并发名额'
  return '等待共享工作区写入锁'
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

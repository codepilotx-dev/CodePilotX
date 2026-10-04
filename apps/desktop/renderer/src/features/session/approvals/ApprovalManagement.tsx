import React from 'react'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { Button } from '../../../components/ui/Button.js'
import { RequestCard } from './RequestCard.js'
import { useApprovalCapability } from './useQuestionSkipCapability.js'

type ReviewState = RpcResult<'approval/reviewState'>
const dismissedNudges = new Set<string>()

export function useApprovalReviewState(threadId: string | null | undefined, busy: boolean) {
  const supported = useApprovalCapability(threadId ?? '', !!threadId, 'approval.retry.v1')
  const [state, setState] = React.useState<ReviewState>({ manualAllows: 0, denials: [] })
  React.useEffect(() => {
    let active = true
    setState({ manualAllows: 0, denials: [] })
    if (supported && threadId)
      void desktopClient
        .approvalReviewState(threadId)
        .then((result) => {
          if (active) setState(result)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [threadId, busy, supported])
  return { supported, state }
}

export function AutoReviewNudge({
  threadId,
  enabled,
  onEnable,
}: {
  threadId: string
  enabled: boolean
  onEnable: () => void | Promise<void>
}) {
  const [dismissed, setDismissed] = React.useState(() => dismissedNudges.has(threadId))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  if (!enabled || dismissed) return null
  const close = () => {
    dismissedNudges.add(threadId)
    setDismissed(true)
  }
  return (
    <RequestCard
      title="启用自动审查？"
      variant="permission"
      description={
        <>
          <p className="inline-approval-target">
            你已成功允许三次操作。可以由 Guardian 审查后续操作；关闭此提示会保留人工审批。
          </p>
          {error ? <p role="alert">{error}</p> : null}
        </>
      }
      actions={
        <div className="inline-approval-actions">
          <Button color="secondary" disabled={busy} onClick={close}>
            保持人工审批
          </Button>
          <Button
            color="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              void Promise.resolve()
                .then(onEnable)
                .then(close)
                .catch(() => setError('启用失败，请重试。'))
                .finally(() => setBusy(false))
            }}
          >
            启用自动审查
          </Button>
        </div>
      }
    >
      {null}
    </RequestCard>
  )
}

export function ApprovalRulesDialog({
  threadId,
  open,
  onClose,
}: {
  threadId: string
  open: boolean
  onClose: () => void
}) {
  const [rules, setRules] = React.useState<RpcResult<'approval/rules/list'>['rules']>([])
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let active = true
    if (open) {
      setError('')
      setBusy(true)
      void desktopClient
        .listApprovalRules(threadId)
        .then((result) => {
          if (active) setRules(result.rules)
        })
        .catch(() => {
          if (active) setError('项目授权规则暂时不可用。')
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }
    return () => {
      active = false
    }
  }, [threadId, open])
  return (
    <ConfirmationDialog
      open={open}
      title="当前项目授权"
      actionLabel="关闭"
      onAction={onClose}
      onCancel={onClose}
      description={
        <div className="request-card-content">
          <p>精确域名与特定 MCP 工具规则仅适用于当前项目。</p>
          {error ? <p role="alert">{error}</p> : null}
          {!busy && !rules.length && !error ? <p>暂无持久授权规则。</p> : null}
          {rules.map((rule) => (
            <div key={rule.id} className="inline-approval-actions">
              <span>{rule.target.join(' / ')}</span>
              <Button
                color="secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void desktopClient
                    .revokeApprovalRule(threadId, rule.id)
                    .then(() =>
                      setRules((current) => current.filter((entry) => entry.id !== rule.id)),
                    )
                    .catch(() => setError('撤销授权失败，请重试。'))
                    .finally(() => setBusy(false))
                }}
              >
                撤销
              </Button>
            </div>
          ))}
        </div>
      }
    />
  )
}

export function ApprovalRetryDialog({
  threadId,
  open,
  onClose,
}: {
  threadId: string
  open: boolean
  onClose: () => void
}) {
  const [state, setState] = React.useState<ReviewState>({ manualAllows: 0, denials: [] })
  const [selected, setSelected] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let active = true
    if (open) {
      setBusy(true)
      setError('')
      void desktopClient
        .approvalReviewState(threadId)
        .then((result) => {
          if (active) {
            setState(result)
            setSelected(result.denials[0]?.id ?? '')
          }
        })
        .catch(() => {
          if (active) setError('自动审查记录暂时不可用。')
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }
    return () => {
      active = false
    }
  }, [threadId, open])
  return (
    <ConfirmationDialog
      open={open}
      title="重试被自动审查拒绝的操作？"
      actionLabel="授权一次并请求重试"
      actionDisabled={busy || !selected}
      onCancel={() => {
        if (!busy) onClose()
      }}
      onAction={() => {
        setBusy(true)
        setError('')
        void desktopClient
          .retryApproval(threadId, selected)
          .then(onClose)
          .catch(() => setError('请求重试失败，请重试。'))
          .finally(() => setBusy(false))
      }}
      description={
        <div className="request-card-content">
          <p>授权仅匹配原工具、参数和范围，重试仍经过 Guardian。</p>
          {error ? <p role="alert">{error}</p> : null}
          {!busy && !state.denials.length ? <p>当前聊天没有可重试的自动审查拒绝。</p> : null}
          {state.denials.map((denial) => (
            <button
              type="button"
              key={denial.id}
              role="radio"
              aria-checked={selected === denial.id}
              className={`inline-approval-option${selected === denial.id ? ' selected' : ''}`}
              disabled={busy}
              onClick={() => setSelected(denial.id)}
            >
              <span>
                {denial.tool}：{denial.reason}
              </span>
              {denial.input ? (
                <pre className="inline-approval-command">
                  {JSON.stringify(denial.input, null, 2)}
                </pre>
              ) : null}
            </button>
          ))}
        </div>
      }
    />
  )
}

import React from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Pencil } from 'lucide-react'
import type { DesktopPermissionRequest } from '../../shared/types.js'

type ApprovalChoice = 'allow' | 'alwaysAllow' | 'deny'

export type InlineApprovalSummary = {
  label: string
  additions: number | null
  deletions: number | null
  accent: 'file' | 'tool'
}

export type InlineApprovalCardProps = {
  request: DesktopPermissionRequest
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
  ) => void
}

export function InlineApprovalCard({
  request,
  onDecide,
}: InlineApprovalCardProps): React.ReactNode {
  const [selectedChoice, setSelectedChoice] =
    React.useState<ApprovalChoice>('allow')
  const summary = buildInlineApprovalSummary(request)

  function submitChoice(): void {
    if (selectedChoice === 'allow') {
      onDecide(request, 'allow')
      return
    }
    if (selectedChoice === 'alwaysAllow') {
      onDecide(request, 'allow', true)
      return
    }
    onDecide(request, 'deny')
  }

  return (
    <section className="inline-approval-card" aria-label="等待审批">
      <header className="inline-approval-header">
        <h2>是否应用这些更改?</h2>
      </header>

      <div className="inline-approval-summary">
        <span className={`inline-approval-target ${summary.accent}`}>
          {summary.label}
        </span>
        {summary.additions !== null ? (
          <span className="inline-approval-additions">
            +{summary.additions}
          </span>
        ) : null}
        {summary.deletions !== null ? (
          <span className="inline-approval-deletions">
            -{summary.deletions}
          </span>
        ) : null}
        <span className="inline-approval-dot" />
      </div>

      <div className="inline-approval-options" role="radiogroup">
        <ApprovalOption
          index={1}
          label="是"
          selected={selectedChoice === 'allow'}
          onSelect={() => setSelectedChoice('allow')}
        />
        <ApprovalOption
          index={2}
          label="是，且本次会话不再询问"
          selected={selectedChoice === 'alwaysAllow'}
          onSelect={() => setSelectedChoice('alwaysAllow')}
        />
        <ApprovalOption
          muted
          indexIcon={<Pencil size={16} />}
          label="否，请告知 Codex 如何调整"
          selected={selectedChoice === 'deny'}
          onSelect={() => setSelectedChoice('deny')}
        />
      </div>

      <div className="inline-approval-footer">
        <button
          className="inline-approval-skip"
          type="button"
          onClick={() => onDecide(request, 'deny')}
        >
          跳过
        </button>
        <button
          className="inline-approval-submit"
          type="button"
          onClick={submitChoice}
        >
          提交
          <CornerDownLeft size={16} />
        </button>
      </div>
    </section>
  )
}

function ApprovalOption({
  index,
  indexIcon,
  label,
  muted = false,
  selected,
  onSelect,
}: {
  index?: number
  indexIcon?: React.ReactNode
  label: string
  muted?: boolean
  selected: boolean
  onSelect: () => void
}): React.ReactNode {
  return (
    <button
      aria-checked={selected}
      className={
        selected
          ? 'inline-approval-option selected'
          : muted
            ? 'inline-approval-option muted'
            : 'inline-approval-option'
      }
      role="radio"
      type="button"
      onClick={onSelect}
    >
      <span className="inline-approval-option-index">
        {indexIcon ?? index}
      </span>
      <span className="inline-approval-option-label">{label}</span>
      {selected ? (
        <span className="inline-approval-option-arrows" aria-hidden="true">
          <ArrowUp size={14} />
          <ArrowDown size={14} />
        </span>
      ) : null}
    </button>
  )
}

export function buildInlineApprovalSummary(
  request: DesktopPermissionRequest,
): InlineApprovalSummary {
  const filePath = request.input.file_path ?? request.input.filePath
  const additions = numberFromInput(request.input.additions)
  const deletions = numberFromInput(request.input.deletions)
  if (typeof filePath === 'string' && filePath.trim()) {
    return {
      label: filePath,
      additions,
      deletions,
      accent: 'file',
    }
  }

  return {
    label: request.description || request.toolName,
    additions: null,
    deletions: null,
    accent: 'tool',
  }
}

function numberFromInput(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

import React from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Info, Pencil } from 'lucide-react'
import type {
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { ExitPlanModeApproval } from './ExitPlanModeApproval.js'

type ApprovalChoice = 'allow' | 'alwaysAllow'

export type InlineApprovalCommand = {
  full: string
  hint: string
}

export type InlineApprovalCardProps = {
  request: DesktopPermissionRequest
  currentPermissionMode?: DesktopPermissionMode
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
  ) => void
  onAcceptExitPlanMode?: (
    request: DesktopPermissionRequest,
    nextMode: DesktopPermissionMode,
  ) => void
}

const COMMAND_HINT_MAX_LENGTH = 56

export function InlineApprovalCard({
  request,
  currentPermissionMode,
  onDecide,
  onAcceptExitPlanMode,
}: InlineApprovalCardProps): React.ReactNode {
  const [selectedChoice, setSelectedChoice] =
    React.useState<ApprovalChoice>('allow')
  const [feedback, setFeedback] = React.useState('')
  const command = buildInlineApprovalCommand(request)

  if (request.toolName === 'AskUserQuestion') {
    return (
      <section
        className="inline-approval-card workflow-composer-card workflow-composer-card-question"
        aria-label="回答问题"
      >
        <AskUserQuestionApproval
          request={request}
          onReject={() => onDecide(request, 'deny')}
          onSubmit={updatedInput =>
            onDecide(request, 'allow', false, updatedInput)
          }
        />
      </section>
    )
  }

  if (request.toolName === 'ExitPlanMode') {
    return (
      <section
        className="inline-approval-card workflow-composer-card workflow-composer-card-plan"
        aria-label="接受计划"
      >
        <ExitPlanModeApproval
          request={request}
          currentMode={currentPermissionMode ?? 'default'}
          onAccept={nextMode => {
            if (onAcceptExitPlanMode) {
              onAcceptExitPlanMode(request, nextMode)
              return
            }
            onDecide(request, 'allow')
          }}
          onRevise={() => onDecide(request, 'deny')}
        />
      </section>
    )
  }

  function submitChoice(): void {
    if (feedback.trim()) {
      onDecide(request, 'deny', false, { feedback: feedback.trim() })
      return
    }
    if (selectedChoice === 'alwaysAllow') {
      onDecide(request, 'allow', true)
      return
    }
    onDecide(request, 'allow')
  }

  return (
    <section
      className="inline-approval-card workflow-composer-card workflow-composer-card-permission"
      aria-label="等待审批"
    >
      <header className="inline-approval-header">
        <h2>{request.description}</h2>
      </header>
      {request.autoReviewFallbackReason ? (
        <p className="inline-approval-target">
          自动审查无法完成，已转为人工审批：{request.autoReviewFallbackReason}
        </p>
      ) : null}

      <div className="inline-approval-summary">
        <code className="inline-approval-command">{command.full}</code>
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
          label="是，且对于以后续内容开头的命令不再询问"
          hint={command.hint}
          selected={selectedChoice === 'alwaysAllow'}
          onSelect={() => setSelectedChoice('alwaysAllow')}
        />
      </div>

      <div className="inline-approval-fixed-option">
        <div
          className={
            feedback.trim()
              ? 'inline-approval-note filled'
              : 'inline-approval-note'
          }
        >
          <span className="inline-approval-note-icon" aria-hidden="true">
            <Pencil size={16} />
          </span>
          <textarea
            className="inline-approval-feedback-input"
            placeholder="否，请告知 Codex 如何调整"
            rows={1}
            value={feedback}
            onChange={event => {
              const next = event.target.value
              setFeedback(next)
              if (next.trim()) setSelectedChoice('allow')
            }}
          />
        </div>

        <div className="inline-approval-actions">
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
            <CornerDownLeft size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}

function ApprovalOption({
  index,
  indexIcon,
  label,
  hint,
  muted = false,
  selected,
  onSelect,
}: {
  index?: number
  indexIcon?: React.ReactNode
  label: string
  hint?: string
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
      <span className="inline-approval-option-label">
        {label}
        {hint ? (
          <span className="inline-approval-option-hint"> {hint}</span>
        ) : null}
      </span>
      <span className="inline-approval-option-info" aria-hidden="true">
        <Info size={14} />
      </span>
      {selected ? (
        <span className="inline-approval-option-arrows" aria-hidden="true">
          <ArrowUp size={14} />
          <ArrowDown size={14} />
        </span>
      ) : null}
    </button>
  )
}

export function buildInlineApprovalCommand(
  request: DesktopPermissionRequest,
): InlineApprovalCommand {
  const full = formatCommandLine(request)
  return {
    full,
    hint: truncateCommand(full, COMMAND_HINT_MAX_LENGTH),
  }
}

function formatCommandLine(request: DesktopPermissionRequest): string {
  const { toolName, input } = request
  const filePath = stringValue(input.file_path) ?? stringValue(input.filePath)
  const isFileTool =
    toolName === 'Edit' ||
    toolName === 'Write' ||
    toolName === 'MultiEdit' ||
    toolName === 'Read'

  if (isFileTool) {
    return filePath ? `${toolName} ${filePath}` : toolName
  }

  const parts: string[] = [toolName]
  for (const [key, value] of Object.entries(input)) {
    if (key === 'file_path' || key === 'filePath') continue
    const flag = key.length === 1 ? `-${key}` : `-${key}`
    if (typeof value === 'string') {
      parts.push(`${flag} ${quoteIfNeeded(value)}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${flag} ${String(value)}`)
    } else if (value !== null && value !== undefined) {
      parts.push(`${flag} ${JSON.stringify(value)}`)
    }
  }
  return parts.join(' ')
}

function quoteIfNeeded(value: string): string {
  if (value === '') return "''"
  if (/[\s'"$`]/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`
  }
  return value
}

function truncateCommand(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

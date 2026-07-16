import React from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Info, Pencil } from 'lucide-react'
import type {
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRememberOptionId,
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { ExitPlanModeApproval } from './ExitPlanModeApproval.js'
import {
  McpElicitationForm,
  McpElicitationUnsupported,
} from './mcpElicitation/McpElicitationForm.js'
import {
  getSchemaMode,
  parseMcpElicitationSchema,
} from './mcpElicitation/mcpElicitationUtils.js'

type ApprovalChoice = 'allow' | `remember:${DesktopPermissionRememberOptionId}`

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
    decisionExtras?: Pick<DesktopPermissionDecision, 'rememberOptionId'>,
  ) => void
  onAcceptExitPlanMode?: (
    request: DesktopPermissionRequest,
    options?: {
      note?: string
      planExecutionModel?: string
      savePlanExecutionModel?: boolean
    },
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
  const [isCommandExpanded, setIsCommandExpanded] = React.useState(false)
  const command = buildInlineApprovalCommand(request)
  const approvalTitle = inlineApprovalTitle(request)
  const rememberOptions = request.rememberOptions ?? []

  if (request.toolName === 'AskUserQuestion') {
    return (
      <section
        className="inline-approval-card workflow-composer-card workflow-composer-card-question"
        data-variant="question"
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
        data-variant="plan"
        aria-label="接受计划"
      >
        <ExitPlanModeApproval
          request={request}
          onAccept={options => {
            if (onAcceptExitPlanMode) {
              onAcceptExitPlanMode(request, options)
              return
            }
            onDecide(request, 'allow')
          }}
          onRevise={() => onDecide(request, 'deny')}
        />
      </section>
    )
  }

  if (request.toolName === 'McpElicitation') {
    const elicitationRequest = request.input?.request as
      | Record<string, unknown>
      | undefined
    const serverName =
      (request.input?.serverName as string) ?? '未知服务器'
    const message = (elicitationRequest?.message as string) ?? ''
    const mode = getSchemaMode(elicitationRequest)

    if (mode === 'form') {
      const schema = parseMcpElicitationSchema(
        elicitationRequest?.requestedSchema,
      )
      if (schema) {
        return (
          <McpElicitationForm
            serverName={serverName}
            message={message}
            schema={schema}
            onSubmit={content =>
              onDecide(request, 'allow', false, { content })
            }
            onDecline={() => onDecide(request, 'deny')}
            onCancel={() =>
              onDecide(request, 'deny', false, {
                cancelled: true,
                action: 'cancel',
              })
            }
          />
        )
      }
    }

    // Fallback: unsupported mode
    return (
      <McpElicitationUnsupported
        serverName={serverName}
        message={message}
        onDecline={() => onDecide(request, 'deny')}
        onCancel={() =>
          onDecide(request, 'deny', false, {
            cancelled: true,
            action: 'cancel',
          })
        }
      />
    )
  }

  function submitChoice(): void {
    if (feedback.trim()) {
      onDecide(request, 'deny', false, { feedback: feedback.trim() })
      return
    }
    const rememberOptionId = rememberOptionIdFromChoice(selectedChoice)
    if (rememberOptionId) {
      onDecide(request, 'allow', false, undefined, { rememberOptionId })
      return
    }
    onDecide(request, 'allow')
  }

  return (
    <section
      className="inline-approval-card workflow-composer-card workflow-composer-card-permission"
      data-variant="permission"
      aria-label="等待审批"
    >
      <header className="inline-approval-header">
        <h2>{approvalTitle}</h2>
      </header>
      {request.autoReviewFallbackReason ? (
        <p className="inline-approval-target">
          自动审查无法完成，已转为人工审批：{request.autoReviewFallbackReason}
        </p>
      ) : null}

      <div className="inline-approval-summary">
        <div
          className={
            isCommandExpanded
              ? 'inline-approval-command-preview expanded'
              : 'inline-approval-command-preview'
          }
        >
          <div className="inline-approval-command-preview-header">
            <span>Shell</span>
            <button
              type="button"
              aria-expanded={isCommandExpanded}
              onClick={() => setIsCommandExpanded(value => !value)}
            >
              {isCommandExpanded ? '折叠' : '展开'}
              {isCommandExpanded ? (
                <ArrowUp size={14} />
              ) : (
                <ArrowDown size={14} />
              )}
            </button>
          </div>
          <code className="inline-approval-command">{command.full}</code>
        </div>
      </div>

      <div className="inline-approval-options" role="radiogroup">
        <ApprovalOption
          index={1}
          label="是"
          selected={selectedChoice === 'allow'}
          onSelect={() => setSelectedChoice('allow')}
        />
        {rememberOptions.map((option, index) => {
          const choice = rememberChoice(option.id)
          return (
            <ApprovalOption
              key={option.id}
              index={index + 2}
              label={option.label}
              hint={option.hint}
              selected={selectedChoice === choice}
              onSelect={() => setSelectedChoice(choice)}
            />
          )
        })}
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
            placeholder="否，请告知 CodePilotX 如何调整"
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

function inlineApprovalTitle(request: DesktopPermissionRequest): string {
  if (isCommandPermission(request)) return '需要运行命令，是否允许？'
  return request.description
}

function isCommandPermission(request: DesktopPermissionRequest): boolean {
  return (
    request.toolName === 'Bash' ||
    request.toolName === 'PowerShell' ||
    stringValue(request.input.command) !== null ||
    stringValue(request.input.cmd) !== null
  )
}

function rememberChoice(
  id: DesktopPermissionRememberOptionId,
): ApprovalChoice {
  return `remember:${id}`
}

function rememberOptionIdFromChoice(
  choice: ApprovalChoice,
): DesktopPermissionRememberOptionId | undefined {
  return choice.startsWith('remember:')
    ? (choice.slice('remember:'.length) as DesktopPermissionRememberOptionId)
    : undefined
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

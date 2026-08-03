import React from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Info, Pencil } from 'lucide-react'
import type {
  DesktopPermissionDecision,
  DesktopPermissionGrantScope,
  DesktopPermissionMode,
  DesktopPermissionRememberOptionId,
  DesktopPermissionRequest,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import {
  McpElicitationForm,
  McpElicitationUnsupported,
} from '../mcpElicitation/McpElicitationForm.js'
import {
  getSchemaMode,
  parseMcpElicitationSchema,
} from '../mcpElicitation/mcpElicitationUtils.js'

type ApprovalChoice = 'allow' | `remember:${DesktopPermissionRememberOptionId}`

export type InlineApprovalCommand = {
  full: string
  hint: string
}

export type PermissionGrantScopeOption = {
  scope: DesktopPermissionGrantScope
  label: string
}

export const PERMISSION_GRANT_SCOPE_LABELS: Record<DesktopPermissionGrantScope, string> = {
  'tool-call': '仅此次工具调用',
  turn: '当前轮次',
  session: '当前任务会话',
}

export function permissionGrantScopeOptions(
  request: DesktopPermissionRequest,
): PermissionGrantScopeOption[] {
  const grant = request.permissionGrant
  const allowedScopes = grant?.allowedScopes ?? []
  const scopes = allowedScopes.length > 0
    ? allowedScopes
    : grant?.requestedScope
      ? [grant.requestedScope]
      : []
  return scopes.map(scope => ({ scope, label: PERMISSION_GRANT_SCOPE_LABELS[scope] }))
}

export function permissionGrantDefaultScope(
  options: PermissionGrantScopeOption[],
  requestedScope: DesktopPermissionGrantScope | undefined,
): DesktopPermissionGrantScope | null {
  return options.find(option => option.scope === requestedScope)?.scope
    ?? options[0]?.scope
    ?? null
}

export function permissionGrantGroups(
  request: DesktopPermissionRequest,
): Array<{ title: string; items: string[] }> {
  const requested = request.permissionGrant?.requestedPermissions
  const groups: Array<{ title: string; items: string[] }> = []
  if (requested) {
    const readPaths = stringArrayValue(requested.readPaths)
    const writePaths = stringArrayValue(requested.writePaths)
    const networkDomains = stringArrayValue(requested.networkDomains)
    if (readPaths.length > 0) groups.push({ title: '读取路径', items: readPaths })
    if (writePaths.length > 0) groups.push({ title: '写入路径', items: writePaths })
    if (networkDomains.length > 0) groups.push({ title: '网络域名', items: networkDomains })
  }
  if (groups.length === 0) {
    const paths = Array.isArray(request.input.paths)
      ? request.input.paths.filter((item): item is string => typeof item === 'string')
      : []
    if (paths.length > 0) groups.push({ title: '涉及范围', items: paths })
  }
  return groups
}

export type InlineApprovalCardProps = {
  request: DesktopPermissionRequest
  currentPermissionMode?: DesktopPermissionMode
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<DesktopPermissionDecision, 'rememberOptionId' | 'grantScope'>,
  ) => void
}

const COMMAND_HINT_MAX_LENGTH = 56

export function InlineApprovalCard({
  request,
  currentPermissionMode,
  onDecide,
}: InlineApprovalCardProps): React.ReactNode {
  const [selectedChoice, setSelectedChoice] =
    React.useState<ApprovalChoice>('allow')
  const [feedback, setFeedback] = React.useState('')
  const [isCommandExpanded, setIsCommandExpanded] = React.useState(false)
  const isPermissionGrant =
    request.requestKind === 'permission-grant' || Boolean(request.permissionGrant)
  const scopeOptions = permissionGrantScopeOptions(request)
  const defaultScope = permissionGrantDefaultScope(
    scopeOptions,
    request.permissionGrant?.requestedScope,
  )
  const [selectedScope, setSelectedScope] =
    React.useState<DesktopPermissionGrantScope | null>(defaultScope)
  React.useEffect(() => {
    // A fresh permission request must not inherit the scope chosen for the
    // previous one rendered by the same card instance.
    setSelectedScope(defaultScope)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])
  const command = buildInlineApprovalCommand(request)
  const approvalTitle = inlineApprovalTitle(request)
  const previewLabel = inlineApprovalPreviewLabel(request)
  const reviewSummary = inlineApprovalReviewSummary(request)
  const rememberOptions = request.rememberOptions ?? []

  if (request.toolName === 'AskUserQuestion') {
    return (
      <section
        className="inline-approval-card workflow-composer-card workflow-composer-card-question tw:w-full tw:max-w-[48rem] tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:p-3 tw:text-app-text tw:shadow-sm"
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

  if (isPermissionGrant) {
    const permissionGroups = permissionGrantGroups(request)
    return (
      <section
        className="inline-approval-card workflow-composer-card workflow-composer-card-permission tw:w-full tw:max-w-[48rem] tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:p-3 tw:text-app-text tw:shadow-sm"
        data-variant="permission-grant"
        aria-label="等待权限授权"
      >
        <header className="inline-approval-header">
          <h2>需要额外权限，是否允许？</h2>
        </header>
        {permissionGroups.length > 0 ? (
          <div className="inline-approval-permission-grant">
            {permissionGroups.map(group => (
              <div className="inline-approval-permission-group" key={group.title}>
                <span className="inline-approval-permission-group-title">
                  {group.title}
                </span>
                <ul className="inline-approval-permission-group-items">
                  {group.items.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {scopeOptions.length > 0 ? (
          <div
            aria-label="授权范围"
            className="inline-approval-options"
            role="radiogroup"
          >
            {scopeOptions.map((option, index) => (
              <ApprovalOption
                key={option.scope}
                index={index + 1}
                label={option.label}
                selected={selectedScope === option.scope}
                onSelect={() => setSelectedScope(option.scope)}
              />
            ))}
          </div>
        ) : null}
        <div className="inline-approval-fixed-option">
          <div className="inline-approval-actions">
            <Button onClick={() => onDecide(request, 'deny')}>
              跳过
            </Button>
            <Button onClick={submitPermissionGrant}>
              提交
              <CornerDownLeft size={14} />
            </Button>
          </div>
        </div>
      </section>
    )
  }

  function submitPermissionGrant(): void {
    const scope = selectedScope ?? defaultScope
    if (scope) onDecide(request, 'allow', false, undefined, { grantScope: scope })
    else onDecide(request, 'allow')
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
      className="inline-approval-card workflow-composer-card workflow-composer-card-permission tw:w-full tw:max-w-[48rem] tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:p-3 tw:text-app-text tw:shadow-sm"
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
      {reviewSummary ? (
        <p className="inline-approval-target">{reviewSummary}</p>
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
            <span>{previewLabel}</span>
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
          <Button
            onClick={() => onDecide(request, 'deny')}
          >
            跳过
          </Button>
          <Button
            onClick={submitChoice}
          >
            提交
            <CornerDownLeft size={14} />
          </Button>
        </div>
      </div>
    </section>
  )
}

function inlineApprovalTitle(request: DesktopPermissionRequest): string {
  if (isCommandPermission(request)) return '需要运行命令，是否允许？'
  const affectedPaths = inlineApprovalAffectedPaths(request)
  if (affectedPaths.length > 0) {
    return `需要修改 ${affectedPaths.length} 个文件，是否允许？`
  }
  return request.description
}

function inlineApprovalPreviewLabel(request: DesktopPermissionRequest): string {
  if (isCommandPermission(request)) return 'Shell'
  const affectedPaths = inlineApprovalAffectedPaths(request)
  return affectedPaths.length > 0
    ? `影响文件（${affectedPaths.length}）`
    : request.toolName
}

function inlineApprovalReviewSummary(
  request: DesktopPermissionRequest,
): string | null {
  const value = request.input.reviewSummary
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const summary = value as Record<string, unknown>
  const fileCount = nonNegativeInteger(summary.fileCount)
  const hunkCount = nonNegativeInteger(summary.hunkCount)
  const additions = nonNegativeInteger(summary.additions)
  const deletions = nonNegativeInteger(summary.deletions)
  if (
    fileCount === null ||
    hunkCount === null ||
    additions === null ||
    deletions === null
  ) return null
  return `${fileCount} 个文件，${hunkCount} 个变更块，+${additions} -${deletions}`
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
  const affectedPaths = inlineApprovalAffectedPaths(request)
  if (affectedPaths.length > 0) {
    return affectedPaths
      .map(({ path, operation }) =>
        `${operation === 'create' ? '新增' : '修改'} ${path}`,
      )
      .join('\n')
  }
  if (toolName.toLowerCase() === 'apply_patch') {
    return 'apply_patch（未提供可展示的文件范围）'
  }
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

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null
}

function inlineApprovalAffectedPaths(
  request: DesktopPermissionRequest,
): Array<{ path: string; operation: 'create' | 'update' }> {
  const value = request.input.affectedPaths
  if (!Array.isArray(value)) return []
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return []
    }
    const affected = candidate as Record<string, unknown>
    const path = stringValue(affected.path)
    const operation = affected.operation
    return path && (operation === 'create' || operation === 'update')
      ? [{ path, operation }]
      : []
  })
}

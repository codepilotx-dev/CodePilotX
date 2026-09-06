import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import React from 'react'
import { ArrowDown, ArrowUp, ChevronDown, X } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  DesktopPermissionDecision,
  DesktopPermissionGrantScope,
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { RequestCard } from './RequestCard.js'
import {
  McpElicitationForm,
  McpElicitationUnsupported,
} from '../mcpElicitation/McpElicitationForm.js'
import {
  getSchemaMode,
  parseMcpElicitationSchema,
} from '../mcpElicitation/mcpElicitationUtils.js'
import { useHeightTransition } from '../../../hooks/useHeightTransition.js'


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
  identity?: string
  disabledReason?: string
  onInterrupt?: () => void | Promise<void>
  request: DesktopPermissionRequest
  currentPermissionMode?: DesktopPermissionMode
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<DesktopPermissionDecision, 'grantScope'>,
  ) => void | Promise<void>
}

const COMMAND_HINT_MAX_LENGTH = 56

export function InlineApprovalCard({
  request,
  currentPermissionMode,
  onDecide,
  onInterrupt,
  identity,
  disabledReason,
}: InlineApprovalCardProps): React.ReactNode {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const busyRef = React.useRef(false)
  const disabled = busy || Boolean(disabledReason)
  const [isCommandExpanded, setIsCommandExpanded] = React.useState(false)
  const commandPreviewId = React.useId()
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
    busyRef.current = false
    setBusy(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])
  const command = buildInlineApprovalCommand(request)
  const commandPreviewTransition = useHeightTransition([
    isCommandExpanded,
    command.full,
  ])
  const approvalTitle = inlineApprovalTitle(request)
  const previewLabel = inlineApprovalPreviewLabel(request)
  const reviewSummary = inlineApprovalReviewSummary(request)
  async function act(action: () => void | Promise<void>): Promise<void> {
    if (busyRef.current || disabledReason) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try { await action() } catch { setError('操作失败，请重试。') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const navigation = onInterrupt ? <button type="button" className="ask-user-question-nav-button" aria-label="中断当前对话" disabled={disabled} onClick={() => void act(onInterrupt)}><X size={APP_ICON_SIZE} /></button> : null
  const actions = <div className="inline-approval-actions">
    {isPermissionGrant && scopeOptions.length > 1 ? <Dropdown width="auto" align="end" trigger={<button type="button" className="inline-approval-scope-trigger" disabled={disabled} aria-label="授权范围">{scopeOptions.find(option => option.scope === selectedScope)?.label}<ChevronDown size={APP_ICON_SIZE} /></button>}>
      <DropdownMenu.RadioGroup value={selectedScope ?? ''} onValueChange={value => {
        if (!disabled && scopeOptions.some(option => option.scope === value)) setSelectedScope(value as DesktopPermissionGrantScope)
      }}>
        {scopeOptions.map(option => <DropdownMenu.RadioItem className="popover-item" key={option.scope} value={option.scope} disabled={disabled}>{option.label}</DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </Dropdown> : isPermissionGrant && selectedScope ? <span className="inline-approval-scope-label">{PERMISSION_GRANT_SCOPE_LABELS[selectedScope]}</span> : null}
    <Button color="secondary" disabled={disabled} onClick={() => void act(() => onDecide(request, 'deny'))}>拒绝</Button>
    <Button color="primary" disabled={disabled || (isPermissionGrant && !selectedScope)} onClick={() => void act(() => onDecide(request, 'allow', false, undefined, isPermissionGrant && selectedScope ? { grantScope: selectedScope } : undefined))}>{isPermissionGrant ? '允许' : '允许一次'}</Button>
  </div>

  if (request.toolName === 'AskUserQuestion') {
    return (
        <AskUserQuestionApproval
          identity={identity}
          disabledReason={disabledReason}
          onInterrupt={onInterrupt}
          request={request}
          onReject={() => onDecide(request, 'deny')}
          onSubmit={updatedInput =>
            onDecide(request, 'allow', false, updatedInput)
          }
        />
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
      <RequestCard title="需要额外权限，是否允许？" variant="permission-grant" identity={identity} disabledReason={disabledReason} error={error} navigation={navigation}>
        {request.description ? <p className="inline-approval-target">{request.description}</p> : null}
        {request.autoReviewFallbackReason ? <p className="inline-approval-target">自动审查无法完成，已转为人工审批：{request.autoReviewFallbackReason}</p> : null}
        {reviewSummary ? <p className="inline-approval-target">{reviewSummary}</p> : null}
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
        {actions}
      </RequestCard>
    )
  }

  return (
    <RequestCard title={approvalTitle} variant="permission" identity={identity} disabledReason={disabledReason} error={error} navigation={navigation}>
      {request.description && request.description !== approvalTitle ? <p className="inline-approval-target">{request.description}</p> : null}
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
          id={commandPreviewId}
          ref={commandPreviewTransition.ref}
          className={
            isCommandExpanded
              ? 'inline-approval-command-preview expanded'
              : 'inline-approval-command-preview'
          }
          style={commandPreviewTransition.style}
        >
          <div className="inline-approval-command-preview-header">
            <span>{previewLabel}</span>
            <button
              aria-controls={commandPreviewId}
              type="button"
              aria-expanded={isCommandExpanded}
              onClick={() => setIsCommandExpanded(value => !value)}
            >
              {isCommandExpanded ? '折叠' : '展开'}
              {isCommandExpanded ? (
                <ArrowUp size={APP_ICON_SIZE} />
              ) : (
                <ArrowDown size={APP_ICON_SIZE} />
              )}
            </button>
          </div>
          <code className="inline-approval-command">{command.full}</code>
        </div>
      </div>

      {actions}
    </RequestCard>
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

import type { CodexContextDiagnostics } from '@codepilotx/core/agent/codexContextDiagnostics.js'
import type { WorkflowReducerDiagnostics } from '../../../shared/workflowReducer.js'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import type { WorkflowConsistencyDiagnostics } from './workflowConsistency.js'
import { workflowConsistencyIssueCount } from './workflowConsistency.js'

export type WorkflowMarkdownLogDiagnostics = {
  count: number
  diagnostics: WorkflowReducerDiagnostics
  note?: string
}

export type WorkflowMarkdownOptions = {
  activeSessionId: string | null
  codexContextDiagnostics?: CodexContextDiagnostics | null
  consistencyDiagnostics?: WorkflowConsistencyDiagnostics | null
  diagnostics: WorkflowReducerDiagnostics
  events: DesktopWorkflowEvent[]
  limit?: number
  logDiagnostics?: WorkflowMarkdownLogDiagnostics | null
}

export function buildWorkflowMarkdownReport({
  activeSessionId,
  codexContextDiagnostics,
  consistencyDiagnostics,
  diagnostics,
  events,
  limit = 60,
  logDiagnostics,
}: WorkflowMarkdownOptions): string {
  const filteredEvents = activeSessionId
    ? events.filter(event => event.threadId === activeSessionId)
    : events
  const visibleEvents = filteredEvents.slice(-limit).reverse()
  const lines = [
    '# Workflow 事件',
    '',
    `- Session: ${markdownInline(activeSessionId ?? '全部')}`,
    `- 当前事件: ${filteredEvents.length} 条`,
    `- 导出事件: ${visibleEvents.length} 条`,
    `- 当前诊断: ${formatDiagnosticsSummary(diagnostics)}`,
  ]

  if (consistencyDiagnostics) {
    lines.push(
      `- 一致性诊断: ${formatConsistencyDiagnosticsSummary(
        consistencyDiagnostics,
      )}`,
    )
  }

  if (logDiagnostics) {
    lines.push(
      `- 日志事件: ${logDiagnostics.count} 条`,
      `- 日志诊断: ${formatDiagnosticsSummary(logDiagnostics.diagnostics)}`,
    )
    if (logDiagnostics.note) {
      lines.push(`- 日志备注: ${markdownInline(logDiagnostics.note)}`)
    }
  }

  if (codexContextDiagnostics) {
    appendCodexContextDiagnostics(lines, codexContextDiagnostics)
  }

  if (
    consistencyDiagnostics?.missingTurnCompletionDetails &&
    consistencyDiagnostics.missingTurnCompletionDetails.length > 0
  ) {
    lines.push(
      '',
      '## 缺 turn 终止事件',
      '',
      '| turn | 最后事件 | 最后时间 | 判断 |',
      '| --- | --- | --- | --- |',
    )
    for (const detail of consistencyDiagnostics.missingTurnCompletionDetails) {
      lines.push(
        `| ${tableCell(detail.turnId)} | ${tableCell(
          detail.lastEventType,
        )} | ${tableCell(formatWorkflowTime(detail.lastEventCreatedAt))} | ${tableCell(
          detail.likelyStillRunning ? '可能仍在运行或复制过早' : '缺少事件上下文',
        )} |`,
      )
    }
  }

  lines.push(
    '',
    '| 时间 | 类型 | thread | turn | item | detail |',
    '| --- | --- | --- | --- | --- | --- |',
  )

  if (visibleEvents.length === 0) {
    lines.push('| - | - | - | - | - | 暂无 workflow 事件 |')
  } else {
    for (const event of visibleEvents) {
      lines.push(
        `| ${tableCell(formatWorkflowTime(event.createdAt))} | ${tableCell(
          event.type,
        )} | ${tableCell(event.threadId)} | ${tableCell(
          'turnId' in event ? event.turnId : '',
        )} | ${tableCell(formatWorkflowItem(event))} | ${tableCell(
          formatWorkflowDetail(event),
        )} |`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}

function appendCodexContextDiagnostics(
  lines: string[],
  diagnostics: CodexContextDiagnostics,
): void {
  lines.push('', '## Codex 上下文快照', '')

  if (diagnostics.guidanceSources.length > 0) {
    lines.push(
      '### 指导文件',
      '',
      '| 文件 | 层级 | override | hash | 摘要 |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const source of diagnostics.guidanceSources) {
      lines.push(
        `| ${tableCell(source.relativePath)} | ${tableCell(
          String(source.level),
        )} | ${tableCell(source.isOverride ? '是' : '否')} | ${tableCell(
          source.contentHash,
        )} | ${tableCell(source.summary)} |`,
      )
    }
  } else {
    lines.push('- 指导文件: 未发现')
  }

  const config = diagnostics.projectConfig
  lines.push(
    '',
    `- Codex config: ${markdownInline(
      config.path ? displayCodexPath(config.path) : '未发现',
    )}`,
  )
  if (config.ignoredProjectKeys.length > 0) {
    lines.push(
      `- 忽略项目级配置键: ${markdownInline(
        config.ignoredProjectKeys.join(', '),
      )}`,
    )
  }
  for (const diagnostic of config.diagnostics) {
    lines.push(`- 配置诊断: ${markdownInline(diagnostic)}`)
  }

  if (diagnostics.permissionProfile) {
    const profile = diagnostics.permissionProfile
    lines.push(
      `- 权限 profile: ${markdownInline(
        `${profile.profile} / approval=${profile.approvalMode} / sandbox=${
          profile.sandboxPolicy ?? profile.profile
        }`,
      )}`,
    )
  }

  const visibilityRows = [
    ...(config.config.mcpServers ?? []).map(server => ({
      name: server.name,
      kind: 'mcp',
      source: server.source,
      detail: formatMcpServerDetail(server),
    })),
    ...(config.config.hooks ?? []).map(hook => ({
      name: hook.event,
      kind: 'hook',
      source: hook.source,
      detail: compactParts([
        hook.matcher ? `matcher=${hook.matcher}` : null,
        hook.commands.length > 0
          ? `commands=${hook.commands.join(', ')}`
          : null,
      ]),
    })),
    ...diagnostics.skills.map(skill => ({
      name: skill.name,
      kind: 'skill',
      source: skill.path,
      detail: skill.description ?? '',
    })),
  ]

  if (visibilityRows.length > 0) {
    lines.push(
      '',
      '### hooks / MCP / skills',
      '',
      '| 名称 | 类型 | 来源 | detail |',
      '| --- | --- | --- | --- |',
    )
    for (const row of visibilityRows) {
      lines.push(
        `| ${tableCell(row.name)} | ${tableCell(row.kind)} | ${tableCell(
          row.source,
        )} | ${tableCell(row.detail)} |`,
      )
    }
  }
}

function formatMcpServerDetail(
  server: NonNullable<CodexContextDiagnostics['projectConfig']['config']['mcpServers']>[number],
): string {
  if (server.command) {
    return compactParts([
      `command=${[server.command, ...(server.args ?? [])].join(' ')}`,
    ])
  }
  if (server.url) return `url=${server.url}`
  return ''
}

function formatDiagnosticsSummary(
  diagnostics: WorkflowReducerDiagnostics,
): string {
  const duplicate = diagnostics.duplicateEventIds.length
  const missing = diagnostics.missingToolResults.length
  const outOfOrder = diagnostics.outOfOrderSequences.length
  const total = duplicate + missing + outOfOrder
  return `${total} 个（重复 ${duplicate}，未完成工具 ${missing}，乱序 ${outOfOrder}）`
}

function formatConsistencyDiagnosticsSummary(
  diagnostics: WorkflowConsistencyDiagnostics,
): string {
  return `${workflowConsistencyIssueCount(diagnostics)} 个（缺 turn 终止事件 ${
    diagnostics.missingTurnCompletions.length
  }，未配对 call ${
    diagnostics.unpairedToolCalls.length
  }，孤立 result ${
    diagnostics.unpairedToolResults.length
  }，未决权限 ${
    diagnostics.pendingPermissionRequests.length
  }，最终回复不一致 ${
    diagnostics.finalResponseMismatches.length
  }，混入 thread ${diagnostics.mixedThreadIds.length}）`
}

function formatWorkflowItem(event: DesktopWorkflowEvent): string {
  if (!('item' in event)) return ''
  return `${event.item.type} / ${event.item.status}`
}

function formatWorkflowDetail(event: DesktopWorkflowEvent): string {
  if ('item' in event) {
    const item = event.item
    if (item.type === 'tool_call' || item.type === 'tool_result') {
      const resultDetail =
        item.type === 'tool_result'
          ? readableToolResultDetail(
              item.metadata,
              item.isError === true || item.status === 'failed',
            )
          : null
      return compactParts([
        `tool=${item.toolName}`,
        item.toolUseId ? `toolUseId=${item.toolUseId}` : null,
        resultDetail ?? (item.summary ? `summary=${item.summary}` : null),
      ])
    }
    if (item.type === 'permission_request') {
      return compactParts([
        `request=${item.request.requestId}`,
        `tool=${item.request.toolName}`,
        item.request.description,
      ])
    }
    if (item.type === 'error') {
      return compactParts([item.code ? `code=${item.code}` : null, item.message])
    }
    if (item.type === 'file_change') {
      return compactParts([`file=${item.filePath}`])
    }
    if (item.type === 'agent_message' || item.type === 'user_message') {
      return truncate(item.text)
    }
  }

  if (event.type === 'turn.completed') {
    return compactParts([
      event.stopReason ? `stop=${event.stopReason}` : 'completed',
      typeof event.costUsd === 'number' ? `cost=${event.costUsd}` : null,
    ])
  }
  if (event.type === 'turn.failed') {
    return compactParts([
      event.error.code ? `code=${event.error.code}` : null,
      event.error.message,
    ])
  }
  if (event.type === 'turn.interrupted') {
    return event.reason ?? 'interrupted'
  }
  return ''
}

function compactParts(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join('; ')
}

function readableToolResultDetail(
  metadata: Record<string, unknown> | undefined,
  isError: boolean,
): string | null {
  if (!metadata) return null
  const direct = readableMetadataDetail(metadata)
  if (direct) return direct

  const result = metadata.result
  if (isRecord(result)) {
    const nested = readableMetadataDetail(result)
    if (nested) return nested
  }

  if (isError) {
    const fallback = unknownToText(result)
    return fallback ? `result=${fallback}` : null
  }
  return null
}

function readableMetadataDetail(metadata: Record<string, unknown>): string | null {
  const fields: Array<[string, unknown]> = [
    ['error', metadata.error],
    ['message', metadata.message],
    ['stderr', metadata.stderr],
    ['stdout', metadata.stdout],
    ['output', metadata.output],
    ['content', metadata.content],
    ['text', metadata.text],
  ]
  const details = fields
    .map(([label, value]) => {
      const text = unknownToText(value)
      return text ? `${label}=${text}` : null
    })
    .filter((value): value is string => Boolean(value))
  return details.length > 0 ? details.join('; ') : null
}

function unknownToText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const text = value
      .map(item => {
        if (typeof item === 'string') return item
        if (isRecord(item)) {
          return unknownToText(item.text) ?? unknownToText(item.content)
        }
        return null
      })
      .filter((item): item is string => Boolean(item))
      .join('\n')
    return text || null
  }
  if (isRecord(value)) {
    const nested = readableMetadataDetail(value)
    if (nested) return nested
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function formatWorkflowTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function tableCell(value: string): string {
  return markdownInline(truncate(value))
}

function markdownInline(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

function displayCodexPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const codexIndex = normalized.lastIndexOf('/.codepilotx/')
  return codexIndex >= 0 ? normalized.slice(codexIndex + 1) : normalized
}

function truncate(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

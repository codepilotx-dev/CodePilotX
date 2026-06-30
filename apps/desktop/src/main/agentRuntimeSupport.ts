import type {
  DesktopPermissionDecision,
  DesktopPermissionRememberOption,
} from '../shared/types.js'

const SESSION_REMEMBER_LABEL = '是，且本会话不再询问匹配请求'

export function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return toolName
  }
  const record = input as Record<string, unknown>
  const target =
    record.file_path ??
    record.filePath ??
    record.pattern ??
    record.command ??
    record.url ??
    record.query
  return typeof target === 'string' ? `${toolName}: ${target}` : toolName
}

export function buildToolResultMetadata(
  result: unknown,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  const content = metadataValueToText(result)
  if (content) {
    metadata.content = content
  }
  if (result !== undefined) {
    metadata.result = result
  }

  if (isRecord(result)) {
    for (const key of [
      'stderr',
      'stdout',
      'output',
      'error',
      'message',
      'text',
      'content',
    ]) {
      const text = metadataValueToText(result[key])
      if (text) metadata[key] = text
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export function getToolUseId(item: Record<string, unknown>): string | undefined {
  if (typeof item.id === 'string') return item.id
  if (typeof item.tool_use_id === 'string') return item.tool_use_id
  return undefined
}

function metadataValueToText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const text = value
      .map(item => metadataValueToText(item))
      .filter((part): part is string => Boolean(part))
      .join('\n')
    return text || undefined
  }
  if (!isRecord(value)) return undefined
  return (
    metadataValueToText(value.text) ??
    metadataValueToText(value.content) ??
    metadataValueToText(value.message)
  )
}

export function extractPartialText(item: Record<string, unknown>): string | null {
  if (item.type !== 'content_block_delta') {
    return null
  }
  const delta = item.delta
  if (!delta || typeof delta !== 'object') {
    return null
  }
  const record = delta as Record<string, unknown>
  return record.type === 'text_delta' && typeof record.text === 'string'
    ? record.text
    : null
}

export function getMessageContent(message: Record<string, unknown>): unknown {
  const wrappedMessage = message.message
  return wrappedMessage && typeof wrappedMessage === 'object'
    ? (wrappedMessage as Record<string, unknown>).content
    : undefined
}

export function getResultErrorMessage(
  message: Record<string, unknown>,
): string {
  if (Array.isArray(message.errors) && typeof message.errors[0] === 'string') {
    return message.errors[0]
  }
  if (typeof message.result === 'string' && message.result.trim()) {
    return message.result
  }
  if (typeof message.subtype === 'string') {
    return message.subtype
  }
  return 'Desktop headless session failed'
}

export function getUpdatedPermissions(
  request: Record<string, unknown>,
  decision: DesktopPermissionDecision,
): Record<string, unknown>[] {
  const suggestions = permissionSuggestions(request)
  if (suggestions.length === 0) {
    return []
  }

  if (decision.rememberOptionId === 'session') {
    return suggestions.map(update => ({ ...update, destination: 'session' }))
  }

  if (decision.rememberOptionId === 'persistentPrefix') {
    return prefixAllowPermissionUpdates(suggestions)
  }

  if (decision.alwaysAllow) {
    return suggestions.map(update =>
      update.destination === 'session'
        ? { ...update, destination: 'localSettings' }
        : update,
    )
  }

  return []
}

export function buildPermissionRememberOptions(
  request: Record<string, unknown>,
): DesktopPermissionRememberOption[] {
  const suggestions = permissionSuggestions(request)
  if (suggestions.length === 0) {
    return []
  }

  const options: DesktopPermissionRememberOption[] = [
    {
      id: 'session',
      label: SESSION_REMEMBER_LABEL,
    },
  ]
  const prefix = firstPrefixRuleContent(suggestions)
  if (prefix) {
    options.push({
      id: 'persistentPrefix',
      label: `是，且以后对以 ${prefix} 开头的命令不再询问`,
      hint: prefix,
    })
  }
  return options
}

function permissionSuggestions(
  request: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(request.permission_suggestions)
    ? request.permission_suggestions.filter(isPermissionUpdate)
    : []
}

function prefixAllowPermissionUpdates(
  suggestions: Record<string, unknown>[],
): Record<string, unknown>[] {
  const updates: Record<string, unknown>[] = []
  for (const update of suggestions) {
    if (!isAddAllowRulesUpdate(update)) {
      continue
    }
    const rules = update.rules.filter(isPrefixAllowRule)
    if (rules.length > 0) {
      updates.push({ ...update, rules })
    }
  }
  return updates
}

function firstPrefixRuleContent(
  suggestions: Record<string, unknown>[],
): string | undefined {
  for (const update of suggestions) {
    if (!isAddAllowRulesUpdate(update)) {
      continue
    }
    for (const rule of update.rules) {
      if (!isPrefixAllowRule(rule)) {
        continue
      }
      return trimPrefixSuffix(rule.ruleContent)
    }
  }
  return undefined
}

function isAddAllowRulesUpdate(
  update: Record<string, unknown>,
): update is Record<string, unknown> & { rules: Record<string, unknown>[] } {
  return (
    update.type === 'addRules' &&
    update.behavior === 'allow' &&
    Array.isArray(update.rules)
  )
}

function isPrefixAllowRule(
  rule: unknown,
): rule is Record<string, unknown> & { ruleContent: string } {
  return (
    isRecord(rule) &&
    typeof rule.ruleContent === 'string' &&
    rule.ruleContent.endsWith(':*')
  )
}

function trimPrefixSuffix(ruleContent: string): string {
  return ruleContent.slice(0, -2).trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isPermissionUpdate(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const update = value as Record<string, unknown>
  if (typeof update.type !== 'string') {
    return false
  }
  if (typeof update.destination !== 'string') {
    return false
  }
  if (
    update.type === 'addRules' ||
    update.type === 'replaceRules' ||
    update.type === 'removeRules'
  ) {
    return Array.isArray(update.rules) && typeof update.behavior === 'string'
  }
  if (update.type === 'setMode') {
    return typeof update.mode === 'string'
  }
  if (update.type === 'addDirectories' || update.type === 'removeDirectories') {
    return Array.isArray(update.directories)
  }
  return false
}

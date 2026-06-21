import type { DesktopPermissionDecision } from '../shared/types.js'

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
  if (!decision.alwaysAllow || !Array.isArray(request.permission_suggestions)) {
    return []
  }
  return request.permission_suggestions
    .filter(isPermissionUpdate)
    .map(update =>
      update.destination === 'session'
        ? { ...update, destination: 'localSettings' }
        : update,
    )
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

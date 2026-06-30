import type { DesktopSessionEvent } from '../../../shared/types.js'

export type ReviewTurn = {
  id: string
  index: number
  userMessageId: string
  userMessageText: string
  filePatchEventIds: string[]
  toolCallEventIds: string[]
  files: Array<{ path: string; additions: number; deletions: number }>
  patch: string
  additions: number
  deletions: number
  hasUntracked: boolean
  hasToolOnlyChanges: boolean
}

export type ReviewTurnGroup = {
  turns: ReviewTurn[]
}

const FILE_MUTATING_TOOL_NAMES = new Set([
  'FileEdit',
  'FileWrite',
  'NotebookEdit',
  'Edit',
  'Write',
  'MultiEdit',
])

function eventCreatedAtMs(event: DesktopSessionEvent): number {
  const ms = Date.parse(event.createdAt)
  return Number.isFinite(ms) ? ms : 0
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function collectFilesFromPatchEvent(
  event: DesktopSessionEvent,
): Array<{ path: string; additions: number; deletions: number }> {
  const meta = event.metadata ?? {}
  const files = Array.isArray(meta.files)
    ? (meta.files as Array<Record<string, unknown>>)
    : []
  if (files.length > 0) {
    return files
      .map(file => {
        const path = asString(file.path)
        if (!path) return null
        return {
          path,
          additions: asNumber(file.additions) ?? 0,
          deletions: asNumber(file.deletions) ?? 0,
        }
      })
      .filter(
        (
          entry,
        ): entry is { path: string; additions: number; deletions: number } =>
          entry !== null,
      )
  }
  const singlePath = asString(meta.filePath)
  if (singlePath) {
    return [
      {
        path: singlePath,
        additions: asNumber(meta.additions) ?? 0,
        deletions: asNumber(meta.deletions) ?? 0,
      },
    ]
  }
  return []
}

function extractFilePathFromToolCall(
  event: DesktopSessionEvent,
): string | null {
  const meta = event.metadata ?? {}
  const input = (meta.input && typeof meta.input === 'object'
    ? (meta.input as Record<string, unknown>)
    : null)
  const candidates = [
    asString(meta.file_path),
    asString(meta.filePath),
    input ? asString(input.file_path) : null,
    input ? asString(input.filePath) : null,
    input ? asString(input.path) : null,
  ]
  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return null
}

function isFileMutatingToolCall(event: DesktopSessionEvent): boolean {
  if (event.type !== 'tool_call') return false
  const toolName = asString(event.metadata?.toolName) ?? ''
  return FILE_MUTATING_TOOL_NAMES.has(toolName)
}

function addFileToTurn(
  turn: ReviewTurn,
  file: { path: string; additions: number; deletions: number },
): void {
  const existing = turn.files.find(f => f.path === file.path)
  if (existing) {
    existing.additions += file.additions
    existing.deletions += file.deletions
  } else {
    turn.files.push({ ...file })
  }
}

export function deriveReviewTurns(
  events: DesktopSessionEvent[],
): ReviewTurnGroup {
  const sorted = [...events].sort(
    (a, b) => eventCreatedAtMs(a) - eventCreatedAtMs(b),
  )
  const turns: ReviewTurn[] = []
  let currentTurn: ReviewTurn | null = null

  function finalizeTurn(): void {
    if (
      currentTurn &&
      (currentTurn.filePatchEventIds.length > 0 ||
        currentTurn.toolCallEventIds.length > 0)
    ) {
      turns.push(currentTurn)
    }
    currentTurn = null
  }

  for (const event of sorted) {
    if (
      event.type === 'message' &&
      event.role === 'user' &&
      (event.content ?? '').trim().length > 0
    ) {
      finalizeTurn()
      currentTurn = {
        id: `turn-${event.id}`,
        index: turns.length + 1,
        userMessageId: event.id,
        userMessageText: (event.content ?? '').trim(),
        filePatchEventIds: [],
        toolCallEventIds: [],
        files: [],
        patch: '',
        additions: 0,
        deletions: 0,
        hasUntracked: false,
        hasToolOnlyChanges: false,
      }
      continue
    }
    if (!currentTurn) continue
    if (event.type === 'file_patch') {
      const patchText = asString(event.metadata?.patch) ?? ''
      const files = collectFilesFromPatchEvent(event)
      currentTurn.filePatchEventIds.push(event.id)
      currentTurn.patch = currentTurn.patch
        ? `${currentTurn.patch}\n${patchText}`
        : patchText
      currentTurn.additions += asNumber(event.metadata?.additions) ?? 0
      currentTurn.deletions += asNumber(event.metadata?.deletions) ?? 0
      for (const file of files) {
        addFileToTurn(currentTurn, file)
      }
      continue
    }
    if (isFileMutatingToolCall(event)) {
      const filePath = extractFilePathFromToolCall(event)
      if (!filePath) continue
      currentTurn.toolCallEventIds.push(event.id)
      currentTurn.hasToolOnlyChanges =
        currentTurn.filePatchEventIds.length === 0
      addFileToTurn(currentTurn, {
        path: filePath,
        additions: 0,
        deletions: 0,
      })
    }
  }
  finalizeTurn()

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i]
    if (!turn) continue
    turn.index = i + 1
    turn.files.sort((a, b) => a.path.localeCompare(b.path))
  }

  return { turns }
}

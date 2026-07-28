import { legacyMessagesToSessionEvents } from '../../../../shared/sessionEventModel.js'
import type {
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
} from '../../../../shared/types.js'
import type { Message } from '../../../uiTypes.js'

export type TimelineToolRun = {
  id: string
  toolUseId?: string
  toolName: string
  callContent: string
  resultContent: string
  outputContent: string
  permissionRequest?: DesktopPermissionRequest
  resultMetadata?: Record<string, unknown>
  isError: boolean
  isRunning: boolean
  isWaitingForPermission: boolean
  startedAtMs?: number
}

export type TimelineToolGroup = {
  id: string
  type: 'tool_group'
  runs: TimelineToolRun[]
}

export type TimelineItem = DesktopSessionEvent | TimelineToolGroup

export type ExecutionPhaseGroup = {
  id: string
  type: 'execution_phase'
  items: TimelineItem[]
  isComplete: boolean
}

export type PhaseTimelineItem = TimelineItem | ExecutionPhaseGroup

export function deriveTimelineSourceEvents({
  conversationMessages,
  events,
  sessionStatus,
  workflowEvents,
}: {
  conversationMessages: Message[]
  events: DesktopSessionEvent[]
  sessionStatus: DesktopSessionStatus
  workflowEvents: DesktopSessionEvent[]
}): DesktopSessionEvent[] {
  if (isActiveSessionStatus(sessionStatus) && events.length > 0) {
    return events
  }
  if (workflowEvents.length > 0) return workflowEvents
  if (events.length > 0) return events
  return legacyMessagesToSessionEvents('legacy', conversationMessages)
}

export function deriveAssistantActionMessageIds({
  sessionStatus,
  timelineEvents,
}: {
  sessionStatus: DesktopSessionStatus
  timelineEvents: DesktopSessionEvent[]
}): Set<string> {
  const visibleIds = new Set<string>()
  let turnAssistantMessageId: string | null = null

  const resetTurn = () => {
    turnAssistantMessageId = null
  }
  const commitCompletedTurn = () => {
    if (!turnAssistantMessageId) return
    visibleIds.add(turnAssistantMessageId)
    resetTurn()
  }

  for (const event of timelineEvents) {
    if (
      event.type === 'message' &&
      event.role === 'assistant' &&
      Boolean(event.content?.trim())
    ) {
      turnAssistantMessageId = event.id
      continue
    }
    if (event.type === 'checkpoint' || event.type === 'error') {
      commitCompletedTurn()
    }
  }
  if (!isActiveSessionStatus(sessionStatus)) commitCompletedTurn()
  return visibleIds
}

export function foldTimelineEvents(
  sourceEvents: DesktopSessionEvent[],
): DesktopSessionEvent[] {
  const folded: DesktopSessionEvent[] = []
  for (const event of sourceEvents) {
    const previous = folded.at(-1)
    if (event.type === 'assistant_delta') {
      if (previous?.type === 'assistant_delta') {
        folded[folded.length - 1] = event
      } else {
        folded.push(event)
      }
      continue
    }
    if (
      event.type === 'message' &&
      event.role === 'assistant' &&
      previous?.type === 'assistant_delta'
    ) {
      folded[folded.length - 1] = event
      continue
    }
    folded.push(event)
  }
  return folded
}

export function groupTimelineToolEvents(
  sourceEvents: DesktopSessionEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = []
  let pendingToolEvents: DesktopSessionEvent[] = []

  function flushToolEvents(options?: { forceStopRuns?: boolean }): void {
    if (pendingToolEvents.length === 0) return
    const group = buildToolGroup(pendingToolEvents)
    if (group) {
      if (options?.forceStopRuns) {
        for (const run of group.runs) {
          if (!run.isRunning) continue
          run.isRunning = false
          run.isError = true
          if (!run.resultContent) run.resultContent = '操作已停止'
        }
      }
      items.push(group)
    }
    pendingToolEvents = []
  }

  for (const event of sourceEvents) {
    if (event.type === 'status') {
      if (
        pendingToolEvents.length > 0 &&
        (event.content === 'idle' || event.content === 'done')
      ) {
        pendingToolEvents.push(terminalToolResultEvent(event))
      }
      continue
    }
    if (
      pendingToolEvents.length > 0 &&
      (event.type === 'error' || event.type === 'checkpoint')
    ) {
      pendingToolEvents.push(terminalToolResultEvent(event))
    }
    if (
      event.type === 'tool_call' ||
      event.type === 'tool_result' ||
      event.type === 'permission_request' ||
      event.type === 'tool_output_delta'
    ) {
      pendingToolEvents.push(event)
      continue
    }
    flushToolEvents({ forceStopRuns: true })
    items.push(event)
  }
  flushToolEvents()
  return items
}

export function groupTimelineExecutionPhases(
  items: TimelineItem[],
  sessionStatus: DesktopSessionStatus,
): PhaseTimelineItem[] {
  const result: PhaseTimelineItem[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]!
    if (item.type !== 'proposed_plan') {
      result.push(item)
      index += 1
      continue
    }

    let turnEnd = index + 1
    while (turnEnd < items.length) {
      const next = items[turnEnd]!
      if (
        next.type === 'checkpoint' ||
        next.type === 'error' ||
        (next.type === 'message' && next.role === 'user')
      ) {
        break
      }
      turnEnd += 1
    }

    result.push(item)
    const turnItems = items.slice(index + 1, turnEnd)
    let lastAssistantIndex = -1
    for (
      let turnIndex = turnItems.length - 1;
      turnIndex >= 0;
      turnIndex -= 1
    ) {
      const candidate = turnItems[turnIndex]
      if (
        candidate?.type === 'message' &&
        candidate.role === 'assistant'
      ) {
        lastAssistantIndex = turnIndex
        break
      }
    }

    const executionItems: TimelineItem[] = []
    const filePatches: TimelineItem[] = []
    let finalMessage: TimelineItem | null = null
    for (
      let turnIndex = 0;
      turnIndex < turnItems.length;
      turnIndex += 1
    ) {
      const candidate = turnItems[turnIndex]!
      if (candidate.type === 'file_patch') {
        filePatches.push(candidate)
      } else if (
        turnIndex === lastAssistantIndex &&
        candidate.type === 'message' &&
        candidate.role === 'assistant'
      ) {
        finalMessage = candidate
      } else if (candidate.type !== 'checkpoint') {
        executionItems.push(candidate)
      }
    }

    const isActive =
      sessionStatus === 'running' || sessionStatus === 'waiting'
    const hasTurnEnd = turnEnd < items.length
    const endedByCheckpointOrError =
      hasTurnEnd &&
      (items[turnEnd]?.type === 'checkpoint' ||
        items[turnEnd]?.type === 'error')
    if (executionItems.length > 0) {
      result.push({
        id: `execution-phase-${item.id}`,
        type: 'execution_phase',
        items: executionItems,
        isComplete:
          endedByCheckpointOrError || (!isActive && !hasTurnEnd),
      })
    }
    result.push(...filePatches)
    if (finalMessage) result.push(finalMessage)
    index = turnEnd
  }
  return result
}

function terminalToolResultEvent(
  event: DesktopSessionEvent,
): DesktopSessionEvent {
  return {
    id: `${event.id}-terminal-tool-result`,
    sessionId: event.sessionId,
    type: 'tool_result',
    content:
      event.type === 'error' ? event.content || '操作已中止' : '操作已停止',
    createdAt: event.createdAt,
    metadata: { isError: true },
  }
}

function buildToolGroup(
  events: DesktopSessionEvent[],
): TimelineToolGroup | null {
  const runs: TimelineToolRun[] = []

  for (const event of events) {
    const toolName = stringMetadata(event, 'toolName') ?? 'Tool'
    const toolUseId = toolUseIdForEvent(event)
    const content = normalizedToolContent(event, toolName)

    if (event.type === 'tool_call') {
      runs.push({
        id: event.id,
        toolUseId,
        toolName,
        callContent: content,
        resultContent: '',
        outputContent: '',
        isError: false,
        isRunning: true,
        isWaitingForPermission: false,
        startedAtMs: Date.parse(event.createdAt) || undefined,
      })
      continue
    }
    if (event.type === 'tool_output_delta') {
      const match =
        findPendingToolRun(runs, toolName, toolUseId) ??
        findPendingToolRun(runs, undefined, toolUseId)
      if (match) {
        match.outputContent += event.content ?? ''
        match.isWaitingForPermission = false
      }
      continue
    }

    const pendingRun =
      (toolUseId
        ? findPendingToolRun(runs, undefined, toolUseId)
        : null) ??
      findPendingToolRun(runs, toolName) ??
      findPendingToolRun(runs)
    if (event.type === 'permission_request') {
      if (pendingRun) {
        pendingRun.isWaitingForPermission = true
        pendingRun.permissionRequest = permissionRequestFromEvent(event)
      }
      continue
    }
    if (pendingRun) {
      pendingRun.resultContent = content
      pendingRun.resultMetadata = event.metadata
      pendingRun.isError = event.metadata?.isError === true
      pendingRun.isRunning = false
      pendingRun.isWaitingForPermission = false
      continue
    }
    if (!content && event.metadata?.isError !== true) continue
    runs.push({
      id: event.id,
      toolUseId,
      toolName,
      callContent: '',
      resultContent: content,
      outputContent: '',
      resultMetadata: event.metadata,
      isError: event.metadata?.isError === true,
      isRunning: false,
      isWaitingForPermission: false,
    })
  }

  const visibleRuns = runs.filter(
    run => run.callContent || run.resultContent || run.isError || run.isRunning,
  )
  if (visibleRuns.length === 0) return null
  return {
    id: `tool-group-${events[0]?.id ?? 'empty'}`,
    type: 'tool_group',
    runs: visibleRuns,
  }
}

function permissionRequestFromEvent(
  event: DesktopSessionEvent,
): DesktopPermissionRequest | undefined {
  const request = event.metadata?.request
  if (!isRecordValue(request)) return undefined
  return request as DesktopPermissionRequest
}

function findPendingToolRun(
  runs: TimelineToolRun[],
  toolName?: string,
  toolUseId?: string,
): TimelineToolRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (!run?.isRunning) continue
    if (toolUseId && run.toolUseId !== toolUseId) continue
    if (toolName && run.toolName !== toolName) continue
    return run
  }
  return null
}

function stringMetadata(
  event: DesktopSessionEvent,
  key: string,
): string | null {
  const value = event.metadata?.[key]
  return typeof value === 'string' ? value : null
}

function toolUseIdForEvent(event: DesktopSessionEvent): string | undefined {
  const metadataToolUseId =
    stringMetadata(event, 'toolUseId') ??
    stringMetadata(event, 'tool_use_id')
  if (metadataToolUseId) return metadataToolUseId
  const directToolUseId = (event as { toolUseId?: unknown }).toolUseId
  return typeof directToolUseId === 'string' ? directToolUseId : undefined
}

function normalizedToolContent(
  event: DesktopSessionEvent,
  toolName: string,
): string {
  const content = event.content?.trim() ?? ''
  if (!content) return ''
  if (event.type === 'tool_result' && content === toolName) return ''
  const prefix = `${toolName}:`
  return content.startsWith(prefix)
    ? content.slice(prefix.length).trim()
    : content
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isActiveSessionStatus(sessionStatus: DesktopSessionStatus): boolean {
  return sessionStatus === 'running' || sessionStatus === 'waiting'
}

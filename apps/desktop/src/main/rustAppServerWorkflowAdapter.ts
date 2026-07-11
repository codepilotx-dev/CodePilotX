import { buildDesktopContextUsageFromRustTokenUsage } from './desktopContextUsage.js'
import { desktopDebug } from './desktopDebug.js'
import type { DesktopAgentEvent } from '../shared/types.js'

/**
 * Maps Rust app-server ServerNotifications into DesktopAgentEvent emissions.
 *
 * Handles the full item lifecycle:
 * - `item/started` — tracks started items by type
 * - `item/agentMessage/delta` (+ fallback `item/delta`) — streaming text
 * - `item/completed` — agentMessage, dynamicToolCall, commandExecution, fileChange
 * - Standard turn/thread lifecycle: thread/started, turn/started, turn/completed, error
 * - Plan/reasoning: turn/plan/updated, item/plan/delta, reasoning text deltas
 * - Progress deltas: commandExecution/outputDelta, fileChange/patchUpdated, turn/diff/updated
 *
 * Server-initiated requests (item/tool/call, item/permissions/requestApproval, etc.)
 * are handled by the runtime's server request handler, not this adapter.
 */

export type StartedItemInfo = {
  type: string
  toolName?: string
  toolInput?: unknown
  toolUseId?: string
  command?: string
}

type BufferedReasoningStream = {
  chunks: string[]
  processedChunkCount: number
  scheduleHandle: unknown | null
  partialEmitted: boolean
  prefix: string
}

export type RustAppServerWorkflowState = {
  threadId: string | null
  activeTurnId: string | null
  activeTurnKind: 'regular' | 'goal' | 'compact' | 'review' | null
  /** Accumulated assistant text from agentMessage/item deltas */
  assistantDeltaBuffer: string
  assistantDeltaChunks: string[]
  assistantProcessedChunkCount: number
  assistantProcessedChars: number
  assistantStreamItemId: string | null
  assistantStreamGeneration: number
  assistantTurnClosed: boolean
  finalizedAssistantItemIds: Set<string>
  assistantDeltaScheduleHandle: unknown | null
  assistantPartialEmitted: boolean
  scheduleAssistantUpdate(
    callback: () => void,
    delayMs: number,
  ): unknown
  cancelAssistantUpdate(handle: unknown): void
  reasoningTextBuffer: string
  reasoningSummaryBuffer: string
  reasoningTextStarted: boolean
  reasoningSummaryStarted: boolean
  reasoningStreams: Map<string, BufferedReasoningStream>
  reasoningStreamGeneration: number
  /** Accumulated command output keyed by item id (toolUseId) */
  aggregatedOutputByItem: Map<string, string>
  /** Review-specific state */
  reviewToolUseId: string | null
  pendingReviewAgentText: string | null
  completedReviewText: string | null
  reviewToolStarted: boolean
  reviewToolCompleted: boolean
}

export function createRustAppServerWorkflowState(options: {
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancelSchedule?: (handle: unknown) => void
} = {}): RustAppServerWorkflowState {
  return {
    threadId: null,
    activeTurnId: null,
    activeTurnKind: null,
    assistantDeltaBuffer: '',
    assistantDeltaChunks: [],
    assistantProcessedChunkCount: 0,
    assistantProcessedChars: 0,
    assistantStreamItemId: null,
    assistantStreamGeneration: 0,
    assistantTurnClosed: false,
    finalizedAssistantItemIds: new Set(),
    assistantDeltaScheduleHandle: null,
    assistantPartialEmitted: false,
    scheduleAssistantUpdate:
      options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    cancelAssistantUpdate:
      options.cancelSchedule ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)),
    reasoningTextBuffer: '',
    reasoningSummaryBuffer: '',
    reasoningTextStarted: false,
    reasoningSummaryStarted: false,
    reasoningStreams: new Map(),
    reasoningStreamGeneration: 0,
    aggregatedOutputByItem: new Map(),
    reviewToolUseId: null,
    pendingReviewAgentText: null,
    completedReviewText: null,
    reviewToolStarted: false,
    reviewToolCompleted: false,
  }
}

/**
 * Process a single raw server notification.
 *
 * @param method              The notification method name (e.g. `"thread/started"`)
 * @param params              The parsed JSON params object
 * @param emit                Function to emit a DesktopAgentEvent
 * @param state               Mutable workflow state updated by side effect
 * @param sessionId           The current session id
 * @param notificationContext Optional model/provider context for notifications
 *                            that need them (e.g. `thread/tokenUsage/updated`).
 */
export function handleServerNotification(
  method: string,
  params: unknown,
  emit: (event: DesktopAgentEvent) => void,
  state: RustAppServerWorkflowState,
  sessionId: string,
  notificationContext?: { model?: string; providerID?: string },
): void {
  switch (method) {
    // ── Thread lifecycle ─────────────────────────────────────────
    case 'thread/started': {
      const p = params as Record<string, unknown> | null
      if (p?.thread && typeof p.thread === 'object') {
        const t = p.thread as Record<string, unknown>
        state.threadId = typeof t.id === 'string' ? t.id : null
      }
      desktopDebug('rust_adapter_thread_started', {
        threadId: state.threadId,
      })
      break
    }

    // ── Turn lifecycle ───────────────────────────────────────────
    case 'turn/started': {
      const p = params as Record<string, unknown> | null
      if (p?.turn && typeof p.turn === 'object') {
        const t = p.turn as Record<string, unknown>
        state.activeTurnId = typeof t.id === 'string' ? t.id : null
      }
      resetAssistantDelta(state)
      resetReasoningDeltas(state)
      state.assistantTurnClosed = false
      state.finalizedAssistantItemIds.clear()
      state.reasoningTextBuffer = ''
      state.reasoningSummaryBuffer = ''
      state.reasoningTextStarted = false
      state.reasoningSummaryStarted = false
      state.aggregatedOutputByItem.clear()
      desktopDebug('rust_adapter_turn_started', {
        turnId: state.activeTurnId,
      })
      emit({ type: 'status', sessionId, status: 'running' })
      break
    }

    case 'turn/completed': {
      const p = params as Record<string, unknown> | null
      const turn = p?.turn as Record<string, unknown> | null
      const status = typeof turn?.status === 'string' ? turn.status : undefined
      if (status === 'failed') {
        state.activeTurnId = null
        state.activeTurnKind = null
        resetAssistantDelta(state)
        resetReasoningDeltas(state)
        state.assistantTurnClosed = true
        state.reasoningTextBuffer = ''
        state.reasoningSummaryBuffer = ''
        state.reasoningTextStarted = false
        state.reasoningSummaryStarted = false
        state.aggregatedOutputByItem.clear()
        const turnError = turn?.error as Record<string, unknown> | null
        const message =
          typeof turnError?.message === 'string'
            ? turnError.message
            : 'Rust app-server turn failed'
        emit({ type: 'error', sessionId, message })
        desktopDebug('rust_adapter_turn_failed', { message })
      } else if (status === 'completed' || status === 'interrupted') {
        state.activeTurnId = null
        state.activeTurnKind = null
        resetAssistantDelta(state)
        resetReasoningDeltas(state)
        state.assistantTurnClosed = true
        state.reasoningTextBuffer = ''
        state.reasoningSummaryBuffer = ''
        state.reasoningTextStarted = false
        state.reasoningSummaryStarted = false
        state.aggregatedOutputByItem.clear()
        emit({ type: 'done', sessionId })
        desktopDebug('rust_adapter_turn_completed', { status })
      } else {
        desktopDebug('rust_adapter_turn_status_pending', { status })
      }
      // Reset review state
      state.reviewToolUseId = null
      state.pendingReviewAgentText = null
      state.completedReviewText = null
      state.reviewToolStarted = false
      state.reviewToolCompleted = false
      break
    }

    // ── Item lifecycle: start ────────────────────────────────────
    case 'item/started': {
      const p = params as Record<string, unknown> | null
      const item = p?.item as Record<string, unknown> | null
      if (!item) break
      desktopDebug('rust_adapter_item_started', {
        itemType: item.type,
        itemId: item.id,
      })
      // Handle enteredReviewMode (review lifecycle item started)
      if (item.type === 'enteredReviewMode') {
        state.activeTurnKind = 'review'
        state.reviewToolUseId = typeof item.id === 'string' ? item.id : null
        if (!state.reviewToolStarted) {
          emit({
            type: 'tool_start',
            sessionId,
            toolName: 'CodeReview',
            toolUseId: state.reviewToolUseId ?? '',
            summary: `AI 审查：${typeof (item as Record<string, unknown>).review === 'string' ? (item as Record<string, unknown>).review : ''}`,
          })
          state.reviewToolStarted = true
        }
        break
      }

      // For known item types, emit a tool_start
      if (item.type === 'dynamicToolCall') {
        const toolCall = item as Record<string, unknown>
        emit({
          type: 'tool_start',
          sessionId,
          toolName: String(toolCall.tool ?? 'Tool'),
          summary: toolCall.arguments ? JSON.stringify(toolCall.arguments).slice(0, 500) : '',
          toolUseId: String(toolCall.id ?? ''),
        })
      } else if (item.type === 'commandExecution') {
        const cmd = item as Record<string, unknown>
        emit({
          type: 'tool_start',
          sessionId,
          toolName: 'Bash',
          summary: String(cmd.command ?? cmd.tool_input ?? ''),
          toolUseId: String(item.id ?? ''),
        })
      } else if (item.type === 'fileChange') {
        const fc = item as Record<string, unknown>
        const changes = fc.changes as Array<Record<string, unknown>> | null
        emit({
          type: 'tool_start',
          sessionId,
          toolName: 'ApplyPatch',
          summary: changes
            ? `${changes.length} file change(s)`
            : 'file change',
          toolUseId: String(item.id ?? ''),
        })
      }
      break
    }

    // ── Item lifecycle: delta (streaming text) ────────────────────
    case 'item/agentMessage/delta':
    case 'item/delta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.itemDelta as Record<string, unknown> | null
      const text = typeof p.delta === 'string'
        ? p.delta
        : typeof delta?.text === 'string'
          ? delta.text
          : undefined
      if (text) {
        const itemId = typeof p.itemId === 'string' ? p.itemId : 'agent-message'
        appendAssistantDelta(state, itemId, text, emit, sessionId)
      }
      break
    }

    // ── Item lifecycle: completed ────────────────────────────────
    case 'item/completed': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const item = p.item as Record<string, unknown> | null
      if (!item) break
      desktopDebug('rust_adapter_item_completed', {
        itemType: item.type,
        itemId: item.id,
      })

      switch (item.type) {
        case 'agentMessage': {
          // In review mode, cache agent text instead of emitting message
          if (state.activeTurnKind === 'review') {
            if (typeof item.text === 'string') {
              state.pendingReviewAgentText = item.text
            }
            resetAssistantDelta(state)
            break
          }
          const activeItemId = state.assistantStreamItemId
          const itemId = typeof item.id === 'string' ? item.id : state.assistantStreamItemId
          const text =
            typeof item.text === 'string'
              ? item.text
              : materializeAssistantDelta(state)
          if (text) {
            emit({
              type: 'message',
              sessionId,
              role: 'assistant',
              text,
              ...(itemId ? { streamId: itemId } : {}),
              ...(state.activeTurnId
                ? { metadata: { turnId: state.activeTurnId } }
                : {}),
            })
          }
          if (itemId) state.finalizedAssistantItemIds.add(itemId)
          if (activeItemId) state.finalizedAssistantItemIds.add(activeItemId)
          resetAssistantDelta(state)
          break
        }

        case 'dynamicToolCall': {
          const toolCall = item as Record<string, unknown>
          const status = toolCall.status as string | undefined
          const contentItems = toolCall.contentItems
          const success = toolCall.success as boolean | undefined
          const isError = status === 'failed' || status === 'error' || success === false
          emit({
            type: 'tool_result',
            sessionId,
            toolName: String(toolCall.tool ?? 'Tool'),
            summary: contentItems
              ? JSON.stringify(contentItems).slice(0, 500)
              : status ?? 'completed',
            toolUseId: String(toolCall.id ?? ''),
            isError,
            metadata: {
              contentItems,
              success,
              durationMs: toolCall.durationMs,
            },
          })
          break
        }

        case 'commandExecution': {
          const cmd = item as Record<string, unknown>
          const cmdStatus = cmd.status as string | undefined
          const output = cmd.output as string | undefined
          const itemId = String(item.id ?? '')
          // Prefer aggregatedOutput from tracked state (built from deltas)
          // Falls back to cmd.output, cmd.result, or cmd.aggregatedOutput
          const aggregated =
            state.aggregatedOutputByItem.get(itemId) ??
            (cmd.aggregatedOutput as string | undefined) ??
            output ??
            (cmd.result as string | undefined)
          state.aggregatedOutputByItem.delete(itemId)
          emit({
            type: 'tool_result',
            sessionId,
            toolName: 'Bash',
            summary: aggregated
              ? String(aggregated).slice(0, 500)
              : cmdStatus ?? 'completed',
            toolUseId: itemId,
            isError: cmd.exitCode != null && cmd.exitCode !== 0,
            metadata: {
              exitCode: cmd.exitCode,
              command: cmd.command,
              output: aggregated,
            },
          })
          break
        }

        case 'fileChange': {
          const fc = item as Record<string, unknown>
          const fcStatus = fc.status as string | undefined
          const changes = fc.changes as Array<Record<string, unknown>> | null
          emit({
            type: 'tool_result',
            sessionId,
            toolName: 'ApplyPatch',
            summary: changes
              ? `${changes.length} file change(s) ${fcStatus ?? 'completed'}`
              : `file change ${fcStatus ?? 'completed'}`,
            toolUseId: String(item.id ?? ''),
            isError: fcStatus === 'failed' || fcStatus === 'error',
            metadata: { status: fcStatus, changes },
          })
          break
        }

        case 'contextCompaction': {
          emit({
            type: 'message',
            sessionId,
            role: 'system',
            text: '对话上下文已压缩',
          })
          break
        }

        case 'exitedReviewMode': {
          const reviewText = typeof (item as Record<string, unknown>).review === 'string'
            ? ((item as Record<string, unknown>).review as string).trim()
            : ''
          state.completedReviewText = reviewText
          if (!state.reviewToolCompleted) {
            emit({
              type: 'tool_result',
              sessionId,
              toolName: 'CodeReview',
              toolUseId: state.reviewToolUseId ?? '',
              summary: 'AI 审查完成',
            })
            state.reviewToolCompleted = true
          }
          if (reviewText) {
            emit({
              type: 'message',
              sessionId,
              role: 'assistant',
              text: reviewText,
            })
          }
          state.pendingReviewAgentText = null
          break
        }

        default: {
          // Unknown item type — log details but don't swallow
          desktopDebug('rust_adapter_unhandled_item_type', {
            itemType: item.type,
            itemId: item.id,
            keys: Object.keys(item),
          })
          break
        }
      }
      break
    }

    // ── Plan notifications ─────────────────────────────────────────
    case 'turn/plan/updated': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const plan = p.plan as Array<Record<string, unknown>> | undefined
      const explanation = p.explanation as string | null | undefined
      const planText = [
        ...(explanation ? [explanation] : []),
        ...(plan
          ? plan.map(
              (step, i) => `${i + 1}. ${step.step} [${step.status ?? 'pending'}]`,
            )
          : []),
      ].join('\n')
      emit({
        type: 'proposed_plan',
        sessionId,
        text: planText,
        streaming: true,
      })
      desktopDebug('rust_adapter_plan_updated', {
        stepCount: plan?.length ?? 0,
        textLength: planText.length,
      })
      break
    }

    case 'item/plan/delta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.delta as string | undefined
      if (delta && !state.assistantTurnClosed) {
        emit({
          type: 'proposed_plan',
          sessionId,
          text: delta,
          streaming: true,
        })
      }
      break
    }

    // ── Reasoning notifications ────────────────────────────────────
    case 'item/reasoning/textDelta':
    case 'reasoning/textDelta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.delta as string | undefined
      if (delta && !state.assistantTurnClosed) {
        const itemId = typeof p.itemId === 'string' ? p.itemId : 'reasoning'
        appendReasoningDelta(state, `reasoning:${itemId}`, '*推理...* ', delta, emit, sessionId)
      }
      break
    }

    case 'item/reasoning/summaryTextDelta':
    case 'reasoning/summaryTextDelta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.delta as string | undefined
      if (delta && !state.assistantTurnClosed) {
        const itemId = typeof p.itemId === 'string' ? p.itemId : 'summary'
        appendReasoningDelta(
          state,
          `reasoning-summary:${itemId}`,
          '*推理摘要...* ',
          delta,
          emit,
          sessionId,
        )
      }
      break
    }

    // ── File change / command execution progress deltas ──────────
    case 'item/commandExecution/outputDelta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.delta as string | undefined
      const itemId = p.itemId as string | undefined
      if (delta) {
        desktopDebug('rust_adapter_command_output', {
          textPreview: delta.slice(0, 200),
          itemId,
        })
        // Accumulate in state for final output on item/completed
        if (itemId) {
          const prev = state.aggregatedOutputByItem.get(itemId) ?? ''
          state.aggregatedOutputByItem.set(itemId, prev + delta)
        }
        // Emit tool_output_delta so live display updates the matching command card
        emit({
          type: 'tool_output_delta',
          sessionId,
          toolUseId: itemId ?? '',
          toolName: 'Bash',
          delta,
        })
      }
      break
    }

    case 'item/fileChange/patchUpdated': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const files = (Array.isArray(p.changes) ? p.changes : p.files) as
        | Array<Record<string, unknown>>
        | undefined
      desktopDebug('rust_adapter_file_change_patch', {
        fileCount: Array.isArray(files) ? files.length : undefined,
        filePaths: files?.map(f => f.path as string).filter(Boolean),
      })
      // Emit diff events for each changed file
      if (Array.isArray(files)) {
        for (const file of files) {
          if (typeof file.path === 'string' && typeof file.patch === 'string') {
            emit({
              type: 'diff',
              sessionId,
              filePath: file.path,
              patch: file.patch,
              metadata: { itemId: p.itemId },
            })
          }
        }
      }
      break
    }

    // ── Turn-level diff notification ───────────────────────────────
    case 'turn/diff/updated': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const diff = p.diff as string | undefined
      if (diff) {
        desktopDebug('rust_adapter_turn_diff', {
          diffLength: diff.length,
        })
        emit({
          type: 'diff',
          sessionId,
          filePath: '(aggregated)',
          patch: diff,
        })
      }
      break
    }

    // ── Server request resolved ──────────────────────────────────
    case 'serverRequest/resolved': {
      const p = params as Record<string, unknown> | null
      const requestId = p?.requestId as string | undefined
      const method = p?.method as string | undefined
      desktopDebug('rust_adapter_server_request_resolved', {
        requestId,
        method,
      })
      // The request was resolved by the Rust server (permission granted/denied).
      // The matching permission_request is already handled by agentSession.
      // Emit status to help the UI clear any stale waiting indicator.
      if (
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/permissions/requestApproval' ||
        method === 'item/fileChange/requestApproval'
      ) {
        state.aggregatedOutputByItem.delete(String(p?.itemId ?? ''))
        emit({
          type: 'status',
          sessionId,
          status: 'running',
        })
      }
      break
    }

    // ── Error ────────────────────────────────────────────────────
    case 'error': {
      const p = params as Record<string, unknown> | null
      const errorObj = p?.error as Record<string, unknown> | null
      const message =
        typeof errorObj?.message === 'string'
          ? errorObj.message
          : 'Rust app-server error'
      state.activeTurnId = null
      resetAssistantDelta(state)
      resetReasoningDeltas(state)
      state.assistantTurnClosed = true
      state.aggregatedOutputByItem.clear()
      emit({ type: 'error', sessionId, message })
      desktopDebug('rust_adapter_error', { message })
      break
    }

	    // ── Token usage ───────────────────────────────────────────────
	    case 'thread/tokenUsage/updated': {
	      const p = params as Record<string, unknown> | null
	      if (!p) break
	      const tu = p.tokenUsage as Record<string, unknown> | null
	      if (!tu) break
	      const last = tu.last as Record<string, unknown> | null
	      if (!last) break

	      const model = notificationContext?.model ?? 'unknown'
	      const providerID = notificationContext?.providerID

	      const usage = buildDesktopContextUsageFromRustTokenUsage({
	        model,
	        provider: providerID,
	        inputTokens: Number(last.inputTokens ?? 0),
	        cachedInputTokens: Number(last.cachedInputTokens ?? 0),
	        outputTokens: Number(last.outputTokens ?? 0),
	        reasoningOutputTokens: Number(last.reasoningOutputTokens ?? 0),
	        totalTokens: Number(last.totalTokens ?? 0),
	      })

	      if (usage) {
	        emit({ type: 'context_usage', sessionId, usage })
	        desktopDebug('rust_adapter_context_usage', { usage })
	      }
	      break
	    }

	    // ── Unknown ──────────────────────────────────────────────────
	    default: {
	      // Unknown notifications: reasoning, plan, MCP, skills, etc.
	      desktopDebug('rust_adapter_unhandled_notification', { method })
	      break
	    }
  }
}

const ASSISTANT_STREAM_UPDATE_MS = 40

function appendReasoningDelta(
  state: RustAppServerWorkflowState,
  streamId: string,
  prefix: string,
  delta: string,
  emit: (event: DesktopAgentEvent) => void,
  sessionId: string,
): void {
  if (state.assistantTurnClosed) return
  let stream = state.reasoningStreams.get(streamId)
  if (!stream) {
    stream = {
      chunks: [],
      processedChunkCount: 0,
      scheduleHandle: null,
      partialEmitted: false,
      prefix,
    }
    state.reasoningStreams.set(streamId, stream)
  }
  stream.chunks.push(delta)
  if (!stream.partialEmitted) {
    stream.partialEmitted = true
    emitReasoningPartial(state, streamId, stream, emit, sessionId)
    return
  }
  if (stream.scheduleHandle !== null) return
  const generation = state.reasoningStreamGeneration
  stream.scheduleHandle = state.scheduleAssistantUpdate(() => {
    if (
      generation !== state.reasoningStreamGeneration ||
      state.assistantTurnClosed ||
      state.reasoningStreams.get(streamId) !== stream
    ) {
      return
    }
    stream.scheduleHandle = null
    emitReasoningPartial(state, streamId, stream, emit, sessionId)
  }, ASSISTANT_STREAM_UPDATE_MS)
}

function emitReasoningPartial(
  state: RustAppServerWorkflowState,
  streamId: string,
  stream: BufferedReasoningStream,
  emit: (event: DesktopAgentEvent) => void,
  sessionId: string,
): void {
  const chunks = stream.chunks.slice(stream.processedChunkCount)
  if (chunks.length === 0) return
  const text = `${stream.processedChunkCount === 0 ? stream.prefix : ''}${chunks.join('')}`
  stream.processedChunkCount = stream.chunks.length
  if (streamId.startsWith('reasoning-summary:')) {
    state.reasoningSummaryStarted = true
    state.reasoningSummaryBuffer = text
  } else {
    state.reasoningTextStarted = true
    state.reasoningTextBuffer = text
  }
  emit({
    type: 'partial_message',
    sessionId,
    text,
    delta: true,
    streamId,
    ...(state.activeTurnId ? { metadata: { turnId: state.activeTurnId } } : {}),
  })
}

function resetReasoningDeltas(state: RustAppServerWorkflowState): void {
  for (const stream of state.reasoningStreams.values()) {
    if (stream.scheduleHandle !== null) {
      state.cancelAssistantUpdate(stream.scheduleHandle)
    }
  }
  state.reasoningStreams.clear()
  state.reasoningStreamGeneration += 1
  state.reasoningTextBuffer = ''
  state.reasoningSummaryBuffer = ''
  state.reasoningTextStarted = false
  state.reasoningSummaryStarted = false
}

function appendAssistantDelta(
  state: RustAppServerWorkflowState,
  itemId: string,
  delta: string,
  emit: (event: DesktopAgentEvent) => void,
  sessionId: string,
): void {
  if (
    state.assistantTurnClosed ||
    state.finalizedAssistantItemIds.has(itemId)
  ) {
    return
  }
  if (state.assistantStreamItemId !== itemId) {
    resetAssistantDelta(state)
    state.assistantStreamItemId = itemId
  }
  state.assistantDeltaChunks.push(delta)
  if (!state.assistantPartialEmitted) {
    state.assistantPartialEmitted = true
    emitAssistantPartial(state, itemId, emit, sessionId)
    return
  }
  if (state.assistantDeltaScheduleHandle !== null) return
  const generation = state.assistantStreamGeneration
  state.assistantDeltaScheduleHandle = state.scheduleAssistantUpdate(() => {
    if (
      generation !== state.assistantStreamGeneration ||
      itemId !== state.assistantStreamItemId ||
      state.finalizedAssistantItemIds.has(itemId) ||
      state.assistantTurnClosed
    ) {
      return
    }
    state.assistantDeltaScheduleHandle = null
    emitAssistantPartial(state, itemId, emit, sessionId)
  }, ASSISTANT_STREAM_UPDATE_MS)
}

function emitAssistantPartial(
  state: RustAppServerWorkflowState,
  itemId: string,
  emit: (event: DesktopAgentEvent) => void,
  sessionId: string,
): void {
  const chunks = state.assistantDeltaChunks.slice(
    state.assistantProcessedChunkCount,
  )
  if (chunks.length === 0) return
  const text = chunks.join('')
  state.assistantProcessedChunkCount = state.assistantDeltaChunks.length
  state.assistantProcessedChars += text.length
  state.assistantDeltaBuffer = text
  emit({
    type: 'partial_message',
    sessionId,
    text,
    delta: true,
    streamId: itemId,
    ...(state.activeTurnId ? { metadata: { turnId: state.activeTurnId } } : {}),
  })
}

function materializeAssistantDelta(state: RustAppServerWorkflowState): string {
  state.assistantDeltaBuffer = state.assistantDeltaChunks.join('')
  return state.assistantDeltaBuffer
}

function resetAssistantDelta(state: RustAppServerWorkflowState): void {
  if (state.assistantDeltaScheduleHandle !== null) {
    state.cancelAssistantUpdate(state.assistantDeltaScheduleHandle)
  }
  state.assistantDeltaScheduleHandle = null
  state.assistantDeltaChunks.length = 0
  state.assistantProcessedChunkCount = 0
  state.assistantDeltaBuffer = ''
  state.assistantPartialEmitted = false
  state.assistantStreamItemId = null
  state.assistantStreamGeneration += 1
}

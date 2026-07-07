import { desktopDebug } from './desktopDebug.js'
import type { DesktopAgentEvent } from '../shared/types.js'

/**
 * Maps Rust app-server ServerNotifications into DesktopAgentEvent emissions.
 *
 * First version only handles text-based agent message flows:
 * - `thread/started` — stores thread id
 * - `turn/started` — marks active turn
 * - `item/delta` with agentMessage fields — accumulates assistant text
 * - `item/completed` with agentMessage — emits final assistant message
 * - `turn/completed` — emits `done` event
 * - `error` — emits `error` event
 *
 * Unknown/unhandled notifications are debug-logged and ignored.
 */

export type RustAppServerWorkflowState = {
  threadId: string | null
  activeTurnId: string | null
  /** Accumulated assistant text from item/delta notifications */
  assistantDeltaBuffer: string
}

export function createRustAppServerWorkflowState(): RustAppServerWorkflowState {
  return {
    threadId: null,
    activeTurnId: null,
    assistantDeltaBuffer: '',
  }
}

/**
 * Process a single raw server notification.
 *
 * @param method  The notification method name (e.g. `"thread/started"`)
 * @param params  The parsed JSON params object
 * @param emit    Function to emit a DesktopAgentEvent
 * @param state   Mutable workflow state updated by side effect
 */
export function handleServerNotification(
  method: string,
  params: unknown,
  emit: (event: DesktopAgentEvent) => void,
  state: RustAppServerWorkflowState,
  sessionId: string,
): void {
  switch (method) {
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

    case 'turn/started': {
      const p = params as Record<string, unknown> | null
      if (p?.turn && typeof p.turn === 'object') {
        const t = p.turn as Record<string, unknown>
        state.activeTurnId = typeof t.id === 'string' ? t.id : null
      }
      state.assistantDeltaBuffer = ''
      desktopDebug('rust_adapter_turn_started', {
        turnId: state.activeTurnId,
      })
      break
    }

    case 'item/delta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.itemDelta as Record<string, unknown> | null
      if (delta?.text && typeof delta.text === 'string') {
        state.assistantDeltaBuffer += delta.text
        emit({
          type: 'partial_message',
          sessionId,
          text: state.assistantDeltaBuffer,
        })
      }
      break
    }

    case 'item/completed': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const item = p.item as Record<string, unknown> | null
      if (item?.type === 'agentMessage' && typeof item.text === 'string') {
        // Use the final item text (not the delta buffer) to avoid duplication
        emit({
          type: 'message',
          sessionId,
          role: 'assistant',
          text: item.text,
        })
      }
      state.assistantDeltaBuffer = ''
      break
    }

    case 'turn/completed': {
      // If no final message was emitted for this turn, emit nothing extra
      state.activeTurnId = null
      state.assistantDeltaBuffer = ''
      emit({ type: 'done', sessionId })
      desktopDebug('rust_adapter_turn_completed')
      break
    }

    case 'error': {
      const p = params as Record<string, unknown> | null
      const errorObj = p?.error as Record<string, unknown> | null
      const message =
        typeof errorObj?.message === 'string'
          ? errorObj.message
          : 'Rust app-server error'
      state.activeTurnId = null
      state.assistantDeltaBuffer = ''
      emit({ type: 'error', sessionId, message })
      desktopDebug('rust_adapter_error', { message })
      break
    }

    default: {
      // Unknown notifications: tools, commands, files, MCP, plan, reasoning
      // Debug log only for first version.
      desktopDebug('rust_adapter_unhandled_notification', { method })
      break
    }
  }
}

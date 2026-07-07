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

export type RustAppServerWorkflowState = {
  threadId: string | null
  activeTurnId: string | null
  /** Accumulated assistant text from agentMessage/item deltas */
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
      state.assistantDeltaBuffer = ''
      desktopDebug('rust_adapter_turn_started', {
        turnId: state.activeTurnId,
      })
      break
    }

    case 'turn/completed': {
      state.activeTurnId = null
      state.assistantDeltaBuffer = ''
      emit({ type: 'done', sessionId })
      desktopDebug('rust_adapter_turn_completed')
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
      // For known item types, emit a tool_start
      if (item.type === 'dynamicToolCall') {
        const toolCall = item as Record<string, unknown>
        emit({
          type: 'tool_start',
          sessionId,
          toolName: String(toolCall.tool_name ?? toolCall.toolName ?? 'Tool'),
          summary: toolCall.input ? JSON.stringify(toolCall.input).slice(0, 500) : '',
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
      if (!delta) break
      desktopDebug('rust_adapter_delta', {
        deltaKeys: Object.keys(delta),
        textPreview: typeof delta.text === 'string'
          ? delta.text.slice(0, 100)
          : undefined,
      })
      if (delta.text && typeof delta.text === 'string') {
        state.assistantDeltaBuffer += delta.text
        emit({
          type: 'partial_message',
          sessionId,
          text: state.assistantDeltaBuffer,
        })
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
        case 'agentMessage':
          if (typeof item.text === 'string') {
            emit({
              type: 'message',
              sessionId,
              role: 'assistant',
              text: item.text,
            })
          }
          state.assistantDeltaBuffer = ''
          break

        case 'dynamicToolCall': {
          const toolCall = item as Record<string, unknown>
          const status = toolCall.status as string | undefined
          const result = toolCall.result as Record<string, unknown> | undefined
          const isError = status === 'failed' || status === 'error'
          emit({
            type: 'tool_result',
            sessionId,
            toolName: String(toolCall.tool_name ?? toolCall.toolName ?? 'Tool'),
            summary: result
              ? JSON.stringify(result).slice(0, 500)
              : status ?? 'completed',
            toolUseId: String(toolCall.id ?? ''),
            isError,
            metadata: result,
          })
          break
        }

        case 'commandExecution': {
          const cmd = item as Record<string, unknown>
          const cmdStatus = cmd.status as string | undefined
          const output = cmd.output as string | undefined
          const cmdResult = output ?? cmd.result
          emit({
            type: 'tool_result',
            sessionId,
            toolName: 'Bash',
            summary: cmdResult
              ? String(cmdResult).slice(0, 500)
              : cmdStatus ?? 'completed',
            toolUseId: String(item.id ?? ''),
            isError: cmd.exitCode != null && cmd.exitCode !== 0,
            metadata: {
              exitCode: cmd.exitCode,
              command: cmd.command,
              output: cmdResult,
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

    // ── File change / command execution progress deltas ──────────
    case 'item/commandExecution/outputDelta': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      const delta = p.delta as Record<string, unknown> | null
      desktopDebug('rust_adapter_command_output', {
        textPreview: typeof delta?.text === 'string'
          ? (delta.text as string).slice(0, 200)
          : undefined,
      })
      // Currently not emitting output delta as events — handled by tool_result
      break
    }

    case 'item/fileChange/patchUpdated': {
      const p = params as Record<string, unknown> | null
      if (!p) break
      desktopDebug('rust_adapter_file_change_patch', {
        fileCount: Array.isArray(p.files) ? p.files.length : undefined,
      })
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
      state.assistantDeltaBuffer = ''
      emit({ type: 'error', sessionId, message })
      desktopDebug('rust_adapter_error', { message })
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

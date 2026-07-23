import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import type { PiRuntimeEventContext, PiRuntimeEventSink } from "./types"

type ToolResultLike = {
  content?: unknown
  details?: unknown
}

const textContent = (content: unknown): string => {
  if (!Array.isArray(content)) return ""
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return []
    const text = (part as { text?: unknown }).text
    return typeof text === "string" ? [text] : []
  }).join("\n").trim()
}

const detailText = (details: unknown, key: string): string => {
  if (!details || typeof details !== "object") return ""
  const value = (details as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

/** Converts Pi's AgentToolResult wrapper into user-facing semantic text. */
export const piToolResultText = (value: unknown, options: { tool: string; progress?: boolean }): string => {
  if (typeof value === "string") return value
  if (value == null) return ""
  if (!value || typeof value !== "object") return String(value)
  const result = value as ToolResultLike
  const message = detailText(result.details, "message")
  if (options.progress && message) return message
  if (/^(shell|bash|powershell|pwsh|command|exec)/i.test(options.tool)) {
    const output = [detailText(result.details, "stdout"), detailText(result.details, "stderr")]
      .filter(Boolean)
      .join("\n")
      .trim()
    if (output) return output
  }
  const content = textContent(result.content)
  if (content) return content
  if (message) return message
  return ""
}

/** Converts Pi's protocol into stable semantic callbacks used by the Agent persistence layer. */
export class PiEventAdapter {
  private beforeCompactionCount: number | undefined

  constructor(private readonly context: PiRuntimeEventContext, private readonly sink: PiRuntimeEventSink) {}

  async handle(event: AgentHarnessEvent) {
    await this.sink.event?.(this.context, event)
    switch (event.type) {
      case "session_before_compact":
        this.beforeCompactionCount = event.branchEntries.length
        break
      case "message_update": {
        const update = event.assistantMessageEvent
        if (update.type === "text_delta") await this.sink.textDelta?.(this.context, update.delta)
        if (update.type === "thinking_delta") await this.sink.reasoningDelta?.(this.context, update.delta)
        break
      }
      case "tool_execution_start":
        await this.sink.toolStarted?.(this.context, { toolCallID: event.toolCallId, tool: event.toolName, input: event.args })
        break
      case "tool_execution_update":
        await this.sink.toolUpdated?.(this.context, {
          toolCallID: event.toolCallId,
          tool: event.toolName,
          update: piToolResultText(event.partialResult, { tool: event.toolName, progress: true }),
        })
        break
      case "tool_execution_end":
        await this.sink.toolFinished?.(this.context, {
          toolCallID: event.toolCallId,
          tool: event.toolName,
          result: piToolResultText(event.result, { tool: event.toolName }),
          isError: event.isError,
        })
        break
      case "queue_update":
        await this.sink.queueUpdated?.(this.context, { steer: event.steer.length, followUp: event.followUp.length, nextTurn: event.nextTurn.length })
        break
      case "session_compact":
        await this.sink.compacted?.(this.context, {
          entryID: event.compactionEntry.id,
          summary: event.compactionEntry.summary,
          tokensBefore: event.compactionEntry.tokensBefore,
          beforeCount: this.beforeCompactionCount ?? 0,
        })
        this.beforeCompactionCount = undefined
        break
      case "save_point":
        await this.sink.savePoint?.(this.context, { hadPendingMutations: event.hadPendingMutations })
        break
      case "settled":
        await this.sink.settled?.(this.context, { nextTurnCount: event.nextTurnCount })
        break
      case "abort":
        await this.sink.aborted?.(this.context)
        break
    }
  }
}

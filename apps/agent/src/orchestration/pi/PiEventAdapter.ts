import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import { ProposedPlanStreamParser, type ProposedPlanChunk } from "../plan/ProposedPlanStreamParser"
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

const usageNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0

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
  private assistantItems: { textItemID: string; reasoningItemID: string; planItemID: string } | null = null
  private parser: ProposedPlanStreamParser | null = null
  private receivedTextDelta = false
  private textStarted = false
  private planStarted = false
  private pendingText = ""
  private pendingPlan = ""
  private completedText = ""

  constructor(
    private readonly context: PiRuntimeEventContext,
    private readonly sink: PiRuntimeEventSink,
    private readonly options: { parseProposedPlan?: boolean } = {},
  ) {}

  private newAssistantItems() {
    const segmentID = crypto.randomUUID()
    return {
      textItemID: `${this.context.turnID}:pi:text:${segmentID}`,
      reasoningItemID: `${this.context.turnID}:pi:reasoning:${segmentID}`,
      planItemID: `${this.context.turnID}:pi:text:${segmentID}:plan`,
    }
  }

  private resetAssistantMessage() {
    const items = this.newAssistantItems()
    this.assistantItems = items
    this.parser = this.options.parseProposedPlan ? new ProposedPlanStreamParser() : null
    this.receivedTextDelta = false
    this.textStarted = false
    this.planStarted = false
    this.pendingText = ""
    this.pendingPlan = ""
    return items
  }

  private async ensureAssistantItems(startText = !this.options.parseProposedPlan) {
    if (this.assistantItems) return this.assistantItems
    const items = this.resetAssistantMessage()
    if (startText) await this.startText()
    return items
  }

  private async startText() {
    const items = this.assistantItems ?? this.resetAssistantMessage()
    if (this.textStarted) return
    this.textStarted = true
    await this.sink.assistantMessageStarted?.(this.context, items)
  }

  private async routeChunks(chunks: readonly ProposedPlanChunk[]) {
    const items = await this.ensureAssistantItems(false)
    for (const chunk of chunks) {
      if (chunk.kind === "text") {
        this.pendingText += chunk.delta
        if (!this.textStarted && /\S/.test(this.pendingText)) await this.startText()
        if (this.textStarted && this.pendingText) {
          await this.sink.textDelta?.(this.context, { itemID: items.textItemID, delta: this.pendingText })
          this.pendingText = ""
        }
        continue
      }
      this.pendingPlan += chunk.delta
      if (!this.planStarted && /\S/.test(this.pendingPlan)) {
        this.planStarted = true
        await this.sink.planStarted?.(this.context, { itemID: items.planItemID })
      }
      if (this.planStarted && this.pendingPlan) {
        await this.sink.planDelta?.(this.context, { itemID: items.planItemID, delta: this.pendingPlan })
        this.pendingPlan = ""
      }
    }
  }

  outputText(content: unknown) {
    return this.options.parseProposedPlan ? this.completedText : textContent(content)
  }

  async handle(event: AgentHarnessEvent) {
    await this.sink.event?.(this.context, event)
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.resetAssistantMessage()
          if (!this.options.parseProposedPlan) await this.startText()
        }
        break
      case "session_before_compact":
        this.beforeCompactionCount = event.branchEntries.length
        break
      case "message_update": {
        const update = event.assistantMessageEvent
        const items = await this.ensureAssistantItems()
        if (update.type === "text_delta") {
          this.receivedTextDelta = true
          if (this.parser) await this.routeChunks(this.parser.push(update.delta))
          else await this.sink.textDelta?.(this.context, { itemID: items.textItemID, delta: update.delta })
        }
        if (update.type === "thinking_delta") await this.sink.reasoningDelta?.(this.context, { itemID: items.reasoningItemID, delta: update.delta })
        break
      }
      case "message_end":
        if (event.message.role === "assistant") {
          const items = await this.ensureAssistantItems(false)
          const usage = event.message.usage && typeof event.message.usage === "object"
            ? event.message.usage as unknown as Record<string, unknown>
            : {}
          const completion = {
            provider: typeof event.message.provider === "string" ? event.message.provider : "",
            api: typeof event.message.api === "string" ? event.message.api : "",
            model: typeof event.message.responseModel === "string"
              ? event.message.responseModel
              : typeof event.message.model === "string"
                ? event.message.model
                : "",
            usage: {
              input: usageNumber(usage.input),
              output: usageNumber(usage.output),
              cacheRead: usageNumber(usage.cacheRead),
              cacheWrite: usageNumber(usage.cacheWrite),
              reasoning: usageNumber(usage.reasoning),
            },
          }
          if (this.parser) {
            if (!this.receivedTextDelta) await this.routeChunks(this.parser.push(textContent(event.message.content)))
            const parsed = this.parser.finish()
            await this.routeChunks(parsed.chunks)
            this.completedText = parsed.text
            await this.sink.assistantMessageCompleted?.(this.context, {
              ...items,
              content: event.message.content,
              text: parsed.text,
              plan: parsed.plan,
              ...completion,
            })
          } else {
            this.completedText = textContent(event.message.content)
            await this.sink.assistantMessageCompleted?.(this.context, {
              ...items,
              content: event.message.content,
              ...completion,
            })
          }
          this.assistantItems = null
          this.parser = null
        }
        break
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

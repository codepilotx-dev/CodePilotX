import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import { ProposedPlanStreamParser, type ProposedPlanChunk } from "../plan/ProposedPlanStreamParser"
import type { PiRuntimeEventContext, PiRuntimeEventHandler, PiRuntimeEventPayload, RuntimeCompactionTrigger } from "./types"

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

const resultDetails = (value: unknown): unknown => value && typeof value === "object"
  ? (value as ToolResultLike).details
  : undefined

const usageNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0

const assistantMessagePlacement = (content: unknown) =>
  Array.isArray(content) && content.some(
    (part) => part && typeof part === "object"
      && (part as { type?: unknown }).type === "toolCall",
  )
    ? "process" as const
    : "result" as const

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

/**
 * 把 Pi 原始 Harness 事件映射为 CodePilotX 语义运行时事件（判别联合），
 * 并负责计划解析与稳定 item ID 生成。持久化决策完全交给单一投影器。
 */
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
    private readonly handler: PiRuntimeEventHandler,
    private readonly options: {
      parseProposedPlan?: boolean
      resolveSessionEntryID?: () => string | null | Promise<string | null>
      resolveCompactionContext?: () => {
        trigger: RuntimeCompactionTrigger
        promptText: string
      }
      /** 原始事件观测（仅用于诊断日志，不进入协议）。 */
      observe?: (event: AgentHarnessEvent) => void
    } = {},
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
    await this.emit({
      type: "assistant.started",
      textItemID: items.textItemID,
      reasoningItemID: items.reasoningItemID,
      placement: "process",
    })
  }

  private async routeChunks(chunks: readonly ProposedPlanChunk[]) {
    const items = await this.ensureAssistantItems(false)
    for (const chunk of chunks) {
      if (chunk.kind === "text") {
        this.pendingText += chunk.delta
        if (!this.textStarted && /\S/.test(this.pendingText)) await this.startText()
        if (this.textStarted && this.pendingText) {
          await this.emit({ type: "assistant.text.delta", itemID: items.textItemID, delta: this.pendingText })
          this.pendingText = ""
        }
        continue
      }
      this.pendingPlan += chunk.delta
      if (!this.planStarted && /\S/.test(this.pendingPlan)) {
        this.planStarted = true
        await this.emit({ type: "plan.started", itemID: items.planItemID })
      }
      if (this.planStarted && this.pendingPlan) {
        await this.emit({ type: "plan.delta", itemID: items.planItemID, delta: this.pendingPlan })
        this.pendingPlan = ""
      }
    }
  }

  outputText(content: unknown) {
    return this.options.parseProposedPlan ? this.completedText : textContent(content)
  }

  private emit(event: PiRuntimeEventPayload): Promise<void> {
    return Promise.resolve(this.handler({ context: this.context, ...event }))
  }

  async handle(event: AgentHarnessEvent) {
    this.options.observe?.(event)
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.resetAssistantMessage()
          if (!this.options.parseProposedPlan) await this.startText()
        }
        break
      case "session_before_compact":
        this.beforeCompactionCount = event.preparation.messagesToSummarize.length
          + event.preparation.turnPrefixMessages.length
          + event.preparation.retainedTail.length
          + (event.preparation.previousSummary ? 1 : 0)
        break
      case "message_update": {
        const update = event.assistantMessageEvent
        const items = await this.ensureAssistantItems()
        if (update.type === "text_delta") {
          this.receivedTextDelta = true
          if (this.parser) await this.routeChunks(this.parser.push(update.delta))
          else await this.emit({ type: "assistant.text.delta", itemID: items.textItemID, delta: update.delta })
        }
        if (update.type === "thinking_delta") await this.emit({ type: "assistant.reasoning.delta", itemID: items.reasoningItemID, delta: update.delta })
        break
      }
      case "message_end":
        if (event.message.role === "assistant") {
          const items = await this.ensureAssistantItems(false)
          const usage = event.message.usage && typeof event.message.usage === "object"
            ? event.message.usage as unknown as Record<string, unknown>
            : {}
          const completion = {
            placement: assistantMessagePlacement(event.message.content),
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
          const resolvedEntryID = completion.placement === "result"
            ? await this.options.resolveSessionEntryID?.()
            : null
          const sessionEntry = typeof resolvedEntryID === "string" && resolvedEntryID
            ? { sessionEntryID: resolvedEntryID }
            : {}
          if (this.parser) {
            if (!this.receivedTextDelta) await this.routeChunks(this.parser.push(textContent(event.message.content)))
            const parsed = this.parser.finish()
            await this.routeChunks(parsed.chunks)
            this.completedText = parsed.text
            await this.emit({
              type: "assistant.completed",
              ...items,
              content: event.message.content,
              text: parsed.text,
              plan: parsed.plan,
              ...sessionEntry,
              ...completion,
            })
          } else {
            this.completedText = textContent(event.message.content)
            await this.emit({
              type: "assistant.completed",
              ...items,
              content: event.message.content,
              ...sessionEntry,
              ...completion,
            })
          }
          this.assistantItems = null
          this.parser = null
        }
        break
      case "tool_execution_start":
        await this.emit({ type: "tool.started", toolCallID: event.toolCallId, tool: event.toolName, input: event.args })
        break
      case "tool_execution_update":
        await this.emit({
          type: "tool.updated",
          toolCallID: event.toolCallId,
          tool: event.toolName,
          update: piToolResultText(event.partialResult, { tool: event.toolName, progress: true }),
        })
        break
      case "tool_execution_end":
        await this.emit({
          type: "tool.finished",
          toolCallID: event.toolCallId,
          tool: event.toolName,
          result: piToolResultText(event.result, { tool: event.toolName }),
          details: resultDetails(event.result),
          isError: event.isError,
        })
        break
      case "queue_update":
        await this.emit({ type: "queue.updated", steer: event.steer.length, followUp: event.followUp.length, nextTurn: event.nextTurn.length })
        break
      case "queue_consumed":
        await this.emit({ type: "queue.consumed", delivery: event.delivery, inputIDs: event.inputIds })
        break
      case "session_compact":
      {
        const compaction = this.options.resolveCompactionContext?.() ?? {
          trigger: "manual" as const,
          promptText: "",
        }
        await this.emit({
          type: "compaction.completed",
          entryID: event.compactionEntry.id,
          summary: event.compactionEntry.summary,
          firstKeptEntryID: event.compactionEntry.firstKeptEntryId ?? null,
          tokensBefore: event.compactionEntry.tokensBefore,
          beforeCount: this.beforeCompactionCount ?? 0,
          trigger: compaction.trigger,
          promptText: compaction.promptText,
        })
        this.beforeCompactionCount = undefined
        break
      }
      case "save_point":
        await this.emit({ type: "runtime.savepoint", hadPendingMutations: event.hadPendingMutations })
        break
      case "settled":
        await this.emit({ type: "runtime.settled", nextTurnCount: event.nextTurnCount })
        break
      case "abort":
        await this.emit({ type: "runtime.aborted" })
        break
    }
  }
}

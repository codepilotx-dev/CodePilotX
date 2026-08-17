import { contentText, type Api, type Model as PiModel } from "@earendil-works/pi-ai"
import type { Session } from "@codepilotx/pi-agent-core"
import { proposedPlanTitle } from "../plan/ProposedPlanStreamParser"
import { createLiveEvent } from "../../storage/events/EventPublisher"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import type { SqlitePiSessionStorage } from "../../storage/SqlitePiSession"
import { TurnPiBoundaryRepository } from "../../storage/repositories/turn-pi-boundary-repository"
import type { ContextCompaction, ContextCompactionService } from "../../context/ContextCompactionService"
import type { Item } from "../../domain"
import {
  commandFromInput,
  finishedPiToolItem,
  mergeTimelineMutationFiles,
  piItemDeltaPayload,
  piToolMutationFiles,
  piToolTimelineInput,
  safeTimelinePatchPath,
  timelinePathKey,
  type TimelineMutationFile,
} from "../PiTimeline"
import type { PiRuntimeEvent, PiRuntimeEventContext } from "./types"

type PendingTurn = {
  items: Map<string, Item>
  consumedInputIDs: Set<string>
  piBoundary?: { sessionID: string; entryID: string }
}

const safeTimelineCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0

export interface PiRuntimeProjectorOptions {
  db: AgentDatabase
  contextCompaction: ContextCompactionService
  storage: SqlitePiSessionStorage
  session: Session
  runtimeModel: PiModel<Api>
  sessionID: string
  /** 事务提交后才发布 live/SSE event。 */
  publish: (event: ReturnType<AgentDatabase["insertEvent"]>) => Promise<void>
  onUsage?: (usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    requests: number
  }) => void | Promise<void>
}

/**
 * Pi 运行时事件的唯一投影器：负责 pending item、live delta、durable event
 * 与 savepoint 事务。savepoint 在同一 AgentDatabase 事务内完成 flush、canonical
 * item 写入、guide mailbox 消费与 durable events/outbox，事务提交后才发布；
 * 事务失败调用 discardPending() 且不发布任何已回滚事件。
 */
export class PiRuntimeProjector {
  private readonly pending = new Map<string, PendingTurn>()
  private readonly completedCompactions = new Map<string, ContextCompaction>()
  private readonly turnPiBoundaries: TurnPiBoundaryRepository

  constructor(private readonly options: PiRuntimeProjectorOptions) {
    this.turnPiBoundaries = new TurnPiBoundaryRepository(options.db)
  }

  private publish(event: ReturnType<AgentDatabase["insertEvent"]>) {
    return this.options.publish(event)
  }

  private pendingFor(context: PiRuntimeEventContext) {
    const existing = this.pending.get(context.threadID)
    if (existing) return existing
    const created: PendingTurn = { items: new Map<string, Item>(), consumedInputIDs: new Set<string>() }
    this.pending.set(context.threadID, created)
    return created
  }

  /** 最后一次压缩的产品记录（供手动/自动压缩完成后的对账）。 */
  lastCompaction(threadID: string): ContextCompaction | undefined {
    return this.completedCompactions.get(threadID)
  }

  async handle(event: PiRuntimeEvent): Promise<void> {
    const { context } = event
    switch (event.type) {
      case "assistant.started": {
        const timestamp = Date.now()
        const persisted = this.options.db.upsertItemWithEvent(context.threadID, {
          id: event.textItemID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "text",
          status: "running",
          data: { placement: event.placement, text: "" },
          createdAt: timestamp,
          updatedAt: timestamp,
        }, "item/started")
        await this.publish(persisted.event)
        break
      }
      case "plan.started": {
        const timestamp = Date.now()
        const persisted = this.options.db.upsertItemWithEvent(context.threadID, {
          id: event.itemID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "plan",
          status: "running",
          data: { title: "实施计划", markdown: "" },
          createdAt: timestamp,
          updatedAt: timestamp,
        }, "item/started")
        await this.publish(persisted.event)
        break
      }
      case "assistant.text.delta":
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "item/agentMessage/delta",
            piItemDeltaPayload({ itemID: event.itemID, context, delta: event.delta }),
          ),
        )
        break
      case "plan.delta":
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "plan/delta",
            piItemDeltaPayload({ itemID: event.itemID, context, delta: event.delta }),
          ),
        )
        break
      case "assistant.reasoning.delta":
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "reasoning/textDelta",
            piItemDeltaPayload({
              itemID: event.itemID,
              context,
              delta: event.delta,
            }),
          ),
        )
        break
      case "assistant.completed": {
        const timestamp = Date.now()
        const pending = this.pendingFor(context)
        if (event.placement === "result" && event.sessionEntryID) {
          pending.piBoundary = { sessionID: this.options.sessionID, entryID: event.sessionEntryID }
        }
        const text = event.text === undefined
          ? contentText(event.content as never, "\n").trim()
          : event.text.trim()
        const usage = {
          provider: event.provider || this.options.runtimeModel.provider,
          model: event.model || this.options.runtimeModel.id,
          contextWindow: Math.max(1, Math.trunc(Number(this.options.runtimeModel.contextWindow) || 1)),
          input: event.usage.input,
          output: event.usage.output,
          cacheRead: event.usage.cacheRead,
          cacheWrite: event.usage.cacheWrite,
          reasoning: event.usage.reasoning,
        }
        if (event.text === undefined || text) {
          const currentText = this.options.db.getItem(event.textItemID)
          pending.items.set(event.textItemID, {
            id: event.textItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "text",
            status: "completed",
            data: { placement: event.placement, text, usage },
            ...(currentText?.ordinal === undefined ? {} : { ordinal: currentText.ordinal }),
            createdAt: currentText?.createdAt ?? timestamp,
            updatedAt: timestamp,
          })
        }
        const plan = event.plan?.trim()
        if (plan) {
          const currentPlan = this.options.db.getItem(event.planItemID)
          pending.items.set(event.planItemID, {
            id: event.planItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "plan",
            status: "completed",
            data: { title: proposedPlanTitle(plan), markdown: plan },
            ...(currentPlan?.ordinal === undefined ? {} : { ordinal: currentPlan.ordinal }),
            createdAt: currentPlan?.createdAt ?? timestamp,
            updatedAt: timestamp,
          })
        }
        const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite
        await this.options.onUsage?.({
          inputTokens,
          outputTokens: usage.output,
          totalTokens: inputTokens + usage.output,
          requests: 1,
        })
        const content = Array.isArray(event.content) ? event.content : []
        const reasoning = content
          .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
          .join("\n")
          .trim()
        if (reasoning) {
          pending.items.set(event.reasoningItemID, {
            id: event.reasoningItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "reasoning",
            status: "completed",
            data: { text: reasoning },
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
        break
      }
      case "tool.started": {
        const timestamp = Date.now()
        const timelineInput = piToolTimelineInput(event.tool, event.input)
        const item: Item = {
          id: event.toolCallID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "tool",
          status: "running",
          data: {
            callID: event.toolCallID,
            tool: event.tool,
            title: event.tool,
            state: "running",
            input: timelineInput,
            command: commandFromInput(timelineInput),
            output: null,
            error: null,
            startedAt: timestamp,
            finishedAt: null,
            durationMs: null,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const persisted = this.options.db.upsertItemWithEvent(
          context.threadID,
          item,
          "tool/callStarted",
          (stored: Item) => ({
            item: stored,
            inputSummary: commandFromInput(timelineInput) ?? event.tool,
          }),
        )
        await this.publish(persisted.event)
        break
      }
      case "tool.updated":
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "tool/outputDelta",
            piItemDeltaPayload({
              itemID: event.toolCallID,
              context,
              delta: typeof event.update === "string" ? event.update : "",
            }),
          ),
        )
        break
      case "tool.finished":
        await this.finishTool(context, {
          toolCallID: event.toolCallID,
          tool: event.tool,
          output: event.result,
          details: event.details,
          isError: event.isError,
        })
        break
      case "queue.consumed":
        if (event.delivery !== "steer") break
        {
          const pending = this.pendingFor(context)
          for (const inputID of event.inputIDs) pending.consumedInputIDs.add(inputID)
        }
        break
      case "compaction.completed": {
        const piEntry = await this.options.session.getEntry(event.entryID)
        if (!piEntry || piEntry.type !== "compaction") {
          throw new Error(`Pi compaction entry ${event.entryID} 不存在`)
        }
        const afterContext = await this.options.session.buildContext()
        let completed!: ReturnType<ContextCompactionService["complete"]>
        this.options.db.transaction(() => {
          this.options.storage.flush()
          completed = this.options.contextCompaction.complete({
            threadID: context.threadID,
            turnID: context.turnID,
            sessionID: this.options.sessionID,
            piEntry,
            summary: event.summary,
            firstKeptEntryID: event.firstKeptEntryID,
            beforeCount: event.beforeCount,
            afterCount: afterContext.messages.length,
            items: afterContext.messages,
            promptText: event.promptText,
            contextWindowTokens: Math.max(1, Number(this.options.runtimeModel.contextWindow) || 1),
            trigger: event.trigger,
          })
        })
        this.completedCompactions.set(context.threadID, completed.compaction)
        await this.publish(completed.event)
        break
      }
      case "runtime.savepoint": {
        const pending = this.pending.get(context.threadID)
        const durable: Array<ReturnType<AgentDatabase["insertEvent"]>> = []
        try {
          this.options.db.transaction(() => {
            this.options.storage.flush()
            if (pending) {
              if (pending.piBoundary) {
                this.turnPiBoundaries.upsert({
                  turnID: context.turnID,
                  sessionID: pending.piBoundary.sessionID,
                  entryID: pending.piBoundary.entryID,
                })
              }
              for (const item of pending.items.values()) {
                this.options.db.upsertItem(context.threadID, item)
                const persisted = this.options.db.getItem(item.id) ?? item
                durable.push(
                  this.options.db.insertEvent(
                    context.threadID,
                    context.turnID,
                    "item/completed",
                    { item: persisted },
                  ),
                )
              }
              const consumedInputIDs = this.options.db.consumeGuideMailbox(
                context.turnID,
                [...pending.consumedInputIDs],
              )
              for (const inputID of consumedInputIDs) {
                durable.push(this.options.db.insertEvent(
                  context.threadID,
                  context.turnID,
                  "queue/updated",
                  {
                    threadId: context.threadID,
                    turnId: context.turnID,
                    inputId: inputID,
                    action: "steer-consumed",
                  },
                ))
              }
            }
          })
        } catch (cause) {
          this.options.storage.discardPending()
          this.pending.delete(context.threadID)
          throw cause
        }
        if (pending) this.pending.delete(context.threadID)
        for (const event of durable) await this.publish(event)
        break
      }
      case "runtime.settled":
        break
      case "runtime.aborted":
        this.options.storage.discardPending()
        this.pending.delete(context.threadID)
        break
    }
  }

  persistFinishedTool(context: PiRuntimeEventContext, input: {
    toolCallID: string
    tool: string
    output: string
    details: unknown
    isError: boolean
  }): Array<ReturnType<AgentDatabase["insertEvent"]>> {
    let item = finishedPiToolItem({
      current: this.options.db.getItem(input.toolCallID),
      turnID: context.turnID,
      agentID: context.agentID,
      ...input,
      timestamp: Date.now(),
    })
    if (!item) return []
    const mutationFiles = input.isError ? [] : piToolMutationFiles(input.tool, input.details)
    if (mutationFiles.length) {
      const timelineInput = item.data.input && typeof item.data.input === "object"
        && !Array.isArray(item.data.input)
        ? item.data.input as Record<string, unknown>
        : {}
      const priorPaths = Array.isArray(timelineInput.affectedPaths)
        ? timelineInput.affectedPaths
        : []
      const operationByPath = new Map(priorPaths.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return []
        const record = value as Record<string, unknown>
        return typeof record.path === "string" && typeof record.operation === "string"
          ? [[timelinePathKey(safeTimelinePatchPath(record.path)), record.operation] as const]
          : []
      }))
      item = {
        ...item,
        data: {
          ...item.data,
          input: {
            ...timelineInput,
            affectedPaths: mutationFiles.map((file) => ({
              ...file,
              ...(operationByPath.has(timelinePathKey(file.path))
                ? { operation: operationByPath.get(timelinePathKey(file.path)) }
                : {}),
            })),
          },
        },
      }
    }
    const durable: Array<ReturnType<AgentDatabase["insertEvent"]>> = []
    this.options.db.transaction(() => {
      this.options.db.upsertItem(context.threadID, item)
      const storedTool = this.options.db.getItem(item.id) ?? item
      durable.push(this.options.db.insertEvent(
        context.threadID,
        context.turnID,
        input.isError ? "tool/error" : "tool/callCompleted",
        input.isError
          ? { item: storedTool, error: { code: "TOOL_EXECUTION_ERROR", message: input.output || "工具执行失败", retryable: false } }
          : { item: storedTool },
      ))
      if (!mutationFiles.length) return
      const patchID = `patch:${context.turnID}`
      const existingPatch = this.options.db.getItem(patchID)
      const existingFiles = Array.isArray(existingPatch?.data.files)
        ? existingPatch.data.files.flatMap((value): TimelineMutationFile[] => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return []
            const file = value as Record<string, unknown>
            if (typeof file.path !== "string") return []
            return [{
              path: safeTimelinePatchPath(file.path),
              additions: safeTimelineCount(file.additions),
              deletions: safeTimelineCount(file.deletions),
            }]
          })
        : []
      const files = mergeTimelineMutationFiles(existingFiles, mutationFiles)
      const timestamp = item.updatedAt
      const reversible = this.options.db.repositories.turnPatches.getByTurn(context.turnID)
      const patch: Item = {
        id: patchID,
        turnID: context.turnID,
        agentID: context.agentID,
        type: "patch",
        status: "completed",
        data: {
          files,
          totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
          totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
          ...(reversible?.evidenceComplete ? {
            reversible: true,
            applyState: reversible.applyState,
            actionVersion: reversible.actionVersion,
          } : {}),
        },
        ...(existingPatch?.ordinal === undefined ? {} : { ordinal: existingPatch.ordinal }),
        createdAt: existingPatch?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      this.options.db.upsertItem(context.threadID, patch)
      const storedPatch = this.options.db.getItem(patchID) ?? patch
      durable.push(this.options.db.insertEvent(
        context.threadID,
        context.turnID,
        "item/completed",
        { item: storedPatch },
      ))
    })
    return durable
  }

  private async finishTool(context: PiRuntimeEventContext, input: {
    toolCallID: string
    tool: string
    output: string
    details: unknown
    isError: boolean
  }) {
    const events = this.persistFinishedTool(context, input)
    for (const event of events) await this.publish(event)
  }
}

import { isAbsolute, normalize } from "node:path"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import type { EventEnvelope } from "../domain"
import type { EventHubSignal } from "../storage/events/EventHub"
import { secretScrubber } from "../security/SecretScrubber"
import type { AgentLogger, LogContext, LogLevel } from "./AgentLogger"

type JsonObject = Record<string, unknown>

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}

const text = (value: unknown) => typeof value === "string" ? value : undefined
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined

const contextFor = (event: EventEnvelope, params: JsonObject): LogContext => ({
  ...(event.threadId ? { threadId: event.threadId } : {}),
  ...(event.turnId ? { turnId: event.turnId } : {}),
  ...(text(params.agentId) ? { agentId: text(params.agentId)! } : {}),
})

const modelDetails = (value: unknown) => {
  const model = object(value)
  const provider = text(model.providerID) ?? text(model.providerId) ?? text(model.provider)
  const id = text(model.id) ?? text(model.model)
  return {
    ...(provider ? { provider } : {}),
    ...(id ? { model: id } : {}),
  }
}

const safeRelativePath = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return undefined
  if (isAbsolute(value)) return "[outside-workspace]"
  const normalized = normalize(value).replaceAll("\\", "/")
  if (normalized === ".." || normalized.startsWith("../")) return "[outside-workspace]"
  return normalized.slice(0, 500)
}

const toolRecord = (params: JsonObject): {
  context: LogContext
  details: Record<string, unknown>
  development?: Record<string, unknown>
} => {
  const item = object(params.item)
  const data = object(item.data)
  const input = object(data.input)
  const tool = text(data.tool) ?? text(item.tool) ?? "tool"
  const durationMs = number(data.durationMs)
  const context: LogContext = {
    ...(text(item.turnID) ?? text(item.turnId) ? { turnId: (text(item.turnID) ?? text(item.turnId))! } : {}),
    ...(text(item.agentID) ?? text(item.agentId) ? { agentId: (text(item.agentID) ?? text(item.agentId))! } : {}),
    ...(text(data.callID) ?? text(data.callId) ?? text(item.id) ? { toolCallId: (text(data.callID) ?? text(data.callId) ?? text(item.id))! } : {}),
  }
  const command = text(input.command) ?? text(data.command)
  const path = safeRelativePath(input.file_path ?? input.path)
  const development = command && /^(bash|powershell)$/i.test(tool)
    ? { command: secretScrubber.scrubText(command).replace(/\s+/g, " ").slice(0, 500) }
    : path
      ? { path }
      : undefined
  return {
    context,
    details: {
      tool,
      ...(text(item.status) ? { status: text(item.status) } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    },
    ...(development ? { development } : {}),
  }
}

const turnRecord = (event: EventEnvelope, params: JsonObject): {
  context: LogContext
  details: Record<string, unknown>
} => {
  const turn = object(params.turn)
  const turnId = text(turn.id) ?? text(params.turnId) ?? event.turnId ?? undefined
  const agentId = text(turn.rootAgentId) ?? text(params.rootAgentId)
  const startedAt = number(turn.startedAt)
  const finishedAt = number(turn.finishedAt)
  return {
    context: {
      ...(event.threadId ? { threadId: event.threadId } : {}),
      ...(turnId ? { turnId } : {}),
      ...(agentId ? { agentId } : {}),
    },
    details: {
      ...(text(turn.status) ?? text(params.status) ? { status: (text(turn.status) ?? text(params.status))! } : {}),
      ...(text(turn.mode) ? { mode: text(turn.mode) } : {}),
      ...modelDetails(turn.model),
      ...(startedAt !== undefined && finishedAt !== undefined
        ? { durationMs: Math.max(0, finishedAt - startedAt) }
        : {}),
    },
  }
}

export class ExecutionLogObserver {
  constructor(private readonly logger: AgentLogger) {}

  observeSignal(signal: EventHubSignal): void {
    this.observeEvent(signal.event)
  }

  observeEvent(event: EventEnvelope): void {
    const params = object(event.params)
    if (event.method === "turn/queued") return this.log("info", "turn.queued", turnRecord(event, params))
    if (event.method === "turn/started") return this.log("info", "turn.started", turnRecord(event, params))
    if (event.method === "turn/completed") return this.log("info", "turn.completed", turnRecord(event, params))
    if (event.method === "turn/failed") {
      const record = turnRecord(event, params)
      const error = object(params.error)
      record.details = {
        ...record.details,
        ...(text(error.code) ? { code: text(error.code) } : {}),
        ...(text(error.message) ? { message: text(error.message) } : {}),
      }
      return this.log("error", "turn.failed", record)
    }
    if (event.method === "turn/interrupted") {
      const record = turnRecord(event, params)
      record.details = { ...record.details, reason: text(params.reason) ?? "interrupted" }
      return this.log("warn", "turn.interrupted", record)
    }
    if (event.method === "turn/statusChanged") {
      return this.log("info", "turn.status-changed", {
        context: contextFor(event, params),
        details: {
          status: text(params.status) ?? text(params.state) ?? "unknown",
          ...(text(params.reason) ? { reason: text(params.reason) } : {}),
        },
      })
    }
    if (event.method === "tool/callStarted") return this.log("info", "tool.started", toolRecord(params))
    if (event.method === "tool/callCompleted") return this.log("info", "tool.completed", toolRecord(params))
    if (event.method === "tool/error") {
      const record = toolRecord(params)
      const error = object(params.error)
      record.details = {
        ...record.details,
        status: "error",
        ...(text(error.code) ? { code: text(error.code) } : {}),
        ...(text(error.message) ? { message: text(error.message) } : {}),
      }
      return this.log("error", "tool.failed", record)
    }
    if (event.method === "approval/requested" || event.method === "approval/cancelled") {
      return this.log(event.method.endsWith("cancelled") ? "warn" : "info", event.method.replace("/", "."), {
        context: {
          ...contextFor(event, params),
          ...(text(params.itemId) ? { toolCallId: text(params.itemId)! } : {}),
        },
        details: {
          status: event.method.endsWith("cancelled") ? "cancelled" : "requested",
          ...(event.method.endsWith("cancelled") && text(params.reason) ? { reason: text(params.reason) } : {}),
        },
      })
    }
    if (event.method === "question/requested" || event.method === "interaction/resolved") {
      return this.log("info", event.method.replace("/", "."), {
        context: contextFor(event, params),
        details: { status: event.method.endsWith("resolved") ? "resolved" : "requested" },
      })
    }
    if (event.method === "queue/updated") {
      return this.log("info", "queue.updated", {
        context: contextFor(event, params),
        details: {
          ...(text(params.action) ? { status: text(params.action) } : {}),
          ...(text(params.pauseReason) ? { reason: text(params.pauseReason) } : {}),
        },
      })
    }
    if (event.method === "subagent/created" || event.method === "subagent/updated") {
      const task = object(params.task)
      const run = object(params.run)
      return this.log("info", event.method.replace("/", "."), {
        context: {
          ...contextFor(event, params),
          ...(text(task.id) ? { agentId: text(task.id)! } : {}),
        },
        details: {
          status: text(run.status) ?? text(task.status) ?? (event.method.endsWith("created") ? "created" : "updated"),
          ...modelDetails(run.model),
        },
      })
    }
  }

  private log(level: LogLevel, event: string, fields: Record<string, unknown>) {
    this.logger[level](event, fields)
  }
}

type ProviderState = { startedAt: number; responseCount: number }

export class HarnessLogObserver {
  private readonly providers = new Map<string, ProviderState>()

  constructor(
    private readonly logger: AgentLogger,
    private readonly now: () => number = Date.now,
  ) {}

  observe(context: LogContext, event: AgentHarnessEvent): void {
    const key = `${context.turnId ?? ""}:${context.agentId ?? ""}`
    if (event.type === "before_provider_request") {
      const model = object(event.model)
      this.providers.set(key, { startedAt: this.now(), responseCount: 0 })
      this.logger.info("provider.requested", {
        context,
        details: {
          provider: text(model.provider) ?? text(model.providerID) ?? "unknown",
          model: text(model.id) ?? "unknown",
          attempt: 1,
        },
      })
      return
    }
    if (event.type === "after_provider_response") {
      const state = this.providers.get(key) ?? { startedAt: this.now(), responseCount: 0 }
      state.responseCount += 1
      this.providers.set(key, state)
      this.logger[event.status >= 500 ? "error" : event.status >= 400 ? "warn" : "info"]("provider.response", {
        context,
        details: {
          status: event.status,
          attempt: state.responseCount,
          durationMs: Math.max(0, this.now() - state.startedAt),
        },
      })
      return
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message as unknown as JsonObject
      const usage = object(message.usage)
      this.logger.info("provider.completed", {
        context,
        details: {
          ...(text(message.stopReason) ? { reason: text(message.stopReason) } : {}),
          inputTokens: number(usage.input) ?? 0,
          outputTokens: number(usage.output) ?? 0,
          cacheReadTokens: number(usage.cacheRead) ?? 0,
          cacheWriteTokens: number(usage.cacheWrite) ?? 0,
        },
      })
      this.providers.delete(key)
      return
    }
    if (event.type === "session_before_compact") {
      this.logger.info("context.compaction-started", {
        context,
        details: { beforeCount: event.branchEntries.length },
      })
      return
    }
    if (event.type === "session_compact") {
      this.logger.info("context.compaction-completed", {
        context,
        details: {
          beforeTokens: event.compactionEntry.tokensBefore,
          status: "completed",
        },
      })
      return
    }
    if (event.type === "abort") {
      this.providers.delete(key)
      this.logger.warn("agent.aborted", { context, details: { status: "aborted" } })
      return
    }
    if (event.type === "settled") {
      this.logger.info("agent.settled", {
        context,
        details: { status: "settled", nextTurnCount: event.nextTurnCount },
      })
    }
  }
}

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { EventManifest, type EventType } from "@codepilotx/agent-protocol"
import { relative, resolve, sep } from "node:path"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import type { AgentConfig } from "../config/Config"
import { AgentError, type EventEnvelope as StoredEventEnvelope } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { ThreadService } from "../session/ThreadService"
import type { ThreadHistoryService } from "../session/ThreadHistoryService"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "../session/QuestionService"
import { RpcRouter } from "./RpcRouter"
import { proxyRendererRequest } from "./RendererProxy"
import type { AgentLogger } from "../observability/AgentLogger"
import type { IntegrationService } from "../provider/IntegrationService"
import type { SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import type { SubagentService } from "../subagent/SubagentService"
import type { AttachmentService } from "../subagent/AttachmentService"
import type { MemoryService } from "../memory/MemoryService"
import type { HookService } from "../hooks/HookService"
import type { GitReviewService } from "../review/GitReviewService"
import type { GithubService } from "../github/GithubService"

export interface TransportDependencies {
  config: AgentConfig
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  history: ThreadHistoryService
  approvals: ApprovalService
  questions: QuestionService
  subagents: SubagentService
  attachments: AttachmentService
  providers: ProviderRuntime
  integrations: IntegrationService
  memory: MemoryService
  hooks: HookService
  sandbox: SandboxRuntimeAdapter
  review: GitReviewService
  github: GithubService
  logger: AgentLogger
}

export const resolveEventCursor = (
  queryAfter: string | undefined,
  headerAfter: string | undefined,
  latestEventID: number,
) => {
  if (queryAfter === undefined && headerAfter === undefined) return latestEventID
  const queryCursor = Number(queryAfter ?? "0")
  const headerCursor = Number(headerAfter ?? "0")
  return Math.max(
    Number.isFinite(queryCursor) ? queryCursor : 0,
    Number.isFinite(headerCursor) ? headerCursor : 0,
  )
}

const cookieValue = (header: string | null, name: string) => header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
const DESKTOP_SETTINGS_KEY = "desktop.settings.v1"
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const eventNextNotification = (
  subscriptionId: string,
  streamId: string,
  event: StoredEventEnvelope,
  rpc: RpcRouter,
  afterSequence = event.id,
) => {
  if (!(event.method in EventManifest)) return null
  const type = event.method as EventType
  const definition = EventManifest[type]
  const payload = rpc.projection.notification(event).notification.params
  const base = {
    eventId: definition.durability === "live"
      ? `live:${event.createdAt}:${crypto.randomUUID()}`
      : String(event.id),
    streamId,
    type,
    version: definition.version,
    occurredAt: event.createdAt,
    ...(event.threadId ? { threadId: event.threadId } : {}),
    ...(event.turnId ? { turnId: event.turnId } : {}),
    payload,
  }
  return {
    jsonrpc: "2.0" as const,
    method: "event/next" as const,
    params: {
      subscriptionId,
      event: definition.durability === "live"
        ? { ...base, durability: "live" as const, sequence: null, afterSequence }
        : { ...base, durability: "durable" as const, sequence: event.id },
    },
  }
}

export const createApp = (dependencies: TransportDependencies) => {
  const { config, db, hub, threads, history, approvals, questions, subagents, attachments, providers, integrations, memory, hooks, sandbox, review, github, logger } = dependencies
  const app = new Hono()
  const rpc = new RpcRouter({ db, hub, threads, history, approvals, questions, subagents, attachments, providers, integrations, memory, hooks, sandbox, review, github })

  app.onError((cause, context) => {
    const error = cause instanceof AgentError ? cause : new AgentError("INTERNAL_ERROR", cause instanceof Error ? cause.message : "未知错误", 500)
    logger.error("http.error", { method: context.req.method, path: context.req.path, code: error.code, status: error.status, message: error.message })
    return context.json({ error: { code: error.code, message: error.message, retryable: error.status === 429 || error.status >= 500, details: error.details } }, error.status as 400)
  })

  app.use("*", async (context, next) => {
    const startedAt = performance.now()
    try {
      await next()
    } finally {
      logger.request({ method: context.req.method, path: context.req.path, status: context.res.status, durationMs: Math.round(performance.now() - startedAt) })
    }
  })

  app.use("*", async (context, next) => {
    const origin = context.req.header("Origin")
    if (origin) {
      const requestURL = new URL(context.req.url)
      if (new URL(origin).host !== requestURL.host) throw new AgentError("ORIGIN_DENIED", "不允许外部 Origin 访问 Agent", 403)
    }
    await next()
  })

  app.get("/health", (context) => context.json({ ok: true, service: "codepilotx-agent", version: "0.1.0", pid: process.pid }))

  app.use("/api/*", async (context, next) => {
    if (!config.authToken) return next()
    const bearer = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "")
    const cookie = cookieValue(context.req.header("Cookie") ?? null, "codepilotx_session")
    if (bearer !== config.authToken && cookie !== config.authToken) throw new AgentError("UNAUTHORIZED", "Agent 认证失败", 401)
    return next()
  })

  app.use("/rpc*", async (context, next) => {
    if (!config.authToken) return next()
    const bearer = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "")
    const cookie = cookieValue(context.req.header("Cookie") ?? null, "codepilotx_session")
    if (bearer !== config.authToken && cookie !== config.authToken) throw new AgentError("UNAUTHORIZED", "Agent 认证失败", 401)
    return next()
  })

  app.post("/rpc", async (context) => {
    const body = await context.req.json().catch(() => null)
    const connectionId = context.req.header("x-codepilotx-connection-id")
    const result = await rpc.handle(body, connectionId ? { connectionId } : {})
    if (Array.isArray(result)) return context.json(result.filter(Boolean))
    if (!result) return new Response(null, { status: 204 })
    return context.json(result)
  })

  app.get("/rpc/events", (context) => {
    const subscriptionId = context.req.query("subscriptionId")
    const connectionId = context.req.query("connectionId")
    if (!subscriptionId || !connectionId) {
      throw new AgentError("INVALID_REQUEST", "SSE 缺少 subscriptionId 或 connectionId", 400)
    }
    const subscription = rpc.subscriptions.get(subscriptionId, connectionId)
    if (!subscription) throw new AgentError("SUBSCRIPTION_NOT_FOUND", "事件订阅不存在或不属于当前连接", 404)
    const cursors = new Map(subscription.acknowledged)
    if (cursors.size === 1) {
      const lastEventId = Number(context.req.header("Last-Event-ID"))
      if (Number.isFinite(lastEventId)) {
        const [streamId, current] = [...cursors][0]!
        cursors.set(streamId, Math.max(current, lastEventId))
      }
    }
    return streamSSE(context, async (stream) => {
      let heartbeatAt = Date.now()
      let replayCompleted = false
      const buffered: StoredEventEnvelope[] = []
      let overflow = false
      const appliesToAnyStream = (event: StoredEventEnvelope) =>
        [...cursors.keys()].some((streamId) => streamId === "global" || event.threadId === null || event.threadId === streamId)
      const unlisten = hub.listen((event) => {
        if (!appliesToAnyStream(event)) return
        const definition = event.method in EventManifest ? EventManifest[event.method as EventType] : null
        if (!definition) return
        if (definition.durability === "live" && subscription.liveEventTypes && !subscription.liveEventTypes.has(event.method)) return
        if (buffered.length >= 1024) {
          overflow = true
          return
        }
        buffered.push(event)
      })
      // Capture the durable high-watermarks only after live delivery is
      // subscribed so commits racing replay are buffered rather than lost.
      const replayTargets = new Map(
        [...subscription.streams.keys()].map((streamId) => {
          const row = streamId === "global"
            ? db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS sequence FROM events").get()
            : db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS sequence FROM events WHERE thread_id = ?").get(streamId)
          return [streamId, Number((row as { sequence: number }).sequence)] as const
        }),
      )
      try {
        while (!stream.aborted) {
          const active = rpc.subscriptions.get(subscriptionId, connectionId)
          if (!active || overflow) {
            await stream.writeSSE({
              data: JSON.stringify({
                jsonrpc: "2.0",
                method: "event/subscriptionClosed",
                params: {
                  subscriptionId,
                  reason: overflow ? "overflow" : "unsubscribed",
                  positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                },
              }),
            })
            return
          }
          let delivered = 0
          if (!replayCompleted) {
            for (const [streamId, cursor] of cursors) {
              const target = replayTargets.get(streamId) ?? 0
              const events = db.eventsAfter(cursor, streamId === "global" ? undefined : streamId, 500)
              for (const event of events) {
                if (event.id > target) break
                // Historical rows for manifest-live events are cleanup data,
                // never replayable state. Advance over them without delivery.
                cursors.set(streamId, event.id)
                if (!(event.method in EventManifest) || EventManifest[event.method as EventType].durability === "live") continue
                const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
                if (!notification) continue
                await stream.writeSSE({ id: String(event.id), data: JSON.stringify(notification) })
                delivered += 1
              }
              if ((cursors.get(streamId) ?? 0) < target && events.length === 0) cursors.set(streamId, target)
            }
            if ([...replayTargets].every(([streamId, target]) => (cursors.get(streamId) ?? 0) >= target)) {
              await stream.writeSSE({
                data: JSON.stringify({
                  jsonrpc: "2.0",
                  method: "event/replayComplete",
                  params: {
                    subscriptionId,
                    positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                  },
                }),
              })
              replayCompleted = true
            }
          }
          if (replayCompleted) {
            // Durable rows remain the source of truth. Polling here also
            // covers transactional producers that commit an outbox row
            // without publishing a best-effort EventHub wake-up.
            for (const [streamId, cursor] of cursors) {
              const events = db.eventsAfter(cursor, streamId === "global" ? undefined : streamId, 500)
              for (const event of events) {
                cursors.set(streamId, event.id)
                if (!(event.method in EventManifest)) continue
                if (EventManifest[event.method as EventType].durability === "live") continue
                const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
                if (!notification) continue
                await stream.writeSSE({ id: String(event.id), data: JSON.stringify(notification) })
                delivered += 1
              }
            }
            const pending = buffered.splice(0, buffered.length)
            for (const event of pending) {
              for (const [streamId, cursor] of cursors) {
                if (streamId !== "global" && event.threadId !== null && event.threadId !== streamId) continue
                const definition = event.method in EventManifest ? EventManifest[event.method as EventType] : null
                if (!definition) continue
                if (definition.durability === "durable") {
                  if (event.id <= cursor) continue
                  cursors.set(streamId, event.id)
                } else if (active.liveEventTypes && !active.liveEventTypes.has(event.method)) {
                  continue
                }
                const notification = eventNextNotification(subscriptionId, streamId, event, rpc, cursor)
                if (!notification) continue
                await stream.writeSSE({
                  ...(definition.durability === "durable" ? { id: String(event.id) } : {}),
                  data: JSON.stringify(notification),
                })
                delivered += 1
              }
            }
          }
          if (Date.now() - heartbeatAt >= 10_000) {
            await stream.writeSSE({
              event: "heartbeat",
              data: JSON.stringify({
                jsonrpc: "2.0",
                method: "heartbeat",
                params: {
                  at: Date.now(),
                  positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                },
              }),
            })
            heartbeatAt = Date.now()
          }
          await stream.sleep(delivered ? 10 : 100)
        }
      } finally {
        unlisten()
      }
    })
  })

  app.get("/api/ready", (context) => {
    db.sqlite.query("SELECT 1").get()
    return context.json({ ok: true, service: "codepilotx-agent", version: "0.1.0", pid: process.pid, readyAt: Date.now() })
  })

  app.get("/api/desktop-settings", (context) =>
    context.json(db.getSetting<Record<string, unknown>>(DESKTOP_SETTINGS_KEY) ?? {}))

  app.put("/api/desktop-settings", async (context) => {
    const settings = await context.req.json().catch(() => null)
    if (!isPlainObject(settings)) throw new AgentError("INVALID_REQUEST", "桌面设置参数无效", 400)
    db.setSetting(DESKTOP_SETTINGS_KEY, settings)
    return context.json(settings)
  })

  app.post("/api/shutdown", (context) => {
    if (process.env.CODEPILOTX_DESKTOP_MANAGED !== "1") throw new AgentError("SHUTDOWN_DENIED", "仅桌面托管的 Agent 可以通过 HTTP 关闭", 403)
    setTimeout(() => process.emit("SIGTERM"), 25)
    return context.json({ ok: true })
  })
  app.all("*", async (context) => {
    if (config.rendererDevURL) {
      return proxyRendererRequest(context.req.raw, config.rendererDevURL)
    }
    if (config.rendererDir) {
      const requested = context.req.path === "/" ? "index.html" : context.req.path.replace(/^\/+/, "")
      const path = resolve(config.rendererDir, requested)
      if (relative(config.rendererDir, path).startsWith(`..${sep}`)) throw new AgentError("PATH_DENIED", "静态资源路径无效", 403)
      const file = Bun.file(path)
      if (await file.exists()) return new Response(file)
      const index = Bun.file(resolve(config.rendererDir, "index.html"))
      if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    return context.json({ error: { code: "NOT_FOUND", message: "资源不存在" } }, 404)
  })

  return app
}

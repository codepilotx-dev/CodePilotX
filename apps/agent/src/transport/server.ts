import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { relative, resolve, sep } from "node:path"
import type { ProviderRuntime } from "@codepilotx/provider-runtime"
import type { AgentConfig } from "../config/Config"
import { AgentError } from "../domain"
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

export interface TransportDependencies {
  config: AgentConfig
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  history: ThreadHistoryService
  approvals: ApprovalService
  questions: QuestionService
  providers: ProviderRuntime
  integrations: IntegrationService
  sandbox: SandboxRuntimeAdapter
  logger: AgentLogger
}

const cookieValue = (header: string | null, name: string) => header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)

export const createApp = (dependencies: TransportDependencies) => {
  const { config, db, hub, threads, history, approvals, questions, providers, integrations, sandbox, logger } = dependencies
  const app = new Hono()
  const rpc = new RpcRouter({ db, hub, threads, history, approvals, questions, providers, integrations, sandbox })

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
    const result = await rpc.handle(body)
    if (Array.isArray(result)) return context.json(result.filter(Boolean))
    if (!result) return new Response(null, { status: 204 })
    return context.json(result)
  })

  app.get("/rpc/events", (context) => {
    const queryAfter = Number(context.req.query("after") ?? "0")
    const headerAfter = Number(context.req.header("Last-Event-ID") ?? "0")
    let cursor = Math.max(Number.isFinite(queryAfter) ? queryAfter : 0, Number.isFinite(headerAfter) ? headerAfter : 0)
    const threadId = context.req.query("threadId")
    return streamSSE(context, async (stream) => {
      let heartbeatAt = Date.now()
      while (!stream.aborted) {
        const events = db.eventsAfter(cursor, threadId, 500)
        for (const event of events) {
          const projected = rpc.projection.notification(event)
          await stream.writeSSE({ id: String(event.id), data: JSON.stringify(projected.notification) })
          cursor = event.id
        }
        if (Date.now() - heartbeatAt >= 10_000) {
          await stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ jsonrpc: "2.0", method: "heartbeat", params: { at: Date.now(), cursor } }) })
          heartbeatAt = Date.now()
        }
        await stream.sleep(events.length ? 10 : 250)
      }
    })
  })

  app.get("/api/ready", (context) => {
    db.sqlite.query("SELECT 1").get()
    return context.json({ ok: true, service: "codepilotx-agent", version: "0.1.0", pid: process.pid, readyAt: Date.now() })
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

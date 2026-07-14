import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { Effect } from "effect"
import { relative, resolve, sep } from "node:path"
import type { AgentConfig } from "../config/Config"
import { AgentError, type PermissionMode, type SendStrategy, type SubmitMessage, type TaskMode } from "../domain"
import type { AgentDatabase } from "../storage/Database"
import type { SessionService } from "../session/SessionService"
import type { ListSessionMessagesParams, ListSessionsParams, SessionHistoryService } from "../session/SessionHistoryService"
import type { PermissionService } from "../permission/PermissionService"
import type { QuestionService } from "../session/QuestionService"
import type { ModelCatalog } from "../provider/ModelCatalog"
import type { CredentialStore } from "../auth/CredentialStore"
import { Projection } from "./Projection"
import { proxyRendererRequest } from "./RendererProxy"
import { WorkspaceService } from "../workspace/WorkspaceService"
import type { AgentLogger } from "../observability/AgentLogger"

export interface TransportDependencies {
  config: AgentConfig
  db: AgentDatabase
  sessions: SessionService
  history: SessionHistoryService
  permissions: PermissionService
  questions: QuestionService
  catalog: ModelCatalog
  credentials: CredentialStore
  logger: AgentLogger
}

const jsonRecord = async (request: Request) => {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AgentError("INVALID_JSON", "请求体必须是 JSON 对象", 400)
  return body as Record<string, unknown>
}

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as T
}

const optionalBool = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
}

const optionalLimit = (value: string | undefined, name: string) => {
  if (value === undefined) return undefined
  const limit = Number(value)
  if (!Number.isFinite(limit)) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return limit
}

const submitMessage = (body: Record<string, unknown>): SubmitMessage => {
  const model = body.model
  if (!model || typeof model !== "object" || Array.isArray(model)) throw new AgentError("INVALID_REQUEST", "model 参数无效", 400)
  const modelRecord = model as Record<string, unknown>
  if (typeof body.content !== "string" || typeof modelRecord.providerID !== "string" || typeof modelRecord.modelID !== "string") throw new AgentError("INVALID_REQUEST", "消息内容或模型参数无效", 400)
  return {
    content: body.content,
    model: { providerID: modelRecord.providerID, modelID: modelRecord.modelID },
    permissionMode: enumValue<PermissionMode>(body.permissionMode, ["ask", "review", "full"], "permissionMode"),
    strategy: enumValue<SendStrategy>(body.strategy, ["queue", "guide"], "strategy"),
    taskMode: enumValue<TaskMode>(body.taskMode, ["chat", "plan"], "taskMode"),
  }
}

const cookieValue = (header: string | null, name: string) => header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)

export const createApp = (dependencies: TransportDependencies) => {
  const { config, db, sessions, history, permissions, questions, catalog, credentials, logger } = dependencies
  const app = new Hono()
  const projection = new Projection(db)

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

  app.get("/api/ready", (context) => {
    db.sqlite.query("SELECT 1").get()
    return context.json({ ok: true, service: "codepilotx-agent", version: "0.1.0", pid: process.pid, readyAt: Date.now() })
  })

  app.get("/api/sessions", (context) => {
    const params: ListSessionsParams = { sort: context.req.query("sort") === "createdAt" ? "createdAt" : "updatedAt" }
    const projectID = context.req.query("projectID")
    const archived = optionalBool(context.req.query("archived"), "archived")
    const search = context.req.query("search")
    const cursor = context.req.query("cursor")
    const limit = optionalLimit(context.req.query("limit"), "limit")
    if (projectID !== undefined) params.projectID = projectID
    if (archived !== undefined) params.archived = archived
    if (search !== undefined) params.search = search
    if (cursor !== undefined) params.cursor = cursor
    if (limit !== undefined) params.limit = limit
    return context.json(history.list(params))
  })
  app.post("/api/sessions", async (context) => {
    const body: Record<string, unknown> = await jsonRecord(context.req.raw).catch(() => ({}))
    if (typeof body.projectID !== "string" || !body.projectID) throw new AgentError("PROJECT_REQUIRED", "请先选择项目工作区", 409)
    const session = sessions.create(typeof body.title === "string" ? body.title : undefined, body.projectID)
    return context.json(projection.snapshot(session.id), 201)
  })
  app.get("/api/projects", (context) => context.json({ projects: db.listProjects() }))
  app.post("/api/projects", async (context) => {
    const body = await jsonRecord(context.req.raw)
    if (typeof body.rootPath !== "string" || !body.rootPath.trim()) throw new AgentError("INVALID_REQUEST", "rootPath 参数无效", 400)
    const workspace = await WorkspaceService.open(body.rootPath)
    return context.json({ project: db.createProject({ rootPath: workspace.rootPath }) }, 201)
  })
  app.post("/api/projects/:id/select", (context) => context.json({ project: db.touchProject(context.req.param("id")) }))
  app.get("/api/projects/:id/settings", (context) => {
    const project = db.getProject(context.req.param("id"))
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
    return context.json({ settings: project.settings })
  })
  app.put("/api/projects/:id/settings", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const settings = body.settings
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new AgentError("INVALID_REQUEST", "settings 参数无效", 400)
    const value = settings as Record<string, unknown>
    const resolveRef = (key: string) => {
      const ref = value[key]
      if (ref === null || ref === undefined) return null
      if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof (ref as Record<string, unknown>).providerID !== "string" || typeof (ref as Record<string, unknown>).modelID !== "string") throw new AgentError("INVALID_REQUEST", `${key} 参数无效`, 400)
      const model = ref as { providerID: string; modelID: string }
      catalog.getModel(model.providerID, model.modelID)
      return model
    }
    const project = db.getProject(context.req.param("id"))
    if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
    const next = db.saveProjectSettings(project.id, {
      defaultModel: resolveRef("defaultModel"),
      plannerModel: resolveRef("plannerModel"),
      developerModel: resolveRef("developerModel"),
      reviewerModel: resolveRef("reviewerModel"),
    })
    return context.json({ settings: next })
  })
  app.get("/api/runs/:id/proposals", (context) => context.json({ proposals: db.listProposals(context.req.param("id")) }))
  app.get("/api/sessions/:id/proposals", (context) => {
    sessions.get(context.req.param("id"))
    const runRows = db.sqlite.query("SELECT id FROM runs WHERE session_id = ? ORDER BY created_at").all(context.req.param("id")) as Array<{ id: string }>
    return context.json({ proposals: runRows.flatMap((run) => db.listProposals(run.id)) })
  })
  app.post("/api/proposals/:id/review", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const status = enumValue(body.status, ["reviewed", "rejected"] as const, "status")
    const proposal = db.updateProposalStatus(context.req.param("id"), status)
    if (!proposal) throw new AgentError("PROPOSAL_NOT_FOUND", "提议不存在", 404)
    return context.json({ proposal })
  })
  app.post("/api/shutdown", (context) => {
    if (process.env.CODEPILOTX_DESKTOP_MANAGED !== "1") throw new AgentError("SHUTDOWN_DENIED", "仅桌面托管的 Agent 可以通过 HTTP 关闭", 403)
    setTimeout(() => process.emit("SIGTERM"), 25)
    return context.json({ ok: true })
  })
  app.get("/api/sessions/:id", (context) => {
    sessions.get(context.req.param("id"))
    return context.json(projection.snapshot(context.req.param("id")))
  })
  app.patch("/api/sessions/:id", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const title = body.title
    const archived = body.archived
    if (title !== undefined && title !== null && typeof title !== "string") throw new AgentError("INVALID_REQUEST", "title 参数无效", 400)
    if (archived !== undefined && typeof archived !== "boolean") throw new AgentError("INVALID_REQUEST", "archived 参数无效", 400)
    return context.json({ session: await history.patch(context.req.param("id"), { ...(title !== undefined ? { title } : {}), ...(archived !== undefined ? { archived } : {}) }) })
  })
  app.delete("/api/sessions/:id", async (context) => {
    await history.remove(context.req.param("id"))
    return context.json({ ok: true })
  })
  app.get("/api/sessions/:id/messages", (context) => {
    const params: ListSessionMessagesParams = {}
    const cursor = context.req.query("cursor")
    const limit = optionalLimit(context.req.query("limit"), "limit")
    if (cursor !== undefined) params.cursor = cursor
    if (limit !== undefined) params.limit = limit
    return context.json(history.listMessages(context.req.param("id"), params))
  })
  app.post("/api/sessions/:id/messages", async (context) => {
    const sessionID = context.req.param("id")
    const submitted = await sessions.submit(sessionID, submitMessage(await jsonRecord(context.req.raw)))
    const snapshot = projection.snapshot(sessionID)
    const input = snapshot?.inputs.find((item) => item.id === submitted.inputID)
    const run = snapshot?.runs.find((item) => item.id === submitted.runID) ?? null
    if (!input) throw new AgentError("INPUT_PROJECTION_FAILED", "消息已保存但无法生成输入投影", 500)
    return context.json({ input, run }, 202)
  })
  app.post("/api/sessions/:id/stop", async (context) => {
    await sessions.stop(context.req.param("id"))
    return context.json({ ok: true })
  })
  app.post("/api/runs/:id/plan-decision", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const decision = enumValue(body.decision, ["continue", "reject"] as const, "decision")
    const result = await sessions.decidePlan(context.req.param("id"), decision)
    if (!result) throw new AgentError("PLAN_DECISION_NOT_AVAILABLE", "当前规划不等待确认", 409)
    return context.json(result, 202)
  })
  app.post("/api/permissions/:id/reply", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const decision = enumValue(body.decision, ["allow-once", "deny", "stop"] as const, "decision")
    if (decision === "stop") {
      const row = db.sqlite.query("SELECT session_id FROM permission_requests WHERE id = ?").get(context.req.param("id")) as { session_id: string } | null
      if (!row) throw new AgentError("PERMISSION_NOT_FOUND", "权限请求不存在", 404)
      await sessions.stop(row.session_id)
    } else {
      await permissions.reply(context.req.param("id"), decision === "allow-once" ? "allow" : "deny")
    }
    return context.json({ ok: true })
  })
  app.post("/api/questions/:id/reply", async (context) => {
    const body = await jsonRecord(context.req.raw)
    await questions.reply(context.req.param("id"), body.ignored === true ? null : body.answer, body.ignored === true)
    return context.json({ ok: true }, 202)
  })

  app.get("/api/providers", (context) => context.json({ providers: projection.providers(catalog.list()), defaultModel: (() => { try { const model = catalog.defaultModel(); return { providerID: model.providerID, modelID: model.modelID } } catch { return null } })(), reviewerModel: db.getSetting("reviewerModel") }))
  app.put("/api/providers/:id/credential", async (context) => {
    const body = await jsonRecord(context.req.raw)
    if (typeof body.apiKey !== "string") throw new AgentError("INVALID_REQUEST", "apiKey 参数无效", 400)
    await Effect.runPromise(credentials.set(context.req.param("id"), body.apiKey))
    await Effect.runPromise(catalog.load())
    return context.json({ ok: true })
  })
  app.delete("/api/providers/:id/credential", async (context) => {
    await Effect.runPromise(credentials.remove(context.req.param("id")))
    await Effect.runPromise(catalog.load())
    return context.json({ ok: true })
  })
  app.put("/api/providers/:id/settings", async (context) => {
    const body = await jsonRecord(context.req.raw)
    const setting = body.setting && typeof body.setting === "object" && !Array.isArray(body.setting) ? body.setting : body
    db.setProviderSettings(context.req.param("id"), setting)
    await Effect.runPromise(catalog.load())
    return context.json({ ok: true })
  })
  app.put("/api/settings/default-model", async (context) => {
    const body = await jsonRecord(context.req.raw)
    if (typeof body.providerID !== "string" || typeof body.modelID !== "string") throw new AgentError("INVALID_REQUEST", "模型参数无效", 400)
    catalog.getModel(body.providerID, body.modelID)
    db.setSetting("defaultModel", { providerID: body.providerID, modelID: body.modelID })
    return context.json({ ok: true })
  })
  app.put("/api/settings/reviewer-model", async (context) => {
    const body = await jsonRecord(context.req.raw)
    if (body.providerID === null && body.modelID === null) {
      db.setSetting("reviewerModel", null)
      return context.json({ ok: true })
    }
    if (typeof body.providerID !== "string" || typeof body.modelID !== "string") throw new AgentError("INVALID_REQUEST", "审查模型参数无效", 400)
    catalog.getModel(body.providerID, body.modelID)
    db.setSetting("reviewerModel", { providerID: body.providerID, modelID: body.modelID })
    return context.json({ ok: true })
  })
  app.post("/api/models/refresh", async (context) => {
    await Effect.runPromise(catalog.refresh())
    return context.json({ providers: projection.providers(catalog.list()), defaultModel: (() => { try { const model = catalog.defaultModel(); return { providerID: model.providerID, modelID: model.modelID } } catch { return null } })(), reviewerModel: db.getSetting("reviewerModel") })
  })

  app.get("/api/events", (context) => {
    const queryAfter = Number(context.req.query("after") ?? "0")
    const headerAfter = Number(context.req.header("Last-Event-ID") ?? "0")
    let cursor = Math.max(Number.isFinite(queryAfter) ? queryAfter : 0, Number.isFinite(headerAfter) ? headerAfter : 0)
    const sessionID = context.req.query("sessionID")
    return streamSSE(context, async (stream) => {
      let heartbeatAt = Date.now()
      while (!stream.aborted) {
        const events = db.eventsAfter(cursor, sessionID, 500)
        for (const event of events) {
          const projected = projection.event(event)
          if (projected) await stream.writeSSE({ id: String(event.id), data: JSON.stringify(projected) })
          cursor = event.id
        }
        if (Date.now() - heartbeatAt >= 10_000) {
          await stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ time: Date.now(), cursor }) })
          heartbeatAt = Date.now()
        }
        await stream.sleep(events.length ? 10 : 250)
      }
    })
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

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { EventManifest, type EventType } from "@codepilotx/agent-protocol"
import { relative, resolve, sep } from "node:path"
import type { AgentModelCatalog } from "../provider/AgentModelCatalog"
import type { AgentConfig } from "../config/Config"
import { AgentError, type EventEnvelope as StoredEventEnvelope } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import { globalEventSequence } from "../storage/events/EventPublisher"
import type { ThreadService } from "../session/ThreadService"
import type { ThreadHistoryService } from "../session/ThreadHistoryService"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "../session/QuestionService"
import { RpcRouter } from "./rpc/RpcRouter"
import { proxyRendererRequest } from "./RendererProxy"
import type { AgentLogger } from "../observability/AgentLogger"
import type { ApiKeyService } from "../provider/ApiKeyService"
import type { ProviderCredentialService } from "../provider/ProviderCredentialService"
import type { ProviderCredentialStoreManager } from "../auth/ProviderCredentialStoreManager"
import type { PiModelService } from "../provider/pi"
import type { PiAuthSessionService } from "../auth/PiAuthSessionService"
import type { SubagentService } from "../subagent/SubagentService"
import type { AttachmentService } from "../subagent/AttachmentService"
import type { ProjectSourceService } from "../project/ProjectSourceService"
import type { MemoryService } from "../memory/MemoryService"
import type { HookService } from "../hooks/HookService"
import type { GitReviewService } from "../review/GitReviewService"
import type { GithubService } from "../github/GithubService"
import type { GitWorkspaceService } from "../git/GitWorkspaceService"
import type { ToolingManager } from "../tool/ToolingManager"
import type { PetService } from "../pet/PetService"
import type { ReleaseNotesService } from "../release-notes/ReleaseNotesService"
import type { SkillManagementService } from "../prompt/SkillManagementService"
import type { McpRuntimeService } from "../mcp/McpRuntimeService"
import type { TaskSuggestionService } from "../suggestion/TaskSuggestionService"
import type { ConfigService } from "../config/ConfigService"
import type { UsageService } from "../usage/UsageService"
import type { TurnPatchService } from "../patch/TurnPatchService"
import type { TerminalContextService } from "../terminal/TerminalContextService"
import type { TerminalOutputMirror } from "../terminal/TerminalOutputMirror"
import type { LocalEnvironmentService } from "../local-environment/LocalEnvironmentService"
import type { ManagedWorktreeService } from "../worktree/ManagedWorktreeService"
import type { HandoffService } from "../handoff/HandoffService"
import type { TaskExecutionBindingService } from "../worktree/TaskExecutionBindingService"
import type { WorktreeRepository } from "../worktree/WorktreeRepository"
import type { EnvironmentDeltaStore } from "../local-environment/EnvironmentDeltaStore"
import type { ThreadMessageForkService } from "../session/fork/ThreadMessageForkService"
import { normalizeShellSecurityLevel } from "../security/ShellRiskClassifier"

export interface TransportDependencies {
  config: AgentConfig
  configService: ConfigService
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  history: ThreadHistoryService
  approvals: ApprovalService
  questions: QuestionService
  subagents: SubagentService
  attachments: AttachmentService
  projectSources: ProjectSourceService
  providers: AgentModelCatalog
  piModels: PiModelService
  apiKeys: ApiKeyService
  providerCredentials: ProviderCredentialService
  providerCredentialStore: ProviderCredentialStoreManager
  authSessions: PiAuthSessionService
  memory: MemoryService
  hooks: HookService
  review: GitReviewService
  github: GithubService
  git: GitWorkspaceService
  tooling: ToolingManager
  pets: PetService
  releaseNotes: ReleaseNotesService
  skills: SkillManagementService
  mcp: McpRuntimeService
  suggestions: TaskSuggestionService
  logger: AgentLogger
  usage: UsageService
  turnPatches: TurnPatchService
  terminalContext: TerminalContextService
  terminalOutput: TerminalOutputMirror
  localEnvironment: LocalEnvironmentService
  worktrees: ManagedWorktreeService
  handoff: HandoffService
  threadFork: ThreadMessageForkService
  executionBindings: TaskExecutionBindingService
  worktreeRepository: WorktreeRepository
  environmentDeltas: EnvironmentDeltaStore
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

export const deliverAnchoredLive = async (
  currentSequence: () => number,
  afterSequence: number,
  deliverDurableThrough: (target: number) => Promise<void>,
  deliverLive: () => Promise<void>,
) => {
  if (currentSequence() > afterSequence) return false
  await deliverDurableThrough(afterSequence)
  if (currentSequence() > afterSequence) return false
  await deliverLive()
  return true
}

const cookieValue = (header: string | null, name: string) => header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
export const rpcTransportAuthority = (
  authorizationHeader: string | null,
  cookieHeader: string | null,
  authToken: string | null | undefined,
): "desktop-host" | "renderer" | undefined => {
  if (!authToken) return undefined
  const bearer = authorizationHeader?.replace(/^Bearer\s+/i, "")
  if (bearer === authToken) return "desktop-host"
  return cookieValue(cookieHeader, "codepilotx_session") === authToken ? "renderer" : undefined
}
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const DESKTOP_RUNTIME_SETTINGS_KEY = "desktop.runtime-state.v1"
const DESKTOP_TERMINAL_SETTINGS_KEY = "desktop.terminal-settings.v1"
const DEPRECATED_DESKTOP_SIDEBAR_FIELDS = new Set([
  "sidebarSectionOrder",
])
const DESKTOP_RUNTIME_FIELDS = new Set([
  "recentWorkspaces",
  "lastActiveWorkspacePath",
  "removedWorkspaces",
  "drawerTab",
  "sidebarStateVersion",
  "sidebarManualOrder",
  "sidebarSessionPins",
  "collapsedSidebarProjectPaths",
  "collapsedSidebarSections",
  "workspaceDependenciesMigrated",
])
const desktopProjection = (config: Record<string, unknown>) => {
  const desktop = isPlainObject(config.desktop)
    ? Object.fromEntries(
      Object.entries(config.desktop).filter(
        ([key]) => !DEPRECATED_DESKTOP_SIDEBAR_FIELDS.has(key),
      ),
    )
    : {}
  const taskModels = isPlainObject(config.task_models) ? config.task_models : {}
  const features = isPlainObject(config.features) ? config.features : {}
  const sandbox = isPlainObject(config.sandbox_workspace_write) ? config.sandbox_workspace_write : {}
  const permissionConfig = isPlainObject(desktop.permissionConfig)
    ? { ...desktop.permissionConfig }
    : {}
  if (typeof config.approval_policy === "string") permissionConfig.approvalPolicy = config.approval_policy
  if (typeof config.approvals_reviewer === "string") permissionConfig.approvalsReviewer = config.approvals_reviewer
  if (typeof config.sandbox_mode === "string") permissionConfig.sandboxMode = config.sandbox_mode
  return {
    ...desktop,
    ...(Object.keys(permissionConfig).length ? { permissionConfig } : {}),
    shellSecurityLevel: normalizeShellSecurityLevel(config.shell_security_level),
    ...(typeof config.model === "string" ? { model: config.model } : {}),
    ...(typeof config.model_provider === "string" ? { providerID: config.model_provider } : {}),
    ...(typeof config.model_reasoning_effort === "string" ? { thinkingMode: config.model_reasoning_effort } : {}),
    ...(typeof config.personality === "string" ? { personality: config.personality } : {}),
    ...(typeof config.system_prompt === "string" ? { systemPrompt: config.system_prompt } : {}),
    ...(typeof config.append_system_prompt === "string" ? { appendSystemPrompt: config.append_system_prompt } : {}),
    ...(typeof config.custom_instructions === "string" ? { customInstructions: config.custom_instructions } : {}),
    ...(typeof taskModels.small_fast === "string" ? { smallFastModel: taskModels.small_fast } : {}),
    ...(typeof taskModels.fast === "string" ? { fastModel: taskModels.fast } : {}),
    ...(typeof taskModels.default === "string" ? { defaultModel: taskModels.default } : {}),
    ...(typeof taskModels.deep === "string" ? { deepModel: taskModels.deep } : {}),
    ...(typeof taskModels.plan === "string" ? { planExecutionModel: taskModels.plan } : {}),
    ...(typeof taskModels.reviewer === "string" ? { reviewModel: taskModels.reviewer } : {}),
    ...(typeof features.memory === "boolean" ? { enableMemory: features.memory } : {}),
    ...(typeof features.pareto_code_router === "boolean" ? { enableParetoCodeRouter: features.pareto_code_router } : {}),
    ...(typeof features.fusion_router === "boolean" ? { enableFusionRouter: features.fusion_router } : {}),
    ...(typeof sandbox.network_access === "boolean" ? { allowNetworkAccess: sandbox.network_access } : {}),
  }
}
const desktopCorePath = (key: string): string[] | null => ({
  model: ["model"],
  providerID: ["model_provider"],
  thinkingMode: ["model_reasoning_effort"],
  personality: ["personality"],
  systemPrompt: ["system_prompt"],
  appendSystemPrompt: ["append_system_prompt"],
  customInstructions: ["custom_instructions"],
  smallFastModel: ["task_models", "small_fast"],
  fastModel: ["task_models", "fast"],
  defaultModel: ["task_models", "default"],
  deepModel: ["task_models", "deep"],
  planExecutionModel: ["task_models", "plan"],
  reviewModel: ["task_models", "reviewer"],
  enableMemory: ["features", "memory"],
  enableParetoCodeRouter: ["features", "pareto_code_router"],
  enableFusionRouter: ["features", "fusion_router"],
  allowNetworkAccess: ["sandbox_workspace_write", "network_access"],
  shellSecurityLevel: ["shell_security_level"],
} as Record<string, string[]>)[key] ?? null
const desktopConfigEdits = (
  value: Record<string, unknown>,
  prefix: string[] = [],
  current: Record<string, unknown> = {},
): Array<{ keyPath: string[]; value: never }> =>
  Object.entries(value).flatMap(([key, child]) => {
    if (
      prefix.length === 0
      && DEPRECATED_DESKTOP_SIDEBAR_FIELDS.has(key)
    ) return []
    if (prefix.length === 0 && DESKTOP_RUNTIME_FIELDS.has(key)) return []
    if (prefix.length === 0 && key === "terminalProfileId") return []
    if (prefix.length === 0 && key === "permissionConfig" && isPlainObject(child)) {
      return Object.entries(child).flatMap(([permissionKey, permissionValue]) => {
        const currentPermission = isPlainObject(current.permissionConfig)
          ? current.permissionConfig[permissionKey]
          : undefined
        if (JSON.stringify(permissionValue) === JSON.stringify(currentPermission)) return []
        const path = permissionKey === "approvalPolicy"
          ? ["approval_policy"]
          : permissionKey === "approvalsReviewer"
            ? ["approvals_reviewer"]
            : permissionKey === "sandboxMode"
              ? ["sandbox_mode"]
              : null
        return path ? [{ keyPath: path, value: permissionValue as never }] : []
      })
    }
    const corePath = prefix.length === 0 ? desktopCorePath(key) : null
    const path = corePath ?? ["desktop", ...prefix, key]
    return isPlainObject(child)
      ? desktopConfigEdits(
          child,
          [...prefix, key],
          isPlainObject(current[key]) ? current[key] : {},
        )
      : JSON.stringify(child) === JSON.stringify(current[key])
        ? []
        : [{ keyPath: path, value: child as never }]
  })
const githubCallbackPage = (completed: boolean) => new Response(
  [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${completed ? "GitHub 登录成功" : "GitHub 登录失败"}</title>`,
    "</head><body>",
    `<main><h1>${completed ? "GitHub 登录成功" : "GitHub 登录未完成"}</h1>`,
    `<p>${completed ? "你可以关闭此页面并返回 CodePilotX。" : "请关闭此页面并返回 CodePilotX 查看详情后重试。"}</p>`,
    "</main></body></html>",
  ].join(""),
  {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  },
)
const mcpCallbackPage = (completed: boolean) => new Response(
  [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${completed ? "MCP 认证成功" : "MCP 认证失败"}</title>`,
    "</head><body>",
    `<main><h1>${completed ? "MCP 认证成功" : "MCP 认证未完成"}</h1>`,
    `<p>${completed ? "你可以关闭此页面并返回 CodePilotX。" : "请关闭此页面，返回 CodePilotX 查看安全错误后重试。"}</p>`,
    "</main></body></html>",
  ].join(""),
  {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  },
)

const eventNextNotification = (
  subscriptionId: string,
  streamId: string,
  event: StoredEventEnvelope,
  rpc: RpcRouter,
) => {
  if (!(event.method in EventManifest)) return null
  const type = event.method as EventType
  const definition = EventManifest[type]
  if (definition.durability === "live" && event.afterSequence === undefined) return null
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
        ? { ...base, durability: "live" as const, sequence: null, afterSequence: event.afterSequence! }
        : { ...base, durability: "durable" as const, sequence: event.id },
    },
  }
}

export const createApp = (dependencies: TransportDependencies) => {
  const { config, db, hub, threads, history, approvals, questions, subagents, attachments, projectSources, providers, piModels, apiKeys, providerCredentials, providerCredentialStore, authSessions, memory, hooks, review, github, git, tooling, pets, releaseNotes, skills, suggestions, logger } = dependencies
  const app = new Hono()
  const rpc = new RpcRouter({ config: dependencies.configService, db, hub, threads, history, approvals, questions, subagents, attachments, projectSources, providers, piModels, apiKeys, providerCredentials, providerCredentialStore, authSessions, memory, hooks, review, github, git, tooling, pets, releaseNotes, skills, suggestions, usage: dependencies.usage, mcp: dependencies.mcp, turnPatches: dependencies.turnPatches, terminalContext: dependencies.terminalContext, terminalOutput: dependencies.terminalOutput, localEnvironment: dependencies.localEnvironment, worktrees: dependencies.worktrees, handoff: dependencies.handoff, threadFork: dependencies.threadFork, executionBindings: dependencies.executionBindings, worktreeRepository: dependencies.worktreeRepository, environmentDeltas: dependencies.environmentDeltas })

  app.onError((cause, context) => {
    const error = cause instanceof AgentError ? cause : new AgentError("INTERNAL_ERROR", cause instanceof Error ? cause.message : "未知错误", 500)
    const log = error.status >= 500
      ? logger.error.bind(logger)
      : (logger.warn ?? logger.error).bind(logger)
    log("http.error", {
      details: {
        method: context.req.method,
        path: context.req.path,
        code: error.code,
        status: error.status,
        message: error.message,
      },
    })
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

  app.get("/auth/github/callback", async (context) => {
    try {
      const code = context.req.query("code")
      const state = context.req.query("state")
      const error = context.req.query("error")
      const status = await github.handleOAuthCallback({
        ...(code === undefined ? {} : { code }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error }),
      })
      return githubCallbackPage(status.state === "completed")
    } catch {
      return githubCallbackPage(false)
    }
  })

  app.get("/auth/mcp/callback", async (context) => {
    try {
      const code = context.req.query("code")
      const state = context.req.query("state")
      const error = context.req.query("error")
      const completed = await dependencies.mcp.oauth?.handleCallback({
        ...(code === undefined ? {} : { code }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error }),
      }) ?? false
      return mcpCallbackPage(completed)
    } catch {
      return mcpCallbackPage(false)
    }
  })

  app.post("/api/desktop/api-keys/:credentialId/copy-material", async (context) => {
    const bearer = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "")
    if (!config.authToken || bearer !== config.authToken) {
      throw new AgentError("PERMISSION_DENIED", "安全复制仅允许桌面主进程调用", 403)
    }
    const credentialID = context.req.param("credentialId")
    if (!/^cred_[0-9a-f-]{36}$/i.test(credentialID)) {
      throw new AgentError("INVALID_REQUEST", "API Key 标识无效", 400)
    }
    const key = await apiKeys.copyMaterial(credentialID)
    context.header("Cache-Control", "no-store, max-age=0")
    context.header("Pragma", "no-cache")
    return context.json({ key })
  })

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
    const transportAuthority = rpcTransportAuthority(
      context.req.header("Authorization") ?? null,
      context.req.header("Cookie") ?? null,
      config.authToken,
    )
    const result = await rpc.handle(body, {
      ...(connectionId ? { connectionId } : {}),
      ...(transportAuthority ? { transportAuthority } : {}),
    })
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
    const transportAuthority = rpcTransportAuthority(
      context.req.header("Authorization") ?? null,
      context.req.header("Cookie") ?? null,
      config.authToken,
    )
    if (!rpc.touchConnection(connectionId, transportAuthority)) throw new AgentError("UNAUTHORIZED", "RPC 连接已过期或认证来源已变化", 401)
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
      let durableWake = false
      const appliesToAnyStream = (event: StoredEventEnvelope) =>
        [...cursors.keys()].some((streamId) => streamId === "global" || event.threadId === null || event.threadId === streamId)
      const unlisten = hub.listen((signal) => {
        if (signal.kind === "durable") {
          durableWake = true
          return
        }
        const event = signal.event
        if (!appliesToAnyStream(event)) return
        const definition = event.method in EventManifest ? EventManifest[event.method as EventType] : null
        if (!definition || definition.durability !== "live") return
        if (subscription.liveEventTypes && !subscription.liveEventTypes.has(event.method)) return
        if (buffered.length >= 1024) {
          overflow = true
          return
        }
        buffered.push(event)
      })
      // Capture the durable high-watermarks only after live delivery is
      // subscribed so commits racing replay are buffered rather than lost.
      const replayTarget = globalEventSequence(db)
      const deliverDurableThrough = async (streamId: string, target: number) => {
        let cursor = cursors.get(streamId) ?? 0
        let delivered = 0
        while (cursor < target) {
          const events = db.eventsAfter(cursor, streamId === "global" ? undefined : streamId, 500)
          let advanced = false
          for (const event of events) {
            if (event.id > target) break
            cursor = event.id
            cursors.set(streamId, cursor)
            advanced = true
            if (!(event.method in EventManifest) || EventManifest[event.method as EventType].durability === "live") continue
            const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
            if (!notification) continue
            await stream.writeSSE({ id: String(event.id), data: JSON.stringify(notification) })
            delivered += 1
          }
          if (!advanced || events.length < 500 || events.at(-1)!.id > target) {
            cursor = target
            cursors.set(streamId, cursor)
          }
        }
        return delivered
      }
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
            for (const streamId of cursors.keys()) delivered += await deliverDurableThrough(streamId, replayTarget)
            if ([...cursors.values()].every((cursor) => cursor >= replayTarget)) {
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
            const pending = buffered.splice(0, buffered.length)
            for (const event of pending) {
              for (const streamId of cursors.keys()) {
                if (streamId !== "global" && event.threadId !== null && event.threadId !== streamId) continue
                if (active.liveEventTypes && !active.liveEventTypes.has(event.method)) continue
                const anchor = event.afterSequence
                if (anchor === undefined) continue
                let durableDelivered = 0
                const liveDelivered = await deliverAnchoredLive(
                  () => cursors.get(streamId) ?? 0,
                  anchor,
                  async (target) => { durableDelivered += await deliverDurableThrough(streamId, target) },
                  async () => {
                    const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
                    if (notification) await stream.writeSSE({ data: JSON.stringify(notification) })
                  },
                )
                delivered += durableDelivered + (liveDelivered ? 1 : 0)
              }
            }
            // Durable rows remain the source of truth. A durable EventHub
            // signal is only a wake-up; polling also covers a missed wake.
            const durableTarget = globalEventSequence(db)
            if (durableWake || [...cursors.values()].some((cursor) => cursor < durableTarget)) {
              durableWake = false
              for (const streamId of cursors.keys()) delivered += await deliverDurableThrough(streamId, durableTarget)
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
            if (!rpc.touchConnection(connectionId, transportAuthority)) return
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

  app.get("/api/config/desktop-projection", async (context) => {
    const result = await dependencies.configService.read()
    const runtime = db.getSetting<Record<string, unknown>>(DESKTOP_RUNTIME_SETTINGS_KEY) ?? {}
    const currentRuntime = Object.fromEntries(
      Object.entries(runtime).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
    )
    const terminalSettings = db.getSetting<Record<string, unknown>>(DESKTOP_TERMINAL_SETTINGS_KEY) ?? {}
    const terminalProfileId = terminalSettings.terminalProfileId
    return context.json({
      ...desktopProjection(result.config),
      ...currentRuntime,
      ...(terminalProfileId === null || typeof terminalProfileId === "string"
        ? { terminalProfileId }
        : {}),
    })
  })

  app.put("/api/config/desktop-projection", async (context) => {
    const settings = await context.req.json().catch(() => null)
    if (!isPlainObject(settings)) throw new AgentError("INVALID_REQUEST", "桌面设置参数无效", 400)
    const hasTerminalProfileId = Object.prototype.hasOwnProperty.call(settings, "terminalProfileId")
    const terminalProfileId = settings.terminalProfileId
    if (hasTerminalProfileId && terminalProfileId !== null && typeof terminalProfileId !== "string") {
      throw new AgentError("INVALID_REQUEST", "终端 profile 设置无效", 400)
    }
    const read = await dependencies.configService.read({ includeLayers: true })
    const currentRuntime = db.getSetting<Record<string, unknown>>(DESKTOP_RUNTIME_SETTINGS_KEY) ?? {}
    const currentSettings = {
      ...desktopProjection(read.config),
      ...Object.fromEntries(
        Object.entries(currentRuntime).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
      ),
    }
    db.setSetting(
      DESKTOP_RUNTIME_SETTINGS_KEY,
      Object.fromEntries(
        Object.entries(settings).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
      ),
    )
    if (hasTerminalProfileId) {
      const current = db.getSetting<Record<string, unknown>>(DESKTOP_TERMINAL_SETTINGS_KEY) ?? {}
      db.setSetting(DESKTOP_TERMINAL_SETTINGS_KEY, { ...current, terminalProfileId })
    }
    const version = read.layers?.find((layer) => layer.kind === "user")?.version
    const edits = desktopConfigEdits(settings, [], currentSettings)
    if (edits.length === 0) return context.json(settings)
    await dependencies.configService.batchWrite({
      edits,
      ...(version ? { expectedVersion: version } : {}),
    })
    return context.json(settings)
  })

  app.get("/api/pets/:id/spritesheet", async (context) => {
    const asset = await pets.spritesheet(context.req.param("id"))
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=0, must-revalidate",
        ETag: asset.etag,
        "X-Content-Type-Options": "nosniff",
      },
    })
  })

  app.get("/api/pets/catalog/:slug/preview", async (context) => {
    const asset = await pets.previewAsset(context.req.param("slug"))
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=14400",
        ETag: asset.etag,
        "X-Content-Type-Options": "nosniff",
      },
    })
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

import {
  PermissionConfigSchema,
  ThreadSettingsPatchSchema,
  ThreadSettingsSchema,
  TurnStartParamsSchema,
  QueueUpdateParamsSchema,
  QueueInputParamsSchema,
  QueueReorderParamsSchema,
  QueueResumeParamsSchema,
  SandboxUninstallParamsSchema,
  type PermissionConfig,
} from "@codepilotx/shared/thread"
import { Effect, Schema } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
import { createHash } from "node:crypto"
import type { ProviderConfig } from "@codepilotx/provider-runtime"
import type { AgentModelCatalog } from "../provider/AgentModelCatalog"
import { AgentError, type SendStrategy, type SubmitMessage, type TaskMode } from "../domain"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "../session/QuestionService"
import type { IntegrationService } from "../provider/IntegrationService"
import type { ThreadHistoryService } from "../session/ThreadHistoryService"
import type { ThreadService } from "../session/ThreadService"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import { publishAgentEvent } from "../storage/EventPublisher"
import type { SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import type { SubagentService } from "../subagent/SubagentService"
import type { AttachmentService } from "../subagent/AttachmentService"
import { WorkspaceService } from "../workspace/WorkspaceService"
import { ThreadProjection } from "./ThreadProjection"
import { projectMemoryKey, type MemoryService } from "../memory/MemoryService"
import type { HookService } from "../hooks/HookService"
import type { GitReviewService } from "../review/GitReviewService"
import type { GithubService } from "../github/GithubService"
import { EventSubscriptionRegistry } from "./EventSubscriptionRegistry"
import {
  ReviewApplyParamsSchema,
  ReviewAiStartParamsSchema,
  ReviewBranchesParamsSchema,
  ReviewCommentIDParamsSchema,
  ReviewCommentListParamsSchema,
  ReviewCommentSaveParamsSchema,
  ReviewCommitParamsSchema,
  ReviewCommitsParamsSchema,
  ReviewFileDiffParamsSchema,
  ReviewStatusParamsSchema,
  ReviewSummaryParamsSchema,
  Capabilities,
  RpcMethods,
  RpcApplicationError,
  InitializedNotificationSchema,
  RPC_APPLICATION_ERROR,
  defineRpcHandlers,
  dispatchRpcMessage,
  type ApplicationErrorCode,
  type JsonValue,
  type RpcHandlers,
  type RpcMethod,
  type ReviewAiTarget,
  type ReviewSource,
} from "@codepilotx/agent-protocol"

export type RpcRouterDependencies = {
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  history: ThreadHistoryService
  approvals: ApprovalService
  questions: QuestionService
  subagents: SubagentService
  attachments: AttachmentService
  providers: AgentModelCatalog
  integrations: IntegrationService
  memory: MemoryService
  hooks: HookService
  sandbox: SandboxRuntimeAdapter
  review: GitReviewService
  github: GithubService
}

export type RpcRouterContext = {
  connectionId?: string
}

type ModelCatalogPage = {
  providers: Array<{ provider: Provider.Info; models: Model.Info[] }>
  defaultModel: Model.Ref | null
  reviewerModel: Model.Ref | null
  catalogVersion: number
  total?: number
  nextCursor?: string
}

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as T
}

const record = (value: unknown, name = "params") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as Record<string, unknown>
}

const optionalRecord = (value: unknown) => value == null ? {} : record(value)

const decodeParams = <A>(decode: (value: unknown) => A, value: unknown, name: string): A => {
  try {
    return decode(value)
  } catch {
    throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  }
}

const decodeTurnStart = Schema.decodeUnknownSync(TurnStartParamsSchema)
const decodeQueueUpdate = Schema.decodeUnknownSync(QueueUpdateParamsSchema)
const decodeQueueInput = Schema.decodeUnknownSync(QueueInputParamsSchema)
const decodeQueueReorder = Schema.decodeUnknownSync(QueueReorderParamsSchema)
const decodeQueueResume = Schema.decodeUnknownSync(QueueResumeParamsSchema)
const decodeThreadSettings = Schema.decodeUnknownSync(ThreadSettingsSchema)
const decodeThreadSettingsPatch = Schema.decodeUnknownSync(ThreadSettingsPatchSchema)
const decodePermissionConfig = Schema.decodeUnknownSync(PermissionConfigSchema)
const decodeSandboxUninstall = Schema.decodeUnknownSync(SandboxUninstallParamsSchema)
const decodeReviewSummary = Schema.decodeUnknownSync(ReviewSummaryParamsSchema)
const decodeReviewFileDiff = Schema.decodeUnknownSync(ReviewFileDiffParamsSchema)
const decodeReviewApply = Schema.decodeUnknownSync(ReviewApplyParamsSchema)
const decodeReviewAiStart = Schema.decodeUnknownSync(ReviewAiStartParamsSchema)
const decodeReviewBranches = Schema.decodeUnknownSync(ReviewBranchesParamsSchema)
const decodeReviewCommit = Schema.decodeUnknownSync(ReviewCommitParamsSchema)
const decodeReviewCommits = Schema.decodeUnknownSync(ReviewCommitsParamsSchema)
const decodeReviewStatus = Schema.decodeUnknownSync(ReviewStatusParamsSchema)
const decodeReviewCommentList = Schema.decodeUnknownSync(ReviewCommentListParamsSchema)
const decodeReviewCommentSave = Schema.decodeUnknownSync(ReviewCommentSaveParamsSchema)
const decodeReviewCommentID = Schema.decodeUnknownSync(ReviewCommentIDParamsSchema)

// The shared schema is the compatibility boundary. Do not collapse the Codex
// permission matrix back into a handful of renderer presets here.
const supportedPermissionConfig = (value: PermissionConfig) => value

const resolveMemoryProjectKey = async (db: AgentDatabase, params: Record<string, unknown>) => {
  if (params.workspacePath !== undefined) throw new AgentError("INVALID_REQUEST", "项目记忆 RPC 不接受 workspacePath，请使用 projectId 或 threadId", 400)
  const explicitProjectID = typeof params.projectId === "string" && params.projectId.trim() ? params.projectId : undefined
  const threadID = typeof params.threadId === "string" && params.threadId.trim() ? params.threadId : undefined
  if (!explicitProjectID && !threadID) throw new AgentError("INVALID_REQUEST", "项目记忆 RPC 缺少 projectId 或 threadId", 400)
  const threadProjectID = threadID ? db.threadProjectID(threadID) : undefined
  if (threadID && !threadProjectID) throw new AgentError("PROJECT_NOT_FOUND", "Thread 未绑定已注册项目", 404)
  if (explicitProjectID && threadProjectID && explicitProjectID !== threadProjectID) throw new AgentError("PROJECT_SCOPE_MISMATCH", "projectId 与 threadId 不属于同一项目", 409)
  const projectID = explicitProjectID ?? threadProjectID!
  const project = db.getProject(projectID)
  if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
  const workspace = await WorkspaceService.open(project.rootPath)
  return projectMemoryKey(workspace.rootPath)
}

const resolveMemoryProjectID = (db: AgentDatabase, params: Record<string, unknown>) => {
  if (typeof params.projectId === "string" && params.projectId) return params.projectId
  if (typeof params.threadId === "string" && params.threadId) {
    const projectId = db.threadProjectID(params.threadId)
    if (projectId) return projectId
  }
  throw new AgentError("PROJECT_NOT_FOUND", "项目记忆缺少已注册项目", 404)
}

const memoryEntryView = (
  entry: {
    id: string
    scope: "user" | "project"
    content: string
    sourceThreadID: string | null
    createdAt: number
    updatedAt: number
  },
  projectId: string | null,
) => ({
  id: entry.id,
  scope: entry.scope,
  projectId,
  content: entry.content,
  sourceThreadId: entry.sourceThreadID,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
})

const resolveProjectWorkspace = async (db: AgentDatabase, projectId: string) => {
  const project = db.getProject(projectId)
  if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
  return WorkspaceService.open(project.rootPath)
}

const submitMessage = (raw: unknown): SubmitMessage => {
  const body = decodeParams(decodeTurnStart, raw, "turn/start")
  return {
    content: body.content,
    model: body.model,
    permissionConfig: supportedPermissionConfig(body.permissionConfig),
    strategy: enumValue<SendStrategy>(body.strategy ?? "queue", ["queue", "guide"], "strategy"),
    taskMode: enumValue<TaskMode>(body.taskMode, ["chat", "plan"], "taskMode"),
  }
}

export class RpcRouter {
  readonly projection: ThreadProjection
  readonly subscriptions: EventSubscriptionRegistry
  private readonly workspaceFileWatchers = new Map<string, { close: () => void }>()
  private catalogVersion = 1
  private catalogSource: Promise<{
    providers: readonly Provider.Info[]
    models: readonly Model.Info[]
    modelsByProvider: ReadonlyMap<string, readonly Model.Info[]>
  }> | null = null
  private readonly modelPageCache = new Map<string, Promise<ModelCatalogPage>>()
  private readonly handlers: RpcHandlers<RpcRouterContext>
  private readonly connections = new Map<string, {
    initialized: boolean
    createdAt: number
    capabilities: ReadonlySet<string>
  }>()

  constructor(private readonly dependencies: RpcRouterDependencies) {
    this.projection = new ThreadProjection(dependencies.db)
    this.subscriptions = new EventSubscriptionRegistry(dependencies.db)
    this.handlers = defineRpcHandlers(Object.fromEntries(
      (Object.keys(RpcMethods) as RpcMethod[]).map((method) => [
        method,
        async (params: unknown, context: RpcRouterContext) => {
          try {
            return await this.dispatch(method, params, context)
          } catch (cause) {
            throw this.applicationError(method, cause)
          }
        },
      ]),
    ) as unknown as RpcHandlers<RpcRouterContext>)
  }

  async handle(input: unknown, context: RpcRouterContext = {}) {
    if (isInitializedNotification(input)) {
      const notification = Schema.decodeUnknownSync(InitializedNotificationSchema)(input)
      const connectionId = context.connectionId
      const connection = connectionId ? this.connections.get(connectionId) : undefined
      if (!connection) return unauthorizedNotificationResponse()
      connection.initialized = true
      return null
    }
    if (isRpcMethod(input, "initialize")) return dispatchRpcMessage(input, this.handlers, context)
    const connection = context.connectionId ? this.connections.get(context.connectionId) : undefined
    if (!connection?.initialized) return unauthorizedRequestResponse(input)
    const requestedMethod = rpcMethodOf(input)
    const capability = requestedMethod ? RpcMethods[requestedMethod].capability : null
    if (capability && !connection.capabilities.has(capability)) {
      return capabilityRequiredResponse(input, capability)
    }
    return dispatchRpcMessage(input, this.handlers, context)
  }

  private async dispatch(method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, memory, sandbox, review, github } = this.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "initialize":
        db.sqlite.query("SELECT 1").get()
        if (!Array.isArray(params.protocols) || !params.protocols.includes("thread-rpc-v3")) {
          throw new AgentError("PROTOCOL_VERSION_UNSUPPORTED", "客户端不支持 thread-rpc-v3", 409)
        }
        if (!Array.isArray(params.capabilities) || !params.capabilities.includes("rpc.typed.v1")) {
          throw new AgentError("CAPABILITY_REQUIRED", "客户端缺少 rpc.typed.v1 capability", 409)
        }
        const connectionId = crypto.randomUUID()
        this.connections.set(connectionId, {
          initialized: false,
          createdAt: Date.now(),
          capabilities: new Set(params.capabilities as string[]),
        })
        return {
          protocol: "thread-rpc-v3",
          serverInfo: { name: "codepilotx-agent", version: "0.1.0" },
          capabilities: [...Capabilities],
          limits: {
            maxFrameBytes: 16 * 1024 * 1024,
            maxSubscriptions: 16,
            maxStreamsPerSubscription: 64,
            maxPendingRequests: 128,
          },
          connectionId,
        }
      case "sandbox/status":
        return { sandbox: await sandbox.getStatus() }
      case "sandbox/install":
      case "sandbox/repair":
        await sandbox.install()
        return { sandbox: await sandbox.getStatus() }
      case "sandbox/uninstall":
        decodeParams(decodeSandboxUninstall, rawParams, "sandbox/uninstall")
        await sandbox.uninstall()
        return { sandbox: await sandbox.getStatus() }
      case "shutdown":
        if (process.env.CODEPILOTX_DESKTOP_MANAGED !== "1") throw new AgentError("SHUTDOWN_DENIED", "仅桌面托管的 Agent 可以通过 RPC 关闭", 403)
        setTimeout(() => process.emit("SIGTERM"), 25)
        return { ok: true, acceptedAt: Date.now() }
      case "event/subscribe":
        return this.subscriptions.subscribe(this.requireConnection(context), params as never)
      case "event/ack":
        return this.subscriptions.ack(this.requireConnection(context), params as never)
      case "event/unsubscribe":
        return this.subscriptions.unsubscribe(this.requireConnection(context), stringParam(params, "subscriptionId"))
      case "interaction/listPending":
        return this.listPendingInteractions(params)
      case "interaction/respond":
        return this.respondToInteraction(params)
      case "project/list":
        return { projects: db.listProjects(), nextCursor: null }
      case "project/open": {
        if (typeof params.rootPath !== "string" || !params.rootPath.trim()) throw new AgentError("INVALID_REQUEST", "rootPath 参数无效", 400)
        const workspace = await WorkspaceService.open(params.rootPath)
        return { project: db.createProject({ rootPath: workspace.rootPath }) }
      }
      case "workspace/file/list": {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, "projectId"))
        if (typeof params.path !== "string") throw new AgentError("INVALID_REQUEST", "path 参数无效", 400)
        return { entries: await workspace.listEditorFiles(params.path) }
      }
      case "workspace/file/read": {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, "projectId"))
        return workspace.readEditorFile(stringParam(params, "path"))
      }
      case "workspace/file/save": {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, "projectId"))
        const expectedRevision = record(params.expectedRevision, "expectedRevision")
        if (typeof params.content !== "string") throw new AgentError("INVALID_REQUEST", "content 参数无效", 400)
        if (typeof expectedRevision.mtimeMs !== "number" || typeof expectedRevision.sha256 !== "string") {
          throw new AgentError("INVALID_REQUEST", "expectedRevision 参数无效", 400)
        }
        return workspace.saveEditorFile(stringParam(params, "path"), params.content, {
          mtimeMs: expectedRevision.mtimeMs,
          sha256: expectedRevision.sha256,
        })
      }
      case "workspace/file/watch": {
        const projectId = stringParam(params, "projectId")
        const workspace = await resolveProjectWorkspace(db, projectId)
        const requestedPath = stringParam(params, "path")
        const watched = await workspace.watchEditorFile(requestedPath, (path) => {
          void this.emit("workspace/file/changed", { projectId, path, changedAt: Date.now() })
        })
        const key = `${projectId}\0${watched.path}`
        if (this.workspaceFileWatchers.has(key)) watched.close()
        else this.workspaceFileWatchers.set(key, watched)
        return { watching: true, path: watched.path }
      }
      case "workspace/file/unwatch": {
        const projectId = stringParam(params, "projectId")
        const workspace = await resolveProjectWorkspace(db, projectId)
        const path = await workspace.resolveEditorFilePath(stringParam(params, "path"))
        const key = `${projectId}\0${path}`
        this.workspaceFileWatchers.get(key)?.close()
        this.workspaceFileWatchers.delete(key)
        return { watching: false, path }
      }
      case "review/summary": {
        const input = decodeParams(decodeReviewSummary, rawParams, method)
        return review.summaryResult(input.projectId, input.source)
      }
      case "review/refresh": {
        const input = decodeParams(decodeReviewSummary, rawParams, method)
        return review.summaryResult(input.projectId, input.source, true)
      }
      case "review/fileDiff": {
        const input = decodeParams(decodeReviewFileDiff, rawParams, method)
        return review.fileDiff(input)
      }
      case "review/apply": {
        const input = decodeParams(decodeReviewApply, rawParams, method)
        return review.apply(input)
      }
      case "review/branches": {
        const input = decodeParams(decodeReviewBranches, rawParams, method)
        return review.branches(input.projectId)
      }
      case "review/commits": {
        const input = decodeParams(decodeReviewCommits, rawParams, method)
        return review.commits(input.projectId, input.limit)
      }
      case "review/status": {
        const input = decodeParams(decodeReviewStatus, rawParams, method)
        return { status: await review.status(input.projectId) }
      }
      case "review/commit": {
        const input = decodeParams(decodeReviewCommit, rawParams, method)
        return review.commit(input)
      }
      case "review/comment/list": {
        const input = decodeParams(decodeReviewCommentList, rawParams, method)
        return { comments: review.listComments(input) }
      }
      case "review/comment/save": {
        const input = decodeParams(decodeReviewCommentSave, rawParams, method)
        return { comment: review.saveComment(input) }
      }
      case "review/comment/resolve": {
        const input = decodeParams(decodeReviewCommentID, rawParams, method)
        return { comment: review.resolveComment(input) }
      }
      case "review/comment/delete": {
        const input = decodeParams(decodeReviewCommentID, rawParams, method)
        return review.deleteComment(input)
      }
      case "review/ai/start": {
        const input = decodeParams(decodeReviewAiStart, rawParams, method)
        const sourceThread = threads.get(input.threadId)
        const projectID = db.threadProjectID(input.threadId)
        if (!projectID) throw new AgentError("PROJECT_REQUIRED", "当前任务未绑定项目", 409)
        const source = await resolveAiReviewSource(review, projectID, input.target)
        const targetThread = input.delivery === "detached"
          ? threads.create(aiReviewTitle(input.target), projectID, sourceThread.settings)
          : sourceThread
        const model = await aiReviewModel(db, providers, input.threadId, projectID)
        const submitted = await threads.submit(targetThread.id, {
          content: aiReviewPrompt(input.target),
          model,
          permissionConfig: sourceThread.settings.permissionConfig,
          strategy: "queue",
          taskMode: "chat",
        })
        return {
          threadId: targetThread.id,
          turnId: submitted.turnID,
          delivery: input.delivery,
          source,
        }
      }
      case "github/auth/status":
        return github.authStatus()
      case "github/auth/start":
        return github.startDeviceFlow(typeof params.clientId === "string" ? params.clientId : undefined)
      case "github/auth/poll":
        return github.pollDeviceFlow(stringParam(params, "loginId"))
      case "github/auth/logout":
        return github.logout()
      case "github/profile":
        return github.profile()
      case "github/profileOverview":
        return github.profileOverview()
      case "github/repositories":
        return github.repositories()
      case "github/pullRequest/read":
        return github.readPullRequest(githubPullRequestIdentity(params))
      case "github/pullRequest/create":
        return github.createPullRequest({
          ...githubRepositoryIdentity(params),
          title: stringParam(params, "title"),
          head: stringParam(params, "head"),
          base: stringParam(params, "base"),
          ...(typeof params.body === "string" ? { body: params.body } : {}),
          ...(typeof params.draft === "boolean" ? { draft: params.draft } : {}),
        })
      case "github/pullRequest/createForProject": {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, "projectId"))
        return github.createPullRequestForProject({
          workspaceRoot: workspace.rootPath,
          title: stringParam(params, "title"),
          ...(typeof params.body === "string" ? { body: params.body } : {}),
          ...(typeof params.draft === "boolean" ? { draft: params.draft } : {}),
        })
      }
      case "github/pullRequest/comment":
        return github.createPullRequestComment({
          ...githubPullRequestIdentity(params),
          body: stringParam(params, "body"),
          path: stringParam(params, "path"),
          side: enumValue(params.side, ["LEFT", "RIGHT"], "side"),
          line: positiveIntegerParam(params, "line"),
          expectedHeadRevision: stringParam(params, "expectedHeadRevision"),
          ...(typeof params.commitId === "string" ? { commitId: params.commitId } : {}),
          ...(params.startSide === "LEFT" || params.startSide === "RIGHT" ? { startSide: params.startSide } : {}),
          ...(typeof params.startLine === "number" ? { startLine: positiveIntegerParam(params, "startLine") } : {}),
        })
      case "github/pullRequest/resolveThread":
        return github.setReviewThreadResolved({
          threadId: stringParam(params, "threadId"),
          ...(typeof params.resolved === "boolean" ? { resolved: params.resolved } : {}),
        })
      case "github/pullRequest/submitReview":
        return github.submitPullRequestReview({
          ...githubPullRequestIdentity(params),
          event: enumValue(params.event, ["COMMENT", "APPROVE", "REQUEST_CHANGES"], "event"),
          expectedHeadRevision: stringParam(params, "expectedHeadRevision"),
          ...(typeof params.body === "string" ? { body: params.body } : {}),
        })
      case "github/push": {
        const workspace = await resolveProjectWorkspace(db, stringParam(params, "projectId"))
        return github.push({
          workspaceRoot: workspace.rootPath,
          ...(typeof params.remote === "string" ? { remote: params.remote } : {}),
          ...(typeof params.branch === "string" ? { branch: params.branch } : {}),
          ...(typeof params.setUpstream === "boolean" ? { setUpstream: params.setUpstream } : {}),
          ...(typeof params.forceWithLease === "boolean" ? { forceWithLease: params.forceWithLease } : {}),
        })
      }
      case "project/settings/update": {
        const projectId = stringParam(params, "projectId")
        const settings = record(params.settings, "settings")
        const saved = db.saveProjectSettings(projectId, {
          defaultModel: modelRefOrNull(settings.defaultModel),
        })
        const row = db.sqlite.query("SELECT updated_at FROM project_settings WHERE project_id = ?").get(projectId) as { updated_at: number } | null
        return { projectId, settings: saved, version: Number(row?.updated_at ?? Date.now()) }
      }
      case "thread/list": {
        const projectID = typeof params.projectID === "string" ? params.projectID : typeof params.projectId === "string" ? params.projectId : undefined
        const archived = typeof params.archived === "boolean" ? params.archived : undefined
        return { threads: this.projection.list({ ...(projectID !== undefined ? { projectID } : {}), ...(archived !== undefined ? { archived } : {}), limit: typeof params.limit === "number" ? params.limit : 100 }), nextCursor: null }
      }
      case "thread/create": {
        const projectID = stringParam(params, "projectID", "projectId")
        const settings = params.settings === undefined
          ? undefined
          : decodeParams(decodeThreadSettings, params.settings, "thread/create.settings")
        if (settings) supportedPermissionConfig(settings.permissionConfig)
        const created = threads.create(typeof params.title === "string" ? params.title : undefined, projectID, settings)
        return this.threadSnapshotResult(created.id)
      }
      case "thread/read":
        return this.threadSnapshotResult(stringParam(params, "threadId"))
      case "prompt/preview": {
        const threadId = stringParam(params, "threadId")
        const preview = await threads.promptPreview(threadId)
        if (!preview) throw new AgentError("PROMPT_PREVIEW_UNAVAILABLE", "该任务尚未建立新提示词 baseline", 409)
        return { threadId, preview, cacheKey: preview.cacheKey }
      }
      case "prompt/refresh": {
        const threadId = stringParam(params, "threadId")
        const settings = threads.refreshPromptSettings(threadId)
        const preview = await threads.promptPreview(threadId)
        if (!preview) throw new AgentError("CHECKPOINT_UNAVAILABLE", "无法刷新提示词 cache key", 409)
        return { threadId, settings, cacheKey: preview.cacheKey }
      }
      case "thread/compact":
        return { compaction: await threads.compact(stringParam(params, "threadId")) }
      case "memory/list": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        const projectId = scope === "project" ? resolveMemoryProjectID(db, params) : null
        return {
          entries: memory.list({ scope, ...(projectKey ? { projectKey } : {}), limit: typeof params.limit === "number" ? params.limit : 100 })
            .map((entry) => memoryEntryView(entry, projectId)),
          nextCursor: null,
        }
      }
      case "memory/read": {
        const id = stringParam(params, "id")
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.read({ id, scope, ...(projectKey ? { projectKey } : {}) })
        if (!entry) throw new AgentError("MEMORY_NOT_FOUND", "记忆不存在或记忆功能未启用", 404)
        return { entry: memoryEntryView(entry, scope === "project" ? resolveMemoryProjectID(db, params) : null) }
      }
      case "memory/save": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.remember({ scope, content: stringParam(params, "content"), ...(typeof params.id === "string" && params.id ? { id: params.id } : {}), ...(projectKey ? { projectKey } : {}) })
        if (!entry) throw new AgentError("MEMORY_REJECTED", "记忆功能未启用、内容为空或包含敏感信息", 409)
        return { entry: memoryEntryView(entry, scope === "project" ? resolveMemoryProjectID(db, params) : null) }
      }
      case "memory/delete": {
        const id = stringParam(params, "id")
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        return { deleted: memory.delete({ id, scope, ...(projectKey ? { projectKey } : {}) }), id }
      }
      case "memory/reset": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        return { deleted: memory.reset({ scope, ...(projectKey ? { projectKey } : {}), includeEventLog: params.includeEventLog === true }) }
      }
      case "subagent/list":
        return { subagents: subagents.list(stringParam(params, "threadId", "parentThreadId")), nextCursor: null }
      case "subagent/read": {
        const value = subagents.read(stringParam(params, "taskId", "subagentTaskId"))
        return {
          ...value,
          snapshot: this.requiredSnapshot(value.task.childThreadId),
          capabilities: {
            canSend: true,
            canStop: Boolean(value.currentRun && !["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canRetry: Boolean(value.currentRun && ["failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canApplyWorktree: value.task.workspace.mode === "worktree" && value.task.workspace.state !== "applied" && value.task.workspace.state !== "discarded" && Boolean(value.currentRun && ["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canDiscardWorktree: value.task.workspace.mode === "worktree" && value.task.workspace.state !== "applied" && value.task.workspace.state !== "discarded",
            canRestoreWorkspace: value.task.workspace.mode === "shared" && value.task.workspace.baselineRef !== null && Boolean(value.currentRun && ["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
          },
        }
      }
      case "subagent/send": {
        const taskId = stringParam(params, "taskId", "subagentTaskId")
        const inputId = stringParam(params, "inputId")
        const sent = await subagents.send(taskId, stringParam(params, "message"), inputId, {
          ...(params.model === undefined ? {} : { model: modelRef(record(params.model, "model")) }),
          ...(params.permissionConfig === undefined ? {} : { permissionConfig: supportedPermissionConfig(decodeParams(decodePermissionConfig, params.permissionConfig, "permissionConfig")) }),
          ...(Array.isArray(params.attachmentIds) ? { attachmentIDs: params.attachmentIds.map((value) => {
            if (typeof value !== "string" || !value) throw new AgentError("INVALID_REQUEST", "attachmentIds 参数无效", 400)
            return value
          }) } : {}),
        })
        const run = record(record(sent).run, "run")
        const runId = stringParam(run, "id")
        const execution = db.sqlite.query("SELECT turn_id FROM agent_executions WHERE subagent_run_id = ? ORDER BY run_sequence DESC LIMIT 1").get(runId) as { turn_id: string } | null
        if (!execution) throw new AgentError("CHECKPOINT_UNAVAILABLE", "子 Agent admission 尚未建立", 409)
        const childThreadId = subagents.read(taskId).task.childThreadId
        const sequence = (db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(childThreadId) as { id: number }).id
        return {
          taskId,
          runId,
          inputId,
          turnId: execution.turn_id,
          disposition: "accepted",
          streamPosition: { streamId: childThreadId, sequence },
        }
      }
      case "subagent/stop":
        return subagents.stop(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "operationId"))
      case "subagent/retry": {
        const taskId = stringParam(params, "taskId", "subagentTaskId")
        const retried = await subagents.retry(taskId, stringParam(params, "operationId"))
        const value = record(retried, "retry")
        const run = record(value.run, "run")
        const runId = stringParam(run, "id")
        const execution = db.sqlite.query("SELECT turn_id FROM agent_executions WHERE subagent_run_id = ? ORDER BY run_sequence DESC LIMIT 1").get(runId) as { turn_id: string } | null
        if (!execution) throw new AgentError("CHECKPOINT_UNAVAILABLE", "子 Agent retry admission 尚未建立", 409)
        const input = db.sqlite.query("SELECT id FROM inputs WHERE turn_id = ? ORDER BY created_at LIMIT 1").get(execution.turn_id) as { id: string } | null
        if (!input) throw new AgentError("CHECKPOINT_UNAVAILABLE", "子 Agent retry input 尚未建立", 409)
        const childThreadId = subagents.read(taskId).task.childThreadId
        const sequence = (db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(childThreadId) as { id: number }).id
        return {
          task: value.task,
          run: value.run,
          admission: {
            inputId: input.id,
            turnId: execution.turn_id,
            disposition: "accepted",
            streamPosition: { streamId: childThreadId, sequence },
          },
        }
      }
      case "subagent/worktree/diff": {
        const result = record(await subagents.worktreeDiff(stringParam(params, "taskId", "subagentTaskId")), "diff")
        const diff = typeof result.patch === "string" ? result.patch : typeof result.diff === "string" ? result.diff : ""
        const maxBytes = typeof params.maxBytes === "number" ? params.maxBytes : 1_000_000
        const encoded = new TextEncoder().encode(diff)
        return {
          diff: encoded.byteLength <= maxBytes ? diff : new TextDecoder().decode(encoded.slice(0, maxBytes)),
          truncated: encoded.byteLength > maxBytes || result.truncated === true,
        }
      }
      case "subagent/worktree/apply": {
        const taskId = stringParam(params, "taskId", "subagentTaskId")
        await subagents.worktreeApply(taskId, stringParam(params, "operationId"))
        return { result: { taskId, action: "apply", outcome: "changed", workspace: subagents.read(taskId).task.workspace } }
      }
      case "subagent/worktree/discard": {
        const taskId = stringParam(params, "taskId", "subagentTaskId")
        await subagents.worktreeDiscard(taskId, stringParam(params, "operationId"))
        return { result: { taskId, action: "discard", outcome: "changed", workspace: subagents.read(taskId).task.workspace } }
      }
      case "subagent/workspace/restore": {
        const taskId = stringParam(params, "taskId", "subagentTaskId")
        await subagents.workspaceRestore(taskId, stringParam(params, "operationId"))
        return { result: { taskId, action: "restore", outcome: "changed", workspace: subagents.read(taskId).task.workspace } }
      }
      case "thread/update": {
        const threadId = stringParam(params, "threadId")
        const patch = record(params.patch, "patch")
        const title = patch.title
        const archived = patch.archived
        if (title !== undefined && title !== null && typeof title !== "string") throw new AgentError("INVALID_REQUEST", "title 参数无效", 400)
        if (archived !== undefined && typeof archived !== "boolean") throw new AgentError("INVALID_REQUEST", "archived 参数无效", 400)
        const thread = await history.patch(threadId, { ...(title !== undefined ? { title } : {}), ...(archived !== undefined ? { archived } : {}) })
        return { thread }
      }
      case "thread/settings/update": {
        const threadId = stringParam(params, "threadId")
        const settings = decodeParams(decodeThreadSettingsPatch, params.settings, "thread/settings/update.settings")
        if (settings.permissionConfig) supportedPermissionConfig(settings.permissionConfig)
        const result = await history.patchSettings(threadId, settings)
        const version = Number((db.sqlite.query("SELECT updated_at FROM threads WHERE id = ?").get(threadId) as { updated_at: number } | null)?.updated_at ?? Date.now())
        return { ...result, version }
      }
      case "thread/delete": {
        const threadId = stringParam(params, "threadId")
        await history.remove(threadId)
        return { threadId, deletedAt: Date.now() }
      }
      case "turn/start": {
        const start = decodeParams(decodeTurnStart, rawParams, "turn/start")
        const threadId = start.threadId
        const attachmentIds = start.attachmentIds ? [...start.attachmentIds] : []
        if (attachmentIds.length) {
          if (new Set(attachmentIds).size !== attachmentIds.length || attachmentIds.length > 8) throw new AgentError("ATTACHMENT_COUNT_LIMIT", "每个 Turn 最多包含 8 个不重复附件", 413)
          const records = await Promise.all(attachmentIds.map((id) => attachments.read(id).then((value) => value.record)))
          if (records.some((record) => record.binding !== null)) throw new AgentError("ATTACHMENT_ALREADY_BOUND", "附件已绑定到其他 Turn", 409)
          if (records.some((record) => record.kind === "image")) {
            const model = await providers.resolve(start.model)
            if (!model.capabilities.input.includes("image")) throw new AgentError("MODEL_IMAGE_UNSUPPORTED", "当前模型不支持图片输入", 409)
          }
        }
        const submitted = await threads.submit(threadId, submitMessage(start), stringParam(params, "inputId"))
        if (attachmentIds.length) await attachments.bind(attachmentIds, { type: "input", id: submitted.inputID })
        const sequence = (db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(threadId) as { id: number }).id
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === "duplicate" ? "duplicate" : "accepted",
          streamPosition: { streamId: threadId, sequence },
        }
      }
      case "turn/steer": {
        const threadId = stringParam(params, "threadId")
        const turnId = stringParam(params, "turnId")
        const inputId = stringParam(params, "inputId")
        const existing = db.inputAdmission(inputId)
        if (existing) {
          if (existing.thread_id !== threadId || existing.turn_id !== turnId || existing.content !== stringParam(params, "content")) {
            throw new AgentError("CONFLICT", "inputId 已被其他请求使用", 409)
          }
          const sequence = (db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(threadId) as { id: number }).id
          return {
            inputId,
            turnId,
            disposition: "duplicate",
            streamPosition: { streamId: threadId, sequence },
          }
        }
        const active = db.activeTurn(threadId)
        if (!active || active.id !== turnId) throw new AgentError("TURN_NOT_FOUND", "当前 Turn 不可引导", 404)
        const row = db.sqlite.query("SELECT model_ref FROM turns WHERE id = ? AND thread_id = ?").get(turnId, threadId) as { model_ref: string } | null
        if (!row) throw new AgentError("TURN_NOT_FOUND", "Turn 不存在", 404)
        const thread = threads.get(threadId)
        const submitted = await threads.submit(threadId, {
          content: stringParam(params, "content"),
          model: modelRef(record(JSON.parse(row.model_ref), "model")),
          permissionConfig: thread.settings.permissionConfig,
          strategy: "guide",
          taskMode: thread.settings.taskMode,
        }, inputId)
        const sequence = (db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(threadId) as { id: number }).id
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === "duplicate" ? "duplicate" : "accepted",
          streamPosition: { streamId: threadId, sequence },
        }
      }
      case "turn/interrupt":
        {
          const threadId = stringParam(params, "threadId")
          const turnId = typeof params.turnId === "string" ? params.turnId : db.activeTurn(threadId)?.id
          await threads.stop(threadId)
          return { threadId, ...(turnId ? { turnId } : {}), status: "interrupted" }
        }
      case "turn/resume": {
        const threadId = stringParam(params, "threadId")
        const turnId = stringParam(params, "turnId")
        threads.resumeTurn(threadId, turnId)
        return { threadId, turnId, status: "running" }
      }
      case "queue/update": {
        const request = decodeParams(decodeQueueUpdate, rawParams, "queue/update")
        const mutation = await threads.updateQueue(request.threadId, request.inputId, request.content, request.attachmentIds, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return this.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/remove": {
        const request = decodeParams(decodeQueueInput, rawParams, "queue/remove")
        const mutation = await threads.removeQueue(request.threadId, request.inputId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return this.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/reorder": {
        const request = decodeParams(decodeQueueReorder, rawParams, "queue/reorder")
        const mutation = await threads.reorderQueue(request.threadId, request.inputIds, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return this.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/steer": {
        const request = decodeParams(decodeQueueInput, rawParams, "queue/steer")
        const mutation = await threads.steerQueue(request.threadId, request.inputId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return this.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/resume": {
        const request = decodeParams(decodeQueueResume, rawParams, "queue/resume")
        const mutation = await threads.resumeQueue(request.threadId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return this.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "attachment/import": {
        if (!Array.isArray(params.uploads)) throw new AgentError("INVALID_REQUEST", "uploads 参数无效", 400)
        const uploads = params.uploads.map((entry) => {
          const value = record(entry, "attachment")
          const kind = enumValue(value.kind, ["text", "image"] as const, "kind")
          const data = stringParam(value, "data")
          return {
            kind,
            name: stringParam(value, "name"),
            mimeType: stringParam(value, "mediaType", "mimeType"),
            data: kind === "image" || value.encoding === "base64" ? new Uint8Array(Buffer.from(data, "base64")) : data,
          }
        })
        return { attachments: (await attachments.store(uploads)).map(attachmentView) }
      }
      case "attachment/read": {
        const value = await attachments.read(stringParam(params, "attachmentId", "id"))
        const all = value.data
        const range = params.range && typeof params.range === "object" && !Array.isArray(params.range)
          ? params.range as Record<string, unknown>
          : null
        const offset = range && typeof range.offset === "number" ? range.offset : 0
        const length = range && typeof range.length === "number" ? Math.min(range.length, Math.max(0, all.byteLength - offset)) : Math.max(0, all.byteLength - offset)
        const data = all.slice(offset, offset + length)
        return {
          attachment: attachmentView(value.record),
          data: value.record.kind === "text" ? new TextDecoder().decode(data) : Buffer.from(data).toString("base64"),
          encoding: value.record.kind === "text" ? "utf8" : "base64",
          range: { offset, length: data.byteLength, total: all.byteLength },
        }
      }
      case "provider/list":
        return this.providerList()
      case "model/list":
        return this.modelCatalog(params)
      case "model/refresh":
        await providers.refresh(true)
        return this.publishCatalogUpdated()
      case "model/setDefault": {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        db.setSetting("defaultModel", model)
        const catalog = await this.publishCatalogUpdated(false)
        return {
          defaultModel: model,
          settingsVersion: catalog.catalogVersion,
        }
      }
      case "model/setReviewer": {
        const model = modelRefOrNull(params.model)
        if (model) await providers.resolve(model)
        db.setSetting("reviewerModel", model)
        const catalog = await this.publishCatalogUpdated(false)
        return {
          reviewerModel: model,
          settingsVersion: catalog.catalogVersion,
        }
      }
      case "provider/test": {
        const providerID = stringParam(params, "providerId")
        const testedAt = Date.now()
        const startedAt = performance.now()
        const model = (await providers.models()).find((item) => item.providerID === providerID)
        if (!model) {
          return {
            providerId: providerID,
            status: "unavailable",
            testedAt,
            category: "configuration",
            message: `Provider ${providerID} 没有可用模型`,
          }
        }
        try {
          await providers.getModel({ providerID: model.providerID, id: model.id })
          return {
            providerId: providerID,
            status: "reachable",
            testedAt,
            latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          }
        } catch (cause) {
          return {
            providerId: providerID,
            status: "unavailable",
            testedAt,
            category: providerFailureCategory(cause),
            message: cause instanceof Error ? cause.message : "Provider 当前不可用",
          }
        }
      }
      case "provider/updateSettings": {
        const setting = providerSetting(params)
        db.setProviderSettings(setting.id, setting.config)
        await providers.reload()
        const catalog = await this.publishCatalogUpdated()
        const catalogProvider = catalog.providers.find(({ provider }) => provider.id === setting.id)
        if (!catalogProvider) throw new AgentError("PROVIDER_UNAVAILABLE", `Provider ${setting.id} 当前不可用`, 409)
        const integration = (await integrations.list()).find((item) => item.id === catalogProvider.provider.integrationID)
        return {
          provider: {
            id: catalogProvider.provider.id,
            name: catalogProvider.provider.name,
            disabled: catalogProvider.provider.disabled === true,
            ...(catalogProvider.provider.integrationID
              ? { integrationId: catalogProvider.provider.integrationID }
              : {}),
            configured: integration ? integration.connections.length > 0 : true,
            modelCount: catalogProvider.models.length,
          },
          catalogVersion: catalog.catalogVersion,
        }
      }
      case "integration/list": {
        const listed = await integrations.list()
        return {
          integrations: listed.filter((integration) => {
            if (
              typeof params.kind === "string" &&
              !integration.methods.some((method) => method.type === params.kind)
            ) return false
            if (
              params.status === "connected" &&
              integration.connections.length === 0
            ) return false
            if (
              params.status === "disconnected" &&
              integration.connections.length > 0
            ) return false
            return true
          }),
        }
      }
      case "integration/connect": {
        const integrationID = stringParam(params, "integrationId")
        await integrations.connect({
          integrationID,
          key: stringParam(params, "key"),
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        await providers.reload()
        await this.emitIntegration("integration/updated", integrationID)
        await this.publishCatalogUpdated()
        return { integration: await this.requiredIntegration(integrationID) }
      }
      case "integration/authorize": {
        const inputs = optionalRecord(params.inputs)
        const values = Object.fromEntries(Object.entries(inputs).map(([key, value]) => {
          if (typeof value !== "string") throw new AgentError("INVALID_REQUEST", `inputs.${key} 参数无效`, 400)
          return [key, value]
        }))
        const attempt = await integrations.authorize({
          integrationID: stringParam(params, "integrationId"),
          methodID: stringParam(params, "methodId"),
          inputs: values,
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        return { attempt }
      }
      case "integration/authorizeComplete": {
        const completedAttemptID = stringParam(params, "attemptId")
        const connection = await integrations.complete({ attemptID: completedAttemptID, ...(typeof params.code === "string" ? { code: params.code } : {}) })
        const completedContext = integrations.attemptContext(completedAttemptID)
        const status = await integrations.status(completedAttemptID)
        await providers.reload()
        await this.emit("integration/authorizationCompleted", {
          attemptId: completedAttemptID,
          integrationId: completedContext.integrationID,
        })
        await this.publishCatalogUpdated()
        return {
          attempt: {
            attemptId: completedAttemptID,
            integrationId: completedContext.integrationID,
            status,
            connection,
          },
          integration: await this.requiredIntegration(completedContext.integrationID),
        }
      }
      case "integration/authorizeStatus": {
        const attemptID = stringParam(params, "attemptId")
        const status = await integrations.status(attemptID)
        const context = integrations.attemptContext(attemptID)
        if (status.status === "complete") {
          await providers.reload()
          await this.emit("integration/authorizationCompleted", {
            attemptId: attemptID,
            integrationId: context.integrationID,
          })
          await this.publishCatalogUpdated()
        }
        if (status.status === "failed") {
          await this.emit("integration/authorizationFailed", {
            attemptId: attemptID,
            integrationId: context.integrationID,
            error: {
              code: "AUTHORIZATION_FAILED",
              message: status.message,
              retryable: false,
            },
          })
        }
        return {
          attempt: {
            attemptId: attemptID,
            integrationId: context.integrationID,
            status,
            connection: context.connection ?? null,
          },
        }
      }
      case "integration/disconnect": {
        const integrationID = stringParam(params, "integrationId")
        await integrations.disconnect({
          integrationID,
          credentialID: stringParam(params, "credentialId"),
        })
        await providers.reload()
        await this.emitIntegration("integration/updated", integrationID)
        await this.publishCatalogUpdated()
        return { integration: await this.requiredIntegration(integrationID) }
      }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  }

  private listPendingInteractions(rawParams: Record<string, unknown>) {
    const { db } = this.dependencies
    const threadId = typeof rawParams.threadId === "string" ? rawParams.threadId : undefined
    const requestedKinds = Array.isArray(rawParams.kinds)
      ? new Set(rawParams.kinds.filter((kind): kind is string => typeof kind === "string"))
      : null
    const interactions: Array<Record<string, unknown>> = []

    if (!requestedKinds || requestedKinds.has("approval")) {
      const rows = db.sqlite.query(`
        SELECT id FROM approval_requests
        WHERE status = 'pending' AND (? IS NULL OR thread_id = ?)
        ORDER BY created_at, id
      `).all(threadId ?? null, threadId ?? null) as Array<{ id: string }>
      for (const row of rows) {
        const checkpoint = db.getApprovalCheckpoint(row.id)
        if (!checkpoint) continue
        const invocation = checkpoint.payload.invocation
        const additional = record(invocation.input.additionalPermissions ?? {}, "requestedPermissions")
        interactions.push({
          interactionId: checkpoint.approvalID,
          threadId: checkpoint.threadID,
          turnId: checkpoint.turnID,
          agentId: checkpoint.agentID,
          createdAt: checkpoint.createdAt,
          version: checkpoint.version,
          kind: "approval",
          toolCallId: checkpoint.toolCallID,
          tool: invocation.name,
          risk: ["low", "medium", "high", "critical"].includes(checkpoint.risk) ? checkpoint.risk : "high",
          reason: checkpoint.reason || "需要批准工具调用",
          ...(typeof invocation.input.command === "string" ? { command: invocation.input.command } : {}),
          ...(typeof invocation.input.cwd === "string" ? { cwd: invocation.input.cwd } : {}),
          requestedPermissions: {
            ...(Array.isArray(additional.readPaths) ? { readPaths: additional.readPaths } : {}),
            ...(Array.isArray(additional.writePaths) ? { writePaths: additional.writePaths } : {}),
            ...(Array.isArray(additional.networkDomains) ? { networkDomains: additional.networkDomains } : {}),
          },
          allowedChoices: ["allow-once", "deny", "stop"],
        })
      }
    }

    if (!requestedKinds || requestedKinds.has("question")) {
      const rows = db.sqlite.query(`
        SELECT id, thread_id, turn_id, agent_id, payload, payload_version, created_at
        FROM question_requests
        WHERE status = 'pending' AND (? IS NULL OR thread_id = ?)
        ORDER BY created_at, id
      `).all(threadId ?? null, threadId ?? null) as Array<{
        id: string; thread_id: string; turn_id: string; agent_id: string
        payload: string; payload_version: number; created_at: number
      }>
      for (const row of rows) {
        const payload = parseJsonRecord(row.payload)
        const prompt = typeof payload.question === "string" && payload.question.trim()
          ? payload.question
          : "需要你的确认"
        const options = Array.isArray(payload.options)
          ? payload.options.filter((option): option is string => typeof option === "string")
          : []
        interactions.push({
          interactionId: row.id,
          threadId: row.thread_id,
          turnId: row.turn_id,
          agentId: row.agent_id,
          createdAt: row.created_at,
          version: row.payload_version,
          kind: "question",
          questions: [{
            id: row.id,
            prompt,
            choices: options.map((label, index) => ({
              id: `${row.id}:${index}`,
              label,
              recommended: index === 0,
            })),
            allowFreeform: true,
            required: true,
          }],
        })
      }
    }

    if (!requestedKinds || requestedKinds.has("plan")) {
      const rows = db.sqlite.query(`
        SELECT t.id AS turn_id, t.thread_id, t.root_agent_id, t.updated_at
        FROM turns AS t
        WHERE t.status = 'waiting_plan_confirmation'
          AND (? IS NULL OR t.thread_id = ?)
        ORDER BY t.updated_at, t.id
      `).all(threadId ?? null, threadId ?? null) as Array<{
        turn_id: string; thread_id: string; root_agent_id: string; updated_at: number
      }>
      for (const row of rows) {
        const markdown = db.currentPlan(row.turn_id)
        if (!markdown) continue
        const item = db.sqlite.query("SELECT id, created_at FROM items WHERE turn_id = ? AND type = 'plan' ORDER BY created_at DESC LIMIT 1").get(row.turn_id) as { id: string; created_at: number } | null
        interactions.push({
          interactionId: item?.id ?? `plan:${row.turn_id}`,
          threadId: row.thread_id,
          turnId: row.turn_id,
          agentId: row.root_agent_id,
          createdAt: item?.created_at ?? row.updated_at,
          version: db.getAgentTurnCheckpoint(row.turn_id)?.version ?? 1,
          kind: "plan",
          title: "实施计划",
          markdown,
        })
      }
    }

    if (!requestedKinds || requestedKinds.has("hookTrust")) {
      const rows = db.sqlite.query(`
        SELECT id FROM hook_trust_requests
        WHERE status = 'pending' AND thread_id IS NOT NULL AND turn_id IS NOT NULL
          AND (? IS NULL OR thread_id = ?)
        ORDER BY created_at, id
      `).all(threadId ?? null, threadId ?? null) as Array<{ id: string }>
      for (const row of rows) {
        const request = db.getHookTrustRequest(row.id)
        if (!request?.threadID || !request.turnID) continue
        const audit = request.auditSummary
        const hooks = Array.isArray(audit.hooks) ? audit.hooks : []
        const hook = hooks.find((candidate) => candidate && typeof candidate === "object") as Record<string, unknown> | undefined
        const agent = db.agentForTurn(request.turnID)
        interactions.push({
          interactionId: request.id,
          threadId: request.threadID,
          turnId: request.turnID,
          agentId: agent?.id ?? `hook:${request.turnID}`,
          createdAt: request.createdAt,
          version: 1,
          kind: "hookTrust",
          configPath: request.configPath,
          sha256: request.configHash,
          hook: {
            id: typeof hook?.id === "string" && hook.id ? hook.id : "project-hooks",
            name: typeof hook?.id === "string" && hook.id ? hook.id : "项目 Hook",
            event: typeof hook?.event === "string" && hook.event ? hook.event : "unknown",
            command: typeof hook?.command === "string" && hook.command ? hook.command : "(multiple hooks)",
          },
        })
      }
    }

    interactions.sort((left, right) => Number(left.createdAt) - Number(right.createdAt) || String(left.interactionId).localeCompare(String(right.interactionId)))
    const offset = decodeOffsetCursor(rawParams.cursor)
    const limit = typeof rawParams.limit === "number" ? rawParams.limit : 100
    const page = interactions.slice(offset, offset + limit)
    return {
      interactions: page,
      nextCursor: offset + page.length < interactions.length ? encodeOffsetCursor(offset + page.length) : null,
    }
  }

  private async respondToInteraction(rawParams: Record<string, unknown>) {
    const { db, approvals, questions, subagents, threads } = this.dependencies
    const operationId = stringParam(rawParams, "operationId")
    const interactionId = stringParam(rawParams, "interactionId")
    const expectedVersion = rawParams.expectedVersion
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) {
      throw new AgentError("INVALID_REQUEST", "expectedVersion 参数无效", 400)
    }
    const response = record(rawParams.response, "response")
    const duplicate = db.interactionOperation(operationId)
    if (duplicate) {
      if (duplicate.interactionID !== interactionId || JSON.stringify(duplicate.response) !== JSON.stringify(response)) {
        throw new AgentError("CONFLICT", "operationId 已被其他 interaction 响应使用", 409)
      }
      return duplicate.result
    }
    const kind = enumValue(response.kind, ["approval", "question", "plan", "hookTrust"] as const, "response.kind")
    const resolvedAt = Date.now()

    if (kind === "approval") {
      const checkpoint = db.getApprovalCheckpoint(interactionId)
      if (!checkpoint || checkpoint.status !== "pending") throw new AgentError("REQUEST_NOT_PENDING", "审批请求不存在或已处理", 409)
      if (checkpoint.version !== expectedVersion) throw new AgentError("CONFLICT", "审批请求版本已经变化", 409)
      const decision = enumValue(response.decision, ["allow-once", "deny", "stop"] as const, "response.decision")
      if (decision === "stop") {
        const execution = db.getAgentExecution(checkpoint.agentID)
        if (execution?.subagentRunID) {
          const task = db.sqlite.query("SELECT task_id FROM subagent_runs WHERE id = ?").get(execution.subagentRunID) as { task_id: string } | null
          if (!task) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
          await subagents.stop(task.task_id, operationId)
        } else {
          await threads.stop(checkpoint.threadID)
        }
      } else {
        const resolved = await approvals.respond(interactionId, decision === "allow-once" ? "allow" : "deny")
        const execution = db.getAgentExecution(resolved.agentID)
        if (execution?.subagentRunID) await subagents.resumeTurn(resolved.threadID, resolved.turnID)
        else threads.resumeTurn(resolved.threadID, resolved.turnID)
      }
    } else if (kind === "question") {
      const row = db.sqlite.query("SELECT payload_version, status FROM question_requests WHERE id = ?").get(interactionId) as { payload_version: number; status: string } | null
      if (!row || row.status !== "pending") throw new AgentError("REQUEST_NOT_PENDING", "问题不存在或已经回答", 409)
      if (row.payload_version !== expectedVersion) throw new AgentError("CONFLICT", "问题版本已经变化", 409)
      const status = enumValue(response.status, ["answered", "ignored"] as const, "response.status")
      await questions.reply(interactionId, status === "ignored" ? null : response.answers, status === "ignored")
    } else if (kind === "plan") {
      const planRow = db.sqlite.query(`
        SELECT t.id, c.version
        FROM turns AS t
        LEFT JOIN agent_checkpoints AS c ON c.turn_id = t.id
        LEFT JOIN items AS i ON i.turn_id = t.id AND i.type = 'plan'
        WHERE t.status = 'waiting_plan_confirmation' AND (i.id = ? OR ('plan:' || t.id) = ?)
        ORDER BY i.created_at DESC LIMIT 1
      `).get(interactionId, interactionId) as { id: string; version: number | null } | null
      if (!planRow) throw new AgentError("REQUEST_NOT_PENDING", "当前规划不等待确认", 409)
      if (Number(planRow.version ?? 1) !== expectedVersion) throw new AgentError("CONFLICT", "规划请求版本已经变化", 409)
      const decision = enumValue(response.decision, ["continue", "reject"] as const, "response.decision")
      const result = await threads.submitPlanDecision(planRow.id, decision)
      if (!result) throw new AgentError("REQUEST_NOT_PENDING", "当前规划不等待确认", 409)
    } else {
      const request = db.getHookTrustRequest(interactionId)
      if (!request || request.status !== "pending") throw new AgentError("REQUEST_NOT_PENDING", "Hook 信任请求不存在或已经处理", 409)
      if (expectedVersion !== 1) throw new AgentError("CONFLICT", "Hook 信任请求版本已经变化", 409)
      const decision = enumValue(response.decision, ["allow", "block"] as const, "response.decision")
      const result = db.resolveHookTrustRequest(interactionId, decision)
      for (const event of result.events) await Effect.runPromise(this.dependencies.hub.publish(event))
      for (const resumed of result.resumed) {
        const execution = db.getAgentExecution(resumed.agentID)
        if (execution?.subagentRunID) await subagents.resumeTurn(resumed.threadID, resumed.turnID)
        else threads.resumeHookTrust(resumed.threadID, resumed.turnID)
      }
    }

    const result = {
      interactionId,
      kind,
      state: "resolved",
      version: Number(expectedVersion) + 1,
      resolvedAt,
      response,
    }
    return db.saveInteractionOperation({
      operationID: operationId,
      interactionID: interactionId,
      response,
      result,
    }).result
  }

  private applicationError(method: RpcMethod, cause: unknown) {
    if (cause instanceof RpcApplicationError) return cause
    if (!(cause instanceof AgentError)) {
      return new RpcApplicationError("INTERNAL_ERROR", "Agent 内部错误", false)
    }
    const declared = RpcMethods[method].errors as readonly string[]
    const exact = declared.includes(cause.code) ? cause.code as ApplicationErrorCode : null
    const mapped = workspaceFileApplicationErrorCode(method, cause.code, declared)
    const fallback: ApplicationErrorCode =
      cause.status === 429 && declared.includes("RATE_LIMITED") ? "RATE_LIMITED"
        : cause.status === 409 && declared.includes("CONFLICT") ? "CONFLICT"
          : cause.status === 403 && declared.includes("PERMISSION_DENIED") ? "PERMISSION_DENIED"
            : "INTERNAL_ERROR"
    const code = exact ?? mapped ?? fallback
    const exposeMessage = exact !== null || mapped !== null || code !== "INTERNAL_ERROR"
    return new RpcApplicationError(
      code,
      exposeMessage ? cause.message : "Agent 内部错误",
      cause.status === 429 || cause.status >= 500,
      safeErrorDetails(cause.details),
    )
  }

  private requireConnection(context: RpcRouterContext) {
    const connectionId = context.connectionId
    if (!connectionId || !this.connections.get(connectionId)?.initialized) {
      throw new AgentError("UNAUTHORIZED", "RPC 连接尚未完成 initialized 握手", 401)
    }
    return connectionId
  }

  private requiredSnapshot(threadId: string) {
    const snapshot = this.projection.snapshot(threadId)
    if (!snapshot) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    return snapshot
  }

  private threadSnapshotResult(threadId: string) {
    const snapshot = this.requiredSnapshot(threadId)
    const sequence = (this.dependencies.db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(threadId) as { id: number }).id
    return { snapshot, streamPosition: { streamId: threadId, sequence } }
  }

  private queueStateResult(threadId: string, eventID?: number) {
    const snapshot = this.requiredSnapshot(threadId)
    const metadata = this.dependencies.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null }
    const sequence = eventID ?? (this.dependencies.db.sqlite.query("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE thread_id = ?").get(threadId) as { id: number }).id
    return {
      threadId,
      version: metadata.version,
      pauseReason: metadata.pauseReason,
      turns: snapshot.turns,
      inputs: snapshot.inputs,
      streamPosition: { streamId: threadId, sequence },
    }
  }

  private loadCatalogSource() {
    if (this.catalogSource) return this.catalogSource
    const { providers } = this.dependencies
    this.catalogSource = Promise.all([providers.list(), providers.models()]).then(([providerInfos, models]) => {
      const modelsByProvider = new Map<string, Model.Info[]>()
      for (const model of models) {
        const group = modelsByProvider.get(model.providerID) ?? []
        group.push(model)
        modelsByProvider.set(model.providerID, group)
      }
      return {
        providers: providerInfos,
        models,
        modelsByProvider: modelsByProvider as ReadonlyMap<string, readonly Model.Info[]>,
      }
    }).catch((cause) => {
      this.catalogSource = null
      throw cause
    })
    return this.catalogSource
  }

  private invalidateCatalogSource() {
    this.catalogSource = null
    this.modelPageCache.clear()
  }

  private async configuredModels() {
    const source = await this.loadCatalogSource()
    const first = source.models.find((model) => model.enabled)
    const configuredDefault = this.dependencies.db.getSetting<Model.Ref>("defaultModel")
    const configuredReviewer = this.dependencies.db.getSetting<Model.Ref>("reviewerModel")
    const available = (ref: Model.Ref | null) => {
      if (!ref) return null
      const match = source.modelsByProvider.get(ref.providerID)?.find((model) => model.id === ref.id)
      if (!match || !match.enabled) return null
      if (ref.variant && !match.variants.some((variant) => variant.id === ref.variant)) return null
      return ref
    }
    return {
      defaultModel: available(configuredDefault) ?? (first ? { providerID: first.providerID, id: first.id } : null),
      reviewerModel: available(configuredReviewer),
    }
  }

  private async providerList() {
    const source = await this.loadCatalogSource()
    return {
      providers: [...source.providers],
      ...await this.configuredModels(),
      catalogVersion: this.catalogVersion,
    }
  }

  private normalizedModelQuery(params: Record<string, unknown>) {
    const filters = {
      ...(typeof params.providerId === "string" ? { providerId: params.providerId } : {}),
      ...(typeof params.query === "string" && params.query.trim() ? { query: params.query.trim().toLowerCase() } : {}),
      ...(typeof params.enabled === "boolean" ? { enabled: params.enabled } : {}),
      ...(typeof params.inputModality === "string" && params.inputModality ? { inputModality: params.inputModality } : {}),
      ...(typeof params.outputModality === "string" && params.outputModality ? { outputModality: params.outputModality } : {}),
    }
    return {
      filters,
      ...(typeof params.cursor === "string" ? { cursor: params.cursor } : {}),
      ...(typeof params.limit === "number" ? { limit: Math.max(1, Math.min(100, Math.trunc(params.limit))) } : {}),
    }
  }

  private async modelCatalog(params: Record<string, unknown> = {}) {
    const query = this.normalizedModelQuery(params)
    const legacyFullCatalog = Object.keys(query.filters).length === 0 && query.limit === undefined && query.cursor === undefined
    if (legacyFullCatalog) return this.buildModelCatalog(query)
    const key = JSON.stringify({ version: this.catalogVersion, ...query })
    const cached = this.modelPageCache.get(key)
    if (cached) return cached
    const pending = this.buildModelCatalog(query).catch((cause) => {
      this.modelPageCache.delete(key)
      throw cause
    })
    this.modelPageCache.set(key, pending)
    return pending
  }

  private async buildModelCatalog(query: ReturnType<RpcRouter["normalizedModelQuery"]>) {
    const source = await this.loadCatalogSource()
    const filterHash = createHash("sha256").update(JSON.stringify(query.filters)).digest("base64url").slice(0, 16)
    let offset = 0
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as { version?: unknown; filter?: unknown; offset?: unknown }
        if (decoded.version !== this.catalogVersion || decoded.filter !== filterHash || !Number.isInteger(decoded.offset) || Number(decoded.offset) < 0) throw new Error("expired")
        offset = Number(decoded.offset)
      } catch {
        throw new AgentError("CURSOR_EXPIRED", "模型目录游标已失效，请重新查询", 409)
      }
    }

    const matches = source.models.filter((model) => {
      const { filters } = query
      if (filters.providerId !== undefined && model.providerID !== filters.providerId) return false
      if (filters.query !== undefined && !model.id.toLowerCase().includes(filters.query) && !model.name.toLowerCase().includes(filters.query)) return false
      if (filters.enabled !== undefined && model.enabled !== filters.enabled) return false
      if (filters.inputModality !== undefined && !model.capabilities.input.includes(filters.inputModality)) return false
      if (filters.outputModality !== undefined && !model.capabilities.output.includes(filters.outputModality)) return false
      return true
    })
    const page = query.limit === undefined ? matches : matches.slice(offset, offset + query.limit)
    const pageByProvider = new Map<string, Model.Info[]>()
    for (const model of page) {
      const group = pageByProvider.get(model.providerID) ?? []
      group.push(model)
      pageByProvider.set(model.providerID, group)
    }
    const nextOffset = offset + page.length
    const hasFilters = Object.keys(query.filters).length > 0
    return {
      providers: source.providers
        .filter((provider) => !hasFilters || pageByProvider.has(provider.id) || query.filters.providerId === provider.id)
        .map((provider) => ({ provider, models: pageByProvider.get(provider.id) ?? [] })),
      ...await this.configuredModels(),
      catalogVersion: this.catalogVersion,
      ...(query.limit === undefined ? {} : { total: matches.length }),
      ...(query.limit !== undefined && nextOffset < matches.length
        ? { nextCursor: Buffer.from(JSON.stringify({ version: this.catalogVersion, filter: filterHash, offset: nextOffset })).toString("base64url") }
        : {}),
    }
  }

  private async publishCatalogUpdated(invalidateSource = true) {
    if (invalidateSource) this.invalidateCatalogSource()
    this.catalogVersion += 1
    this.modelPageCache.clear()
    const catalog = await this.modelCatalog()
    await this.emit("catalog/updated", {
      catalogVersion: catalog.catalogVersion,
    })
    return catalog
  }

  private async requiredIntegration(integrationID: string) {
    const integration = (await this.dependencies.integrations.list()).find((item) => item.id === integrationID)
    if (!integration) throw new AgentError("INTEGRATION_NOT_FOUND", `未找到认证集成 ${integrationID}`, 404)
    return integration
  }

  private async emit(method: string, params: unknown) {
    await publishAgentEvent(this.dependencies.db, this.dependencies.hub, null, null, method, params)
  }

  private async emitIntegration(method: string, integrationID: string) {
    const integration = (await this.dependencies.integrations.list()).find((item) => item.id === integrationID)
    if (integration) await this.emit(method, { integrationId: integration.id })
  }
}

const isInitializedNotification = (input: unknown): input is Record<string, unknown> =>
  Boolean(input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>).method === "initialized")

const isRpcMethod = (input: unknown, method: string) =>
  Boolean(input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>).method === method)

const rpcMethodOf = (input: unknown): RpcMethod | null => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const method = (input as Record<string, unknown>).method
  return typeof method === "string" && method in RpcMethods ? method as RpcMethod : null
}

const WORKSPACE_FILE_APPLICATION_ERROR_CODES: Readonly<Record<string, ApplicationErrorCode>> = {
  WORKSPACE_PATH_DENIED: "PATH_DENIED",
  WORKSPACE_PATH_NOT_FOUND: "FILE_NOT_FOUND",
  WORKSPACE_NOT_FILE: "FILE_NOT_TEXT",
  WORKSPACE_FILE_UNREADABLE: "FILE_NOT_TEXT",
  WORKSPACE_FILE_TOO_LARGE: "FILE_TOO_LARGE",
  WORKSPACE_FILE_READONLY: "FILE_READONLY",
}

const workspaceFileApplicationErrorCode = (
  method: RpcMethod,
  causeCode: string,
  declared: readonly string[],
): ApplicationErrorCode | null => {
  if (!method.startsWith("workspace/file/")) return null
  const mapped = WORKSPACE_FILE_APPLICATION_ERROR_CODES[causeCode]
  return mapped && declared.includes(mapped) ? mapped : null
}

const unauthorizedRequestResponse = (input: unknown) => {
  const id = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).id
    : null
  return {
    jsonrpc: "2.0" as const,
    id: typeof id === "string" || typeof id === "number" ? id : null,
    error: {
      code: RPC_APPLICATION_ERROR,
      message: "RPC 连接尚未完成 initialized 握手",
      data: { code: "UNAUTHORIZED" as const, retryable: false },
    },
  }
}

const capabilityRequiredResponse = (input: unknown, capability: string) => {
  const id = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).id
    : null
  return {
    jsonrpc: "2.0" as const,
    id: typeof id === "string" || typeof id === "number" ? id : null,
    error: {
      code: RPC_APPLICATION_ERROR,
      message: `RPC 连接未协商 capability：${capability}`,
      data: {
        code: "CAPABILITY_REQUIRED" as const,
        retryable: false,
        details: { capability },
      },
    },
  }
}

const unauthorizedNotificationResponse = () => ({
  jsonrpc: "2.0" as const,
  id: null,
  error: {
    code: RPC_APPLICATION_ERROR,
    message: "RPC connection is not initialized",
    data: { code: "UNAUTHORIZED" as const, retryable: false },
  },
})

const resolveAiReviewSource = async (
  review: GitReviewService,
  projectId: string,
  target: ReviewAiTarget,
): Promise<ReviewSource> => {
  if (target.type === "uncommittedChanges") {
    const [unstaged, staged] = await Promise.all([
      review.summary(projectId, { kind: "unstaged" }),
      review.summary(projectId, { kind: "staged" }),
    ])
    if (unstaged.totals.files > 0) return { kind: "unstaged" }
    if (staged.totals.files > 0) return { kind: "staged" }
    throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "当前没有可供审阅的未提交更改", 409)
  }
  const source: ReviewSource = target.type === "baseBranch"
    ? { kind: "branch", baseBranch: target.branch }
    : { kind: "commit", commitSha: target.sha }
  const snapshot = await review.summary(projectId, source)
  if (snapshot.totals.files === 0) throw new AgentError("REVIEW_SOURCE_UNAVAILABLE", "所选范围没有可供审阅的更改", 409)
  return source
}

const aiReviewModel = async (
  db: AgentDatabase,
  providers: AgentModelCatalog,
  threadId: string,
  projectId: string,
): Promise<Model.Ref> => {
  const latest = db.sqlite.query("SELECT model_ref FROM inputs WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(threadId) as { model_ref: string } | null
  let latestModel: Model.Ref | null = null
  if (latest?.model_ref) {
    try {
      latestModel = modelRef(record(JSON.parse(latest.model_ref), "model"))
    } catch {
      latestModel = null
    }
  }
  const candidates = [
    db.getSetting<Model.Ref>("reviewerModel"),
    latestModel,
    db.getProjectSettings(projectId)?.defaultModel,
    db.getSetting<Model.Ref>("defaultModel"),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await providers.resolve(candidate)
      return candidate
    } catch {
      // Try the next configured model.
    }
  }
  const first = (await providers.models()).find((candidate) => candidate.enabled)
  if (!first) throw new AgentError("MODEL_UNAVAILABLE", "没有可用于代码审查的模型", 409)
  return Model.Ref.make({ providerID: first.providerID, id: first.id })
}

const aiReviewTitle = (target: ReviewAiTarget) => {
  if (target.type === "baseBranch") return `代码审查 · ${target.branch}`
  if (target.type === "commit") return `代码审查 · ${target.title?.trim() || target.sha.slice(0, 8)}`
  return "代码审查 · 未提交更改"
}

const aiReviewPrompt = (target: ReviewAiTarget) => {
  const scope = target.type === "uncommittedChanges"
    ? "审查当前仓库所有未提交更改，包括已暂存、未暂存和未跟踪文件。"
    : target.type === "baseBranch"
      ? `审查当前工作树相对基础分支 ${target.branch} 的全部变更，先解析 merge-base。`
      : `审查提交 ${target.sha} 引入的变更。`
  return [
    "请执行一次严格、可操作的代码审查。不要修改文件。",
    "",
    "Review Guidelines:",
    "- 只报告会影响正确性、安全性、性能或可维护性的具体问题。",
    "- 每条 finding 必须说明触发条件、影响和最小修复方向，并按严重度排序。",
    "- 不要报告纯风格偏好，不要猜测无法从代码或仓库状态验证的问题。",
    "- 先检查真实 diff 和相关上下文；没有问题时明确说明未发现 actionable findings。",
    "- 每条可定位 finding 额外输出一行 directive：",
    '  ::code-comment{title="简短标题" body="问题和修复建议" file="仓库相对路径" start=行号 end=行号 priority=2}',
    "- priority 使用 0（阻断）、1（高）、2（中）、3（低）；行号必须来自变更后的文件。",
    "",
    `审查范围：${scope}`,
  ].join("\n")
}

const stringParam = (params: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = params[name]
    if (typeof value === "string" && value) return value
  }
  throw new AgentError("INVALID_REQUEST", `${names[0]} 参数无效`, 400)
}

const positiveIntegerParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (!Number.isInteger(value) || (value as number) <= 0) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as number
}

const githubRepositoryIdentity = (params: Record<string, unknown>) => ({
  owner: stringParam(params, "owner"),
  repository: stringParam(params, "repository"),
})

const githubPullRequestIdentity = (params: Record<string, unknown>) => ({
  ...githubRepositoryIdentity(params),
  number: positiveIntegerParam(params, "number"),
})

const attachmentView = (record: { id: string; kind: "text" | "image"; name: string; mimeType: string; size: number; sha256: string; createdAt: number }) => ({
  id: record.id,
  kind: record.kind,
  name: record.name,
  mediaType: record.mimeType,
  sizeBytes: record.size,
  sha256: record.sha256,
  createdAt: record.createdAt,
})

const modelRef = (value: Record<string, unknown>) => {
  if (typeof value.providerID !== "string" || typeof value.id !== "string") throw new AgentError("INVALID_REQUEST", "模型参数无效", 400)
  return Model.Ref.make({ providerID: Provider.ID.make(value.providerID), id: Model.ID.make(value.id), ...(typeof value.variant === "string" ? { variant: Model.VariantID.make(value.variant) } : {}) })
}

const modelRefOrNull = (value: unknown) => value == null ? null : modelRef(record(value, "model"))

const parseJsonRecord = (value: string) => {
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

const encodeOffsetCursor = (offset: number) => `offset:${offset}`
const decodeOffsetCursor = (value: unknown) => {
  if (value === undefined) return 0
  if (typeof value !== "string" || !/^offset:\d+$/.test(value)) {
    throw new AgentError("INVALID_REQUEST", "cursor 参数无效", 400)
  }
  return Number(value.slice("offset:".length))
}

const safeErrorDetails = (value: unknown): JsonValue | undefined => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return value.length <= 500 && !/token|authorization|secret|credential/i.test(value) ? value : undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const safe = Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (/token|authorization|secret|credential|environment|stack|path/i.test(key)) return []
    if (entry === null || typeof entry === "boolean" || typeof entry === "number") return [[key, entry]]
    if (typeof entry === "string" && entry.length <= 500 && !/token|authorization|secret|credential/i.test(entry)) return [[key, entry]]
    return []
  }))
  return Object.keys(safe).length ? safe as JsonValue : undefined
}

const providerSetting = (params: Record<string, unknown>): { id: string; config: ProviderConfig } => {
  const id = stringParam(params, "providerId")
  const settings = record(params.settings, "settings")
  if (Array.isArray(params.sensitiveHeaders) && params.sensitiveHeaders.length > 0) {
    throw new AgentError(
      "PROVIDER_UNAVAILABLE",
      "敏感 Header 不能写入 Provider 设置，请通过对应 Integration 凭据配置",
      409,
    )
  }
  const headers = settings.headers && typeof settings.headers === "object" && !Array.isArray(settings.headers)
    ? settings.headers as Record<string, string>
    : undefined
  const models = settings.models && typeof settings.models === "object" && !Array.isArray(settings.models)
    ? settings.models as ProviderConfig["models"]
    : undefined
  return {
    id,
    config: {
      ...(typeof settings.name === "string" ? { name: settings.name } : {}),
      ...(typeof settings.disabled === "boolean" ? { disabled: settings.disabled } : {}),
      ...(typeof settings.api === "string" ? { api: settings.api } : {}),
      ...(typeof settings.npm === "string" ? { npm: settings.npm } : {}),
      ...(Array.isArray(settings.env) ? { env: settings.env as string[] } : {}),
      ...(settings.options && typeof settings.options === "object" && !Array.isArray(settings.options)
        ? { options: settings.options as Record<string, unknown> }
        : {}),
      ...(settings.body && typeof settings.body === "object" && !Array.isArray(settings.body)
        ? { body: settings.body as Record<string, unknown> }
        : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(Array.isArray(settings.whitelist) ? { whitelist: settings.whitelist as string[] } : {}),
      ...(Array.isArray(settings.blacklist) ? { blacklist: settings.blacklist as string[] } : {}),
      ...(models ? { models } : {}),
    },
  }
}

const providerFailureCategory = (
  cause: unknown,
): "authentication" | "configuration" | "network" | "rate-limit" | "unknown" => {
  if (cause instanceof AgentError) {
    if (cause.status === 401 || cause.status === 403) return "authentication"
    if (cause.status === 429) return "rate-limit"
    if (cause.status >= 400 && cause.status < 500) return "configuration"
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/auth|credential|api.?key|token|unauthor/i.test(message)) return "authentication"
  if (/network|fetch|socket|timeout|dns|connect/i.test(message)) return "network"
  if (/rate.?limit|too many requests|429/i.test(message)) return "rate-limit"
  return "unknown"
}

import {
  PermissionConfigSchema,
  ThreadSettingsPatchSchema,
  ThreadSettingsSchema,
  TurnStartParamsSchema,
  QueueUpdateParamsSchema,
  QueueInputParamsSchema,
  QueueReorderParamsSchema,
  QueueResumeParamsSchema,
  type PermissionConfig,
} from "@codepilotx/shared/thread"
import { SandboxUninstallParamsSchema } from "@codepilotx/agent-protocol"
import { Effect, Schema } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
import { createHash } from "node:crypto"
import type { ProviderConfig } from "@codepilotx/provider-runtime"
import type { AgentModelCatalog } from "../../provider/AgentModelCatalog"
import { AgentError, type SendStrategy, type SubmitMessage, type TaskMode } from "../../domain"
import type { ApprovalService } from "../../permission/ApprovalService"
import type { QuestionService } from "../../session/QuestionService"
import type { IntegrationService } from "../../provider/IntegrationService"
import type { ApiKeyService } from "../../provider/ApiKeyService"
import type { ThreadHistoryService } from "../../session/ThreadHistoryService"
import type { ThreadService } from "../../session/ThreadService"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import type { EventHub } from "../../storage/events/EventHub"
import { globalEventSequence, publishAgentEvent } from "../../storage/events/EventPublisher"
import type { SandboxRuntimeAdapter } from "../../sandbox/SandboxRuntimeAdapter"
import type { SubagentService } from "../../subagent/SubagentService"
import type { AttachmentService } from "../../subagent/AttachmentService"
import type { ProjectSourceService } from "../../project/ProjectSourceService"
import { WorkspaceService } from "../../workspace/WorkspaceService"
import { InvalidThreadHistoryCursorError, ThreadProjection } from "../ThreadProjection"
import { projectMemoryKey, type MemoryService } from "../../memory/MemoryService"
import type { HookService } from "../../hooks/HookService"
import type { GitReviewService } from "../../review/GitReviewService"
import type { GithubService } from "../../github/GithubService"
import type { ToolingManager } from "../../tool/ToolingManager"
import type { PetService } from "../../pet/PetService"
import type { SkillManagementService } from "../../prompt/SkillManagementService"
import type { McpRuntimeService } from "../../mcp/McpRuntimeService"
import type { TaskSuggestionService } from "../../suggestion/TaskSuggestionService"
import type { ConfigService } from "../../config/ConfigService"
import { EventSubscriptionRegistry } from "../EventSubscriptionRegistry"
import { secretScrubber } from "../../security/SecretScrubber"
import { createRpcHandlerRegistry } from "./registry"
import type { RpcRouterContext } from "./request-context"
import { decodeRpcParams as decodeParams, optionalRpcRecord as optionalRecord, rpcRecord as record } from "./decoders"
import {
  capabilityRequiredResponse,
  unauthorizedNotificationResponse,
  unauthorizedRequestResponse,
  workspaceFileApplicationErrorCode,
} from "./errors"

export {
  Effect,
  Model,
  WorkspaceService,
  globalEventSequence,
  secretScrubber,
  AgentError,
  Capabilities,
  InvalidThreadHistoryCursorError,
}
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
  dispatchRpcMessage,
  type ApplicationErrorCode,
  type JsonValue,
  type RpcHandlers,
  type RpcMethod,
  type ReviewAiTarget,
  type ReviewSource,
} from "@codepilotx/agent-protocol"

export type RpcRouterDependencies = {
  config: ConfigService
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
  integrations: IntegrationService
  apiKeys: ApiKeyService
  memory: MemoryService
  hooks: HookService
  sandbox: SandboxRuntimeAdapter
  review: GitReviewService
  github: GithubService
  tooling: ToolingManager
  pets: PetService
  skills?: SkillManagementService
  mcp?: McpRuntimeService
  suggestions?: TaskSuggestionService
}

export type { RpcRouterContext } from "./request-context"

type ModelCatalogPage = {
  providers: Array<{ provider: Provider.Info; models: Model.Info[] }>
  defaultModel: Model.Ref | null
  reviewerModel: Model.Ref | null
  catalogVersion: number
  total?: number
  nextCursor?: string
}

export const enumValue = <T extends string>(value: unknown, allowed: readonly T[], name: string): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as T
}

export const decodeTurnStart = Schema.decodeUnknownSync(TurnStartParamsSchema)
export const decodeQueueUpdate = Schema.decodeUnknownSync(QueueUpdateParamsSchema)
export const decodeQueueInput = Schema.decodeUnknownSync(QueueInputParamsSchema)
export const decodeQueueReorder = Schema.decodeUnknownSync(QueueReorderParamsSchema)
export const decodeQueueResume = Schema.decodeUnknownSync(QueueResumeParamsSchema)
export const decodeThreadSettings = Schema.decodeUnknownSync(ThreadSettingsSchema)
export const decodeThreadSettingsPatch = Schema.decodeUnknownSync(ThreadSettingsPatchSchema)
export const decodePermissionConfig = Schema.decodeUnknownSync(PermissionConfigSchema)
export const decodeSandboxUninstall = Schema.decodeUnknownSync(SandboxUninstallParamsSchema)
export const decodeReviewSummary = Schema.decodeUnknownSync(ReviewSummaryParamsSchema)
export const decodeReviewFileDiff = Schema.decodeUnknownSync(ReviewFileDiffParamsSchema)
export const decodeReviewApply = Schema.decodeUnknownSync(ReviewApplyParamsSchema)
export const decodeReviewAiStart = Schema.decodeUnknownSync(ReviewAiStartParamsSchema)
export const decodeReviewBranches = Schema.decodeUnknownSync(ReviewBranchesParamsSchema)
export const decodeReviewCommit = Schema.decodeUnknownSync(ReviewCommitParamsSchema)
export const decodeReviewCommits = Schema.decodeUnknownSync(ReviewCommitsParamsSchema)
export const decodeReviewStatus = Schema.decodeUnknownSync(ReviewStatusParamsSchema)
export const decodeReviewCommentList = Schema.decodeUnknownSync(ReviewCommentListParamsSchema)
export const decodeReviewCommentSave = Schema.decodeUnknownSync(ReviewCommentSaveParamsSchema)
export const decodeReviewCommentID = Schema.decodeUnknownSync(ReviewCommentIDParamsSchema)

// The shared schema is the compatibility boundary. Do not collapse the Codex
// permission matrix back into a handful of renderer presets here.
export const supportedPermissionConfig = (value: PermissionConfig) => value

export const resolveMemoryProjectKey = async (db: AgentDatabase, params: Record<string, unknown>) => {
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
  return projectMemoryKey(projectID)
}

export const resolveMemoryProjectID = (db: AgentDatabase, params: Record<string, unknown>) => {
  if (typeof params.projectId === "string" && params.projectId) return params.projectId
  if (typeof params.threadId === "string" && params.threadId) {
    const projectId = db.threadProjectID(params.threadId)
    if (projectId) return projectId
  }
  throw new AgentError("PROJECT_NOT_FOUND", "项目记忆缺少已注册项目", 404)
}

export const memoryEntryView = (
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

export const resolveProjectWorkspace = async (db: AgentDatabase, projectId: string) => {
  const project = db.getProject(projectId)
  if (!project) throw new AgentError("PROJECT_NOT_FOUND", "项目不存在", 404)
  return WorkspaceService.open(project.rootPath)
}

export const submitMessage = (raw: unknown): SubmitMessage => {
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
  readonly workspaceFileWatchers = new Map<string, { close: () => void }>()
  catalogVersion = 1
  private catalogSource: Promise<{
    providers: readonly Provider.Info[]
    models: readonly Model.Info[]
    modelsByProvider: ReadonlyMap<string, readonly Model.Info[]>
  }> | null = null
  private readonly modelPageCache = new Map<string, Promise<ModelCatalogPage>>()
  private readonly handlers: RpcHandlers<RpcRouterContext>
  readonly connections = new Map<string, {
    initialized: boolean
    createdAt: number
    lastSeenAt: number
    capabilities: ReadonlySet<string>
  }>()
  private readonly connectionLeaseMs: number
  readonly now: () => number

  constructor(
    readonly dependencies: RpcRouterDependencies,
    options: { connectionLeaseMs?: number; now?: () => number } = {},
  ) {
    this.connectionLeaseMs = options.connectionLeaseMs ?? 60_000
    this.now = options.now ?? Date.now
    this.projection = new ThreadProjection(dependencies.db)
    this.subscriptions = new EventSubscriptionRegistry(dependencies.db)
    this.handlers = createRpcHandlerRegistry(
      this,
      (method, cause) => this.applicationError(method, cause),
    )
  }

  async handle(input: unknown, context: RpcRouterContext = {}) {
    if (context.connectionId) this.touchConnection(context.connectionId)
    else this.reapExpiredConnections()
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

  listPendingInteractions(rawParams: Record<string, unknown>) {
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

  async respondToInteraction(rawParams: Record<string, unknown>) {
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
    const kind = enumValue(response.kind, ["approval", "question", "hookTrust"] as const, "response.kind")
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
        const rawFeedback = response.feedback
        if (rawFeedback !== undefined && typeof rawFeedback !== "string") {
          throw new AgentError("INVALID_REQUEST", "response.feedback 参数无效", 400)
        }
        if (decision !== "deny" && rawFeedback?.trim()) {
          throw new AgentError("INVALID_REQUEST", "只有拒绝审批时才能提交调整意见", 400)
        }
        const trimmedFeedback = rawFeedback?.trim().slice(0, 4_000)
        const feedback = trimmedFeedback ? secretScrubber.scrubText(trimmedFeedback) : undefined
        const resolved = await approvals.respond(interactionId, decision === "allow-once" ? "allow" : "deny", feedback)
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

  requireConnection(context: RpcRouterContext) {
    const connectionId = context.connectionId
    if (!connectionId || !this.connections.get(connectionId)?.initialized) {
      throw new AgentError("UNAUTHORIZED", "RPC 连接尚未完成 initialized 握手", 401)
    }
    return connectionId
  }

  touchConnection(connectionId: string) {
    const now = this.now()
    this.reapExpiredConnections(now)
    const connection = this.connections.get(connectionId)
    if (!connection) return false
    connection.lastSeenAt = now
    return true
  }

  closeConnection(connectionId: string) {
    const deleted = this.connections.delete(connectionId)
    this.subscriptions.closeConnection(connectionId)
    return deleted
  }

  private reapExpiredConnections(now = this.now()) {
    for (const [connectionId, connection] of this.connections) {
      if (now - connection.lastSeenAt > this.connectionLeaseMs) this.closeConnection(connectionId)
    }
  }

  requiredSnapshot(threadId: string) {
    const snapshot = this.projection.snapshot(threadId)
    if (!snapshot) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    return snapshot
  }

  threadSnapshotResult(threadId: string) {
    const snapshot = this.requiredSnapshot(threadId)
    const sequence = globalEventSequence(this.dependencies.db)
    return { snapshot, streamPosition: { streamId: threadId, sequence } }
  }

  threadHistoryPageResult(threadId: string, params: { before?: string; limit?: number }) {
    return this.dependencies.db.transaction(() => {
      const page = this.projection.historyPage(threadId, params)
      if (!page) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
      const sequence = globalEventSequence(this.dependencies.db)
      return { ...page, streamPosition: { streamId: threadId, sequence } }
    })
  }

  queueStateResult(threadId: string, eventID?: number) {
    const snapshot = this.requiredSnapshot(threadId)
    const metadata = this.dependencies.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null }
    const sequence = Math.max(eventID ?? 0, globalEventSequence(this.dependencies.db))
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
    const config = this.dependencies.config.snapshot()
    const providerID = typeof config.model_provider === "string" ? config.model_provider : ""
    const taskModels = config.task_models && typeof config.task_models === "object" && !Array.isArray(config.task_models)
      ? config.task_models as Record<string, unknown>
      : {}
    const configuredDefault = providerID && typeof config.model === "string"
      ? { providerID, id: config.model } as Model.Ref
      : null
    const configuredReviewer = providerID && typeof taskModels.reviewer === "string"
      ? { providerID, id: taskModels.reviewer } as Model.Ref
      : null
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

  async providerList() {
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

  async modelCatalog(params: Record<string, unknown> = {}) {
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

  async publishCatalogUpdated(invalidateSource = true) {
    if (invalidateSource) this.invalidateCatalogSource()
    this.catalogVersion += 1
    this.modelPageCache.clear()
    const catalog = await this.modelCatalog()
    await this.emit("catalog/updated", {
      catalogVersion: catalog.catalogVersion,
    })
    return catalog
  }

  async requiredIntegration(integrationID: string) {
    const integration = (await this.dependencies.integrations.list()).find((item) => item.id === integrationID)
    if (!integration) throw new AgentError("INTEGRATION_NOT_FOUND", `未找到认证集成 ${integrationID}`, 404)
    return integration
  }

  async providerIntegrationID(providerID: string) {
    const provider = (await this.dependencies.providers.list()).find((item) => String(item.id) === providerID)
    return String(provider?.integrationID ?? providerID)
  }

  async emit(method: string, params: unknown) {
    await publishAgentEvent(this.dependencies.db, this.dependencies.hub, null, null, method, params)
  }

  async emitIntegration(method: string, integrationID: string) {
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

export const resolveAiReviewSource = async (
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

export const aiReviewModel = async (
  db: AgentDatabase,
  providers: AgentModelCatalog,
  configService: ConfigService,
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
  const project = db.getProject(projectId)
  const config = (await configService.read(
    project ? { cwd: project.rootPath } : {},
  )).config
  const taskModels = config.task_models && typeof config.task_models === "object" && !Array.isArray(config.task_models)
    ? config.task_models as Record<string, unknown>
    : {}
  const providerID = typeof config.model_provider === "string" ? config.model_provider : ""
  const configuredReviewer = providerID && typeof taskModels.reviewer === "string"
    ? { providerID, id: taskModels.reviewer } as Model.Ref
    : null
  const configuredDefault = providerID && typeof config.model === "string"
    ? { providerID, id: config.model } as Model.Ref
    : null
  const candidates = [
    configuredReviewer,
    latestModel,
    configuredDefault,
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

export const aiReviewTitle = (target: ReviewAiTarget) => {
  if (target.type === "baseBranch") return `代码审查 · ${target.branch}`
  if (target.type === "commit") return `代码审查 · ${target.title?.trim() || target.sha.slice(0, 8)}`
  return "代码审查 · 未提交更改"
}

export const aiReviewPrompt = (target: ReviewAiTarget) => {
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

export const stringParam = (params: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = params[name]
    if (typeof value === "string" && value) return value
  }
  throw new AgentError("INVALID_REQUEST", `${names[0]} 参数无效`, 400)
}

export const booleanParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (typeof value !== "boolean") throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value
}

export const positiveIntegerParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (!Number.isInteger(value) || (value as number) <= 0) throw new AgentError("INVALID_REQUEST", `${name} 参数无效`, 400)
  return value as number
}

export const githubRepositoryIdentity = (params: Record<string, unknown>) => ({
  owner: stringParam(params, "owner"),
  repository: stringParam(params, "repository"),
})

export const githubPullRequestIdentity = (params: Record<string, unknown>) => ({
  ...githubRepositoryIdentity(params),
  number: positiveIntegerParam(params, "number"),
})

export const attachmentView = (record: { id: string; kind: "text" | "image"; name: string; mimeType: string; size: number; sha256: string; createdAt: number }) => ({
  id: record.id,
  kind: record.kind,
  name: record.name,
  mediaType: record.mimeType,
  sizeBytes: record.size,
  sha256: record.sha256,
  createdAt: record.createdAt,
})

export const modelRef = (value: Record<string, unknown>) => {
  if (typeof value.providerID !== "string" || typeof value.id !== "string") throw new AgentError("INVALID_REQUEST", "模型参数无效", 400)
  return Model.Ref.make({ providerID: Provider.ID.make(value.providerID), id: Model.ID.make(value.id), ...(typeof value.variant === "string" ? { variant: Model.VariantID.make(value.variant) } : {}) })
}

export const modelRefOrNull = (value: unknown) => value == null ? null : modelRef(record(value, "model"))

export const parseJsonRecord = (value: string) => {
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

export const encodeOffsetCursor = (offset: number) => `offset:${offset}`
export const decodeOffsetCursor = (value: unknown) => {
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

export const providerSetting = (params: Record<string, unknown>): { id: string; config: ProviderConfig } => {
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

export const providerFailureCategory = (
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

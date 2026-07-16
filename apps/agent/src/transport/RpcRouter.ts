import {
  ApprovalRespondParamsSchema,
  PermissionConfigSchema,
  ThreadSettingsPatchSchema,
  ThreadSettingsSchema,
  TurnStartParamsSchema,
  SandboxUninstallParamsSchema,
  AgentRpcRequestSchema,
  type AgentRpcRequest,
  type AgentRpcResponse,
  type PermissionConfig,
} from "@codepilotx/shared/thread"
import { Effect, Schema } from "effect"
import { Model, Provider } from "@codepilotx/model-schema"
import type { ProviderConfig, ProviderRuntime } from "@codepilotx/provider-runtime"
import { AgentError, type SendStrategy, type SubmitMessage, type TaskMode } from "../domain"
import type { ApprovalService } from "../permission/ApprovalService"
import type { QuestionService } from "../session/QuestionService"
import type { IntegrationService } from "../provider/IntegrationService"
import type { ThreadHistoryService } from "../session/ThreadHistoryService"
import type { ThreadService } from "../session/ThreadService"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"
import type { SandboxRuntimeAdapter } from "../sandbox/SandboxRuntimeAdapter"
import type { SubagentService } from "../subagent/SubagentService"
import type { AttachmentService } from "../subagent/AttachmentService"
import { WorkspaceService } from "../workspace/WorkspaceService"
import { ThreadProjection } from "./ThreadProjection"
import { projectMemoryKey, type MemoryService } from "../memory/MemoryService"
import type { HookService } from "../hooks/HookService"

export type RpcRouterDependencies = {
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
const decodeThreadSettings = Schema.decodeUnknownSync(ThreadSettingsSchema)
const decodeThreadSettingsPatch = Schema.decodeUnknownSync(ThreadSettingsPatchSchema)
const decodeApprovalRespond = Schema.decodeUnknownSync(ApprovalRespondParamsSchema)
const decodePermissionConfig = Schema.decodeUnknownSync(PermissionConfigSchema)
const decodeRpcRequest = Schema.decodeUnknownSync(AgentRpcRequestSchema)
const decodeSandboxUninstall = Schema.decodeUnknownSync(SandboxUninstallParamsSchema)

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

  constructor(private readonly dependencies: RpcRouterDependencies) {
    this.projection = new ThreadProjection(dependencies.db)
  }

  async handle(input: unknown) {
    if (Array.isArray(input)) return Promise.all(input.map((request) => this.handleSingle(request)))
    return this.handleSingle(input)
  }

  private async handleSingle(input: unknown): Promise<AgentRpcResponse | null> {
    const request = decodeParams(decodeRpcRequest, input, "request") as AgentRpcRequest
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new AgentError("INVALID_RPC", "JSON-RPC 请求无效", 400)
    if (request.id === undefined) {
      await this.dispatch(request.method, request.params)
      return null
    }
    try {
      const result = await this.dispatch(request.method, request.params)
      return { jsonrpc: "2.0", id: request.id, result }
    } catch (cause) {
      const error = cause instanceof AgentError ? cause : new AgentError("INTERNAL_ERROR", cause instanceof Error ? cause.message : "未知错误", 500)
      return { jsonrpc: "2.0", id: request.id, error: { code: error.status, message: error.message, data: { code: error.code, details: error.details } } }
    }
  }

  private async dispatch(method: string, rawParams: unknown): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, memory, sandbox } = this.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "initialize":
        db.sqlite.query("SELECT 1").get()
        return { ok: true, service: "codepilotx-agent", version: "0.1.0", pid: process.pid, readyAt: Date.now(), protocol: "thread-rpc-v2", capabilities: { agentExecutions: 1, subagents: 1, attachments: 1, prompt: 2, memory: 2, compact: 1, hookTrust: 1 } }
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
        return { ok: true }
      case "desktop/settings/get":
        return { settings: db.getSetting<Record<string, unknown>>("desktop.settings.v1") }
      case "desktop/settings/save": {
        const settings = record(params.settings, "settings")
        db.setSetting("desktop.settings.v1", settings)
        return { settings }
      }
      case "project/list":
        return { projects: db.listProjects() }
      case "project/open": {
        if (typeof params.rootPath !== "string" || !params.rootPath.trim()) throw new AgentError("INVALID_REQUEST", "rootPath 参数无效", 400)
        const workspace = await WorkspaceService.open(params.rootPath)
        return { project: db.createProject({ rootPath: workspace.rootPath }) }
      }
      case "project/updateSettings": {
        const projectId = stringParam(params, "projectId")
        const settings = record(params.settings, "settings")
        return { settings: db.saveProjectSettings(projectId, {
          defaultModel: modelRefOrNull(settings.defaultModel),
        }) }
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
        return this.requiredSnapshot(created.id)
      }
      case "thread/read":
        return this.requiredSnapshot(stringParam(params, "threadId"))
      case "prompt/preview": {
        const threadId = stringParam(params, "threadId")
        const preview = await threads.promptPreview(threadId)
        if (!preview) throw new AgentError("PROMPT_PREVIEW_UNAVAILABLE", "该任务尚未建立新提示词 baseline", 409)
        return { threadId, preview }
      }
      case "prompt/refresh":
        return { threadId: stringParam(params, "threadId"), settings: threads.refreshPromptSettings(stringParam(params, "threadId")) }
      case "thread/compact":
        return { compaction: await threads.compact(stringParam(params, "threadId")) }
      case "memory/list": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        return { entries: memory.list({ scope, ...(projectKey ? { projectKey } : {}), limit: typeof params.limit === "number" ? params.limit : 100 }) }
      }
      case "memory/read": {
        const id = stringParam(params, "id")
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.read({ id, scope, ...(projectKey ? { projectKey } : {}) })
        if (!entry) throw new AgentError("MEMORY_NOT_FOUND", "记忆不存在或记忆功能未启用", 404)
        return { entry }
      }
      case "memory/save": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.remember({ scope, content: stringParam(params, "content"), ...(typeof params.id === "string" && params.id ? { id: params.id } : {}), ...(projectKey ? { projectKey } : {}) })
        if (!entry) throw new AgentError("MEMORY_REJECTED", "记忆功能未启用、内容为空或包含敏感信息", 409)
        return { entry }
      }
      case "memory/delete": {
        const id = stringParam(params, "id")
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        return { deleted: memory.delete({ id, scope, ...(projectKey ? { projectKey } : {}) }) }
      }
      case "memory/reset": {
        const scope = enumValue(params.scope, ["user", "project"] as const, "scope")
        const projectKey = scope === "project" ? await resolveMemoryProjectKey(db, params) : undefined
        return { deleted: memory.reset({ scope, ...(projectKey ? { projectKey } : {}), includeEventLog: params.includeEventLog === true }) }
      }
      case "subagent/list":
        return { subagents: subagents.list(stringParam(params, "threadId", "parentThreadId")) }
      case "subagent/read": {
        const value = subagents.read(stringParam(params, "taskId", "subagentTaskId"))
        return {
          ...value,
          snapshot: this.requiredSnapshot(value.task.childThreadId),
          capabilities: {
            canSend: true,
            canStop: Boolean(value.currentRun && !["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canRetry: Boolean(value.currentRun && ["failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canRespondToApprovals: true,
            canRespondToQuestions: true,
            canSubmitPlanDecision: false,
            canApplyWorktree: value.task.workspace.mode === "worktree" && value.task.workspace.state !== "applied" && value.task.workspace.state !== "discarded" && Boolean(value.currentRun && ["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
            canDiscardWorktree: value.task.workspace.mode === "worktree" && value.task.workspace.state !== "applied" && value.task.workspace.state !== "discarded",
            canRestoreWorkspace: value.task.workspace.mode === "shared" && value.task.workspace.baselineRef !== null && Boolean(value.currentRun && ["completed", "failed", "stopped", "interrupted"].includes(value.currentRun.status)),
          },
        }
      }
      case "subagent/send":
        return subagents.send(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "message"), stringParam(params, "requestId"), {
          ...(params.model === undefined ? {} : { model: modelRef(record(params.model, "model")) }),
          ...(params.permissionConfig === undefined ? {} : { permissionConfig: supportedPermissionConfig(decodeParams(decodePermissionConfig, params.permissionConfig, "permissionConfig")) }),
          ...(Array.isArray(params.attachmentIds) ? { attachmentIDs: params.attachmentIds.map((value) => {
            if (typeof value !== "string" || !value) throw new AgentError("INVALID_REQUEST", "attachmentIds 参数无效", 400)
            return value
          }) } : {}),
        })
      case "subagent/stop":
        return subagents.stop(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "requestId"))
      case "subagent/retry":
        return subagents.retry(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "requestId"))
      case "subagent/worktree/diff":
        return { diff: await subagents.worktreeDiff(stringParam(params, "taskId", "subagentTaskId")) }
      case "subagent/worktree/apply":
        return { result: await subagents.worktreeApply(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "requestId")) }
      case "subagent/worktree/discard":
        return { result: await subagents.worktreeDiscard(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "requestId")) }
      case "subagent/workspace/restore":
        return { result: await subagents.workspaceRestore(stringParam(params, "taskId", "subagentTaskId"), stringParam(params, "requestId")) }
      case "thread/update": {
        const threadId = stringParam(params, "threadId")
        const title = params.title
        const archived = params.archived
        if (title !== undefined && title !== null && typeof title !== "string") throw new AgentError("INVALID_REQUEST", "title 参数无效", 400)
        if (archived !== undefined && typeof archived !== "boolean") throw new AgentError("INVALID_REQUEST", "archived 参数无效", 400)
        const thread = await history.patch(threadId, { ...(title !== undefined ? { title } : {}), ...(archived !== undefined ? { archived } : {}) })
        return { thread }
      }
      case "thread/settings/update": {
        const threadId = stringParam(params, "threadId")
        const settings = decodeParams(decodeThreadSettingsPatch, params.settings, "thread/settings/update.settings")
        if (settings.permissionConfig) supportedPermissionConfig(settings.permissionConfig)
        return history.patchSettings(threadId, settings)
      }
      case "thread/delete":
        await history.remove(stringParam(params, "threadId"))
        return { ok: true }
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
        const submitted = await threads.submit(threadId, submitMessage(start))
        if (attachmentIds.length) await attachments.bind(attachmentIds, { type: "input", id: submitted.inputID })
        const snapshot = this.requiredSnapshot(threadId)
        return { input: snapshot.inputs.find((input) => input.id === submitted.inputID), turn: snapshot.turns.find((turn) => turn.id === submitted.turnID) ?? null }
      }
      case "turn/interrupt":
        await threads.stop(stringParam(params, "threadId"))
        return { ok: true }
      case "turn/resume":
        threads.resumeTurn(stringParam(params, "threadId"), stringParam(params, "turnId"))
        return { ok: true }
      case "turn/submitPlanDecision": {
        const result = await threads.submitPlanDecision(stringParam(params, "turnId"), enumValue(params.decision, ["continue", "reject"] as const, "decision"))
        if (!result) throw new AgentError("PLAN_DECISION_NOT_AVAILABLE", "当前规划不等待确认", 409)
        return { ...result, threadId: result.threadID, turnId: result.turnID }
      }
      case "approval/respond": {
        const approval = decodeParams(decodeApprovalRespond, rawParams, "approval/respond")
        const decision = approval.decision
        if (decision === "stop") {
          const row = db.sqlite.query("SELECT thread_id, agent_id FROM approval_requests WHERE id = ?").get(approval.approvalId) as { thread_id: string; agent_id: string } | null
          if (!row) throw new AgentError("APPROVAL_NOT_FOUND", "权限请求不存在", 404)
          const execution = db.getAgentExecution(row.agent_id)
          if (execution?.subagentRunID) {
            const task = db.sqlite.query("SELECT task_id FROM subagent_runs WHERE id = ?").get(execution.subagentRunID) as { task_id: string } | null
            if (!task) throw new AgentError("SUBAGENT_NOT_FOUND", "子 Agent 不存在", 404)
            await subagents.stop(task.task_id, crypto.randomUUID())
          } else {
            await threads.stop(row.thread_id)
          }
        } else {
          const checkpoint = await approvals.respond(approval.approvalId, decision === "allow-once" ? "allow" : "deny")
          const execution = db.getAgentExecution(checkpoint.agentID)
          if (execution?.subagentRunID) await subagents.resumeTurn(checkpoint.threadID, checkpoint.turnID)
          else threads.resumeTurn(checkpoint.threadID, checkpoint.turnID)
        }
        return { ok: true }
      }
      case "hook/trust/respond": {
        const requestId = stringParam(params, "requestId", "id")
        const decision = enumValue(params.decision, ["allow", "block"] as const, "decision")
        const result = db.resolveHookTrustRequest(requestId, decision)
        if (result.state === "missing" || !result.request) throw new AgentError("HOOK_TRUST_NOT_FOUND", "Hook 信任请求不存在", 404)
        for (const event of result.events) await Effect.runPromise(this.dependencies.hub.publish(event))
        for (const resumed of result.resumed) {
          const execution = db.getAgentExecution(resumed.agentID)
          if (execution?.subagentRunID) await subagents.resumeTurn(resumed.threadID, resumed.turnID)
          else threads.resumeHookTrust(resumed.threadID, resumed.turnID)
        }
        return { request: result.request }
      }
      case "question/respond":
        await questions.reply(stringParam(params, "questionId"), params.ignored === true ? null : params.answer, params.ignored === true)
        return { ok: true }
      case "attachment/import": {
        if (!Array.isArray(params.attachments)) throw new AgentError("INVALID_REQUEST", "attachments 参数无效", 400)
        const uploads = params.attachments.map((entry) => {
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
        return { attachment: attachmentView(value.record), data: value.record.kind === "text" ? new TextDecoder().decode(value.data) : Buffer.from(value.data).toString("base64"), encoding: value.record.kind === "text" ? "utf8" : "base64" }
      }
      case "model/list":
        return this.modelCatalog()
      case "model/refresh":
        await providers.refresh(true)
        await this.emit("catalog/updated", await this.modelCatalog())
        return this.modelCatalog()
      case "model/setDefault": {
        const model = modelRef(params)
        await providers.resolve(model)
        db.setSetting("defaultModel", model)
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      }
      case "model/setReviewer": {
        if (params.providerID === null && params.id === null) {
          db.setSetting("reviewerModel", null)
          return { ok: true }
        }
        const model = modelRef(params)
        await providers.resolve(model)
        db.setSetting("reviewerModel", model)
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      }
      case "provider/test": {
        const providerID = stringParam(params, "providerID", "providerId")
        const model = (await providers.models()).find((item) => item.providerID === providerID)
        if (!model) throw new AgentError("PROVIDER_UNAVAILABLE", `Provider ${providerID} 当前不可用`, 409)
        await providers.getLanguage({ providerID: model.providerID, id: model.id })
        return { ok: true, message: `Provider ${providerID} 已可解析` }
      }
      case "provider/updateSettings": {
        const setting = providerSetting(params)
        db.setProviderSettings(setting.id, setting.config)
        await providers.reload()
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      }
      case "integration/list":
        return { integrations: await integrations.list() }
      case "integration/connect":
        await integrations.connect({
          integrationID: stringParam(params, "integrationID"),
          key: stringParam(params, "key"),
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        await providers.reload()
        await this.emitIntegration("integration/updated", stringParam(params, "integrationID"))
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      case "integration/authorize": {
        const inputs = optionalRecord(params.inputs)
        const values = Object.fromEntries(Object.entries(inputs).map(([key, value]) => {
          if (typeof value !== "string") throw new AgentError("INVALID_REQUEST", `inputs.${key} 参数无效`, 400)
          return [key, value]
        }))
        const attempt = await integrations.authorize({
          integrationID: stringParam(params, "integrationID"),
          methodID: stringParam(params, "methodID"),
          inputs: values,
          ...(typeof params.label === "string" ? { label: params.label } : {}),
        })
        return { attempt }
      }
      case "integration/authorizeComplete":
        const completedAttemptID = stringParam(params, "attemptID")
        const connection = await integrations.complete({ attemptID: completedAttemptID, ...(typeof params.code === "string" ? { code: params.code } : {}) })
        const completedContext = integrations.attemptContext(completedAttemptID)
        await providers.reload()
        await this.emit("integration/authorizationCompleted", {
          attemptID: completedAttemptID,
          integrationID: completedContext.integrationID,
          connection,
        })
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      case "integration/authorizeStatus": {
        const attemptID = stringParam(params, "attemptID")
        const status = await integrations.status(attemptID)
        const context = integrations.attemptContext(attemptID)
        if (status.status === "complete") {
          await providers.reload()
          await this.emit("integration/authorizationCompleted", {
            attemptID,
            integrationID: context.integrationID,
            ...(context.connection === undefined ? {} : { connection: context.connection }),
          })
          await this.emit("catalog/updated", await this.modelCatalog())
        }
        if (status.status === "failed") {
          await this.emit("integration/authorizationFailed", {
            attemptID,
            integrationID: context.integrationID,
            message: status.message,
          })
        }
        return { status }
      }
      case "integration/disconnect":
        await integrations.disconnect({ integrationID: stringParam(params, "integrationID"), credentialID: stringParam(params, "credentialID") })
        await providers.reload()
        await this.emitIntegration("integration/updated", stringParam(params, "integrationID"))
        await this.emit("catalog/updated", await this.modelCatalog())
        return { ok: true }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  }

  private requiredSnapshot(threadId: string) {
    const snapshot = this.projection.snapshot(threadId)
    if (!snapshot) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
    return snapshot
  }

  private async modelCatalog() {
    const { db, providers } = this.dependencies
    const providerInfos = await providers.list()
    const models = await providers.models()
    const catalog = providerInfos.map((provider) => ({ provider, models: models.filter((model) => model.providerID === provider.id) }))
    const first = models.find((model) => model.enabled)
    const configuredDefault = db.getSetting<Model.Ref>("defaultModel")
    const configuredReviewer = db.getSetting<Model.Ref>("reviewerModel")
    const available = async (ref: Model.Ref | null) => {
      if (!ref) return null
      try { await providers.resolve(ref); return ref } catch { return null }
    }
    return {
      providers: catalog,
      defaultModel: await available(configuredDefault) ?? (first ? { providerID: first.providerID, id: first.id } : null),
      reviewerModel: await available(configuredReviewer),
    }
  }

  private async emit(method: string, params: unknown) {
    const event = this.dependencies.db.insertEvent(null, null, method, params)
    await Effect.runPromise(this.dependencies.hub.publish(event))
  }

  private async emitIntegration(method: string, integrationID: string) {
    const integration = (await this.dependencies.integrations.list()).find((item) => item.id === integrationID)
    if (integration) await this.emit(method, { integration })
  }
}

const stringParam = (params: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = params[name]
    if (typeof value === "string" && value) return value
  }
  throw new AgentError("INVALID_REQUEST", `${names[0]} 参数无效`, 400)
}

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

const providerSetting = (params: Record<string, unknown>): { id: string; config: ProviderConfig } => {
  const provider = record(params.provider, "provider")
  const id = stringParam(provider, "id")
  const api = record(provider.api, "provider.api")
  const request = record(provider.request, "provider.request")
  const headers = request.headers && typeof request.headers === "object" && !Array.isArray(request.headers)
    ? request.headers as Record<string, string>
    : {}
  const forbidden = Object.keys(headers).find((name) => ["authorization", "x-api-key", "api-key"].includes(name.toLowerCase()))
  if (forbidden) throw new AgentError("SENSITIVE_HEADER_REJECTED", `Provider 设置不能保存敏感 Header：${forbidden}`, 400)
  const models = Array.isArray(params.models) ? params.models : []
  return {
    id,
    config: {
      ...(typeof provider.name === "string" ? { name: provider.name } : {}),
      ...(typeof api.url === "string" ? { api: api.url } : {}),
      ...(typeof api.package === "string" ? { npm: api.package } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      models: Object.fromEntries(models.flatMap((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
        const model = raw as Record<string, unknown>
        if (typeof model.id !== "string") return []
        return [[model.id, { id: typeof record(model.api, "model.api").id === "string" ? record(model.api, "model.api").id as string : model.id, name: typeof model.name === "string" ? model.name : model.id, enabled: model.enabled !== false }]]
      })),
    },
  }
}

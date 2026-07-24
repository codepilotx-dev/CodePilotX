import type { RpcMethod } from "@codepilotx/agent-protocol"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import { decodeRpcParams as decodeParams, optionalRpcRecord as optionalRecord, rpcRecord as record } from "../decoders"
import {
  AgentError,
  Capabilities,
  Effect,
  InvalidThreadHistoryCursorError,
  Model,
  WorkspaceService,
  globalEventSequence,
  secretScrubber,
  aiReviewModel,
  aiReviewPrompt,
  aiReviewTitle,
  attachmentView,
  booleanParam,
  decodeOffsetCursor,
  decodePermissionConfig,
  decodeQueueInput,
  decodeQueueReorder,
  decodeQueueResume,
  decodeQueueUpdate,
  decodeReviewAiStart,
  decodeReviewApply,
  decodeReviewBranches,
  decodeReviewCommentID,
  decodeReviewCommentList,
  decodeReviewCommentSave,
  decodeReviewCommit,
  decodeReviewCommits,
  decodeReviewFileDiff,
  decodeReviewStatus,
  decodeReviewSummary,
  decodeSandboxUninstall,
  decodeThreadSettings,
  decodeThreadSettingsPatch,
  decodeTurnStart,
  encodeOffsetCursor,
  enumValue,
  githubPullRequestIdentity,
  githubRepositoryIdentity,
  memoryEntryView,
  modelRef,
  modelRefOrNull,
  parseJsonRecord,
  positiveIntegerParam,
  providerFailureCategory,
  providerSetting,
  resolveAiReviewSource,
  resolveMemoryProjectID,
  resolveMemoryProjectKey,
  resolveProjectWorkspace,
  stringParam,
  submitMessage,
  supportedPermissionConfig,
} from "../RpcRouter"
import type { RpcHandlerGroup } from "./types"

export const threadHandlers = {
  name: "thread",
  methods: [
    "thread/list",
    "thread/create",
    "thread/read",
    "thread/history/read",
    "prompt/preview",
    "prompt/refresh",
    "thread/compact",
    "thread/update",
    "thread/settings/update",
    "thread/delete",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
    "turn/resume",
    "queue/update",
    "queue/remove",
    "queue/reorder",
    "queue/steer",
    "queue/resume",
    "attachment/import",
    "attachment/read",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, sandbox, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "thread/list": {
        const projectID = typeof params.projectID === "string" ? params.projectID : typeof params.projectId === "string" ? params.projectId : undefined
        const archived = typeof params.archived === "boolean" ? params.archived : undefined
        return { threads: runtime.projection.list({ ...(projectID !== undefined ? { projectID } : {}), ...(archived !== undefined ? { archived } : {}), limit: typeof params.limit === "number" ? params.limit : 100 }), nextCursor: null }
      }
      case "thread/create": {
        const workspaceValue = record(params.workspace, "workspace")
        const workspace = workspaceValue.kind === "project"
          ? { kind: "project" as const, projectID: stringParam(workspaceValue, "projectId") }
          : workspaceValue.kind === "projectless"
            ? { kind: "projectless" as const, ...(typeof workspaceValue.prompt === "string" ? { prompt: workspaceValue.prompt } : {}) }
            : (() => { throw new AgentError("INVALID_REQUEST", "workspace.kind 参数无效", 400) })()
        const settings = params.settings === undefined
          ? undefined
          : decodeParams(decodeThreadSettings, params.settings, "thread/create.settings")
        if (settings) supportedPermissionConfig(settings.permissionConfig)
        const created = await threads.create({
          ...(typeof params.title === "string" ? { title: params.title } : {}),
          ...(settings ? { settings } : {}),
          workspace,
          operationID: stringParam(params, "operationId"),
        })
        return runtime.threadSnapshotResult(created.id)
      }
      case "thread/read":
        return runtime.threadSnapshotResult(stringParam(params, "threadId"))
      case "thread/history/read": {
        const threadId = stringParam(params, "threadId")
        try {
          return runtime.threadHistoryPageResult(threadId, {
            ...(typeof params.before === "string" ? { before: params.before } : {}),
            ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
          })
        } catch (cause) {
          if (cause instanceof InvalidThreadHistoryCursorError) throw new AgentError("CONFLICT", cause.message, 409)
          throw cause
        }
      }
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
        const sequence = globalEventSequence(db)
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
          const sequence = globalEventSequence(db)
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
        const sequence = globalEventSequence(db)
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
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/remove": {
        const request = decodeParams(decodeQueueInput, rawParams, "queue/remove")
        const mutation = await threads.removeQueue(request.threadId, request.inputId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/reorder": {
        const request = decodeParams(decodeQueueReorder, rawParams, "queue/reorder")
        const mutation = await threads.reorderQueue(request.threadId, request.inputIds, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/steer": {
        const request = decodeParams(decodeQueueInput, rawParams, "queue/steer")
        const mutation = await threads.steerQueue(request.threadId, request.inputId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case "queue/resume": {
        const request = decodeParams(decodeQueueResume, rawParams, "queue/resume")
        const mutation = await threads.resumeQueue(request.threadId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
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
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

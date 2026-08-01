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
  decodeQueueAdd,
  decodeQueueInput,
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
  decodeTurnInterrupt,
  decodeTurnStart,
  decodeTurnSteer,
  encodeOffsetCursor,
  enumValue,
  githubPullRequestIdentity,
  githubRepositoryIdentity,
  memoryEntryView,
  modelRefOrNull,
  parseJsonRecord,
  positiveIntegerParam,
  providerFailureCategory,
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
    "thread/mark-read",
    "thread/title/regenerate",
    "thread/settings/update",
    "thread/delete",
    "thread/patch/diff",
    "thread/patch/apply",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
    "turn/resume",
    "queue/add",
    "queue/update",
    "queue/remove",
    "queue/resume",
    "attachment/import",
    "attachment/read",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, apiKeys, memory, review, github, turnPatches } = runtime.dependencies
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
      case "thread/patch/diff":
        return turnPatches.readDiff({
          threadID: stringParam(params, "threadId"),
          toolCallID: stringParam(params, "toolCallId"),
          path: stringParam(params, "path"),
        })
      case "thread/patch/apply": {
        if (
          typeof params.expectedVersion !== "number"
          || !Number.isSafeInteger(params.expectedVersion)
          || params.expectedVersion < 0
        ) {
          throw new AgentError("INVALID_REQUEST", "expectedVersion 参数无效", 400)
        }
        const stored = await turnPatches.apply({
          threadID: stringParam(params, "threadId"),
          itemID: stringParam(params, "itemId"),
          action: enumValue(params.action, ["undo", "reapply"] as const, "action"),
          expectedVersion: params.expectedVersion,
          operationID: stringParam(params, "operationId"),
        })
        const item = runtime.projection.item(stored)
        if (!item || item.type !== "patch") {
          throw new AgentError("CONFLICT", "修改文件卡片不存在", 409)
        }
        return { item }
      }
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
      case "thread/mark-read": {
        const threadId = stringParam(params, "threadId")
        const readThroughAt = params.readThroughAt
        if (typeof readThroughAt !== "number" || !Number.isFinite(readThroughAt) || readThroughAt < 0) {
          throw new AgentError("INVALID_REQUEST", "readThroughAt 参数无效", 400)
        }
        return { thread: history.markRead(threadId, readThroughAt) }
      }
      case "thread/title/regenerate":
        return { thread: await threads.regenerateTitle(stringParam(params, "threadId")) }
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
        const submitted = await threads.startTurn(
          threadId,
          submitMessage(start),
          start.inputId,
          start.attachmentIds ?? [],
        )
        const sequence = globalEventSequence(db)
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === "duplicate" ? "duplicate" : "accepted",
          streamPosition: { streamId: threadId, sequence },
        }
      }
      case "turn/steer": {
        const request = decodeParams(decodeTurnSteer, rawParams, "turn/steer")
        const activeInput = db.getTurnInput(request.turnId)
        if (!activeInput) throw new AgentError("TURN_ID_MISMATCH", "活动 Turn 已变化，请刷新后重试", 409)
        const submitted = await threads.steerTurn(request.threadId, request.turnId, {
          content: request.content,
          model: activeInput.model,
          permissionConfig: activeInput.permissionConfig,
          strategy: "guide",
          taskMode: activeInput.taskMode,
        }, request.inputId, request.attachmentIds ?? [])
        const sequence = globalEventSequence(db)
        return {
          inputId: request.inputId,
          turnId: submitted.turnID,
          disposition: submitted.disposition === "duplicate" ? "duplicate" : "accepted",
          streamPosition: { streamId: request.threadId, sequence },
        }
      }
      case "turn/interrupt": {
        const request = decodeParams(decodeTurnInterrupt, rawParams, "turn/interrupt")
        const status = await threads.stop(request.threadId, request.turnId)
        return { threadId: request.threadId, turnId: request.turnId, status }
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
      case "queue/add": {
        const request = decodeParams(decodeQueueAdd, rawParams, "queue/add")
        const submitted = await threads.enqueueFollowUp(request.threadId, {
          content: request.content,
          model: request.model,
          permissionConfig: request.permissionConfig,
          strategy: "queue",
          taskMode: request.taskMode,
        }, request.inputId, request.attachmentIds ?? [], {
          operationID: request.operationId,
          ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
        })
        const sequence = globalEventSequence(db)
        const turn = db.sqlite.query("SELECT status FROM turns WHERE id = ?").get(submitted.turnID) as { status: string } | null
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === "duplicate" ? "duplicate" : "accepted",
          admission: submitted.disposition === "started"
            ? "started"
            : submitted.disposition === "queued"
              ? "queued"
              : turn?.status === "queued"
                ? "queued"
                : "started",
          streamPosition: { streamId: request.threadId, sequence },
        }
      }
      case "queue/remove": {
        const request = decodeParams(decodeQueueInput, rawParams, "queue/remove")
        const mutation = await threads.removeQueue(request.threadId, request.inputId, { operationID: request.operationId, ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }) })
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

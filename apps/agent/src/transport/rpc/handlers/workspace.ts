import type { RpcMethod } from "@codepilotx/agent-protocol"
import type { RpcRouter } from "../RpcRouter"
import type { RpcRouterContext } from "../request-context"
import { decodeRpcParams as decodeParams, optionalRpcRecord as optionalRecord, rpcRecord as record } from "../decoders"
import {
  AgentError,
  Capabilities,
  Effect,
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

export const workspaceHandlers = {
  name: "workspace",
  methods: [
    "project/list",
    "project/open",
    "workspace/file/list",
    "workspace/file/read",
    "workspace/file/save",
    "workspace/file/watch",
    "workspace/file/unwatch",
    "project/settings/update",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, sandbox, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
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
          void runtime.emit("workspace/file/changed", { projectId, path, changedAt: Date.now() })
        })
        const key = `${projectId}\0${watched.path}`
        if (runtime.workspaceFileWatchers.has(key)) watched.close()
        else runtime.workspaceFileWatchers.set(key, watched)
        return { watching: true, path: watched.path }
      }
      case "workspace/file/unwatch": {
        const projectId = stringParam(params, "projectId")
        const workspace = await resolveProjectWorkspace(db, projectId)
        const path = await workspace.resolveEditorFilePath(stringParam(params, "path"))
        const key = `${projectId}\0${path}`
        runtime.workspaceFileWatchers.get(key)?.close()
        runtime.workspaceFileWatchers.delete(key)
        return { watching: false, path }
      }
      case "project/settings/update": {
        const projectId = stringParam(params, "projectId")
        const settings = record(params.settings, "settings")
        const saved = db.saveProjectSettings(projectId, {
          defaultModel: modelRefOrNull(settings.defaultModel),
        })
        const row = db.profileSqlite.query("SELECT updated_at FROM project_settings WHERE project_id = ?").get(projectId) as { updated_at: number } | null
        return { projectId, settings: saved, version: Number(row?.updated_at ?? Date.now()) }
      }
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

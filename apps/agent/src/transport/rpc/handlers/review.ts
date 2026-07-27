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

export const reviewHandlers = {
  name: "review",
  methods: [
    "review/summary",
    "review/refresh",
    "review/fileDiff",
    "review/apply",
    "review/branches",
    "review/commits",
    "review/status",
    "review/commit",
    "review/comment/list",
    "review/comment/save",
    "review/comment/resolve",
    "review/comment/delete",
    "review/ai/start",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
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
          ? await threads.create({
              title: aiReviewTitle(input.target),
              workspace: { kind: "project", projectID },
              settings: sourceThread.settings,
              operationID: crypto.randomUUID(),
            })
          : sourceThread
        const model = await aiReviewModel(
          db,
          providers,
          runtime.dependencies.config,
          input.threadId,
          projectID,
        )
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
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

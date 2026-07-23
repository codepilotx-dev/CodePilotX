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

export const githubHandlers = {
  name: "github",
  methods: [
    "github/auth/status",
    "github/auth/start",
    "github/auth/poll",
    "github/auth/logout",
    "github/profile",
    "github/profileOverview",
    "github/repositories",
    "github/pullRequest/read",
    "github/pullRequest/create",
    "github/pullRequest/createForProject",
    "github/pullRequest/comment",
    "github/pullRequest/resolveThread",
    "github/pullRequest/submitReview",
    "github/push",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, sandbox, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
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
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

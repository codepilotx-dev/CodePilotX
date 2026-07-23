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

export const subagentHandlers = {
  name: "subagent",
  methods: [
    "subagent/list",
    "subagent/read",
    "subagent/send",
    "subagent/stop",
    "subagent/retry",
    "subagent/worktree/diff",
    "subagent/worktree/apply",
    "subagent/worktree/discard",
    "subagent/workspace/restore",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, sandbox, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "subagent/list":
        return { subagents: subagents.list(stringParam(params, "threadId", "parentThreadId")), nextCursor: null }
      case "subagent/read": {
        const value = subagents.read(stringParam(params, "taskId", "subagentTaskId"))
        return {
          ...value,
          snapshot: runtime.requiredSnapshot(value.task.childThreadId),
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
        const sequence = globalEventSequence(db)
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
        const sequence = globalEventSequence(db)
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
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

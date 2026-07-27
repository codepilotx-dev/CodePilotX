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

const unsupportedSandboxResult = () => ({
  sandbox: {
    state: "unsupported" as const,
    platform: process.platform,
    architecture: process.arch,
    runtimeVersion: "host-hook-v1",
    maturity: "alpha" as const,
    maxConcurrentCommands: 1,
    error: "内置命令沙箱已移除；Shell 经 Pi Hook 和权限检查后以当前用户身份在本机执行。",
    operations: {
      canInstall: false,
      canRepair: false,
      canUninstall: false,
    },
  },
})

export const systemHandlers = {
  name: "system",
  methods: [
    "initialize",
    "sandbox/status",
    "sandbox/refresh",
    "sandbox/install",
    "sandbox/repair",
    "sandbox/uninstall",
    "shutdown",
    "event/subscribe",
    "event/ack",
    "event/unsubscribe",
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown, context: RpcRouterContext): Promise<unknown> {
    const { db, threads, history, approvals, questions, subagents, attachments, providers, integrations, apiKeys, memory, review, github } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case "initialize":
        db.sqlite.query("SELECT 1").get()
        if (!Array.isArray(params.protocols) || !params.protocols.includes("thread-rpc-v4")) {
          throw new AgentError("PROTOCOL_VERSION_UNSUPPORTED", "客户端不支持 thread-rpc-v4", 409)
        }
        if (!Array.isArray(params.capabilities) || !params.capabilities.includes("rpc.typed.v1")) {
          throw new AgentError("CAPABILITY_REQUIRED", "客户端缺少 rpc.typed.v1 capability", 409)
        }
        const connectionId = crypto.randomUUID()
        const createdAt = runtime.now()
        runtime.connections.set(connectionId, {
          initialized: false,
          createdAt,
          lastSeenAt: createdAt,
          capabilities: new Set(params.capabilities as string[]),
        })
        return {
          protocol: "thread-rpc-v4",
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
      case "sandbox/refresh":
        return unsupportedSandboxResult()
      case "sandbox/install":
      case "sandbox/repair":
        throw new AgentError("SANDBOX_UNAVAILABLE", "CodePilotX 不再提供内置安全沙箱。", 503)
      case "sandbox/uninstall":
        decodeParams(decodeSandboxUninstall, rawParams, "sandbox/uninstall")
        throw new AgentError("SANDBOX_UNAVAILABLE", "CodePilotX 不再提供内置安全沙箱。", 503)
      case "shutdown":
        if (process.env.CODEPILOTX_DESKTOP_MANAGED !== "1") throw new AgentError("SHUTDOWN_DENIED", "仅桌面托管的 Agent 可以通过 RPC 关闭", 403)
        setTimeout(() => process.emit("SIGTERM"), 25)
        return { ok: true, acceptedAt: Date.now() }
      case "event/subscribe":
        return runtime.subscriptions.subscribe(runtime.requireConnection(context), params as never)
      case "event/ack":
        return runtime.subscriptions.ack(runtime.requireConnection(context), params as never)
      case "event/unsubscribe":
        return runtime.subscriptions.unsubscribe(runtime.requireConnection(context), stringParam(params, "subscriptionId"))
      default:
        throw new AgentError("METHOD_NOT_FOUND", `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup

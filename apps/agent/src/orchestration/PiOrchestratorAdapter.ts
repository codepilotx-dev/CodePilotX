import { Effect } from "effect";
import {
  type Api,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai";
import {
  AgentHarness,
  SessionError,
  type Session,
  type AgentHarnessEvent,
} from "@codepilotx/pi-agent-core";
import type {
  AgentRuntimeRequest,
  AgentRuntimeResult,
  PendingApproval,
  PlanCheckpoint,
} from "./AgentRuntimeTypes";
import {
  PiAgentRuntime,
  piToolResultText,
  type PiRuntimeEventContext,
} from "./pi";
import { PiRuntimeProjector } from "./pi/PiRuntimeProjector";
import {
  SqlitePiSessionRepo,
  type SqlitePiSessionStorage,
} from "../storage/SqlitePiSession";
import type { AgentDatabase } from "../storage/database/AgentDatabase";
import type { EventHub } from "../storage/events/EventHub";
import type { ToolExecutor } from "../tool/ToolExecutor";
import { PI_LIFECYCLE_TOOLS, type ToolExposureInput } from "../tool/ToolExposurePlan";
import { AgentError, type Item, type PermissionConfig, type SubagentResult } from "../domain";
import { secretScrubber } from "../security/SecretScrubber";
import { resolveEffectivePermissionConfig } from "../permission/EffectivePermissionConfig";
import {
  ContextCompactionService,
  type ContextCompaction,
} from "../context/ContextCompactionService";
import type { RuntimeContributionRegistry } from "../runtime/RuntimeContribution";
import type { RequestSnapshotRecorder } from "../snapshot/RequestSnapshotRecorder";
import type { RuntimeStepService } from "../runtime/RuntimeStepService";
import type { RuntimeLease } from "../runtime/AgentRuntimeScope";
import type { PiRuntimeRequest } from "./pi/types";

export type {
  DelegationController,
  AgentRuntimeRequest,
  PendingApproval,
  PlanCheckpoint,
} from "./AgentRuntimeTypes";

export class SafeBoundaryInterrupt extends Error {
  constructor() {
    super("SUBAGENT_STEERING_BOUNDARY");
  }
}

export {
  finishedPiToolItem,
  mergeTimelineMutationFiles,
  piItemDeltaPayload,
  piToolItemPayload,
  piToolMutationFiles,
  piToolTimelineInput,
  type TimelineMutationFile,
} from "./PiTimeline";

const resumedToolResultText = (value: unknown, tool: string) => {
  if (typeof value === "string") return value;
  const safe = secretScrubber.scrub(value);
  const content = safe == null ? "" : JSON.stringify(safe, null, 2);
  return piToolResultText({
    content: content ? [{ type: "text", text: content }] : [],
    details: safe,
  }, { tool }) || "工具执行完成（无输出）";
};

export interface PiOrchestratorAdapterOptions {
  db: AgentDatabase;
  hub: EventHub;
  models: Models;
  toolExecutor: ToolExecutor;
  contextCompaction: ContextCompactionService;
  /** 仓库内静态贡献注册表；运行时传给 PiAgentRuntime 并绑定到 scope。 */
  contributions?: RuntimeContributionRegistry;
  /** 完整 Provider 请求快照采集器；未开启配置时内部直接跳过。 */
  requestSnapshot?: RequestSnapshotRecorder;
  /** 持久 step 状态机与 model-visible context invariant。 */
  runtimeSteps?: RuntimeStepService;
  /** 插件 generation 租约获取器；main turn 与 subagent 共用（PR 4）。 */
  pluginLeases?: (request: PiRuntimeRequest) => Promise<RuntimeLease[]>;
  observeHarnessEvent?: (
    context: PiRuntimeEventContext,
    event: AgentHarnessEvent,
  ) => void;
  /**
   * System agent-loop provider 替换点（PR 8C）：返回非 null 时整轮 turn
   * 委托给 provider.runTurn，Pi 编排完全不启动；null = 默认 Pi 编排原路径。
   */
  loopOverride?: () => AgentLoopOverride | null;
}

/**
 * agent-loop System service 的进程内调用形状（与
 * `AGENT_LOOP_CONTRACT` 的 runTurn JSON 契约对齐）。
 */
export interface AgentLoopRunInput {
  threadID: string;
  turnID: string;
  agentID: string;
  sessionID: string;
  profile?: string;
  content: string;
  taskMode: "chat" | "plan";
  model: { providerID: string; id: string };
  permissionConfig: PermissionConfig;
  resume?: PlanCheckpoint;
  aborted: boolean;
}

export interface AgentLoopRunOutput {
  status: "completed" | "paused" | "error" | "interrupted";
  output: string;
  result?: SubagentResult;
  error?: { code: string; message: string };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
  };
  events?: Array<{ method: string; params: unknown }>;
}

export interface AgentLoopOverride {
  runTurn(input: AgentLoopRunInput): Promise<AgentLoopRunOutput>;
}

/** Adapts the existing product lifecycle to Pi without exposing Pi types to RPC. */
export class PiOrchestratorAdapter {
  private readonly repo: SqlitePiSessionRepo;
  private readonly active = new Map<string, PiAgentRuntime>();
  private readonly projectors = new Map<string, PiRuntimeProjector>();

  constructor(private readonly options: PiOrchestratorAdapterOptions) {
    this.repo = new SqlitePiSessionRepo(options.db);
  }

  private async publish(event: ReturnType<AgentDatabase["insertEvent"]>) {
    await Effect.runPromise(this.options.hub.publish(event));
  }

  async run(request: AgentRuntimeRequest) {
    // Serialized OpenAI RunState cannot be replayed safely. Continue only from
    // durable Pi session context; side effects remain protected by toolCallID.
    const resolved = await request.resolveModel(request.fallbackModel);
    // System agent-loop provider（PR 8C）：激活时整轮委托，Pi 编排不启动。
    const loop = this.options.loopOverride?.();
    if (loop) {
      return this.runWithLoopOverride(request, resolved, loop);
    }
    const effectivePermissionConfig = resolveEffectivePermissionConfig(
      request.taskMode,
      request.permissionConfig,
    );
    const effectivePromptSections = (request.promptSections ?? []).map((section) =>
      section.id === "permission.resolved"
        ? {
            ...section,
            content: `Resolved permission config: ${JSON.stringify(effectivePermissionConfig)}.`,
          }
        : section
    );
    const model = resolved.model as unknown as PiModel<Api>;
    let session;
    try {
      session = await this.repo.openForThread(request.sessionID, request.threadID);
    } catch (cause) {
      if (!(cause instanceof SessionError) || cause.code !== "not_found") throw cause;
      session = await this.repo.create({
        id: request.sessionID,
        threadID: request.threadID,
        agentID: request.agentID,
      });
    }
    const storage = session.getStorage() as SqlitePiSessionStorage;
    const projector = new PiRuntimeProjector({
      db: this.options.db,
      contextCompaction: this.options.contextCompaction,
      storage,
      session,
      runtimeModel: model,
      sessionID: request.sessionID,
      ...(request.onUsage ? { onUsage: request.onUsage } : {}),
      publish: (event) => this.publish(event),
    });
    this.projectors.set(request.threadID, projector);
    if (request.resume?.toolCallID) {
      const entries = await session.getEntries();
      const assistantEntry = [...entries]
        .reverse()
        .find(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            entry.message.content.some(
              (part) =>
                part.type === "toolCall" &&
                part.id === request.resume!.toolCallID,
            ),
        );
      const toolCall =
        assistantEntry?.type === "message" &&
        assistantEntry.message.role === "assistant"
          ? assistantEntry.message.content.find(
              (part) =>
                part.type === "toolCall" &&
                part.id === request.resume!.toolCallID,
            )
          : undefined;
      if (!assistantEntry || !toolCall || toolCall.type !== "toolCall")
        throw new Error("Pi checkpoint 中找不到待恢复的 tool call");
      const alreadySettled = this.options.db.hasPersistedToolResult(request.turnID, request.resume.toolCallID);
      if (!alreadySettled) await session.moveTo(assistantEntry.id);
      let resolutionText = request.resume.decision === "deny"
        ? request.resume.answer
          ? `用户拒绝了此工具调用，并要求：${request.resume.answer}`
          : "用户拒绝了此工具调用，请改用其他方案。"
        : request.resume.answer ?? request.resume.decision ?? "continue";
      let resolutionDetails: unknown;
      let isError = request.resume.decision === "deny";
      const lifecycleNames = new Set([
        "request_user_input",
        "request_permissions",
        "spawn_agents",
        "wait_agents",
        "send_agent",
        "stop_agent",
        "update_plan",
        "finalize_result",
      ]);
      if (!alreadySettled &&
        request.resume.decision === "allow"
        && toolCall.name === "request_permissions"
        && request.resume.permissionGrant
      ) {
        try {
          const grant = await this.options.toolExecutor.applyPermissionGrant({
            scope: request.resume.permissionGrant.scope,
            requestedPermissions: toolCall.arguments as Record<string, unknown>,
            grantedPermissions: request.resume.permissionGrant.grantedPermissions,
          }, {
            threadID: request.threadID,
            turnID: request.turnID,
            agentID: request.agentID,
            profile: request.profile ?? "main",
            taskMode: request.taskMode,
            signal: request.signal,
            workspace: request.workspace,
            ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
            permissionConfig: effectivePermissionConfig,
            model: request.fallbackModel,
            taskSummary: request.content,
            toolCallID: request.resume.toolCallID,
          });
          resolutionDetails = secretScrubber.scrub(grant);
          resolutionText = resumedToolResultText(grant, toolCall.name);
        } catch (cause) {
          isError = true;
          resolutionText = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause));
        }
      }
      if (!alreadySettled &&
        request.resume.decision === "allow" &&
        !lifecycleNames.has(toolCall.name)
      ) {
        const completed = this.options.db.completedToolCall(request.resume.toolCallID);
        if (completed) {
          resolutionDetails = secretScrubber.scrub(completed.output);
          resolutionText = resumedToolResultText(completed.output, completed.name);
        } else try {
          const resolution = await this.options.toolExecutor.execute(
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
            {
              threadID: request.threadID,
              turnID: request.turnID,
              agentID: request.agentID,
              profile: request.profile ?? "main",
              taskMode: request.taskMode,
              signal: request.signal,
              workspace: request.workspace,
              ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
              permissionConfig: effectivePermissionConfig,
              model: request.fallbackModel,
              taskSummary: request.content,
              toolCallID: request.resume.toolCallID,
              approvedToolCallID: request.resume.toolCallID,
              ...(request.resume.authorizationFingerprint
                ? { approvedAuthorizationFingerprint: request.resume.authorizationFingerprint }
                : {}),
            },
          );
          resolutionDetails = secretScrubber.scrub(resolution);
          resolutionText = resumedToolResultText(resolution, toolCall.name);
        } catch (cause) {
          isError = true;
          resolutionText = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause));
        }
      }
      if (!alreadySettled) {
        await session.appendMessage({
          role: "toolResult",
          toolCallId: request.resume.toolCallID,
          toolName: toolCall.name,
          content: [
            {
              type: "text",
              text: resolutionText,
            },
          ],
          isError,
          timestamp: Date.now(),
        });
        let completedEvents: Array<ReturnType<AgentDatabase["insertEvent"]>> = [];
        this.options.db.transaction(() => {
          storage.flush();
          if (!request.resume?.resumeLeaseID && request.resume?.checkpointID) {
            this.options.db.completeQuestionResume(request.resume.checkpointID);
          }
          completedEvents = projector.persistFinishedTool({
            threadID: request.threadID,
            turnID: request.turnID,
            agentID: request.agentID,
          }, {
            toolCallID: request.resume!.toolCallID!,
            tool: toolCall.name,
            output: resolutionText,
            details: resolutionDetails,
            isError,
          });
        });
        for (const event of completedEvents) await this.publish(event);
      }
    }
    const previousRuntime = this.active.get(request.threadID);
    if (previousRuntime) await previousRuntime.dispose();
    const exposedTools = this.toolExposure({
      ...request,
      permissionConfig: effectivePermissionConfig,
    }).exposed;
    let paused = false;
    const preapprovedToolCalls = new Map<string, string | undefined>();
    const pause = async (approval: PendingApproval) => {
      paused = true;
      await request.pause(approval);
    };
    const executionContext = {
      threadID: request.threadID,
      turnID: request.turnID,
      agentID: request.agentID,
      profile: request.profile ?? "main",
      taskMode: request.taskMode,
      signal: request.signal,
      workspace: request.workspace,
      ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
      permissionConfig: effectivePermissionConfig,
      model: request.fallbackModel,
      taskSummary: request.content,
    };
    const runtime = new PiAgentRuntime({
      toolExecutor: this.options.toolExecutor,
      ...(this.options.contributions ? { contributions: this.options.contributions } : {}),
      ...(this.options.requestSnapshot ? { requestSnapshot: this.options.requestSnapshot } : {}),
      ...(this.options.runtimeSteps ? { runtimeSteps: this.options.runtimeSteps } : {}),
      ...(this.options.pluginLeases ? { acquireLeases: this.options.pluginLeases } : {}),
      harnessFactory: {
        resolve: async () => ({
          models: this.options.models,
          model,
          session,
        }),
      } as never,
      eventHandler: (event) => projector.handle(event),
      observeHarnessEvent: (context, event) =>
        this.options.observeHarnessEvent?.(context, event),
      beforeToolCall: async (runtimeRequest, input) => {
        if ((PI_LIFECYCLE_TOOLS as readonly string[]).includes(input.tool))
          return undefined;
        const decision = await this.options.toolExecutor.previewApproval(
          input.tool,
          input.input,
          {
            ...executionContext,
            ...(runtimeRequest.toolCatalog ? { toolCatalog: runtimeRequest.toolCatalog } : {}),
          },
          input.toolCallID,
        );
        if (decision.decision === "allow") {
          preapprovedToolCalls.set(
            input.toolCallID,
            decision.authorizationFingerprint,
          );
          return undefined;
        }
        if (decision.decision === "deny")
          return { block: true, reason: decision.reason };
        await pause({
          kind: "permission",
          toolCallID: input.toolCallID,
          checkpoint: {
            state: JSON.stringify({
              engine: "pi",
              sessionID: request.sessionID,
            }),
            interruption: input,
            toolCallID: input.toolCallID,
            ...(decision.authorizationFingerprint
              ? { authorizationFingerprint: decision.authorizationFingerprint }
              : {}),
          },
        });
        return { block: true, reason: "等待用户审批", pause: true };
      },
      compaction: {
        shouldAutoCompact: (threadID) => this.options.contextCompaction.shouldAutoCompact(threadID),
        recordFailure: (threadID, trigger) => this.options.contextCompaction.recordFailure(threadID, trigger),
      },
      lifecycle: {
        skillList: async () =>
          request.skillService
            ?.list()
            .map(({ name, description, origin, format, hash }) => ({
              name,
              description,
              origin,
              format,
              hash,
            })) ?? [],
        skillRead: async (input) => {
          if (!request.skillService)
            throw new Error("当前 turn 未启用 SkillService");
          return request.skillService.read(String(input.name));
        },
        projectSourceList: async () => {
          if (!request.projectSources)
            throw new Error("当前 turn 未启用项目来源");
          return request.projectSources.list();
        },
        projectSourceRead: async (input) => {
          if (!request.projectSources)
            throw new Error("当前 turn 未启用项目来源");
          return request.projectSources.read(
            input.sourceId,
            typeof input.offset === "number" && typeof input.length === "number"
              ? { offset: input.offset, length: input.length }
              : undefined,
          );
        },
        requestUserInput: async (input, toolCallID) => {
          await pause({
            kind: "clarification",
            questions: input.questions,
            ...(input.autoResolutionMs === undefined ? {} : { autoResolutionMs: input.autoResolutionMs }),
            toolCallID,
            checkpoint: {
              state: JSON.stringify({
                engine: "pi",
                sessionID: request.sessionID,
              }),
              interruption: { toolCallID },
              toolCallID,
            },
          });
          return { __piPause: true, status: "waiting_for_user" };
        },
        requestPermissions: async (input, toolCallID) => {
          if (request.taskMode === "plan")
            throw new Error("Plan 模式禁止请求或提升权限");
          const decision = await this.options.toolExecutor.previewApproval(
            "request_permissions",
            input,
            executionContext,
            toolCallID,
          );
          if (decision.decision === "deny") throw new Error(decision.reason);
          if (decision.decision === "allow") {
            return this.options.toolExecutor.execute(
              "request_permissions",
              input,
              {
                ...executionContext,
                toolCallID,
                approvedToolCallID: toolCallID,
                ...(decision.authorizationFingerprint
                  ? { approvedAuthorizationFingerprint: decision.authorizationFingerprint }
                  : {}),
              },
            );
          }
          await pause({
            kind: "permission",
            toolCallID,
            checkpoint: {
              state: JSON.stringify({
                engine: "pi",
                sessionID: request.sessionID,
              }),
              interruption: { toolCallID, input },
              toolCallID,
              ...(decision.authorizationFingerprint
                ? { authorizationFingerprint: decision.authorizationFingerprint }
                : {}),
            },
          });
          return { __piPause: true, status: "waiting_for_permission" };
        },
        updatePlan: async (input, toolCallID) => {
          if (request.taskMode !== "chat" || (request.profile ?? "main") !== "main")
            throw new Error("update_plan 仅允许 Chat 模式的主 Agent 使用");
          if (!request.updatePlan) throw new Error("当前 turn 未配置执行计划服务");
          return request.updatePlan(input, toolCallID);
        },
        spawnAgents: async (input) => {
          const agents = Array.isArray(input.agents) ? input.agents : [];
          if (
            request.taskMode === "plan"
            && agents.some((agent) =>
              !agent
              || typeof agent !== "object"
              || (agent as Record<string, unknown>).profile !== "explorer"
            )
          ) throw new Error("Plan 模式只能创建 Explorer 子 Agent");
          return request.delegation?.spawn(input as never);
        },
        waitAgents: async (input, toolCallID) => {
          const runIDs = Array.isArray(input.runIDs)
            ? input.runIDs.map(String)
            : [];
          const mode = input.mode === "any" ? "any" : "all";
          if (!(await request.delegation?.isWaitSatisfied({ runIDs, mode }))) {
            await pause({
              kind: "subagents",
              runIDs,
              waitMode: mode,
              toolCallID,
              checkpoint: {
                state: JSON.stringify({
                  engine: "pi",
                  sessionID: request.sessionID,
                }),
                interruption: { toolCallID },
                toolCallID,
              },
            });
            return { __piPause: true, status: "waiting_for_subagents" };
          }
          return request.delegation?.wait({ runIDs, mode });
        },
        sendAgent: async (input) =>
          request.delegation?.send({
            taskID: String(input.taskID ?? input.taskId ?? ""),
            message: String(input.message ?? ""),
          }),
        stopAgent: async (input) =>
          request.delegation?.stop({
            taskID: String(input.taskID ?? input.taskId ?? ""),
          }),
        finalizeResult: async (input: SubagentResult) => input,
      },
    });
    this.active.set(request.threadID, runtime);
    await request.onRuntimeReady?.();
    const resumedContent = request.resume
      ? `<interaction_resolution toolCallId=${JSON.stringify(request.resume.toolCallID ?? "unknown")}>${JSON.stringify({ answer: request.resume.answer, decision: request.resume.decision ?? null })}</interaction_resolution>\n继续处理已恢复的 Pi session；不得重新执行已完成或已被用户拒绝的同一个工具调用。若用户给出调整要求，必须据此改用其他方案。`
      : request.content;
    let result: Awaited<ReturnType<PiAgentRuntime["run"]>>
    try {
      result = await runtime.run({
        threadID: request.threadID,
        turnID: request.turnID,
        agentID: request.agentID,
        sessionID: request.sessionID,
        ...(request.profile ? { profile: request.profile } : {}),
        content: resumedContent,
        taskMode: request.taskMode,
        permissionConfig: effectivePermissionConfig,
        signal: request.signal,
        workspace: request.workspace,
        ...(request.defaultCwd ? { defaultCwd: request.defaultCwd } : {}),
        model,
        policyModel: request.fallbackModel,
        ...(resolved.ref.variant
          ? { thinkingLevel: String(resolved.ref.variant) as import("@codepilotx/pi-agent-core").ThinkingLevel }
          : {}),
        exposedTools,
        promptSections: effectivePromptSections,
        ...(request.attachments ? { attachments: request.attachments } : {}),
        preapprovedToolCalls,
        ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
        ...(request.toolCatalog ? { toolCatalog: request.toolCatalog } : {}),
        onPromptComposed: async (bundle) =>
          request.onPromptComposed?.(bundle, { budgetText: bundle.instructions }),
        canAutoCompact: () => !paused && !request.signal.aborted,
      });
    } catch (cause) {
      if (
        cause instanceof AgentError
        && cause.code === "PI_CONTEXT_WINDOW_EXCEEDED"
        && (request.profile ?? "main") === "main"
      ) {
        const completed = this.options.db.completedToolEvidenceForTurn(request.turnID);
        if (completed.length > 0) {
          const existing = this.options.db.getAgentTurnCheckpoint(request.turnID);
          const previousAttempt = existing?.payload.kind === "side-effect-prompt-recovery"
            ? Number(existing.payload.attemptOrdinal) || 1
            : 1;
          const interrupted = this.options.db.interruptForSideEffectRecovery({
            threadID: request.threadID,
            turnID: request.turnID,
            agentID: request.agentID,
            payload: {
              kind: "side-effect-prompt-recovery",
              attemptOrdinal: previousAttempt + 1,
              completed,
              error: "模型上下文超过窗口限制，压缩后仍无法继续",
            },
          });
          for (const event of interrupted.events) await this.publish(event);
          throw new AgentError("SIDE_EFFECT_RECOVERY_REQUIRED", "模型上下文超限；已保存副作用恢复证据", 409);
        }
      }
      throw cause;
    }
    return paused
      ? { status: "paused" as const, output: result.output }
      : result;
  }

  /**
   * agent-loop provider 委托路径（PR 8C）：固定输入 = thread/turn 身份 +
   * 模型选择 + 权限上下文 + 事件发布；固定输出 = 完成/错误分类 + usage +
   * 中断状态。Provider 只回传要发布的事件，发布动作由 Host 完成。
   */
  private async runWithLoopOverride(
    request: AgentRuntimeRequest,
    resolved: Awaited<ReturnType<AgentRuntimeRequest["resolveModel"]>>,
    loop: AgentLoopOverride,
  ): Promise<AgentRuntimeResult> {
    const input: AgentLoopRunInput = {
      threadID: request.threadID,
      turnID: request.turnID,
      agentID: request.agentID,
      sessionID: request.sessionID,
      ...(request.profile ? { profile: request.profile } : {}),
      content: request.content,
      taskMode: request.taskMode,
      model: resolved.ref,
      permissionConfig: request.permissionConfig,
      ...(request.resume ? { resume: request.resume } : {}),
      aborted: request.signal.aborted,
    };
    await request.onRuntimeReady?.();
    let result: AgentLoopRunOutput;
    try {
      result = await loop.runTurn(input);
    } catch (cause) {
      throw new AgentError(
        "LOOP_PROVIDER_ERROR",
        secretScrubber.scrubText(
          cause instanceof Error ? cause.message : String(cause),
        ),
        500,
      );
    }
    if (result.status === "error") {
      throw new AgentError(
        result.error?.code ?? "LOOP_PROVIDER_ERROR",
        result.error?.message ?? "agent-loop Provider 执行失败",
        500,
      );
    }
    if (result.status === "interrupted") {
      throw new AgentError("RUN_ABORTED", "任务已停止", 499);
    }
    if (result.usage) await request.onUsage?.(result.usage);
    for (const event of result.events ?? []) {
      await this.publish({
        id: 0,
        afterSequence: 0,
        threadId: request.threadID,
        turnId: request.turnID,
        method: event.method,
        params: event.params,
        createdAt: Date.now(),
      });
    }
    return result.status === "paused"
      ? { status: "paused" as const, output: result.output }
      : {
          status: "completed" as const,
          output: result.output,
          ...(result.result ? { result: result.result } : {}),
        };
  }

  toolExposure(request: AgentRuntimeRequest | (ToolExposureInput & { permissionConfig?: never })) {    const runtime = request as AgentRuntimeRequest;
    return this.options.toolExecutor.exposurePlan({
      taskMode: request.taskMode,
      sandboxMode: request.taskMode === "plan"
        ? "read-only"
        : "permissionConfig" in request
          ? request.permissionConfig.sandboxMode
          : request.sandboxMode,
      ...(request.profile ? { profile: request.profile } : {}),
      ...(runtime.skillService ? { hasSkillService: true } : "hasSkillService" in request && request.hasSkillService ? { hasSkillService: true } : {}),
      ...(runtime.projectSources ? { hasProjectSources: true } : "hasProjectSources" in request && request.hasProjectSources ? { hasProjectSources: true } : {}),
      ...(runtime.defaultModeRequestUserInput ? { defaultModeRequestUserInput: true } : "defaultModeRequestUserInput" in request && request.defaultModeRequestUserInput ? { defaultModeRequestUserInput: true } : {}),
      ...(request.delegationEnabled === false ? { delegationEnabled: false } : {}),
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
    }, runtime.toolCatalog);
  }

  async compact(threadID: string, instructions?: string, promptText?: string) {
    const runtime = this.active.get(threadID);
    if (runtime) {
      await runtime.compact(threadID, instructions);
      const completed = this.projectors.get(threadID)?.lastCompaction(threadID);
      if (!completed) throw new Error("Pi 压缩完成但缺少产品压缩记录");
      return completed;
    }
    const row = this.options.db.sqlite
      .query(
        `
      SELECT a.session_id, a.model_ref, t.project_id,
             t.workspace_root, t.workspace_cwd
      FROM agent_executions AS a
      JOIN threads AS t ON t.id = a.thread_id
      WHERE a.thread_id = ? AND a.profile = 'main'
      ORDER BY a.created_at DESC LIMIT 1
    `,
      )
      .get(threadID) as {
      session_id: string;
      model_ref: string;
      project_id: string | null;
      workspace_root: string | null;
      workspace_cwd: string | null;
    } | null;
    if (!row) throw new Error("Pi session 不存在，无法执行手动压缩");
    const ref = JSON.parse(row.model_ref) as { providerID: string; id: string };
    const model = this.options.models.getModel(ref.providerID, ref.id);
    if (!model) throw new Error(`Pi 模型 ${ref.providerID}/${ref.id} 不可用`);
    const session = await this.repo.openForThread(row.session_id, threadID);
    const storage = session.getStorage() as SqlitePiSessionStorage;
    const harness = new AgentHarness({
      session,
      models: this.options.models,
      model,
      tools: [],
      systemPrompt: "",
    });
    const beforeCount = (await session.getEntries()).length;
    const result = await harness.compact(instructions);
    const entryID = await storage.getLeafId();
    const piEntry = entryID ? await session.getEntry(entryID) : undefined;
    if (!piEntry || piEntry.type !== "compaction") {
      throw new Error("Pi 压缩完成但未生成 compaction entry");
    }
    const afterContext = await session.buildContext();
    let completed!: ReturnType<ContextCompactionService["complete"]>;
    this.options.db.transaction(() => {
      storage.flush();
      completed = this.options.contextCompaction.complete({
        threadID,
        turnID: null,
        sessionID: row.session_id,
        piEntry,
        summary: result.summary,
        firstKeptEntryID: result.firstKeptEntryId ?? null,
        beforeCount,
        afterCount: afterContext.messages.length,
        items: afterContext.messages,
        promptText: promptText ?? "",
        contextWindowTokens: Math.max(1, Number(model.contextWindow) || 1),
        trigger: "manual",
      });
    });
    await this.publish(completed.event);
    return completed.compaction;
  }

  async steer(threadID: string, content: string, images?: import("@earendil-works/pi-ai").ImageContent[], inputID?: string) {
    const runtime = this.active.get(threadID);
    if (!runtime) throw new Error("Pi Harness 尚未启动");
    await runtime.steer(threadID, content, images, inputID);
  }

  async followUp(threadID: string, content: string) {
    const runtime = this.active.get(threadID);
    if (!runtime) throw new Error("Pi Harness 尚未启动");
    await runtime.followUp(threadID, content);
  }

  async abort(threadID: string) {
    const runtime = this.active.get(threadID);
    if (runtime) await runtime.abort(threadID);
  }

  clearTurnPermissionGrants(threadID: string, turnID: string) {
    this.options.toolExecutor.clearTurnPermissionGrants(threadID, turnID);
  }

  async dispose() {
    await Promise.allSettled(
      [...this.active.values()].map((runtime) => runtime.dispose()),
    );
    this.active.clear();
    this.projectors.clear();
  }
}

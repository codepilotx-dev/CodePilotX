import { Effect } from "effect";
import {
  contentText,
  type Api,
  type Model as PiModel,
  type Models,
} from "@earendil-works/pi-ai";
import {
  AgentHarness,
  SessionError,
  type AgentHarnessEvent,
} from "@codepilotx/pi-agent-core";
import type { AgentRuntimeRequest, PendingApproval } from "./AgentRuntimeTypes";
import {
  PiAgentRuntime,
  piToolResultText,
  type PiRuntimeEventContext,
  type PiRuntimeEventSink,
} from "./pi";
import {
  SqlitePiSessionRepo,
  type SqlitePiSessionStorage,
} from "../storage/SqlitePiSession";
import type { AgentDatabase } from "../storage/database/AgentDatabase";
import type { EventHub } from "../storage/events/EventHub";
import type { ToolExecutor } from "../tool/ToolExecutor";
import { PI_LIFECYCLE_TOOLS, type ToolExposureInput } from "../tool/ToolExposurePlan";
import type { Item, SubagentResult } from "../domain";
import { createLiveEvent } from "../storage/events/EventPublisher";
import { secretScrubber } from "../security/SecretScrubber";
import { resolveEffectivePermissionConfig } from "../permission/EffectivePermissionConfig";
import { proposedPlanTitle } from "./plan/ProposedPlanStreamParser";
import { parseApplyPatch } from "../tool/ApplyPatch/parseApplyPatch";

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

type PendingTurn = {
  items: Map<string, Item>;
  storage: SqlitePiSessionStorage;
  consumedInputIDs: Set<string>;
};

const outputDelta = (value: unknown) => typeof value === "string" ? value : "";

const safeTimelinePatchPath = (path: string) => {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (/^(?:[a-z]:\/|\/)/i.test(normalized) || parts.includes("..")) {
    return parts.at(-1) ?? "<workspace-file>";
  }
  return normalized || "<workspace-file>";
};

export const piToolTimelineInput = (
  tool: string,
  input: unknown,
): Record<string, unknown> => {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  if (tool.toLowerCase().split(".").at(-1) !== "apply_patch") return record;
  const patch = typeof record.patch === "string" ? record.patch : "";
  let affectedPaths: Array<{ path: string; operation: "create" | "update" }> = [];
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;
  try {
    const operations = parseApplyPatch(patch);
    affectedPaths = operations.map((operation) => ({
      path: safeTimelinePatchPath(operation.path),
      operation: operation.type === "add" ? "create" : "update",
    }));
    for (const operation of operations) {
      if (operation.type === "add") {
        additions += operation.content.endsWith("\n")
          ? operation.content.slice(0, -1).split("\n").length
          : operation.content.split("\n").length;
        continue;
      }
      hunkCount += operation.chunks.length;
      additions += operation.chunks.reduce((sum, chunk) => sum + chunk.additions, 0);
      deletions += operation.chunks.reduce((sum, chunk) => sum + chunk.deletions, 0);
    }
  } catch {
    // Invalid patches still get a safe timeline item; the tool result carries the actionable parse error.
  }
  return {
    operation: "apply_patch",
    patchBytes: Buffer.byteLength(patch, "utf8"),
    hunkCount,
    additions,
    deletions,
    patch: "[补丁正文已隐藏]",
    ...(affectedPaths.length ? { affectedPaths } : {}),
  };
};

const commandFromInput = (input: unknown) => input && typeof input === "object"
  && typeof (input as Record<string, unknown>).command === "string"
  ? (input as Record<string, unknown>).command as string
  : null;

const resumedToolResultText = (value: unknown, tool: string) => {
  if (typeof value === "string") return value;
  const safe = secretScrubber.scrub(value);
  const content = safe == null ? "" : JSON.stringify(safe, null, 2);
  return piToolResultText({
    content: content ? [{ type: "text", text: content }] : [],
    details: safe,
  }, { tool }) || "工具执行完成（无输出）";
};

export const piToolItemPayload = (item: Item) => {
  const data = item.data;
  const terminal = item.status === "completed" || item.status === "error" || item.status === "interrupted";
  return {
    id: item.id,
    messageID: item.turnID,
    turnId: item.turnID,
    agentId: item.agentID,
    type: "tool" as const,
    callID: typeof data.callID === "string" ? data.callID : item.id,
    tool: typeof data.tool === "string" ? data.tool : "tool",
    title: typeof data.title === "string" ? data.title : `运行了 ${typeof data.tool === "string" ? data.tool : "tool"}`,
    state: item.status === "pending" ? "pending" as const
      : item.status === "running" ? "running" as const
      : item.status === "error" ? "error" as const
      : item.status === "interrupted" ? "interrupted" as const
      : "completed" as const,
    input: data.input ?? null,
    command: typeof data.command === "string" ? data.command : null,
    output: typeof data.output === "string" ? data.output : null,
    error: typeof data.error === "string" ? data.error : null,
    startedAt: typeof data.startedAt === "number" ? data.startedAt : item.createdAt,
    finishedAt: typeof data.finishedAt === "number" ? data.finishedAt : terminal ? item.updatedAt : null,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : terminal ? item.updatedAt - item.createdAt : null,
    ...(item.ordinal === undefined ? {} : { ordinal: item.ordinal }),
    createdAt: item.createdAt,
  };
};

export const finishedPiToolItem = (input: {
  current: Item | null;
  turnID: string;
  agentID: string;
  toolCallID: string;
  tool: string;
  output: string;
  isError: boolean;
  timestamp: number;
}): Item | null => {
  if (input.current && ["completed", "error", "interrupted"].includes(input.current.status)) return null;
  const createdAt = input.current?.createdAt ?? input.timestamp;
  return {
    id: input.toolCallID,
    turnID: input.turnID,
    agentID: input.agentID,
    type: "tool",
    status: input.isError ? "error" : "completed",
    data: {
      ...(input.current?.data ?? {}),
      callID: input.toolCallID,
      tool: input.tool,
      title: input.tool,
      state: input.isError ? "error" : "completed",
      output: input.isError ? null : input.output,
      error: input.isError ? input.output : null,
      finishedAt: input.timestamp,
      durationMs: input.timestamp - createdAt,
    },
    createdAt,
    updatedAt: input.timestamp,
  };
};

export const piItemDeltaPayload = (input: {
  itemID: string;
  context: PiRuntimeEventContext;
  delta: string;
}) => ({
  itemId: input.itemID,
  turnId: input.context.turnID,
  agentId: input.context.agentID,
  delta: input.delta,
});

export const piCompactionEventPayload = (input: {
  compactionID: string;
  beforeCount: number;
  afterCount: number;
  beforeTokens: number;
  afterTokens?: number;
  targetTokens?: number;
}) => ({
  compactionId: input.compactionID,
  beforeCount: input.beforeCount,
  afterCount: input.afterCount,
  beforeTokens: input.beforeTokens,
  afterTokens: input.afterTokens ?? 0,
  targetTokens: input.targetTokens ?? 0,
  baselineVersion: 1,
  usageSampleId: input.compactionID,
});

export interface PiOrchestratorAdapterOptions {
  db: AgentDatabase;
  hub: EventHub;
  models: Models;
  toolExecutor: ToolExecutor;
  observeHarnessEvent?: (
    context: PiRuntimeEventContext,
    event: AgentHarnessEvent,
  ) => void;
}

/** Adapts the existing product lifecycle to Pi without exposing Pi types to RPC. */
export class PiOrchestratorAdapter {
  private readonly repo: SqlitePiSessionRepo;
  private readonly active = new Map<string, PiAgentRuntime>();
  private readonly pending = new Map<string, PendingTurn>();

  constructor(private readonly options: PiOrchestratorAdapterOptions) {
    this.repo = new SqlitePiSessionRepo(options.db);
  }

  private async publish(event: ReturnType<AgentDatabase["insertEvent"]>) {
    await Effect.runPromise(this.options.hub.publish(event));
  }

  private persistFinishedTool(context: PiRuntimeEventContext, input: {
    toolCallID: string;
    tool: string;
    output: string;
    isError: boolean;
  }) {
    const item = finishedPiToolItem({
      current: this.options.db.getItem(input.toolCallID),
      turnID: context.turnID,
      agentID: context.agentID,
      ...input,
      timestamp: Date.now(),
    });
    if (!item) return null;
    const persisted = this.options.db.upsertItemWithEvent(
      context.threadID,
      item,
      input.isError ? "tool/error" : "tool/callCompleted",
      (stored: Item) => input.isError
        ? { item: stored, error: { code: "TOOL_EXECUTION_ERROR", message: input.output || "工具执行失败", retryable: false } }
        : { item: stored },
    );
    return persisted.event;
  }

  private async finishTool(context: PiRuntimeEventContext, input: {
    toolCallID: string;
    tool: string;
    output: string;
    isError: boolean;
  }) {
    const event = this.persistFinishedTool(context, input);
    if (event) await this.publish(event);
  }

  private eventSink(
    storage: SqlitePiSessionStorage,
    runtimeModel: PiModel<Api>,
    onUsage?: AgentRuntimeRequest["onUsage"],
  ): PiRuntimeEventSink {
    const pendingFor = (context: PiRuntimeEventContext) => {
      const existing = this.pending.get(context.threadID);
      if (existing) return existing;
      const created = { storage, items: new Map<string, Item>(), consumedInputIDs: new Set<string>() };
      this.pending.set(context.threadID, created);
      return created;
    };
    return {
      event: (context, event) => {
        this.options.observeHarnessEvent?.(context, event);
      },
      assistantMessageStarted: async (context, input) => {
        const timestamp = Date.now();
        const persisted = this.options.db.upsertItemWithEvent(context.threadID, {
          id: input.textItemID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "text",
          status: "running",
          data: { placement: "result", text: "" },
          createdAt: timestamp,
          updatedAt: timestamp,
        }, "item/started");
        await this.publish(persisted.event);
      },
      planStarted: async (context, input) => {
        const timestamp = Date.now();
        const persisted = this.options.db.upsertItemWithEvent(context.threadID, {
          id: input.itemID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "plan",
          status: "running",
          data: { title: "实施计划", markdown: "" },
          createdAt: timestamp,
          updatedAt: timestamp,
        }, "item/started");
        await this.publish(persisted.event);
      },
      textDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "item/agentMessage/delta",
            piItemDeltaPayload({ itemID: input.itemID, context, delta: input.delta }),
          ),
        );
      },
      planDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "plan/delta",
            piItemDeltaPayload({ itemID: input.itemID, context, delta: input.delta }),
          ),
        );
      },
      reasoningDelta: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "reasoning/textDelta",
            piItemDeltaPayload({
              itemID: input.itemID,
              context,
              delta: input.delta,
            }),
          ),
        );
      },
      assistantMessageCompleted: async (context, input) => {
        const timestamp = Date.now();
        const pending = pendingFor(context);
        const text = input.text === undefined
          ? contentText(input.content as never, "\n").trim()
          : input.text.trim();
        const usage = {
          provider: input.provider || runtimeModel.provider,
          model: input.model || runtimeModel.id,
          contextWindow: Math.max(1, Math.trunc(Number(runtimeModel.contextWindow) || 1)),
          input: input.usage.input,
          output: input.usage.output,
          cacheRead: input.usage.cacheRead,
          cacheWrite: input.usage.cacheWrite,
          reasoning: input.usage.reasoning,
        };
        if (input.text === undefined || text) {
          const currentText = this.options.db.getItem(input.textItemID);
          pending.items.set(input.textItemID, {
            id: input.textItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "text",
            status: "completed",
            data: { placement: "result", text, usage },
            ...(currentText?.ordinal === undefined ? {} : { ordinal: currentText.ordinal }),
            createdAt: currentText?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
        }
        const plan = input.plan?.trim();
        if (plan) {
          const currentPlan = this.options.db.getItem(input.planItemID);
          pending.items.set(input.planItemID, {
            id: input.planItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "plan",
            status: "completed",
            data: { title: proposedPlanTitle(plan), markdown: plan },
            ...(currentPlan?.ordinal === undefined ? {} : { ordinal: currentPlan.ordinal }),
            createdAt: currentPlan?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
        }
        const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
        await onUsage?.({
          inputTokens,
          outputTokens: usage.output,
          totalTokens: inputTokens + usage.output,
          requests: 1,
        });
        const content = Array.isArray(input.content) ? input.content : [];
        const reasoning = content
          .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
          .join("\n")
          .trim();
        if (reasoning) {
          pending.items.set(input.reasoningItemID, {
            id: input.reasoningItemID,
            turnID: context.turnID,
            agentID: context.agentID,
            type: "reasoning",
            status: "completed",
            data: { text: reasoning },
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      },
      toolStarted: async (context, input) => {
        const timestamp = Date.now();
        const timelineInput = piToolTimelineInput(input.tool, input.input);
        const item: Item = {
          id: input.toolCallID,
          turnID: context.turnID,
          agentID: context.agentID,
          type: "tool",
          status: "running",
          data: {
            callID: input.toolCallID,
            tool: input.tool,
            title: input.tool,
            state: "running",
            input: timelineInput,
            command: commandFromInput(timelineInput),
            output: null,
            error: null,
            startedAt: timestamp,
            finishedAt: null,
            durationMs: null,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const persisted = this.options.db.upsertItemWithEvent(
          context.threadID,
          item,
          "tool/callStarted",
          (stored: Item) => ({
            item: stored,
            inputSummary: commandFromInput(timelineInput) ?? input.tool,
          }),
        );
        await this.publish(persisted.event);
      },
      toolUpdated: async (context, input) => {
        await this.publish(
          createLiveEvent(
            this.options.db,
            context.threadID,
            context.turnID,
            "tool/outputDelta",
            piItemDeltaPayload({
              itemID: input.toolCallID,
              context,
              delta: outputDelta(input.update),
            }),
          ),
        );
      },
      toolFinished: async (context, input) => {
        const output = typeof input.result === "string" ? input.result : "";
        await this.finishTool(context, { ...input, output });
      },
      queueConsumed: async (context, input) => {
        if (input.delivery !== "steer") return;
        const pending = pendingFor(context);
        for (const inputID of input.inputIDs) pending.consumedInputIDs.add(inputID);
      },
      savePoint: async (context) => {
        const pending = this.pending.get(context.threadID);
        const durable: Array<ReturnType<AgentDatabase["insertEvent"]>> = [];
        this.options.db.transaction(() => {
          storage.flush();
          if (pending) {
            for (const item of pending.items.values()) {
              this.options.db.upsertItem(context.threadID, item);
              const persisted = this.options.db.getItem(item.id) ?? item;
              durable.push(
                this.options.db.insertEvent(
                  context.threadID,
                  context.turnID,
                  "item/completed",
                  { item: persisted },
                ),
              );
            }
            const consumedInputIDs = this.options.db.consumeGuideMailbox(
              context.turnID,
              [...pending.consumedInputIDs],
            );
            for (const inputID of consumedInputIDs) {
              durable.push(this.options.db.insertEvent(
                context.threadID,
                context.turnID,
                "queue/updated",
                {
                  threadId: context.threadID,
                  turnId: context.turnID,
                  inputId: inputID,
                  action: "steer-consumed",
                },
              ));
            }
          }
        });
        if (pending) this.pending.delete(context.threadID);
        for (const event of durable) await this.publish(event);
      },
      compacted: async (context, input) => {
        const afterCount = (await storage.getEntries()).length;
        await this.publish(
          this.options.db.insertEvent(
            context.threadID,
            context.turnID,
            "context/compacted",
            piCompactionEventPayload({
              compactionID: input.entryID,
              beforeCount: input.beforeCount,
              afterCount,
              beforeTokens: input.tokensBefore,
            }),
          ),
        );
      },
      aborted: async (context) => {
        storage.discardPending();
        this.pending.delete(context.threadID);
      },
    };
  }

  async run(request: AgentRuntimeRequest) {
    // Serialized OpenAI RunState cannot be replayed safely. Continue only from
    // durable Pi session context; side effects remain protected by toolCallID.
    const resolved = await request.resolveModel(request.fallbackModel);
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
      await session.moveTo(assistantEntry.id);
      let resolutionText = request.resume.decision === "deny"
        ? request.resume.answer
          ? `用户拒绝了此工具调用，并要求：${request.resume.answer}`
          : "用户拒绝了此工具调用，请改用其他方案。"
        : request.resume.answer ?? request.resume.decision ?? "continue";
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
      if (
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
          resolutionText = resumedToolResultText(grant, toolCall.name);
        } catch (cause) {
          isError = true;
          resolutionText = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause));
        }
      }
      if (
        request.resume.decision === "allow" &&
        !lifecycleNames.has(toolCall.name)
      ) {
        try {
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
          resolutionText = resumedToolResultText(resolution, toolCall.name);
        } catch (cause) {
          isError = true;
          resolutionText = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause));
        }
      }
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
      let completedEvent: ReturnType<AgentDatabase["insertEvent"]> | null = null;
      this.options.db.transaction(() => {
        storage.flush();
        if (request.resume?.checkpointID) this.options.db.completeQuestionResume(request.resume.checkpointID);
        completedEvent = this.persistFinishedTool({
          threadID: request.threadID,
          turnID: request.turnID,
          agentID: request.agentID,
        }, {
          toolCallID: request.resume!.toolCallID!,
          tool: toolCall.name,
          output: resolutionText,
          isError,
        });
      });
      if (completedEvent) await this.publish(completedEvent);
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
      harnessFactory: {
        resolve: async () => ({
          models: this.options.models,
          model,
          session,
        }),
      } as never,
      eventSink: this.eventSink(storage, model, request.onUsage),
      beforeToolCall: async (_runtimeRequest, input) => {
        if ((PI_LIFECYCLE_TOOLS as readonly string[]).includes(input.tool))
          return undefined;
        const decision = await this.options.toolExecutor.previewApproval(
          input.tool,
          input.input,
          executionContext,
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
    const result = await runtime.run({
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
    });
    return paused
      ? { status: "paused" as const, output: result.output }
      : result;
  }

  toolExposure(request: AgentRuntimeRequest | (ToolExposureInput & { permissionConfig?: never })) {
    const runtime = request as AgentRuntimeRequest;
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
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
    }, runtime.toolCatalog);
  }

  async compact(threadID: string, instructions?: string) {
    const runtime = this.active.get(threadID);
    if (runtime) return runtime.compact(threadID, instructions);
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
    const afterCount = (await session.getEntries()).length;
    const compactionID = entryID ?? crypto.randomUUID();
    let event!: ReturnType<AgentDatabase["insertEvent"]>;
    this.options.db.transaction(() => {
      storage.flush();
      event = this.options.db.insertEvent(
        threadID,
        null,
        "context/compacted",
        piCompactionEventPayload({
          compactionID,
          beforeCount,
          afterCount,
          beforeTokens: result.tokensBefore,
        }),
      );
    });
    await this.publish(event);
    return result;
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
  }
}

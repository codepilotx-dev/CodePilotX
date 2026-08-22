import { AgentHarness } from "../harness/agent-harness"
import { DeferredToolCatalog } from "../../tool/harness/deferred-tool-catalog"
import { type AssistantMessage, type ImageContent } from "@earendil-works/pi-ai"
import { z } from "zod"
import { AgentError } from "../../domain"
import type { SubagentResult } from "../../domain"
import { PromptComposer } from "../../prompt/PromptComposer"
import { inferPromptCacheRuntimePolicy } from "../../prompt/PromptCache"
import { secretScrubber } from "../../security/SecretScrubber"
import { PiEventAdapter } from "./PiEventAdapter"
import { applyPromptCacheRuntimePolicy } from "./PiPromptCacheAdapter"
import { adaptToolDefinition, createPiTools } from "./PiToolAdapter"
import type { ActiveHarness, HarnessRunResult, HarnessRuntimeOptions, HarnessRuntimeRequest } from "./types"
import type { RuntimeCompactionTrigger } from "./types"
import {
  isProviderContextOverflow,
  REACTIVE_COMPACTION_INSTRUCTIONS,
  REACTIVE_CONTINUATION_PROMPT,
} from "./ContextOverflow"

const subagentResultSchema = z.object({
  outcome: z.enum(["succeeded", "partial", "blocked"]),
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(["info", "warning", "error"]) })),
  changedFiles: z.array(z.object({ path: z.string(), summary: z.string() })),
  validation: z.array(z.object({ command: z.string(), status: z.enum(["passed", "failed", "skipped"]), output: z.string().optional() })),
  risks: z.array(z.string()),
  references: z.array(z.object({ kind: z.enum(["file", "url", "thread", "subagent"]), value: z.string(), label: z.string().optional() })),
})

const promptContext = (request: HarnessRuntimeRequest, contextItems: readonly unknown[]) => {
  const attachments = request.attachments?.flatMap((attachment) => attachment.kind === "text"
    ? [`<attachment name=${JSON.stringify(attachment.name)}>${attachment.text}</attachment>`]
    : []) ?? []
  const contextual = contextItems.flatMap((item) => {
    const content = (item as { content?: Array<{ text?: unknown }> }).content
    return content?.flatMap((part) => typeof part.text === "string" ? [part.text] : []) ?? []
  })
  return [...contextual, ...attachments, request.content].filter(Boolean).join("\n\n")
}

const promptImages = (request: HarnessRuntimeRequest): ImageContent[] => request.attachments?.flatMap((attachment) => attachment.kind === "image"
  ? [{ type: "image" as const, data: attachment.base64, mimeType: attachment.mediaType }]
  : []) ?? []

/**
 * Pi runtime core. SQLite/outbox persistence is supplied through PiRuntimeEventSink;
 * this class never publishes a durable event before the sink's transaction completes.
 */
export async function executeHarnessRun(options: HarnessRuntimeOptions, request: HarnessRuntimeRequest): Promise<HarnessRunResult> {
    if (request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const dependencies = await options.harnessFactory.resolve(request)
    // A pre-composed bundle is authoritative (frozen by the turn composition);
    // otherwise compose here so this function stays usable as a stateless facade.
    const bundle = request.bundle ?? new PromptComposer().compose({
      threadID: request.threadID,
      mode: request.taskMode,
      profile: request.profile ?? "main",
      exposedTools: request.exposedTools,
      sections: request.promptSections,
    })
    const initialCachePolicy = inferPromptCacheRuntimePolicy(request.model, bundle.cacheKey)
    await request.onPromptComposed?.(bundle)

    let finalizedResult: SubagentResult | undefined
    const lifecycle = {
      ...options.lifecycle,
      ...(options.lifecycle?.finalizeResult ? {
        finalizeResult: async (input: SubagentResult, id: string) => {
          finalizedResult = subagentResultSchema.parse(input) as SubagentResult
          return options.lifecycle!.finalizeResult!(finalizedResult, id)
        },
      } : {}),
    }
    const tools = createPiTools({ executor: options.toolExecutor, request }, lifecycle)
    const deferredDefinitions = options.toolExecutor.deferredDefinitions({
      taskMode: request.taskMode,
      sandboxMode: request.permissionConfig.sandboxMode,
      profile: request.profile ?? "main",
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
    }, request.toolCatalog)
    const deferredToolCatalog = new DeferredToolCatalog(deferredDefinitions.map((definition) => ({
      name: definition.sdkName,
      label: definition.sdkName,
      description: typeof definition.description === "string" ? definition.description : definition.sdkName,
      load: () => adaptToolDefinition(definition, { executor: options.toolExecutor, request }),
    })))
    const harness = new AgentHarness({
      session: dependencies.session,
      models: dependencies.models,
      ...(dependencies.resources ? { resources: dependencies.resources } : {}),
      model: request.model,
      thinkingLevel: request.thinkingLevel ?? "off",
      systemPrompt: bundle.instructions,
      tools,
      activeToolNames: tools.map((tool) => tool.name),
      deferredToolCatalog,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      streamOptions: {
        timeoutMs: 120_000,
        maxRetries: 2,
        maxRetryDelayMs: 10_000,
        cacheRetention: initialCachePolicy.cacheRetention,
        metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      },
    })
    harness.on("before_provider_request", (event) => ({
      streamOptions: {
        cacheRetention: inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey).cacheRetention,
        metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      },
    }))
    harness.on("before_provider_payload", (event) => {
      const policy = inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey)
      const applied = applyPromptCacheRuntimePolicy(event.payload, policy, bundle.stableContextText)
      return { payload: secretScrubber.scrub(applied.payload) }
    })
    const pausedToolCalls = new Set<string>()
    if (options.beforeToolCall) harness.on("tool_call", async (event) => {
      const result = await options.beforeToolCall!(request, { toolCallID: event.toolCallId, tool: event.toolName, input: event.input })
      if (result?.pause) pausedToolCalls.add(event.toolCallId)
      return result ? { ...(result.block === undefined ? {} : { block: result.block }), ...(result.reason === undefined ? {} : { reason: result.reason }) } : undefined
    })
    harness.on("tool_result", (event) => pausedToolCalls.has(event.toolCallId) ? { terminate: true } : undefined)
    let compactionTrigger: RuntimeCompactionTrigger | null = null
    const adapter = new PiEventAdapter(
      { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      options.eventSink ?? {},
      {
        parseProposedPlan: request.taskMode === "plan",
        resolveSessionEntryID: () => dependencies.session.getLeafId(),
        resolveCompactionContext: () => ({
          trigger: compactionTrigger ?? "manual",
          promptText: bundle.instructions,
        }),
      },
    )
    const unsubscribe = harness.subscribe((event) => adapter.handle(event))
    const compact = async (trigger: RuntimeCompactionTrigger, instructions?: string) => {
      compactionTrigger = trigger
      try {
        return await harness.compact(instructions)
      } finally {
        compactionTrigger = null
      }
    }
    const active = { harness, unsubscribe, compact } as unknown as ActiveHarness
    options.activated?.(request.threadID, active)
    const onAbort = () => { void harness.abort() }
    request.signal.addEventListener("abort", onAbort, { once: true })
    try {
      const images = promptImages(request)
      let message: AssistantMessage = await harness.prompt(promptContext(request, bundle.contextItems), images.length > 0 ? { images } : undefined)
      if (message.stopReason === "error" && isProviderContextOverflow(message.errorMessage)) {
        try {
          await compact("reactive", REACTIVE_COMPACTION_INSTRUCTIONS)
          message = await harness.prompt(REACTIVE_CONTINUATION_PROMPT)
        } catch {
          await options.compaction?.recordFailure(request.threadID, "reactive")
          throw new AgentError("PI_CONTEXT_WINDOW_EXCEEDED", "模型上下文超过窗口限制，自动压缩未能恢复", 413)
        }
        if (message.stopReason === "error" && isProviderContextOverflow(message.errorMessage)) {
          await options.compaction?.recordFailure(request.threadID, "reactive")
          throw new AgentError("PI_CONTEXT_WINDOW_EXCEEDED", "模型上下文超过窗口限制，压缩后仍无法继续", 413)
        }
      }
      if (message.stopReason === "error") throw new AgentError("PI_AGENT_FAILED", message.errorMessage ?? "Pi Agent 执行失败", 502)
      if (message.stopReason === "aborted" || request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
      const output = adapter.outputText(message.content)
      const compaction = options.compaction
      if (
        compaction
        && (await request.canAutoCompact?.() ?? true)
        && await compaction.shouldAutoCompact(request.threadID)
      ) {
        try {
          await compact("automatic")
        } catch {
          await compaction.recordFailure(request.threadID, "automatic")
        }
      }
      return { status: "completed", output, ...(finalizedResult ? { result: finalizedResult } : {}) }
    } finally {
      request.signal.removeEventListener("abort", onAbort)
    }
}

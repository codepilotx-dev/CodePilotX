import { AgentHarness, createTurnComposition, DeferredToolCatalog } from "@codepilotx/pi-agent-core"
import { type AssistantMessage, type ImageContent } from "@earendil-works/pi-ai"
import { z } from "zod"
import { AgentError } from "../../domain"
import type { SubagentResult } from "../../domain"
import { inferPromptCacheRuntimePolicy } from "../../prompt/PromptCache"
import { secretScrubber } from "../../security/SecretScrubber"
import { PiEventAdapter } from "./PiEventAdapter"
import { applyPromptCacheRuntimePolicy } from "./PiPromptCacheAdapter"
import { adaptToolDefinition, createPiTools } from "./PiToolAdapter"
import type { ActivePiHarness, PiAgentRuntimeApi, PiAgentRuntimeOptions, PiRunResult, PiRuntimeRequest } from "./types"
import type { RuntimeCompactionTrigger } from "./types"
import {
  isProviderContextOverflow,
  REACTIVE_COMPACTION_INSTRUCTIONS,
  REACTIVE_CONTINUATION_PROMPT,
} from "./ContextOverflow"
import type { BoundRuntimeComposition } from "../../runtime-composition"

const subagentResultSchema = z.object({
  outcome: z.enum(["succeeded", "partial", "blocked"]),
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(["info", "warning", "error"]) })),
  changedFiles: z.array(z.object({ path: z.string(), summary: z.string() })),
  validation: z.array(z.object({ command: z.string(), status: z.enum(["passed", "failed", "skipped"]), output: z.string().optional() })),
  risks: z.array(z.string()),
  references: z.array(z.object({ kind: z.enum(["file", "url", "thread", "subagent"]), value: z.string(), label: z.string().optional() })),
})

const promptContext = (request: PiRuntimeRequest, contextItems: readonly unknown[]) => {
  const attachments = request.attachments?.flatMap((attachment) => attachment.kind === "text"
    ? [`<attachment name=${JSON.stringify(attachment.name)}>${attachment.text}</attachment>`]
    : []) ?? []
  const contextual = contextItems.flatMap((item) => {
    const content = (item as { content?: Array<{ text?: unknown }> }).content
    return content?.flatMap((part) => typeof part.text === "string" ? [part.text] : []) ?? []
  })
  return [...contextual, ...attachments, request.content].filter(Boolean).join("\n\n")
}

const promptImages = (request: PiRuntimeRequest): ImageContent[] => request.attachments?.flatMap((attachment) => attachment.kind === "image"
  ? [{ type: "image" as const, data: attachment.base64, mimeType: attachment.mediaType }]
  : []) ?? []

/**
 * Pi runtime core. SQLite/outbox persistence is supplied through PiRuntimeEventSink;
 * this class never publishes a durable event before the sink's transaction completes.
 */
export class PiAgentRuntime implements PiAgentRuntimeApi {
  private readonly harnesses = new Map<string, ActivePiHarness>()
  /** Cached composed turns released via {@link PiAgentRuntime.run}. */
  private readonly releasedCompositions = new WeakSet<BoundRuntimeComposition>()

  constructor(private readonly options: PiAgentRuntimeOptions) {}

  async run(request: PiRuntimeRequest): Promise<PiRunResult> {
    if (request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const previous = this.harnesses.get(request.threadID)
    if (previous) {
      await previous.harness.waitForIdle()
      previous.unsubscribe()
    }
    const dependencies = await this.options.harnessFactory.resolve(request)
    const composition = request.composition
    const snapshot = composition.plan.snapshot
    const bundle = snapshot.prompt
    const initialCachePolicy = inferPromptCacheRuntimePolicy(composition.harness.model, snapshot.hashes.promptHash)
    let finalizedResult: SubagentResult | undefined
    const lifecycle = {
      ...this.options.lifecycle,
      ...(this.options.lifecycle?.finalizeResult ? {
        finalizeResult: async (input: SubagentResult, id: string) => {
          finalizedResult = subagentResultSchema.parse(input) as SubagentResult
          return this.options.lifecycle!.finalizeResult!(finalizedResult, id)
        },
      } : {}),
    }
    const adapterTools = createPiTools({ executor: this.options.toolExecutor, request }, lifecycle)
    const deferredNames = new Set(snapshot.tools.deferred)
    const registeredTools = adapterTools.filter((tool) => !deferredNames.has(tool.name))
    const expectedRegistered = snapshot.tools.exposed.filter((name) => !deferredNames.has(name))
    if (
      registeredTools.length !== expectedRegistered.length
      || expectedRegistered.some((name) => !registeredTools.some((tool) => tool.name === name))
    ) throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen tool bindings are unavailable", 409)
    const deferredToolCatalog = new DeferredToolCatalog(
      snapshot.tools.deferred.map((name) => ({
        name,
        label: name,
        description: name,
        load: async () => {
          const definition = this.options.toolExecutor.definition(name)
          if (!definition) throw new Error(`Deferred tool ${name} missing from registry`)
          return adaptToolDefinition(definition, { executor: this.options.toolExecutor, request })
        },
      })),
    )
    const harnessComposition = createTurnComposition({
      compositionID: snapshot.identity.id,
      compositionHash: snapshot.identity.hash,
      compositionVersion: snapshot.identity.version,
      model: composition.harness.model,
      thinkingLevel: composition.harness.thinkingLevel,
      systemPrompt: bundle.instructions,
      tools: registeredTools,
      initialActiveNames: expectedRegistered,
      deferredAllowedNames: snapshot.tools.deferred,
      resources: composition.harness.resources,
      toolContext: composition.harness.toolContext,
      streamOptions: composition.harness.streamOptions,
    })
    const harness = new AgentHarness({
      session: dependencies.session,
      models: dependencies.models,
      composition: harnessComposition,
      deferredToolCatalog,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    })
    harness.on("before_provider_request", (event) => ({
      streamOptions: {
        cacheRetention: inferPromptCacheRuntimePolicy(event.model ?? composition.harness.model, snapshot.hashes.promptHash).cacheRetention,
        metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      },
    }))
    harness.on("before_provider_payload", (event) => {
      const policy = inferPromptCacheRuntimePolicy(event.model ?? composition.harness.model, snapshot.hashes.promptHash)
      const applied = applyPromptCacheRuntimePolicy(event.payload, policy, bundle.stableContextText)
      return { payload: secretScrubber.scrub(applied.payload) }
    })
    const pausedToolCalls = new Set<string>()
    if (this.options.beforeToolCall) harness.on("tool_call", async (event) => {
      const result = await this.options.beforeToolCall!(request, { toolCallID: event.toolCallId, tool: event.toolName, input: event.input })
      if (result?.pause) pausedToolCalls.add(event.toolCallId)
      return result ? { ...(result.block === undefined ? {} : { block: result.block }), ...(result.reason === undefined ? {} : { reason: result.reason }) } : undefined
    })
    harness.on("tool_result", (event) => pausedToolCalls.has(event.toolCallId) ? { terminate: true } : undefined)
    let compactionTrigger: RuntimeCompactionTrigger | null = null
    const adapter = new PiEventAdapter(
      { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      this.options.eventSink ?? {},
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
    this.harnesses.set(request.threadID, { harness, unsubscribe, compact })
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
          await this.options.compaction?.recordFailure(request.threadID, "reactive")
          throw new AgentError("PI_CONTEXT_WINDOW_EXCEEDED", "模型上下文超过窗口限制，自动压缩未能恢复", 413)
        }
        if (message.stopReason === "error" && isProviderContextOverflow(message.errorMessage)) {
          await this.options.compaction?.recordFailure(request.threadID, "reactive")
          throw new AgentError("PI_CONTEXT_WINDOW_EXCEEDED", "模型上下文超过窗口限制，压缩后仍无法继续", 413)
        }
      }
      if (message.stopReason === "error") throw new AgentError("PI_AGENT_FAILED", message.errorMessage ?? "Pi Agent 执行失败", 502)
      if (message.stopReason === "aborted" || request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
      const output = adapter.outputText(message.content)
      const compaction = this.options.compaction
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
      this.releaseComposition(request.composition)
    }
  }

  private releaseComposition(composition: BoundRuntimeComposition) {
    if (this.releasedCompositions.has(composition)) return
    this.releasedCompositions.add(composition)
    void composition.release().catch(() => undefined)
  }

  private active(threadID: string) {
    const active = this.harnesses.get(threadID)
    if (!active) throw new AgentError("PI_HARNESS_NOT_FOUND", `Thread ${threadID} 尚未创建 Pi Harness`, 404)
    return active.harness
  }

  steer(threadID: string, content: string, images?: ImageContent[], inputID?: string) {
    return this.active(threadID).steer(content, {
      ...(images ? { images } : {}),
      ...(inputID ? { inputId: inputID } : {}),
    })
  }

  followUp(threadID: string, content: string, images?: ImageContent[]) {
    return this.active(threadID).followUp(content, images ? { images } : undefined)
  }

  abort(threadID: string) {
    return this.active(threadID).abort().then(() => undefined)
  }

  compact(threadID: string, instructions?: string) {
    return this.activeRecord(threadID).compact("manual", instructions)
  }

  private activeRecord(threadID: string) {
    const active = this.harnesses.get(threadID)
    if (!active) throw new AgentError("PI_HARNESS_NOT_FOUND", `Thread ${threadID} 尚未创建 Pi Harness`, 404)
    return active
  }

  async dispose() {
    const active = [...this.harnesses.values()]
    this.harnesses.clear()
    await Promise.allSettled(active.map(async ({ harness, unsubscribe }) => {
      unsubscribe()
      await harness.abort()
    }))
  }
}

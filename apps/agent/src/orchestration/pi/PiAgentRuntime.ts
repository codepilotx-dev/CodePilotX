import { AgentHarness, DeferredToolCatalog } from "@codepilotx/pi-agent-core"
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
import type { ActivePiHarness, PiAgentRuntimeApi, PiAgentRuntimeOptions, PiRunResult, PiRuntimeRequest } from "./types"

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
  private readonly composer = new PromptComposer()

  constructor(private readonly options: PiAgentRuntimeOptions) {}

  async run(request: PiRuntimeRequest): Promise<PiRunResult> {
    if (request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
    const previous = this.harnesses.get(request.threadID)
    if (previous) {
      await previous.harness.waitForIdle()
      previous.unsubscribe()
    }
    const dependencies = await this.options.harnessFactory.resolve(request)
    const bundle = this.composer.compose({
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
      ...this.options.lifecycle,
      ...(this.options.lifecycle?.finalizeResult ? {
        finalizeResult: async (input: SubagentResult, id: string) => {
          finalizedResult = subagentResultSchema.parse(input) as SubagentResult
          return this.options.lifecycle!.finalizeResult!(finalizedResult, id)
        },
      } : {}),
    }
    const tools = createPiTools({ executor: this.options.toolExecutor, request }, lifecycle)
    const deferredDefinitions = this.options.toolExecutor.deferredDefinitions({
      taskMode: request.taskMode,
      sandboxMode: request.permissionConfig.sandboxMode,
      profile: request.profile ?? "main",
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
    }, request.toolCatalog)
    const deferredToolCatalog = new DeferredToolCatalog(deferredDefinitions.map((definition) => ({
      name: definition.sdkName,
      label: definition.sdkName,
      description: typeof definition.description === "string" ? definition.description : definition.sdkName,
      load: () => adaptToolDefinition(definition, { executor: this.options.toolExecutor, request }),
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
    if (this.options.beforeToolCall) harness.on("tool_call", async (event) => {
      const result = await this.options.beforeToolCall!(request, { toolCallID: event.toolCallId, tool: event.toolName, input: event.input })
      if (result?.pause) pausedToolCalls.add(event.toolCallId)
      return result ? { ...(result.block === undefined ? {} : { block: result.block }), ...(result.reason === undefined ? {} : { reason: result.reason }) } : undefined
    })
    harness.on("tool_result", (event) => pausedToolCalls.has(event.toolCallId) ? { terminate: true } : undefined)
    const adapter = new PiEventAdapter(
      { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      this.options.eventSink ?? {},
      { parseProposedPlan: request.taskMode === "plan" },
    )
    const unsubscribe = harness.subscribe((event) => adapter.handle(event))
    this.harnesses.set(request.threadID, { harness, unsubscribe })
    const onAbort = () => { void harness.abort() }
    request.signal.addEventListener("abort", onAbort, { once: true })
    try {
      const images = promptImages(request)
      const message: AssistantMessage = await harness.prompt(promptContext(request, bundle.contextItems), images.length > 0 ? { images } : undefined)
      if (message.stopReason === "error") throw new AgentError("PI_AGENT_FAILED", message.errorMessage ?? "Pi Agent 执行失败", 502)
      if (message.stopReason === "aborted" || request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
      const output = adapter.outputText(message.content)
      return { status: "completed", output, ...(finalizedResult ? { result: finalizedResult } : {}) }
    } finally {
      request.signal.removeEventListener("abort", onAbort)
    }
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
    return this.active(threadID).compact(instructions)
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

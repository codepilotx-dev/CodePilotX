import { AgentHarness, DeferredToolCatalog } from "@codepilotx/pi-agent-core"
import { type AssistantMessage, type ImageContent } from "@earendil-works/pi-ai"
import { z } from "zod"
import { AgentError } from "../../domain"
import type { SubagentResult } from "../../domain"
import { PromptComposer } from "../../prompt/PromptComposer"
import type { PromptBundle, PromptSection } from "../../prompt/types"
import { inferPromptCacheRuntimePolicy } from "../../prompt/PromptCache"
import { secretScrubber } from "../../security/SecretScrubber"
import { mergeToolGuards } from "../../tool/ToolPipeline"
import { PiEventAdapter } from "./PiEventAdapter"
import { applyPromptCacheRuntimePolicy } from "./PiPromptCacheAdapter"
import { adaptToolDefinition, createPiTools } from "./PiToolAdapter"
import type { ActivePiHarness, PiAgentRuntimeApi, PiAgentRuntimeOptions, PiRunResult, PiRuntimeRequest } from "./types"
import type { RuntimeCompactionTrigger } from "./types"
import { AgentRuntimeScopeImpl, type AgentRuntimeIdentity, type RuntimeDisposeReason } from "../../runtime/AgentRuntimeScope"
import {
  createRuntimeSnapshot,
  resolveRuntimePresetID,
  type RuntimeContributionBuilders,
  type RuntimeGuard,
  type RuntimeObserver,
  type RuntimeSnapshot,
} from "../../runtime/RuntimeContribution"
import type { ToolDefinition } from "../../tool/ToolRegistry"
import { TurnToolCatalog } from "../../tool/ToolRegistry"
import type { StoredRuntimeManifestV2 } from "../../storage/repositories/model-request-snapshot-repository"
import type { RuntimeStepService } from "../../runtime/RuntimeStepService"
import { RuntimeInterceptorChain } from "../../runtime/RuntimeInterceptorChain"
import type { RuntimeInterceptor } from "../../runtime/RuntimeContribution"
import { runtimeContextDigest, computeCanonicalMessagesDigest } from "../../storage/repositories/runtime-step-repository"
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
 * Pi Agent 宿主运行时。
 *
 * 关键不变式：
 * - 每次 run() 必须在初始化任意位置失败时把 active harness 归零并逆序释放资源；
 * - 贡献必须在快照冻结前登记；
 * - 快照冻结后创建 AgentHarness 与 DeferredToolCatalog；
 * - model-visible context invariant：发送前持久化并比对出站 digest；
 * - RequestSnapshot 在 Provider 请求发出前记录，绝不在响应返回后补录。
 * - harness.subscribe(adapter.handle) is invoked before PiAgentRuntime's
 * event handler; this class never publishes a durable event before the projector's
 * transaction completes.
 */
export class PiAgentRuntime implements PiAgentRuntimeApi {
  private readonly harnesses = new Map<string, ActivePiHarness>()
  /** 每个 thread 上一次运行结束的方式，用于在 harness 替换时给出正确的释放原因。 */
  private readonly outcomes = new Map<string, RuntimeDisposeReason>()
  private readonly composer = new PromptComposer()

  constructor(private readonly options: PiAgentRuntimeOptions) {}

  async run(request: PiRuntimeRequest): Promise<PiRunResult> {
    const identity: AgentRuntimeIdentity = {
      threadID: request.threadID,
      turnID: request.turnID,
      agentID: request.agentID,
      sessionID: request.sessionID,
    }
    const previous = this.harnesses.get(request.threadID)
    if (previous) {
      await previous.harness.waitForIdle()
      await previous.scope.dispose(this.outcomes.get(request.threadID) ?? "settled")
      this.outcomes.delete(request.threadID)
    }
    // ── 1. 先创建本轮 scope：后续获取与注册全部挂入 scope，随释放逆序回收 ──
    const scope = new AgentRuntimeScopeImpl(identity)
    let stepStart: import("../../runtime/RuntimeStepService").RuntimeStepStartResult | null = null
    let stepCompleted = false
    let onAbort: (() => void) | null = null
    try {
      if (request.signal.aborted) throw new AgentError("RUN_ABORTED", "任务已停止", 499)
      // ── 2. 获取运行时依赖与资源租约（MCP/插件 generation lease 装配位） ──
      const dependencies = await this.options.harnessFactory.resolve(request)
      if (this.options.acquireLeases) {
        const leases = await this.options.acquireLeases(request)
        for (const lease of leases) scope.add(() => lease.release())
      }
      // ── 3. 解析贡献计划：只注册实际启用的贡献，登记发生在快照冻结之前 ──
      const collectedTools: ToolDefinition[] = []
      const collectedSections: PromptSection[] = []
      const collectedGuards: RuntimeGuard[] = []
      const collectedObservers: RuntimeObserver[] = []
      const collectedInterceptors: RuntimeInterceptor[] = []
      const builders: RuntimeContributionBuilders = {
        addToolDefinition: (definition) => { collectedTools.push(definition) },
        addPromptSection: (section) => { collectedSections.push(section) },
        addGuard: (guard) => { collectedGuards.push(guard) },
        addObserver: (observer) => { collectedObservers.push(observer) },
        addInterceptor: (interceptor) => { collectedInterceptors.push(interceptor) },
      }
      for (const contribution of this.options.contributions?.resolveEnabled() ?? []) {
        const disposer = contribution.register({ identity, scope, builders })
        if (disposer) scope.add(disposer)
      }
      // ── 4. 组合 prompt/tools/guards/observers（快照冻结之前） ──
      const bundle = this.composer.compose({
        threadID: request.threadID,
        mode: request.taskMode,
        profile: request.profile ?? "main",
        exposedTools: request.exposedTools,
        sections: [...request.promptSections, ...collectedSections],
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
      // ── 5. per-turn frozen ToolCatalog：base + contributed 合并，重复 SDK name 在
      // Harness 创建前 fail closed；exposure/adapter/执行/快照共用同一目录 ──
      const frozenCatalog = new TurnToolCatalog(
        request.toolCatalog ?? this.options.toolExecutor.baseCatalog(),
        collectedTools,
      )
      const interceptorChain = new RuntimeInterceptorChain(collectedInterceptors)
      const runtimeRequest: PiRuntimeRequest = { ...request, toolCatalog: frozenCatalog }
      const tools = createPiTools({ executor: this.options.toolExecutor, request: runtimeRequest }, lifecycle)
      const deferredDefinitions = this.options.toolExecutor.deferredDefinitions({
        taskMode: request.taskMode,
        sandboxMode: request.permissionConfig.sandboxMode,
        profile: request.profile ?? "main",
        ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
      }, frozenCatalog)
      // ── 6. 冻结本轮 RuntimeSnapshot：运行期间配置变化只影响下一次运行 ──
      const snapshot = this.freezeSnapshot(frozenCatalog, bundle, request)
      const deferredToolCatalog = new DeferredToolCatalog(deferredDefinitions.map((definition) => ({
        name: definition.sdkName,
        label: definition.sdkName,
        description: typeof definition.description === "string" ? definition.description : definition.sdkName,
        load: () => adaptToolDefinition(definition, { executor: this.options.toolExecutor, request: runtimeRequest }),
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
      // ── 6. 最后创建 AgentHarness；中止最后释放（先解除订阅与 Hook，再中止执行体） ──
      scope.add(() => harness.abort().then(() => undefined))
      scope.add(harness.on("before_provider_request", (event) => ({
        streamOptions: {
          cacheRetention: inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey).cacheRetention,
          metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
        },
      })))
      let attemptOrdinal = 0
      scope.add(harness.on("before_provider_payload", async (event) => {
        const policy = inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey)
        const applied = applyPromptCacheRuntimePolicy(event.payload, policy, bundle.stableContextText)
        const safePayload = secretScrubber.scrub(applied.payload)
        // ── model-visible invariant：发送前持久化规范化 semantic context；
        // 失败（含 scrub 失败）阻止 Provider 请求，绝不发送无法重建的模型输入 ──
        if (this.options.runtimeSteps && stepStart) {
          const entries = await dependencies.session.getEntries()
          const messageEntryIds = entries
            .filter((entry) => entry.type === "message")
            .map((entry) => entry.id)
          const payloadMessages = safePayload && typeof safePayload === "object"
            && Array.isArray((safePayload as Record<string, unknown>).messages)
            ? ((safePayload as Record<string, unknown>).messages as unknown[])
            : []
          const messageDigest = computeCanonicalMessagesDigest(payloadMessages)
          const snapshotRecord = await this.options.runtimeSteps.persistContextSnapshot({
            threadId: request.threadID,
            turnId: request.turnID,
            stepId: stepStart.step.id,
            attemptOrdinal,
            piSessionId: request.sessionID,
            piLeafEntryId: await dependencies.session.getLeafId(),
            messageEntryIds,
            messageDigest,
            promptText: bundle.instructions,
            toolCatalogJson: JSON.stringify(frozenCatalog.all().map((definition) => ({
              sdkName: definition.sdkName,
              inputSchema: definition.inputSchema,
            }))),
            runtimeManifestJson: JSON.stringify(this.buildRuntimeManifestV2(snapshot)),
          })
          attemptOrdinal += 1
          // 出站 digest 与持久记录一致才允许发送。
          const outboundDigest = runtimeContextDigest({
            messageEntryIds,
            messageDigest,
            promptText: bundle.instructions,
            toolCatalogJson: JSON.stringify(frozenCatalog.all().map((definition) => ({
              sdkName: definition.sdkName,
              inputSchema: definition.inputSchema,
            }))),
            runtimeManifestJson: JSON.stringify(this.buildRuntimeManifestV2(snapshot)),
          })
          if (outboundDigest !== snapshotRecord.contextDigest) {
            throw new AgentError("RUNTIME_CONTEXT_INVARIANT", "模型上下文与持久记录不一致，已阻止请求", 409)
          }
        }
        // 完整请求快照：缓存标记、消息转换与 Provider payload 构造已完成，
        // SecretScrubber 已执行，尚未交给 pi-ai 发送；不含认证头与响应数据。
        await this.options.requestSnapshot?.capture({
          threadID: request.threadID,
          turnID: request.turnID,
          agentID: request.agentID,
          sessionID: request.sessionID,
          providerId: String(event.model.provider),
          api: String(event.model.api),
          modelId: String(event.model.id),
          payload: safePayload,
          runtimeManifest: this.buildRuntimeManifestV2(snapshot),
        })
        return { payload: safePayload }
      }))
      const pausedToolCalls = new Set<string>()
      if (this.options.beforeToolCall || collectedGuards.length > 0) scope.add(harness.on("tool_call", async (event) => {
        const result = this.options.beforeToolCall
          ? await this.options.beforeToolCall!(runtimeRequest, { toolCallID: event.toolCallId, tool: event.toolName, input: event.input })
          : undefined
        if (result?.pause) pausedToolCalls.add(event.toolCallId)
        // waterfall：tool-pre-execute interceptor 可重写输入或拒绝（handled 语义）。
        const intercepted = await interceptorChain.run<{ block?: boolean; reason?: string; input?: Record<string, unknown> }>(
          "tool-pre-execute",
          { toolName: event.toolName, input: event.input, block: result?.block, reason: result?.reason },
        )
        if (intercepted?.block) return { block: true, reason: intercepted.reason ?? "interceptor 拒绝执行" }
        // 贡献型 guard 单调合并：deny/require-approval 一律阻止调用（fail-closed）。
        const merged = mergeToolGuards(await Promise.all(
          collectedGuards.map((guard) => guard({ toolName: event.toolName, input: event.input })),
        ))
        if (merged.kind !== "continue") return { block: true, reason: merged.reason }
        if (!result) return undefined
        return { ...(result.block === undefined ? {} : { block: result.block }), ...(result.reason === undefined ? {} : { reason: result.reason }) }
      }))
      scope.add(harness.on("tool_result", (event) => pausedToolCalls.has(event.toolCallId) ? { terminate: true } : undefined))
      let compactionTrigger: RuntimeCompactionTrigger | null = null
      const adapter = new PiEventAdapter(
        { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
        this.options.eventHandler ?? (() => undefined),
        {
          parseProposedPlan: request.taskMode === "plan",
          resolveSessionEntryID: () => dependencies.session.getLeafId(),
          resolveCompactionContext: () => ({
            trigger: compactionTrigger ?? "manual",
            promptText: bundle.instructions,
          }),
          ...(this.options.observeHarnessEvent ? {
            observe: (event) => {
              this.options.observeHarnessEvent!(
                { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
                event,
              )
            },
          } : {}),
        },
      )
      scope.add(harness.subscribe(async (event) => {
        // projector 失败向 run 传播；observer 失败只记录诊断，不回滚已完成的 projection。
        await adapter.handle(event)
        for (const observer of collectedObservers) {
          try {
            await observer(event)
          } catch (cause) {
            this.options.logger?.warn("runtime.observer.failed", {
              context: {
                threadId: request.threadID,
                turnId: request.turnID,
                agentId: request.agentID,
              },
              details: { reason: "diagnostic_only" },
            })
          }
        }
      }))
      const compact = async (trigger: RuntimeCompactionTrigger, instructions?: string) => {
        compactionTrigger = trigger
        try {
          return await harness.compact(instructions)
        } finally {
          compactionTrigger = null
        }
      }
      this.harnesses.set(request.threadID, { harness, scope, compact, snapshot })
      onAbort = () => { void harness.abort() }
      request.signal.addEventListener("abort", onAbort, { once: true })
      scope.add(() => { if (onAbort) request.signal.removeEventListener("abort", onAbort) })
      // ── 7. step 状态机：Provider 请求前原子认领 inbox 并创建 running step ──
      stepStart = this.options.runtimeSteps
        ? await this.options.runtimeSteps.claimAndStartStep({
            threadId: request.threadID,
            turnId: request.turnID,
            runtimeManifestHash: snapshot.manifestHash,
            startedAt: Date.now(),
          })
        : null
      const claimedContent = stepStart?.inputs.map((entry) => entry.content) ?? []
      // pre-step waterfall：可重写或拒绝本次已认领输入；拒绝首输入 → 零 step turn。
      const preStep = await interceptorChain.run<{
        reject?: boolean
        reason?: string
        content?: string
      }>("pre-step", { content: claimedContent.length > 0 ? claimedContent.join("\n\n") : request.content, inputs: stepStart?.inputs ?? [] })
      if (preStep?.reject) {
        if (stepStart && !stepCompleted) {
          stepCompleted = true
          await this.options.runtimeSteps?.completeStep(stepStart.step.id, "rejected")
        }
        this.outcomes.set(request.threadID, "settled")
        return { status: "completed", output: preStep.reason ?? "" }
      }
      const runContent = typeof preStep?.content === "string" && preStep.content
        ? preStep.content
        : claimedContent.length > 0
          ? claimedContent.join("\n\n")
          : request.content

      const images = promptImages(request)
      let message: AssistantMessage = await harness.prompt(
        promptContext({ ...request, content: runContent }, bundle.contextItems),
        images.length > 0 ? { images } : undefined,
      )
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
      this.outcomes.set(request.threadID, "settled")
      if (stepStart && !stepCompleted) {
        stepCompleted = true
        await this.options.runtimeSteps?.completeStep(stepStart.step.id)
      }
      return { status: "completed", output, ...(finalizedResult ? { result: finalizedResult } : {}) }
    } catch (cause) {
      if (stepStart && !stepCompleted) {
        stepCompleted = true
        if (request.signal.aborted) {
          await this.options.runtimeSteps?.interruptStep(stepStart.step.id)
        } else {
          await this.options.runtimeSteps?.failStep(stepStart.step.id)
        }
      }
      const reason: RuntimeDisposeReason = request.signal.aborted ? "aborted" : "failed"
      this.outcomes.delete(request.threadID)
      // failed/aborted runtime 从 active map 移除并释放；初始化任意位置失败同样归零。
      if (this.harnesses.get(request.threadID)?.scope === scope) {
        this.harnesses.delete(request.threadID)
      }
      await scope.dispose(reason)
      throw cause
    } finally {
      if (onAbort) request.signal.removeEventListener("abort", onAbort)
    }
  }

  private buildRuntimeManifestV2(snapshot: RuntimeSnapshot): StoredRuntimeManifestV2 {
    return {
      version: 2,
      presetID: snapshot.presetID,
      layers: [],
      contributions: snapshot.contributions.map(({ id, version }) => ({ id, version })),
      pluginBindings: [],
      serviceBindings: [],
      interceptorBindings: [],
      promptHash: snapshot.promptHash,
      toolCatalogHash: snapshot.toolCatalogHash,
      toolNames: [...snapshot.toolNames],
      serviceBindingHash: snapshot.serviceBindingHash,
      manifestHash: snapshot.manifestHash,
    }
  }

  private freezeSnapshot(
    catalog: TurnToolCatalog,
    bundle: PromptBundle,
    request: PiRuntimeRequest,
  ): RuntimeSnapshot {
    const contributions = this.options.contributions?.snapshot() ?? []
    const catalogEntries = catalog.all().map((definition) => ({
      sdkName: definition.sdkName,
      inputSchema: definition.inputSchema,
    }))
    return createRuntimeSnapshot({
      presetID: resolveRuntimePresetID({ taskMode: request.taskMode, profile: request.profile ?? "main" }),
      contributions,
      promptText: bundle.instructions,
      toolCatalog: catalogEntries,
      toolNames: catalogEntries.map((tool) => tool.sdkName),
    })
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
    this.outcomes.clear()
    await Promise.allSettled(active.map(({ scope }) => scope.dispose("shutdown")))
  }
}

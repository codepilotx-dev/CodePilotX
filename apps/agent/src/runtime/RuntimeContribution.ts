import { createHash } from "node:crypto"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import type { SubagentProfile, TaskMode } from "../domain"
import type { PromptSection } from "../prompt/types"
import type { ToolGuardResult } from "../tool/ToolPipeline"
import type { ToolDefinition } from "../tool/ToolRegistry"
import type { AgentRuntimeIdentity, AgentRuntimeScope, RuntimeDisposer } from "./AgentRuntimeScope"

export type RuntimeContributionKind = "tools" | "prompt" | "guard" | "observer" | "interceptor"

export type RuntimeContributionID = `${string}@builtin`

/** 运行预设：主 Agent 按任务模式区分，子 Agent 按 profile 区分。 */
export type RuntimePresetID = "main/chat" | "main/plan" | `subagent/${SubagentProfile}`

export interface RuntimeContributionManifest {
  id: RuntimeContributionID
  version: number
  displayName: string
  description: string
  provides: readonly RuntimeContributionKind[]
  enablement: "required" | "conditional"
}

/** 运行时守卫：在工具调用前求值，结论经 mergeToolGuards 单调合并（deny 优先）。 */
export type RuntimeGuard = (input: { toolName: string; input: Record<string, unknown> }) => ToolGuardResult | Promise<ToolGuardResult>

/** 运行时观察者：接收 harness 原始事件；只用于观测与诊断，不进入协议。 */
export type RuntimeObserver = (event: AgentHarnessEvent) => void | Promise<void>

/** 受支持的 scoped interceptor 扩展点。 */
export type RuntimeInterceptorPoint =
  | "pre-step"
  | "provider-request"
  | "tool-pre-execute"
  | "tool-post-execute"
  | "turn-stopping"

/**
 * waterfall interceptor：按 composition 顺序执行；next(value) 最多调用一次，
 * 重复调用是安全错误；不调用 next() 表示明确 short-circuit（必须返回
 * reject/pause/handled 语义结果）。
 */
export interface RuntimeInterceptor {
  readonly id: string
  readonly version: number
  readonly point: RuntimeInterceptorPoint
  intercept(
    input: unknown,
    next: (value: unknown) => Promise<unknown>,
  ): Promise<unknown>
}

export interface RuntimeInterceptorRegistration {
  interceptor: RuntimeInterceptor
  /** 组合顺序：小者先执行。 */
  order: number
}

/**
 * 贡献登记时使用的内部 builder handles。只允许在快照冻结前累积登记；
 * 运行期间的变化只影响下一次运行。
 */
export interface RuntimeContributionBuilders {
  /** 登记本轮工具定义（含执行体）；与 deferred 工具目录合并后进入 harness 与快照。 */
  addToolDefinition(definition: ToolDefinition): void
  /** 登记本轮 prompt section；附加在请求 sections 之后参与 compose。 */
  addPromptSection(section: PromptSection): void
  /** 登记 monotonic guard；任一 deny/require-approval 结论即阻止调用。 */
  addGuard(guard: RuntimeGuard): void
  /** 登记 harness 事件观察者；与既有观察者并行调用。 */
  addObserver(observer: RuntimeObserver): void
  /** 登记 waterfall interceptor；按登记顺序执行，next() 最多一次。 */
  addInterceptor(interceptor: RuntimeInterceptor): void
}

export interface RuntimeContributionContext {
  identity: AgentRuntimeIdentity
  scope: AgentRuntimeScope
  builders: RuntimeContributionBuilders
}

/**
 * 仓库内静态贡献。所有贡献必须通过静态 import 在 composition root 注册；
 * 禁止字符串 DI、运行时模块路径或外部动态 import。
 */
export interface RuntimeContribution {
  readonly manifest: RuntimeContributionManifest
  /** 在每次运行时绑定到 scope；返回的 disposer 随 scope 释放。 */
  register(context: RuntimeContributionContext): void | RuntimeDisposer
}

export interface RuntimeCompositionLayer {
  readonly id: string
  readonly version: number
  readonly order: number
}

export interface RuntimePluginBinding {
  readonly pluginId: string
  readonly packageGenerationId: string
  readonly runtimeGenerationId: string
  readonly packageDigest: string
}

export interface RuntimeServiceBinding {
  readonly serviceKey: string
  readonly providerPluginId: string | null
  readonly providerGenerationId: string | null
  readonly version: string
}

export interface RuntimeInterceptorBinding {
  readonly id: string
  readonly version: number
  readonly point: string
  readonly order: number
}

export interface RuntimeCompositionPlan {
  readonly presetID: RuntimePresetID
  readonly layers: readonly RuntimeCompositionLayer[]
  readonly contributions: readonly RuntimeContribution[]
  readonly pluginBindings: readonly RuntimePluginBinding[]
  readonly serviceBindings: readonly RuntimeServiceBinding[]
  readonly interceptorBindings: readonly RuntimeInterceptorBinding[]
  snapshot(): readonly RuntimeSnapshotContribution[]
}

export interface RuntimeSnapshotContribution {
  id: RuntimeContributionID
  version: number
}

/** 每次 run() 开始时冻结的运行快照；运行期间配置变化只影响下一次运行。 */
export interface RuntimeSnapshot {
  presetID: RuntimePresetID
  /** 实际启用的贡献列表；disabled 贡献不进入快照。 */
  contributions: readonly RuntimeSnapshotContribution[]
  promptHash: string
  toolCatalogHash: string
  toolNames: readonly string[]
  /** 插件 generation/digest；无插件时为 null。 */
  pluginGeneration: string | null
  /** 服务绑定拓扑哈希；无绑定时为空绑定集哈希。 */
  serviceBindingHash: string
  manifestHash: string
}

export const hashRuntimeText = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex")

export function resolveRuntimePresetID(input: { taskMode: TaskMode; profile: SubagentProfile }): RuntimePresetID {
  if (input.profile !== "main") return `subagent/${input.profile}`
  return input.taskMode === "plan" ? "main/plan" : "main/chat"
}

/** 静态贡献注册表。只读查询；不提供安装或任意启停接口。 */
export class RuntimeContributionRegistry {
  private readonly contributions: RuntimeContribution[] = []
  private readonly byID = new Map<string, RuntimeContribution>()

  constructor(
    private readonly statusResolver?: (contribution: RuntimeContribution) => boolean,
  ) {}

  /** 只能在 composition root 调用；重复 id 直接拒绝。 */
  register(contribution: RuntimeContribution) {
    if (this.byID.has(contribution.manifest.id)) {
      throw new Error(`Runtime contribution ${contribution.manifest.id} 已注册`)
    }
    this.byID.set(contribution.manifest.id, contribution)
    this.contributions.push(contribution)
  }

  list(): readonly RuntimeContribution[] {
    return this.contributions
  }

  /** required 贡献恒启用；conditional 贡献沿用各自现有配置。 */
  enabled(contribution: RuntimeContribution): boolean {
    if (contribution.manifest.enablement === "required") return true
    return this.statusResolver?.(contribution) ?? true
  }

  /** 只返回实际启用的贡献；required 恒启用，conditional 沿用各自配置。 */
  resolveEnabled(): readonly RuntimeContribution[] {
    return this.contributions.filter((contribution) => this.enabled(contribution))
  }

  /** 冻结不可变组合计划；一次 turn 只生成一次。 */
  composePlan(input: {
    presetID: RuntimePresetID
    pluginBindings?: readonly RuntimePluginBinding[]
    serviceBindings?: readonly RuntimeServiceBinding[]
    interceptorBindings?: readonly RuntimeInterceptorBinding[]
  }): RuntimeCompositionPlan {
    const enabled = this.resolveEnabled()
    const layers: RuntimeCompositionLayer[] = [
      { id: "core.preset", version: 1, order: 0 },
      ...enabled.map((c, i) => ({ id: c.manifest.id, version: c.manifest.version, order: 10 + i })),
    ]
    const pluginBindings = input.pluginBindings ?? []
    const serviceBindings = input.serviceBindings ?? []
    const interceptorBindings = input.interceptorBindings ?? []
    return {
      presetID: input.presetID,
      layers,
      contributions: enabled,
      pluginBindings,
      serviceBindings,
      interceptorBindings,
      snapshot: () => enabled.map(({ manifest }) => ({ id: manifest.id, version: manifest.version })),
    }
  }

  /** 快照只记录实际启用的贡献。 */
  snapshot(): readonly RuntimeSnapshotContribution[] {
    return this.resolveEnabled().map(({ manifest }) => ({ id: manifest.id, version: manifest.version }))
  }
}

export function createRuntimeSnapshot(input: {
  presetID: RuntimePresetID
  contributions: readonly RuntimeSnapshotContribution[]
  promptText: string
  toolCatalog: readonly { sdkName: string; inputSchema: Record<string, unknown> }[]
  toolNames: readonly string[]
  pluginGeneration?: string | null
  serviceBindingHash?: string
  layers?: readonly RuntimeCompositionLayer[]
  pluginBindings?: readonly RuntimePluginBinding[]
  serviceBindings?: readonly RuntimeServiceBinding[]
  interceptorBindings?: readonly RuntimeInterceptorBinding[]
}): RuntimeSnapshot {
  const promptHash = hashRuntimeText(input.promptText)
  const toolCatalogHash = hashRuntimeText(
    [...input.toolCatalog]
      .sort((left, right) => left.sdkName.localeCompare(right.sdkName))
      .map((tool) => `${tool.sdkName}:${JSON.stringify(tool.inputSchema)}`)
      .join("\n"),
  )
  const toolNames = [...input.toolNames].sort()
  const pluginGeneration = input.pluginGeneration ?? null
  const serviceBindingHash = input.serviceBindingHash ?? hashRuntimeText(JSON.stringify(input.serviceBindings ?? []))
  const manifestHash = hashRuntimeText(JSON.stringify({
    version: 2,
    presetID: input.presetID,
    layers: input.layers ?? [],
    contributions: input.contributions,
    pluginBindings: input.pluginBindings ?? [],
    serviceBindings: input.serviceBindings ?? [],
    interceptorBindings: input.interceptorBindings ?? [],
    promptHash,
    toolCatalogHash,
    toolNames,
    pluginGeneration,
    serviceBindingHash,
  }))
  return {
    presetID: input.presetID,
    contributions: input.contributions,
    promptHash,
    toolCatalogHash,
    toolNames,
    pluginGeneration,
    serviceBindingHash,
    manifestHash,
  }
}

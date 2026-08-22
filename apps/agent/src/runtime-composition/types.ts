import type { AgentHarnessTool, HarnessTurnComposition } from "@codepilotx/pi-agent-core"
import type { Model } from "@earendil-works/pi-ai"
import type { PermissionConfig, SubagentProfile, TaskMode } from "../domain"
import type { PromptBundle } from "../prompt/types"
import type { McpTurnLease } from "../mcp/McpConnectionManager"
import type { ToolExecutionContext } from "../tool/ToolExecutor"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import type { ToolCatalog } from "../tool/ToolRegistry"
import type { Model as ModelSchema } from "@codepilotx/model-schema"

/** Stable identity for a turn composition. */
export interface RuntimeCompositionIdentity {
  readonly id: string
  readonly version: number
  readonly hash: string
}

/** Serializable snapshot of a resolved model reference. */
export interface ResolvedModelSnapshot {
  readonly providerID: string
  readonly id: string
  readonly variant: string | null
  readonly contextWindow: number
  readonly capabilities: {
    readonly tools: boolean
    readonly input: readonly string[]
    readonly output: readonly string[]
  }
}

/** Workspace scope attached to a runtime composition. */
export interface RuntimeWorkspaceScope {
  readonly kind: "project" | "projectless" | "legacy"
  readonly cwd: string
  readonly roots: readonly string[]
  readonly outputDirectory: string | null
  readonly instructionSources: readonly string[]
}

/** Skills catalog snapshot attached to a runtime composition. */
export interface SkillSnapshot {
  readonly skills: ReadonlyArray<{
    readonly name: string
    readonly description: string
    readonly origin: string
    readonly format: string
    readonly hash: string
    readonly path: string
  }>
}

/** Stable MCP binding identifier. We compare the hash, not process generation. */
export interface McpGenerationBinding {
  readonly workspaceKey: string
  readonly bindingHash: string
  readonly serverInstructions: readonly { serverName: string; content: string }[]
}

/** Serializable tool exposure plan. */
export interface SerializableToolExposurePlan {
  readonly eager: readonly string[]
  readonly deferred: readonly string[]
  readonly exposed: readonly string[]
}

/** Stable, normalized context baseline metadata. */
export interface ContextBaseline {
  readonly threadsActiveTurnID: string | null
  readonly sessionEntryID: string | null
}

/** Capability list advertised by a runtime composition. */
export interface RuntimeCapability {
  readonly id: string
  readonly version: number
}

/** Hashes for every component of a runtime composition. */
export interface CompositionHashes {
  readonly modelHash: string
  readonly permissionHash: string
  readonly workspaceHash: string
  readonly skillsHash: string
  readonly mcpHash: string
  readonly toolsHash: string
  readonly promptHash: string
  readonly contextHash: string
  readonly overall: string
}

/** Plan persisted to `runtime_composition_plans`. Versioned envelope. */
export interface RuntimeCompositionSnapshotV1 {
  readonly version: 1
  readonly identity: RuntimeCompositionIdentity
  readonly model: ResolvedModelSnapshot
  readonly workspace: RuntimeWorkspaceScope
  readonly permissions: PermissionConfig
  readonly skills: SkillSnapshot
  readonly mcp: McpGenerationBinding
  readonly tools: SerializableToolExposurePlan
  readonly prompt: PromptBundle
  readonly context: ContextBaseline
  readonly capabilities: readonly RuntimeCapability[]
  readonly hashes: CompositionHashes
}

/** The runtime plan handed to the harness. */
export interface RuntimeCompositionPlan {
  readonly snapshot: RuntimeCompositionSnapshotV1
}

/** Live resources attached to a composed turn. `release()` is idempotent. */
export interface RuntimeCompositionBindings {
  readonly mcpLease: McpTurnLease | null
  readonly toolContext: ToolExecutionContext
  readonly model: Model<any>
  readonly modelRef: ModelSchema.Ref
  readonly workspace: WorkspaceService
  readonly defaultCwd?: string
  readonly toolCatalog: ToolCatalog
  readonly skills: {
    list(): SkillSnapshot["skills"]
    read(name: string): Promise<unknown>
  }
  release(): Promise<void>
}

/**
 * Bind a frozen composition to live resources and the harness envelope.
 * `release()` is idempotent and tears down MCP leases and tool contexts.
 */
export interface BoundRuntimeComposition {
  readonly plan: RuntimeCompositionPlan
  readonly harness: HarnessTurnComposition<any, any, any, AgentHarnessTool<any>>
  readonly bindings: RuntimeCompositionBindings
  release(): Promise<void>
}

export type RuntimeCompositionProfile = SubagentProfile | "main"

/** Inputs that drive a fresh composition. The service owns durable resolution. */
export interface ComposeRuntimeCompositionInput {
  readonly turnID: string
  readonly agentID: string
  readonly threadID: string
  readonly sessionID: string
  readonly profile: RuntimeCompositionProfile
  readonly taskMode: TaskMode
  readonly content: string
  readonly model: Model<any>
  readonly thinkingLevel?: HarnessTurnComposition<any, any, any, any>["thinkingLevel"]
  readonly workspace: WorkspaceService
  readonly permissionConfig: PermissionConfig
  readonly fallbackModel: import("@codepilotx/model-schema").Model.Ref
  readonly signal: AbortSignal
  readonly defaultCwd?: string
}

export interface RuntimeCompositionUnavailableError extends Error {
  readonly code: "RUNTIME_COMPOSITION_UNAVAILABLE"
  readonly reason: string
}

export const RUNTIME_COMPOSITION_UNAVAILABLE_CODE = "RUNTIME_COMPOSITION_UNAVAILABLE" as const

export function createRuntimeCompositionUnavailable(reason: string): RuntimeCompositionUnavailableError {
  const error = new Error(reason) as RuntimeCompositionUnavailableError
  error.name = "RuntimeCompositionUnavailableError"
  ;(error as { code: string }).code = RUNTIME_COMPOSITION_UNAVAILABLE_CODE
  return error
}

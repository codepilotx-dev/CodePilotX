import { createHash } from "node:crypto"
import { resolve } from "node:path"
import type { Model } from "@earendil-works/pi-ai"
import { Model as ModelSchema, Provider as ProviderSchema } from "@codepilotx/model-schema"
import { AgentError, type PermissionConfig, type TaskMode } from "../domain"
import { inferPromptCacheRuntimePolicy } from "../prompt/PromptCache"
import { resolveEffectivePermissionConfig } from "../permission/EffectivePermissionConfig"
import { createToolExposurePlan, type ToolExposureInput } from "../tool/ToolExposurePlan"
import type { ToolExecutionContext } from "../tool/ToolExecutor"
import type { ToolCatalog } from "../tool/ToolRegistry"
import type { WorkspaceService } from "../workspace/WorkspaceService"
import type { McpTurnLease } from "../mcp/McpConnectionManager"
import type { PromptBundle } from "../prompt/types"
import type { SkillService } from "../prompt/SkillService"
import { createTurnComposition, type AgentHarnessTool, type HarnessTurnComposition } from "@codepilotx/pi-agent-core"
import type {
  CompositionHashes,
  ContextBaseline,
  McpGenerationBinding,
  ResolvedModelSnapshot,
  RuntimeCompositionBindings,
  RuntimeCompositionIdentity,
  RuntimeCompositionProfile,
  RuntimeCompositionSnapshotV1,
  RuntimeWorkspaceScope,
  SerializableToolExposurePlan,
  SkillSnapshot,
} from "./types"

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>()
  const walk = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object") return entry
    if (seen.has(entry as object)) return null
    seen.add(entry as object)
    if (Array.isArray(entry)) return entry.map(walk)
    const record = entry as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      next[key] = walk(record[key] ?? null)
    }
    return next
  }
  return JSON.stringify(walk(value))
}

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex")

const hashJson = (value: unknown) => sha256(stableStringify(value))

export interface RuntimeCompositionInput {
  turnID: string
  threadID: string
  profile: RuntimeCompositionProfile
  taskMode: TaskMode
  thinkingLevel?: HarnessTurnComposition<any, any, any, any>["thinkingLevel"]
  model: Model<any>
  modelRef: ModelSchema.Ref
  toolCatalog: ToolCatalog
  workspace: WorkspaceService
  workspaceScope: RuntimeWorkspaceScope
  sessionEntryID: string | null
  skillService: SkillService
  mcpBinding: McpGenerationBinding
  mcpLease: McpTurnLease | null
  effectivePermissionConfig: PermissionConfig
  toolContext: ToolExecutionContext
  defaultCwd?: string
  promptBundle: PromptBundle
  tools: readonly AgentHarnessTool<any>[]
  initialActiveNames: readonly string[]
  deferredAllowedNames: readonly string[]
  allowedTools?: readonly string[]
}

const snapshotModel = (model: Model<any>, ref?: ModelSchema.Ref): ResolvedModelSnapshot => ({
  providerID: model.provider,
  id: model.id,
  variant: ref?.variant ? String(ref.variant) : null,
  contextWindow: Math.max(1, Math.trunc(Number(model.contextWindow) || 1)),
  capabilities: {
    tools: true,
    input: Array.isArray(model.input) ? model.input.map((value) => String(value)) : [],
    output: [],
  },
})

const workspaceHashFor = (workspace: RuntimeWorkspaceScope) =>
  hashJson({
    kind: workspace.kind,
    cwd: resolve(workspace.cwd),
    roots: workspace.roots.map((root) => resolve(root)).sort(),
    outputDirectory: workspace.outputDirectory ? resolve(workspace.outputDirectory) : null,
    instructionSources: [...workspace.instructionSources].sort(),
  })

const skillsHashFor = (skills: SkillSnapshot) =>
  hashJson(skills.skills.map((skill) => ({
    name: skill.name,
    hash: skill.hash,
    path: skill.path,
  })))

const mcpHashFor = (binding: McpGenerationBinding) =>
  hashJson({
    workspaceKey: binding.workspaceKey,
    bindingHash: binding.bindingHash,
    serverInstructions: binding.serverInstructions.map((s) => ({ serverName: s.serverName, content: s.content })),
  })

const toolsHashFor = (plan: SerializableToolExposurePlan) =>
  hashJson({
    eager: [...plan.eager].sort(),
    deferred: [...plan.deferred].sort(),
    exposed: [...plan.exposed].sort(),
  })

const promptHashFor = (bundle: PromptBundle) =>
  hashJson({
    instructions: bundle.instructions,
    contextItems: bundle.contextItems.map((item) => item.content),
    baseHash: bundle.baseHash,
    contextHash: bundle.contextHash,
    cacheKey: bundle.cacheKey,
  })

const permissionHashFor = (config: PermissionConfig) =>
  hashJson(config)

const contextHashFor = (baseline: ContextBaseline) =>
  hashJson(baseline)

const frozenMcpInstructions = (
  binding: McpGenerationBinding,
  fromLease: McpTurnLease | null,
): readonly { serverName: string; content: string }[] => {
  if (fromLease) {
    return fromLease.serverInstructions.map((item) => ({
      serverName: item.serverName,
      content: item.content,
    }))
  }
  return binding.serverInstructions.map((item) => ({ ...item }))
}

export interface ComposeRuntimeCompositionResult {
  snapshot: RuntimeCompositionSnapshotV1
  harnessComposition: HarnessTurnComposition<any, any, any, AgentHarnessTool<any>>
  bindings: RuntimeCompositionBindings
}

const createBindings = (
  input: Pick<RuntimeCompositionInput, "mcpLease" | "toolContext" | "model" | "modelRef" | "workspace" | "defaultCwd" | "toolCatalog" | "skillService">,
  snapshot: RuntimeCompositionSnapshotV1,
): RuntimeCompositionBindings => {
  let released = false
  const catalog = new Map(snapshot.skills.skills.map((skill) => [skill.name, skill]))
  return Object.freeze({
    mcpLease: input.mcpLease,
    toolContext: input.toolContext,
    model: input.model,
    modelRef: input.modelRef,
    workspace: input.workspace,
    ...(input.defaultCwd ? { defaultCwd: input.defaultCwd } : {}),
    toolCatalog: input.toolCatalog,
    skills: Object.freeze({
      list: () => snapshot.skills.skills,
      read: async (name: string) => {
        const frozen = catalog.get(name)
        const current = input.skillService.list().find((skill) => skill.name === name)
        if (!frozen || !current || current.hash !== frozen.hash) {
          throw new AgentError("SKILL_SNAPSHOT_STALE", "Skill snapshot is stale", 409)
        }
        return input.skillService.read(name)
      },
    }),
    release: async () => {
      if (released) return
      released = true
      await input.mcpLease?.release()
    },
  })
}

export const createMcpGenerationBinding = (
  workspaceKey: string,
  lease: McpTurnLease | null,
): McpGenerationBinding => {
  const serverInstructions = lease?.serverInstructions.map(({ serverName, content }) => ({ serverName, content })) ?? []
  const toolNames = lease?.definitions.map((definition) => ({
    name: definition.sdkName,
    server: definition.origin?.kind === "mcp" ? definition.origin.serverName : "",
    rawName: definition.origin?.kind === "mcp" ? definition.origin.rawToolName : "",
  })).sort((a, b) => a.name.localeCompare(b.name)) ?? []
  return {
    workspaceKey,
    bindingHash: hashJson({ serverInstructions, toolNames }),
    serverInstructions,
  }
}

export type RebindRuntimeCompositionInput = Pick<
  RuntimeCompositionInput,
  "model" | "modelRef" | "workspace" | "workspaceScope" | "skillService" | "mcpBinding" |
  "mcpLease" | "toolContext" | "toolCatalog" | "defaultCwd"
>

/**
 * Compose a fresh turn snapshot from the live inputs. Hashes are computed from
 * normalized inputs so that re-binding the same snapshot always yields the
 * same identity hash. Caller persists the snapshot before any provider
 * sampling round.
 */
export function composeRuntimeComposition(input: RuntimeCompositionInput): ComposeRuntimeCompositionResult {
  const effectivePermissionConfig = resolveEffectivePermissionConfig(
    input.taskMode,
    input.effectivePermissionConfig,
  )
  const exposureInput: ToolExposureInput = {
    taskMode: input.taskMode,
    sandboxMode: input.taskMode === "plan" ? "read-only" : effectivePermissionConfig.sandboxMode,
    profile: input.profile,
    hasSkillService: true,
    hasProjectSources: false,
    defaultModeRequestUserInput: false,
    delegationEnabled: input.profile === "main" && input.taskMode !== "plan",
    ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
  }
  const exposurePlan = createToolExposurePlan(input.toolCatalog, exposureInput)

  const promptBundle: PromptBundle = structuredClone(input.promptBundle)

  const skillSnapshot: SkillSnapshot = {
    skills: input.skillService.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      format: skill.format,
      hash: skill.hash,
      path: skill.path,
    })),
  }

  const frozenMcp = {
    workspaceKey: input.mcpBinding.workspaceKey,
    bindingHash: input.mcpBinding.bindingHash,
    serverInstructions: frozenMcpInstructions(input.mcpBinding, input.mcpLease),
  }

  const compositionID = `rc:${input.turnID}`
  const modelHash = hashJson({
    provider: input.model.provider,
    id: input.model.id,
    api: input.model.api,
    contextWindow: input.model.contextWindow,
  })
  const permissionHash = permissionHashFor(effectivePermissionConfig)
  const workspaceHash = workspaceHashFor(input.workspaceScope)
  const skillsHash = skillsHashFor(skillSnapshot)
  const mcpHash = mcpHashFor(frozenMcp)
  const toolsHash = toolsHashFor({
    eager: [...exposurePlan.eager],
    deferred: [...exposurePlan.deferred],
    exposed: [...exposurePlan.exposed],
  })
  const promptHash = promptHashFor(promptBundle)
  const contextHash = hashJson({
    threadsActiveTurnID: input.threadID,
    sessionEntryID: input.sessionEntryID,
  })
  const overall = sha256(
    [
      compositionID,
      modelHash,
      permissionHash,
      workspaceHash,
      skillsHash,
      mcpHash,
      toolsHash,
      promptHash,
      contextHash,
    ].join("\0"),
  )

  const hashes: CompositionHashes = {
    modelHash,
    permissionHash,
    workspaceHash,
    skillsHash,
    mcpHash,
    toolsHash,
    promptHash,
    contextHash,
    overall,
  }

  const identity: RuntimeCompositionIdentity = {
    id: compositionID,
    version: 1,
    hash: overall,
  }

  const serializablePlan: SerializableToolExposurePlan = {
    eager: [...exposurePlan.eager],
    deferred: [...exposurePlan.deferred],
    exposed: [...exposurePlan.exposed],
  }

  const baseline: ContextBaseline = {
    threadsActiveTurnID: input.threadID,
    sessionEntryID: input.sessionEntryID,
  }

  const snapshot: RuntimeCompositionSnapshotV1 = {
    version: 1,
    identity,
    model: snapshotModel(input.model, input.modelRef),
    workspace: input.workspaceScope,
    permissions: effectivePermissionConfig,
    skills: skillSnapshot,
    mcp: frozenMcp,
    tools: serializablePlan,
    prompt: promptBundle,
    context: baseline,
    capabilities: [
      { id: "harness.turn-composition.v1", version: 1 },
      { id: "agent.runtime-composition.v1", version: 1 },
    ],
    hashes,
  }

  const harnessComposition = createHarnessComposition({
    compositionID,
    compositionHash: overall,
    model: input.model,
    promptBundle,
    tools: input.tools,
    initialActiveNames: input.initialActiveNames,
    deferredAllowedNames: input.deferredAllowedNames,
    toolContext: input.toolContext,
    thinkingLevel: input.thinkingLevel ?? "off",
  })

  const bindings = createBindings(input, snapshot)
  return {
    snapshot,
    harnessComposition,
    bindings,
  }
}

function createHarnessComposition(input: {
  compositionID: string
  compositionHash: string
  model: Model<any>
  thinkingLevel: HarnessTurnComposition<any, any, any, any>["thinkingLevel"]
  promptBundle: PromptBundle
  tools: readonly AgentHarnessTool<any>[]
  initialActiveNames: readonly string[]
  deferredAllowedNames: readonly string[]
  toolContext: ToolExecutionContext
}): HarnessTurnComposition<any, any, any, AgentHarnessTool<any>> {
  return createTurnComposition({
    compositionID: input.compositionID,
    compositionHash: input.compositionHash,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    systemPrompt: input.promptBundle.instructions,
    tools: input.tools,
    initialActiveNames: input.initialActiveNames,
    deferredAllowedNames: input.deferredAllowedNames,
    resources: {},
    toolContext: input.toolContext,
    streamOptions: {},
  })
}

/** Rebind live handlers from a persisted snapshot without recomposing prompt, policy or exposure. */
export function rebindRuntimeComposition(
  snapshot: RuntimeCompositionSnapshotV1,
  input: RebindRuntimeCompositionInput,
): Omit<ComposeRuntimeCompositionResult, "snapshot"> {
  const currentModel = snapshotModel(input.model, input.modelRef)
  if (
    currentModel.providerID !== snapshot.model.providerID
    || currentModel.id !== snapshot.model.id
    || currentModel.variant !== snapshot.model.variant
    || currentModel.contextWindow !== snapshot.model.contextWindow
    || stableStringify(currentModel.capabilities) !== stableStringify(snapshot.model.capabilities)
  ) throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen model is unavailable", 409)
  if (workspaceHashFor(input.workspaceScope) !== snapshot.hashes.workspaceHash) {
    throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen workspace is unavailable", 409)
  }
  const currentSkills: SkillSnapshot = {
    skills: input.skillService.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      format: skill.format,
      hash: skill.hash,
      path: skill.path,
    })),
  }
  if (skillsHashFor(currentSkills) !== snapshot.hashes.skillsHash) {
    throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen Skills catalog is unavailable", 409)
  }
  if (input.mcpBinding.bindingHash !== snapshot.mcp.bindingHash) {
    throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen MCP binding is unavailable", 409)
  }
  if (promptHashFor(snapshot.prompt) !== snapshot.hashes.promptHash) {
    throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen prompt failed verification", 409)
  }
  const lifecycle = new Set([
    "skill_list", "skill_read", "project_source_list", "project_source_read",
    "request_user_input", "request_permissions", "update_plan", "spawn_agents",
    "wait_agents", "send_agent", "stop_agent", "finalize_result",
  ])
  for (const name of new Set([...snapshot.tools.exposed, ...snapshot.tools.deferred])) {
    if (lifecycle.has(name)) continue
    try { input.toolCatalog.get(name) } catch {
      throw new AgentError("RUNTIME_COMPOSITION_UNAVAILABLE", "Frozen tool catalog is unavailable", 409)
    }
  }
  const harnessComposition = createHarnessComposition({
    compositionID: snapshot.identity.id,
    compositionHash: snapshot.identity.hash,
    model: input.model,
    promptBundle: snapshot.prompt,
    tools: [],
    initialActiveNames: [],
    deferredAllowedNames: [],
    toolContext: input.toolContext,
    thinkingLevel: "off",
  })
  return { harnessComposition, bindings: createBindings(input, snapshot) }
}

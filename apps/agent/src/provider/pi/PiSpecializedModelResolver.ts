import type { Api, Model as PiModel } from "@earendil-works/pi-ai"
import { Model, Provider } from "@codepilotx/model-schema"
import type { ConfigObject, ConfigService } from "../../config/ConfigService"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import type { PiModelService } from "./PiModelService"

export type SpecializedModelPurpose = "generation" | "organization" | "coding" | "security"
export type SpecializedPiModelService = Pick<PiModelService, "getPiModel">

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const modelRef = (value: unknown, fallbackProvider: unknown): Model.Ref | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const configured = value.trim()
  const separator = configured.indexOf("/")
  const providerID = separator > 0
    ? configured.slice(0, separator).trim()
    : typeof fallbackProvider === "string" ? fallbackProvider.trim() : ""
  const id = separator > 0 ? configured.slice(separator + 1).trim() : configured
  if (!providerID || !id) return null
  return Model.Ref.make({
    providerID: Provider.ID.make(providerID),
    id: Model.ID.make(id),
  })
}

const specializedRef = (
  config: ConfigObject,
  purpose: SpecializedModelPurpose,
): Model.Ref | null => {
  const specialized = object(config.specialized_models)
  return modelRef(specialized[purpose], config.model_provider)
}

const mainRef = (config: ConfigObject) => modelRef(config.model, config.model_provider)

export async function resolveSpecializedPiModel(input: {
  purpose: SpecializedModelPurpose
  db: AgentDatabase
  models: SpecializedPiModelService
  configService?: ConfigService
  projectId?: string
  fallbackRefs?: readonly Model.Ref[]
  includeMainFallback?: boolean
}): Promise<{ ref: Model.Ref; model: PiModel<Api> } | null> {
  const globalConfig = input.configService?.snapshot() ?? {}
  let effectiveConfig = globalConfig
  if (input.projectId && input.configService) {
    const project = input.db.getProject(input.projectId)
    if (project) effectiveConfig = (await input.configService.read({ cwd: project.rootPath })).config
  }

  const refs = [
    specializedRef(effectiveConfig, input.purpose),
    ...(input.fallbackRefs ?? []),
    ...(input.includeMainFallback === false
      ? []
      : [mainRef(effectiveConfig), mainRef(globalConfig)]),
  ].filter((ref): ref is Model.Ref => ref !== null)
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.providerID}/${ref.id}/${ref.variant ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      return { ref, model: await input.models.getPiModel(ref) }
    } catch {
      // An unavailable specialized model falls back to the effective main model.
    }
  }
  return null
}

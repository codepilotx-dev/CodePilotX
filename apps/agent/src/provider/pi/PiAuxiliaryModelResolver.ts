import type { Api, Model as PiModel } from "@earendil-works/pi-ai"
import { Model, Provider } from "@codepilotx/model-schema"
import type { ConfigService } from "../../config/ConfigService"
import type { AgentDatabase } from "../../storage/database/AgentDatabase"
import type { PiModelService } from "./PiModelService"

export type AuxiliaryPiModelService = Pick<PiModelService, "getPiModel">

export async function resolveAuxiliaryPiModel(input: {
  db: AgentDatabase
  models: AuxiliaryPiModelService
  configService?: ConfigService
  projectId?: string
}): Promise<{ ref: Model.Ref; model: PiModel<Api> } | null> {
  const config = input.configService?.snapshot() ?? {}
  const taskModels = config.task_models
    && typeof config.task_models === "object"
    && !Array.isArray(config.task_models)
    ? config.task_models as Record<string, unknown>
    : {}
  const providerID = typeof config.model_provider === "string"
    ? config.model_provider.trim()
    : ""
  const refs: Model.Ref[] = []
  if (providerID) {
    for (const key of ["small_fast", "fast"] as const) {
      const id = typeof taskModels[key] === "string" ? taskModels[key].trim() : ""
      if (id) {
        refs.push(Model.Ref.make({
          providerID: Provider.ID.make(providerID),
          id: Model.ID.make(id),
        }))
      }
    }
  }
  if (input.projectId) {
    const project = input.db.getProject(input.projectId)
    const effective = project && input.configService
      ? (await input.configService.read({ cwd: project.rootPath })).config
      : null
    const projectDefault = effective
      && typeof effective.model_provider === "string"
      && typeof effective.model === "string"
      ? Model.Ref.make({
          providerID: Provider.ID.make(effective.model_provider),
          id: Model.ID.make(effective.model),
        })
      : null
    if (projectDefault) refs.push(projectDefault)
  }
  const globalDefault = providerID && typeof config.model === "string" && config.model.trim()
    ? Model.Ref.make({
        providerID: Provider.ID.make(providerID),
        id: Model.ID.make(config.model.trim()),
      })
    : null
  if (globalDefault) refs.push(globalDefault)

  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.providerID}/${ref.id}/${ref.variant ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      return { ref, model: await input.models.getPiModel(ref) }
    } catch {
      // Continue through the configured auxiliary-model fallback chain.
    }
  }
  return null
}

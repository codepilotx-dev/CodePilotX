/**
 * Model catalog utilities for the desktop renderer.
 *
 * Merges provider-side model lists with runtime capabilities
 * from the app-server catalog.
 */

export type DesktopRuntimeModel = {
  id: string
  model: string
  displayName: string
  description: string
  hidden: boolean
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>
  defaultReasoningEffort: string
  inputModalities: string[]
  supportsPersonality: boolean
  additionalSpeedTiers: string[]
  serviceTiers: Array<{ id: string; name: string; description: string }>
  defaultServiceTier: string | null
  isDefault: boolean
}

export type DesktopRuntimeModelCatalog = {
  models: DesktopRuntimeModel[]
}

export type DesktopMergedModel = {
  id: string
  providerMetadata: Record<string, unknown> | null
  runtime: DesktopRuntimeModel | null
}

/**
 * Merge provider models (BYOK list) with runtime capabilities.
 *
 * Rules:
 * - Provider model list is the authoritative source for BYOK model IDs.
 * - app-server is the authoritative source for runtime capabilities.
 * - Match by `model` first, fall back to `id`.
 * - Unknown custom models from the provider must NOT disappear.
 * - `supportedReasoningEfforts` retains server order.
 * - Do not fabricate effort, service tier, or personality for unknown models.
 * - When catalog unavailable, preserve existing model selection.
 */
export function mergeProviderAndRuntimeModels(input: {
  providerModels: string[]
  providerMetadata: Record<string, unknown>
  selectedModel: string | null
  runtimeCatalog: DesktopRuntimeModelCatalog | null
}): DesktopMergedModel[] {
  const runtimeModels = input.runtimeCatalog?.models ?? []

  const byModel = new Map(
    runtimeModels.map(model => [model.model, model]),
  )

  const byId = new Map(
    runtimeModels.map(model => [model.id, model]),
  )

  // Collect unique model IDs: provider list first, then selected model
  const ids = [
    ...new Set([
      ...input.providerModels,
      ...(input.selectedModel ? [input.selectedModel] : []),
    ]),
  ]

  // Fall back to all visible runtime models when provider list is empty
  if (ids.length === 0) {
    ids.push(
      ...runtimeModels
        .filter(model => !model.hidden)
        .map(model => model.model),
    )
  }

  return ids.map(modelID => ({
    id: modelID,
    providerMetadata: (input.providerMetadata as Record<string, Record<string, unknown>>)[modelID] ?? null,
    runtime:
      byModel.get(modelID) ??
      byId.get(modelID) ??
      null,
  }))
}

/**
 * Check if a merged model is usable (has runtime capabilities or provider metadata).
 */
export function isModelUsable(model: DesktopMergedModel): boolean {
  return model.runtime !== null || model.providerMetadata !== null
}

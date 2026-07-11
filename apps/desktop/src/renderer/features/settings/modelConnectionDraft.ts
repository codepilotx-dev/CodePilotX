import type { ModelProviderID } from '../../../shared/types.js'

export type ModelConnectionDraft = {
  providerID: ModelProviderID
  baseURL: string
  model: string
}

export function createModelConnectionDraft(
  saved: ModelConnectionDraft,
): ModelConnectionDraft {
  return { ...saved }
}

export function isModelConnectionDraftDirty(
  draft: ModelConnectionDraft,
  saved: ModelConnectionDraft,
): boolean {
  return (
    draft.providerID !== saved.providerID ||
    draft.baseURL !== saved.baseURL ||
    draft.model !== saved.model
  )
}

export function restoreModelConnectionDraft(
  saved: ModelConnectionDraft,
): ModelConnectionDraft {
  return createModelConnectionDraft(saved)
}

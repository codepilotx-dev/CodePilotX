import type { ModelProviderID, LocalRouterMode } from '../types.js'

export type FusionPanelCandidate = {
  providerID: ModelProviderID
  model: string
  score: number
}

export type FusionRouterInput = {
  message: string
  panelCandidates: FusionPanelCandidate[]
  judgeProviderID?: ModelProviderID
  judgeModel?: string
  bypass?: boolean
}

export type FusionRouterResult = {
  panelModels: Array<{ providerID: ModelProviderID; model: string }>
  judgeModel: { providerID: ModelProviderID; model: string }
  bypass?: boolean
}

const PANEL_COUNT = 3

export function selectFusionPanel(
  input: FusionRouterInput,
): FusionRouterResult {
  if (input.bypass) {
    return {
      panelModels: [],
      judgeModel: {
        providerID: input.judgeProviderID ?? 'minimax',
        model: input.judgeModel ?? '',
      },
      bypass: true,
    }
  }

  const sorted = [...input.panelCandidates].sort(
    (a, b) => b.score - a.score,
  )
  const panelModels = sorted.slice(0, PANEL_COUNT).map(c => ({
    providerID: c.providerID,
    model: c.model,
  }))

  const judgeModel = input.judgeModel
    ? { providerID: input.judgeProviderID ?? 'minimax', model: input.judgeModel }
    : panelModels[0] ?? { providerID: 'minimax' as ModelProviderID, model: '' }

  return {
    panelModels,
    judgeModel,
    bypass: false,
  }
}

export function fusionBypass(localRouterMode: LocalRouterMode): boolean {
  return localRouterMode !== 'off'
}

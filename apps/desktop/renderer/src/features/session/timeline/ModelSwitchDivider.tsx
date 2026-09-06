import React from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { RenderTurnEntry } from '@codepilotx/session-view'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { ConversationItemContext } from './ConversationItemContext.js'

type TurnModel = RenderTurnEntry['turn']['model']

export function ModelSwitchDivider({ previousModel, model }: {
  previousModel?: TurnModel
  model: TurnModel
}): React.ReactNode {
  const names = React.useContext(ConversationItemContext)?.modelProviderNames
  if (!previousModel || (
    previousModel.providerID === model.providerID && previousModel.id === model.id
  )) return null

  const label = (value: TurnModel): string =>
    `${names?.[value.providerID] ?? value.providerID}/${value.id}`

  return (
    <div className="canonical-model-switch-divider">
      <span className="canonical-model-switch-divider__content">
        <ArrowRightLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} aria-hidden="true" />
        <span>模型已切换 {label(previousModel)} → {label(model)}</span>
      </span>
    </div>
  )
}

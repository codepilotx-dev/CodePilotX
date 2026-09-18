import React from 'react'
import type { RpcParams } from '@codepilotx/agent-protocol'
import type { PlanApproval } from '@codepilotx/shared/thread'
import { ModelRefSchema } from '@codepilotx/shared'
import type { DesktopModelSelection } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

type Response = RpcParams<'planApproval/respond'>['response']

export function usePlanApprovalResponse(approval: PlanApproval | null | undefined, reload: () => Promise<void>, model?: Pick<DesktopModelSelection, 'providerID' | 'model' | 'variant'>) {
  const [available, setAvailable] = React.useState(false)
  const [capabilityError, setCapabilityError] = React.useState<string | null>(null)
  const operation = React.useRef<{ key: string; id: string } | null>(null)
  React.useEffect(() => {
    let active = true
    void desktopClient.getRuntimeCapabilities().then(capabilities => {
      if (active) setAvailable(capabilities.includes('plan.approval.v1'))
    }).catch(() => {
      if (active) setCapabilityError('无法确认计划操作能力，请重新打开会话。')
    })
    return () => { active = false }
  }, [])

  const respond = React.useCallback(async (response: Response) => {
    if (!approval || !available) throw new Error('当前会话不支持计划批准。')
    if (response.action !== 'close' && (!model?.providerID || !model.model)) throw new Error('当前会话模型尚未加载，请稍后重试。')
    const resolvedResponse = response.action === 'close' || !model ? response : {
      ...response,
      model: ModelRefSchema.make({
        providerID: ModelRefSchema.fields.providerID.make(model.providerID),
        id: ModelRefSchema.fields.id.make(model.model),
        ...(model.variant && model.variant !== 'default' ? { variant: ModelRefSchema.fields.variant.from.make(model.variant) } : {}),
      }),
    }
    const key = JSON.stringify([approval.id, approval.version, resolvedResponse])
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
    await desktopClient.respondPlanApproval({
      threadId: approval.threadId,
      approvalId: approval.id,
      expectedVersion: approval.version,
      operationId: operation.current.id,
      response: resolvedResponse,
    })
    await reload()
  }, [approval, available, reload, model])

  return { respond, disabledReason: available ? undefined : capabilityError ?? '当前 Agent 尚未提供计划批准能力。' }
}

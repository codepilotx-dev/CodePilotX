import type React from 'react'
import { useComputerSettings } from './useComputerSettings.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'

export function ComputerSettings(): React.ReactNode {
  const { state, busy, error, update } = useComputerSettings()
  const saved = state.permissions.filter((entry) => entry.decision === 'allow' && !entry.needsConfirmation)
  const other = state.permissions.filter((entry) => entry.decision === 'deny' || entry.needsConfirmation)
  const entries = (permissions: typeof state.permissions) => permissions.map((entry) => (
    <SettingsRow key={entry.appId} title={entry.name}
      description={entry.needsConfirmation ? '需要重新确认，下次使用时在聊天中授权。'
        : entry.decision === 'deny' ? '已拒绝'
        : state.policy?.allowPersistentApproval === false ? '策略禁止永久授权，此记录暂不生效。'
        : entry.policy?.access === 'deny' ? entry.policy.reason : undefined}
      control={<Button color="secondary" disabled={busy}
        onClick={() => void update({ appId: entry.appId, decision: 'remove' })}>撤销</Button>} />
  ))
  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">电脑控制</h2>
          <p className="settings-page-desc">管理 Agent 如何使用电脑上已运行的应用。</p>
        </div>
        <SettingsSection title="控制">
          <SettingsRow title="任意应用" description="开启后即可在聊天中使用电脑，授权跟随聊天权限。"
            control={<ToggleSwitch ariaLabel="任意应用" checked={state.enabled} disabled={busy}
              onChange={(enabled) => void update({ enabled })} />} />
          {state.enabled && !state.available ? <p role="status">电脑控制运行时尚未就绪。</p> : null}
          {state.policy?.valid === false ? <p role="status">{state.policy.reason}</p> : null}
          {state.policy?.managed ? <p>部分应用访问可能受管理员策略限制。</p> : null}
          {error ? <p role="status">{error}</p> : null}
        </SettingsSection>
        <SettingsSection title="始终允许的应用">
          {saved.length ? entries(saved) : <p className="settings-empty-state">暂无</p>}
        </SettingsSection>
        {other.length ? <SettingsSection title="其他权限记录">{entries(other)}</SettingsSection> : null}
      </div>
    </SettingsContentArea>
  )
}

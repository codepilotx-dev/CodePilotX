import React from 'react'
import { AppearanceSettings } from './AppearanceSettings.js'
import { ArchivedConversationsSettings } from './ArchivedConversationsSettings.js'
import { ConfigSettings } from './ConfigSettings.js'
import { GeneralSettings } from './GeneralSettings.js'
import { GitSettings } from './GitSettings.js'
import { McpSettings } from './McpSettings.js'
import { ModelConnectionSettings } from './ModelConnectionSettings.js'
import { PersonalizationSettings } from './PersonalizationSettings.js'
import { SettingsSection } from './SettingsSection.js'
import { UsageBillingSettings } from './UsageBillingSettings.js'

type Props = {
  activeTab: string
  onError: (message: string) => void
}

export function SettingsPage({ activeTab, onError }: Props): React.ReactNode {
  if (activeTab === 'general') return <GeneralSettings />
  if (activeTab === 'appearance') return <AppearanceSettings />
  if (activeTab === 'config') return <ConfigSettings />
  if (activeTab === 'connections') return <ModelConnectionSettings onError={onError} />
  if (activeTab === 'mcp') return <McpSettings />
  if (activeTab === 'git') return <GitSettings />
  if (activeTab === 'personalization') return <PersonalizationSettings />
  if (activeTab === 'archived') return <ArchivedConversationsSettings />
  if (activeTab === 'billing') return <UsageBillingSettings />
  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">建设中</h2>
        <SettingsSection description="此设置页面暂未实现。">
          <div />
        </SettingsSection>
      </div>
    </div>
  )
}
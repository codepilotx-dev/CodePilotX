import React from 'react'
import { AppearanceSettings } from './AppearanceSettings.js'
import { ArchivedConversationsSettings } from './ArchivedConversationsSettings.js'
import { BrowserSettings } from './BrowserSettings.js'
import { ConfigSettings } from './ConfigSettings.js'
import { GeneralSettings } from './GeneralSettings.js'
import { GitSettings } from './GitSettings.js'
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings.js'
import { McpSettings } from './McpSettings.js'
import { MemorySettings } from './MemorySettings.js'
import { ModelConnectionSettings } from './ModelConnectionSettings.js'
import { PersonalizationSettings } from './PersonalizationSettings.js'
import { ProfileSettings } from './ProfileSettings.js'
import { SettingsSection } from './SettingsSection.js'
import { UsageBillingSettings } from './UsageBillingSettings.js'
import { SettingsContentArea } from './SettingsContentArea.js';

type Props = {
  activeTab: string
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

export function SettingsPage({
  activeTab,
  onError,
  onNotice,
}: Props): React.ReactNode {
  if (activeTab === 'general') return <GeneralSettings onNotice={onNotice} />
  if (activeTab === 'appearance') {
    return <AppearanceSettings onError={onError} onNotice={onNotice} />
  }
  if (activeTab === 'config') return <ConfigSettings />
  if (activeTab === 'connections') return <ModelConnectionSettings onError={onError} />
  if (activeTab === 'mcp') return <McpSettings />
  if (activeTab === 'git') return <GitSettings />
  if (activeTab === 'profile') return <ProfileSettings />
  if (activeTab === 'personalization') {
    return <PersonalizationSettings onError={onError} onNotice={onNotice} />
  }
  if (activeTab === 'memory') return <MemorySettings />
  if (activeTab === 'shortcuts') return <KeyboardShortcutsSettings />
  if (activeTab === 'archived') return <ArchivedConversationsSettings />
  if (activeTab === 'billing') return <UsageBillingSettings />
  if (activeTab === 'browser') return <BrowserSettings />
  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner tw:mx-auto tw:w-full tw:max-w-[48rem] tw:px-6 tw:py-8">
        <div className="settings-page-header tw:mb-7 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:text-xl tw:font-[var(--font-weight-heading)] tw:text-app-text">建设中</h2>
        </div>
        <SettingsSection description="此设置页面暂未实现。">
          <div />
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

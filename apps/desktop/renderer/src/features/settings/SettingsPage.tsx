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
import { UsageBillingSettings } from './UsageBillingSettings.js'
import { SETTINGS_ITEMS } from './settingsRegistry.js'

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
  const resolvedTab = SETTINGS_ITEMS.some(item => item.routeId === activeTab)
    ? activeTab
    : 'general'
  if (resolvedTab === 'general') return <GeneralSettings onNotice={onNotice} />
  if (resolvedTab === 'appearance') {
    return <AppearanceSettings onError={onError} onNotice={onNotice} />
  }
  if (resolvedTab === 'config') return <ConfigSettings />
  if (resolvedTab === 'connections') return <ModelConnectionSettings onError={onError} />
  if (resolvedTab === 'mcp') return <McpSettings />
  if (resolvedTab === 'git') return <GitSettings />
  if (resolvedTab === 'profile') return <ProfileSettings />
  if (resolvedTab === 'personalization') {
    return <PersonalizationSettings onError={onError} onNotice={onNotice} />
  }
  if (resolvedTab === 'memory') return <MemorySettings />
  if (resolvedTab === 'shortcuts') return <KeyboardShortcutsSettings />
  if (resolvedTab === 'archived') return <ArchivedConversationsSettings />
  if (resolvedTab === 'billing') return <UsageBillingSettings />
  if (resolvedTab === 'browser') return <BrowserSettings />
  return <GeneralSettings onNotice={onNotice} />
}

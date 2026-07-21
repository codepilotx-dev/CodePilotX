import React, { Suspense } from 'react'
import { SETTINGS_ITEMS } from './settingsRegistry.js'

const AppearanceSettings = React.lazy(() => import('./AppearanceSettings.js').then(module => ({ default: module.AppearanceSettings })))
const ArchivedConversationsSettings = React.lazy(() => import('./ArchivedConversationsSettings.js').then(module => ({ default: module.ArchivedConversationsSettings })))
const BrowserSettings = React.lazy(() => import('./BrowserSettings.js').then(module => ({ default: module.BrowserSettings })))
const ConfigSettings = React.lazy(() => import('./ConfigSettings.js').then(module => ({ default: module.ConfigSettings })))
const GeneralSettings = React.lazy(() => import('./GeneralSettings.js').then(module => ({ default: module.GeneralSettings })))
const GitSettings = React.lazy(() => import('./GitSettings.js').then(module => ({ default: module.GitSettings })))
const KeyboardShortcutsSettings = React.lazy(() => import('./KeyboardShortcutsSettings.js').then(module => ({ default: module.KeyboardShortcutsSettings })))
const McpSettings = React.lazy(() => import('./McpSettings.js').then(module => ({ default: module.McpSettings })))
const MemorySettings = React.lazy(() => import('./MemorySettings.js').then(module => ({ default: module.MemorySettings })))
const ModelConnectionSettings = React.lazy(() => import('./ModelConnectionSettings.js').then(module => ({ default: module.ModelConnectionSettings })))
const PersonalizationSettings = React.lazy(() => import('./PersonalizationSettings.js').then(module => ({ default: module.PersonalizationSettings })))
const ProfileSettings = React.lazy(() => import('./ProfileSettings.js').then(module => ({ default: module.ProfileSettings })))
const UsageBillingSettings = React.lazy(() => import('./UsageBillingSettings.js').then(module => ({ default: module.UsageBillingSettings })))

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
  let content: React.ReactNode
  if (resolvedTab === 'general') content = <GeneralSettings onNotice={onNotice} />
  else if (resolvedTab === 'appearance') content = <AppearanceSettings onError={onError} onNotice={onNotice} />
  else if (resolvedTab === 'config') content = <ConfigSettings />
  else if (resolvedTab === 'connections') content = <ModelConnectionSettings onError={onError} />
  else if (resolvedTab === 'mcp') content = <McpSettings />
  else if (resolvedTab === 'git') content = <GitSettings />
  else if (resolvedTab === 'profile') content = <ProfileSettings />
  else if (resolvedTab === 'personalization') content = <PersonalizationSettings onError={onError} onNotice={onNotice} />
  else if (resolvedTab === 'memory') content = <MemorySettings />
  else if (resolvedTab === 'shortcuts') content = <KeyboardShortcutsSettings />
  else if (resolvedTab === 'archived') content = <ArchivedConversationsSettings />
  else if (resolvedTab === 'billing') content = <UsageBillingSettings />
  else if (resolvedTab === 'browser') content = <BrowserSettings />
  else content = <GeneralSettings onNotice={onNotice} />
  return <Suspense fallback={null}>{content}</Suspense>
}

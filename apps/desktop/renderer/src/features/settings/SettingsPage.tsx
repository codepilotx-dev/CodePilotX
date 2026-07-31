import React, { Suspense } from 'react'
import type { DesktopInstalledSkill } from '../../../shared/types.js'
import { SETTINGS_ITEMS } from './settingsRegistry.js'

const AppearanceSettings = React.lazy(() => import('./AppearanceSettings.js').then(module => ({ default: module.AppearanceSettings })))
const ArchivedConversationsSettings = React.lazy(() => import('./ArchivedConversationsSettings.js').then(module => ({ default: module.ArchivedConversationsSettings })))
const BrowserSettings = React.lazy(() => import('./BrowserSettings.js').then(module => ({ default: module.BrowserSettings })))
const ConfigSettings = React.lazy(() => import('./ConfigSettings.js').then(module => ({ default: module.ConfigSettings })))
const EnvironmentSettings = React.lazy(() => import('./EnvironmentSettings.js').then(module => ({ default: module.EnvironmentSettings })))
const GeneralSettings = React.lazy(() => import('./GeneralSettings.js').then(module => ({ default: module.GeneralSettings })))
const GitSettings = React.lazy(() => import('./GitSettings.js').then(module => ({ default: module.GitSettings })))
const KeyboardShortcutsSettings = React.lazy(() => import('./KeyboardShortcutsSettings.js').then(module => ({ default: module.KeyboardShortcutsSettings })))
const PluginsSettingsPage = React.lazy(() => import('./plugins/PluginsSettingsPage.js').then(module => ({ default: module.PluginsSettingsPage })))
const MemorySettings = React.lazy(() => import('./MemorySettings.js').then(module => ({ default: module.MemorySettings })))
const PetSettings = React.lazy(() => import('./PetSettings.js').then(module => ({ default: module.PetSettings })))
const PersonalizationSettings = React.lazy(() => import('./PersonalizationSettings.js').then(module => ({ default: module.PersonalizationSettings })))
const ProfileSettings = React.lazy(() => import('./ProfileSettings.js').then(module => ({ default: module.ProfileSettings })))
const UsageBillingSettings = React.lazy(() => import('./UsageBillingSettings.js').then(module => ({ default: module.UsageBillingSettings })))
const WorkspaceDependenciesSettings = React.lazy(() => import('./WorkspaceDependenciesSettings.js').then(module => ({ default: module.WorkspaceDependenciesSettings })))

type Props = {
  activeTab: string
  workspacePath: string | null
  onUseSkill: (skill: DesktopInstalledSkill) => void
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

export function SettingsPage({
  activeTab,
  workspacePath,
  onUseSkill,
  onError,
  onNotice,
}: Props): React.ReactNode {
  const resolvedTab = SETTINGS_ITEMS.some(item => item.routeId === activeTab)
    ? activeTab
    : 'general'
  let content: React.ReactNode
  if (resolvedTab === 'general') content = <GeneralSettings onNotice={onNotice} />
  else if (resolvedTab === 'appearance') content = <AppearanceSettings onError={onError} />
  else if (resolvedTab === 'config') content = <ConfigSettings />
  else if (resolvedTab === 'plugins') {
    content = (
      <PluginsSettingsPage
        workspacePath={workspacePath}
        onUseSkill={onUseSkill}
        onError={onError}
        onNotice={onNotice}
      />
    )
  }
  else if (resolvedTab === 'git') content = <GitSettings />
  else if (resolvedTab === 'environment') {
    content = <EnvironmentSettings onError={onError} onNotice={onNotice} />
  }
  else if (resolvedTab === 'profile') content = <ProfileSettings />
  else if (resolvedTab === 'personalization') content = <PersonalizationSettings onError={onError} onNotice={onNotice} />
  else if (resolvedTab === 'memory') {
    content = (
      <MemorySettings
        key={workspacePath ?? 'no-workspace'}
        workspacePath={workspacePath}
      />
    )
  }
  else if (resolvedTab === 'pets') content = <PetSettings onError={onError} onNotice={onNotice} />
  else if (resolvedTab === 'shortcuts') content = <KeyboardShortcutsSettings />
  else if (resolvedTab === 'archived') content = <ArchivedConversationsSettings />
  else if (resolvedTab === 'billing') content = <UsageBillingSettings />
  else if (resolvedTab === 'browser') content = <BrowserSettings />
  else if (resolvedTab === 'dependencies') content = <WorkspaceDependenciesSettings onError={onError} onNotice={onNotice} />
  else content = <GeneralSettings onNotice={onNotice} />
  return <Suspense fallback={null}>{content}</Suspense>
}

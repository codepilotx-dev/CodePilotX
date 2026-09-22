import React from 'react'
import type { DesktopInstalledSkill } from '../../../shared/types.js'
import { SETTINGS_ITEMS } from './settingsRegistry.js'
import { AppearanceSettings } from './AppearanceSettings.js'
import { ArchivedConversationsSettings } from './ArchivedConversationsSettings.js'
import { BrowserSettings } from './BrowserSettings.js'
import { ConfigSettings } from './ConfigSettings.js'
import { EnvironmentSettings } from './EnvironmentSettings.js'
import { GeneralSettings } from './GeneralSettings.js'
import { GitSettings } from './GitSettings.js'
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings.js'
import { PluginsSettingsPage } from './plugins/PluginsSettingsPage.js'
import { MemorySettings } from './MemorySettings.js'
import { PetSettings } from './PetSettings.js'
import { PersonalizationSettings } from './PersonalizationSettings.js'
import { ProfileSettings } from './ProfileSettings.js'
import { UsageBillingSettings } from './UsageBillingSettings.js'
import { WorkspaceDependenciesSettings } from './WorkspaceDependenciesSettings.js'
import { LocalEnvironmentSettings } from './local-environment/LocalEnvironmentSettings.js'
import { WorktreeSettings } from '../worktree/WorktreeSettings.js'
import { ProviderSettings } from '../models/ModelCenterView.js'

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
  else if (resolvedTab === 'providers') {
    content = <ProviderSettings onError={onError} onNotice={onNotice ?? (() => {})} />
  }
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
  else if (resolvedTab === 'local-environment') content = <LocalEnvironmentSettings onError={onError} onNotice={onNotice} />
  else if (resolvedTab === 'worktrees') content = <WorktreeSettings onError={onError} onNotice={onNotice} />
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
  return content
}

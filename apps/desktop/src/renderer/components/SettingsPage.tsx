import React from 'react'
import { AppearanceSettings } from './AppearanceSettings.js'
import { ArchivedConversationsSettings } from './ArchivedConversationsSettings.js'
import { GeneralSettings } from './GeneralSettings.js'
import { ModelProviderSettings } from './ModelProviderSettings.js'

type Props = {
  activeTab: string
  legacySettings?: React.ReactNode
}

export function SettingsPage({
  activeTab,
  legacySettings,
}: Props): React.ReactNode {
  return (
    <div className="settings-page">
      {activeTab === 'general' ? (
        <GeneralSettings />
      ) : activeTab === 'appearance' ? (
        <AppearanceSettings />
      ) : activeTab === 'config' ? (
        <div className="settings-content-area">
          <h2 className="settings-section-title">高级配置</h2>
          <ModelProviderSettings />
          {legacySettings ? (
            <div className="settings-block">{legacySettings}</div>
          ) : null}
        </div>
      ) : activeTab === 'archived' ? (
        <ArchivedConversationsSettings />
      ) : (
        <div className="settings-content-area">
          <h2 className="settings-section-title">建设中...</h2>
          <p className="settings-block-desc">此设置页面暂未实现。</p>
        </div>
      )}
    </div>
  )
}

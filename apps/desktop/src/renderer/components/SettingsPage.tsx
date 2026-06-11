import React from 'react'
import { AppearanceSettings } from './AppearanceSettings.js'
import { ArchivedConversationsSettings } from './ArchivedConversationsSettings.js'
import { GeneralSettings } from './GeneralSettings.js'
import { ModelProviderSettings } from './ModelProviderSettings.js'
import { UsageBillingSettings } from './UsageBillingSettings.js'

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
          <div className="settings-content-inner settings-content-inner-wide">
            <h2 className="settings-page-title">高级配置</h2>
            <p className="settings-page-desc">
              配置桌面端新会话使用的模型供应商、模型、API key 和连接状态。
            </p>
            <ModelProviderSettings />
            {legacySettings ? (
              <div className="settings-block">{legacySettings}</div>
            ) : null}
          </div>
        </div>
      ) : activeTab === 'archived' ? (
        <ArchivedConversationsSettings />
      ) : activeTab === 'billing' ? (
        <UsageBillingSettings />
      ) : (
        <div className="settings-content-area">
          <div className="settings-content-inner">
            <h2 className="settings-page-title">建设中...</h2>
            <p className="settings-block-desc">此设置页面暂未实现。</p>
          </div>
        </div>
      )}
    </div>
  )
}

import React from 'react'
import { GeneralSettings } from './GeneralSettings.js'
import { AppearanceSettings } from './AppearanceSettings.js'

type Props = {
  activeTab: string
  legacySettings?: React.ReactNode
}

export function SettingsPage({ activeTab, legacySettings }: Props) {
  return (
    <div className="settings-page">
      {/* 
        Ideally we would switch rendering based on activeTab. 
        For this task, we only implemented the GeneralSettings 
      */}
      {activeTab === 'general' ? (
        <GeneralSettings />
      ) : activeTab === 'appearance' ? (
        <AppearanceSettings />
      ) : activeTab === 'config' ? (
        <div className="settings-content-area">
          <h2 className="settings-section-title">高级配置</h2>
          <div className="settings-block">
             {legacySettings}
          </div>
        </div>
      ) : (
        <div className="settings-content-area">
          <h2 className="settings-section-title">建设中...</h2>
          <p className="settings-block-desc">此设置页面暂未实现。</p>
        </div>
      )}
    </div>
  )
}

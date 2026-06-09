import React, { useState } from 'react'
import { SettingsNav } from './SettingsNav.js'
import { GeneralSettings } from './GeneralSettings.js'

type Props = {
  onClose: () => void
  legacySettings?: React.ReactNode
}

export function SettingsPage({ onClose, legacySettings }: Props) {
  const [activeTab, setActiveTab] = useState('general')

  return (
    <div className="settings-page">
      <SettingsNav 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        onBack={onClose} 
      />
      
      {/* 
        Ideally we would switch rendering based on activeTab. 
        For this task, we only implemented the GeneralSettings 
      */}
      {activeTab === 'general' ? (
        <GeneralSettings />
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

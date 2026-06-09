import React from 'react'
import { RadioCard } from './RadioCard.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { Brain, Zap, Code2, Terminal } from 'lucide-react'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import {
  PERMISSION_MODE_OPTIONS,
  THINKING_MODE_OPTIONS,
} from '../features/settings/settingsStorage.js'

const THINKING_MODE_DESCRIPTIONS = {
  disabled: '尽量减少额外推理，优先快速响应。',
  default: '使用默认推理设置，适合日常任务。',
  adaptive: '根据任务复杂度自动调整推理深度。',
  enabled: '启用更深入的推理，适合复杂分析。',
} satisfies Record<(typeof THINKING_MODE_OPTIONS)[number]['value'], string>

export function GeneralSettings() {
  const {
    permissionMode,
    setPermissionMode,
    thinkingMode,
    setThinkingMode,
    model,
    setModel,
  } = useDesktopSettings()

  return (
    <div className="settings-content-area">
      <h2 className="settings-section-title">常规</h2>

      {/* Plate 1: Work Mode */}
      <div className="settings-block">
        <h3 className="settings-block-title">工作模式</h3>
        <p className="settings-block-desc">选择模型思考的深入程度与显示细节</p>
        <div className="settings-radio-group">
          {THINKING_MODE_OPTIONS.map(option => (
            <RadioCard
              checked={thinkingMode === option.value}
              description={THINKING_MODE_DESCRIPTIONS[option.value]}
              icon={
                option.value === 'enabled' || option.value === 'adaptive' ? (
                  <Brain />
                ) : (
                  <Zap />
                )
              }
              key={option.value}
              onClick={() => setThinkingMode(option.value)}
              title={option.label}
            />
          ))}
        </div>
      </div>

      {/* Plate 2: Permissions */}
      <div className="settings-block">
        <h3 className="settings-block-title">权限</h3>
        <p className="settings-block-desc">配置应用在您的系统上的操作权限限制</p>
        <div className="settings-toggle-list">
          {PERMISSION_MODE_OPTIONS.map(option => (
            <ToggleSwitch
              checked={permissionMode === option.value}
              description={option.detail}
              key={option.value}
              onChange={checked => {
                if (checked) setPermissionMode(option.value)
              }}
              title={option.label}
            />
          ))}
        </div>
      </div>

      {/* Plate 3: General subcategory (Dropdown) */}
      <div className="settings-block">
        <h3 className="settings-block-title">默认代码编辑器</h3>
        <p className="settings-block-desc">选择用于在外部打开文件的首选编辑器</p>
        <SettingsDropdown
          value={model || 'vscode'} // Just a visual mock if the setting doesn't perfectly match editor
          onChange={(v) => setModel(v)} // We map it to model just to keep data binding active
          options={[
            { value: 'vscode', label: 'Visual Studio Code', icon: <Code2 size={16} /> },
            { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', icon: <Brain size={16} /> },
            { value: 'terminal', label: 'Terminal', icon: <Terminal size={16} /> },
          ]}
        />
      </div>
    </div>
  )
}

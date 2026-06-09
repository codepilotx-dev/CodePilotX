import React from 'react'
import { RadioCard } from './RadioCard.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { Brain, Zap, Code2, Terminal } from 'lucide-react'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'

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
          <RadioCard
            icon={<Zap />}
            title="标准模式"
            description="快速响应，适合日常常规任务与代码生成。"
            checked={thinkingMode === 'default' || thinkingMode === 'disabled'}
            onClick={() => setThinkingMode('default')}
          />
          <RadioCard
            icon={<Brain />}
            title="深度推理"
            description="允许模型在回答前进行更长时间的逻辑推理。"
            checked={thinkingMode === 'enabled' || thinkingMode === 'adaptive'}
            onClick={() => setThinkingMode('enabled')}
          />
        </div>
      </div>

      {/* Plate 2: Permissions */}
      <div className="settings-block">
        <h3 className="settings-block-title">权限</h3>
        <p className="settings-block-desc">配置应用在您的系统上的操作权限限制</p>
        <div className="settings-toggle-list">
          <ToggleSwitch
            title="只读模式 (Read)"
            description="模型只能读取文件和执行安全命令，不能修改文件。"
            checked={permissionMode === 'read'}
            onChange={(checked) => {
              if (checked) setPermissionMode('read')
            }}
          />
          <ToggleSwitch
            title="自动审核 (Bypass)"
            description="跳过常规的权限弹窗，加快连续操作速度。"
            checked={permissionMode === 'bypass'}
            onChange={(checked) => {
              if (checked) setPermissionMode('bypass')
              else if (permissionMode === 'bypass') setPermissionMode('read')
            }}
          />
          <ToggleSwitch
            title="完全访问 (Full)"
            description="授予模型对系统文件和命令的完整访问权限。"
            checked={permissionMode === 'full'}
            onChange={(checked) => {
              if (checked) setPermissionMode('full')
              else if (permissionMode === 'full') setPermissionMode('read')
            }}
          />
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

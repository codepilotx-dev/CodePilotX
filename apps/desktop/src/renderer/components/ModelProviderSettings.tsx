import React from 'react'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { THINKING_MODE_OPTIONS } from '../features/settings/settingsStorage.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

export function ModelProviderSettings(): React.ReactNode {
  const settings = useDesktopSettings()

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">Agent 配置</h2>
        <p className="settings-page-desc">
          配置桌面端新会话使用的默认行为。模型供应商、API key、Base URL 和连接测试已移至连接页。
        </p>

        <SettingsSection
          title="新会话默认值"
          description="这些值会写入桌面端设置，并在创建新会话时进入 session snapshot。"
        >
          <SettingsRow
            title="会话名称"
            description="可选。留空时由对话内容生成标题。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={settings.sessionName}
                placeholder="自动生成"
                onChange={event => settings.setSessionName(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Thinking 模式"
            description="选择支持推理模型的新会话默认推理强度。"
            control={
              <SettingsDropdown
                ariaLabel="Thinking 模式"
                value={settings.thinkingMode}
                options={THINKING_MODE_OPTIONS}
                onChange={value =>
                  settings.setThinkingMode(
                    value as typeof settings.thinkingMode,
                  )
                }
              />
            }
          />
          <SettingsRow
            title="系统提示词"
            description="可选。设置后替换默认系统提示词。"
            control={
              <textarea
                className="settings-textarea"
                value={settings.systemPrompt}
                placeholder="使用内置默认"
                onChange={event => settings.setSystemPrompt(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="追加系统提示词"
            description="可选。追加到默认系统提示词之后。"
            control={
              <textarea
                className="settings-textarea"
                value={settings.appendSystemPrompt}
                placeholder="无追加内容"
                onChange={event =>
                  settings.setAppendSystemPrompt(event.target.value)
                }
              />
            }
          />
          <SettingsRow
            title="额外目录"
            description="每行一个目录，新会话会额外读取这些工作目录。"
            control={
              <textarea
                className="settings-textarea settings-code-textarea"
                value={settings.additionalDirectories}
                placeholder="D:\\path\\to\\repo"
                onChange={event =>
                  settings.setAdditionalDirectories(event.target.value)
                }
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

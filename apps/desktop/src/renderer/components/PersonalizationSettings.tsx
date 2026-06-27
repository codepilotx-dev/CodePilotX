import React, { useEffect, useState } from 'react'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import type { DesktopPersonality } from '../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { ToggleSwitch } from './ToggleSwitch.js'

const PERSONALITY_OPTIONS: Array<{
  value: DesktopPersonality
  label: string
}> = [
  { value: 'pragmatic', label: '务实' },
  { value: 'friendly', label: '友好' },
  { value: 'concise', label: '严谨' },
  { value: 'encouraging', label: '鼓励' },
]

function LearnMoreLink() {
  return (
    <a
      className="settings-row-link"
      href="#"
      onClick={event => event.preventDefault()}
    >
      了解更多
    </a>
  )
}

export function PersonalizationSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const [draftInstructions, setDraftInstructions] = useState(
    settings.customInstructions,
  )

  useEffect(() => {
    setDraftInstructions(settings.customInstructions)
  }, [settings.customInstructions])

  const dirty = draftInstructions !== settings.customInstructions

  const handleSave = (): void => {
    settings.setCustomInstructions(draftInstructions)
  }

  const handleResetMemory = (): void => {
    const confirmed = window.confirm('将删除所有 Codex 记忆。确认继续吗？')
    if (!confirmed) return
    window.alert('记忆已重置（占位）。')
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">个性化</h2>

        <SettingsSection>
          <SettingsRow
            title="个性"
            description="选择 Codex 回复的默认语气"
            control={
              <SettingsDropdown
                ariaLabel="个性"
                value={settings.personality}
                options={PERSONALITY_OPTIONS}
                onChange={value =>
                  settings.setPersonality(value as DesktopPersonality)
                }
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="自定义指令"
          description={
            <>
              为此主机上的所有任务向 Codex 提供额外说明和上下文。
              <LearnMoreLink />
            </>
          }
          actions={
            <button
              className="settings-button"
              disabled={!dirty}
              onClick={handleSave}
              type="button"
            >
              保存
            </button>
          }
        >
          <textarea
            className="settings-textarea settings-textarea-tall"
            rows={10}
            onChange={event => setDraftInstructions(event.target.value)}
            placeholder="1、用 utf-8 读取文件！&#10;2、不写测试"
            value={draftInstructions}
          />
        </SettingsSection>

        <SettingsSection
          title="记忆（实验性）"
          description={
            <>
              设置 Codex 如何收集、保留和整合记忆。
              <LearnMoreLink />
            </>
          }
        >
          <SettingsRow
            title="启用记忆"
            description="从聊天中生成新记忆，并将其带入新聊天"
            control={
              <ToggleSwitch
                ariaLabel="启用记忆"
                checked={settings.enableMemory}
                onChange={settings.setEnableMemory}
              />
            }
          />
          <SettingsRow
            title="跳过工具辅助对话"
            description="请勿从使用了 MCP 工具或网页搜索的对话中生成记忆"
            control={
              <ToggleSwitch
                ariaLabel="跳过工具辅助对话"
                checked={settings.skipToolAidedChats}
                onChange={settings.setSkipToolAidedChats}
              />
            }
          />
          <SettingsRow
            title="GitHub 记忆同步"
            description="预留能力：后续可把用户记忆同步到指定 GitHub 仓库。当前版本不会上传任何记忆。"
            control={
              <ToggleSwitch
                ariaLabel="GitHub 记忆同步"
                checked={settings.githubMemorySyncEnabled}
                onChange={settings.setGithubMemorySyncEnabled}
              />
            }
          />
          <SettingsRow
            title="记忆仓库"
            description="预留格式：owner/repo。当前版本仅保存设置。"
            control={
              <input
                className="settings-input settings-input-narrow"
                disabled={!settings.githubMemorySyncEnabled}
                value={settings.githubMemoryRepository}
                placeholder="owner/repo"
                onChange={event =>
                  settings.setGithubMemoryRepository(event.target.value)
                }
              />
            }
          />
          <SettingsRow
            title="重置记忆"
            description="删除所有 Codex 记忆"
            control={
              <button
                className="settings-button"
                onClick={handleResetMemory}
                type="button"
              >
                重置
              </button>
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

import React from 'react'
import { useDesktopSettings } from './useDesktopSettings.js'
import type { DesktopPersonality } from '../../../shared/types.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

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
      className="settings-row-link personalization-learn-more-link"
      href="#"
      onClick={event => event.preventDefault()}
    >
      了解更多
    </a>
  )
}

type Props = {
  onError?: (message: string) => void
  onNotice?: (message: string) => void
}

export function PersonalizationSettings({
  onError,
  onNotice,
}: Props = {}): React.ReactNode {
  const { draft } = useDesktopSettings()

  async function saveCustomInstructions(): Promise<void> {
    try {
      await draft.save()
      onNotice?.('设置已保存')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onError?.(message)
    }
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">个性化</h2>
        </div>

        <SettingsSection>
          <SettingsRow
            title="个性"
            description="选择 CodePilotX 回复的默认语气"
            autoSave
            control={
              <SettingsDropdown
                ariaLabel="个性"
                value={draft.values.personality}
                options={PERSONALITY_OPTIONS}
                onChange={value => {
                  draft.setValue('personality', value as DesktopPersonality)
                  draft.autoSave()
                }}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="自定义指令"
          description={
            <>
              为此主机上的所有任务向 CodePilotX 提供额外说明和上下文。
              <LearnMoreLink />
            </>
          }
        >
          <div className="personalization-instructions-editor">
            <textarea
              className="settings-textarea settings-textarea-tall personalization-textarea"
              onChange={event =>
                draft.setValue('customInstructions', event.target.value)
              }
              placeholder="1、用 utf-8 读取文件！&#10;2、不写测试"
              value={draft.values.customInstructions}
            />
            <div className="personalization-actions">
              <button
                className="settings-button"
                disabled={draft.saving}
                onClick={() => void saveCustomInstructions()}
                type="button"
              >
                {draft.saving ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

import React from 'react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'

export function GitSettings(): React.ReactNode {
  const {
    gitBranchPrefix,
    setGitBranchPrefix,
    allowForcePush,
    setAllowForcePush,
    commitMessagePrompt,
    setCommitMessagePrompt,
    pullRequestPrompt,
    setPullRequestPrompt,
  } = useDesktopSettings()

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">Git</h2>
        <p className="settings-page-desc">
          配置 Codex 风格的分支命名和 Git 工作流提示词。v1 先保存这些偏好，后续可接入提交和 PR 命令。
        </p>

        <SettingsSection
          title="分支与推送"
          description="这些设置用于标准化新分支和高风险 Git 操作。"
        >
          <SettingsRow
            title="分支前缀"
            description="新建工作分支时使用的默认前缀。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={gitBranchPrefix}
                placeholder="codex/"
                onChange={event => setGitBranchPrefix(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="允许 force push"
            description="关闭时，桌面端默认不鼓励高风险强推操作。"
            control={
              <ToggleSwitch
                checked={allowForcePush}
                onChange={setAllowForcePush}
                ariaLabel="允许 force push"
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="提示词"
          description="留空表示使用内置默认提示词。"
        >
          <SettingsRow
            title="Commit message 提示词"
            description="用于生成提交信息的额外偏好。"
            control={
              <textarea
                className="settings-textarea"
                value={commitMessagePrompt}
                placeholder="使用内置默认"
                onChange={event => setCommitMessagePrompt(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Pull request 描述提示词"
            description="用于生成 PR 描述的额外偏好。"
            control={
              <textarea
                className="settings-textarea"
                value={pullRequestPrompt}
                placeholder="使用内置默认"
                onChange={event => setPullRequestPrompt(event.target.value)}
              />
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

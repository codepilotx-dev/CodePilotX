import React, { useEffect, useState } from 'react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SegmentedControl } from './SegmentedControl.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { desktopClient } from '../../services/desktopClient.js'
import type {
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
} from '../../../shared/types.js'

const PR_MERGE_OPTIONS: Array<{ value: 'merge' | 'squash'; label: string }> = [
  { value: 'merge', label: '合并' },
  { value: 'squash', label: '压缩' },
]

export function GitSettings(): React.ReactNode {
  const { draft } = useDesktopSettings()
  const {
    gitBranchPrefix,
    gitPrMergeMethod,
    gitShowPrIconsInSidebar,
    gitDraftPullRequest,
    gitAutoDeleteWorktree,
    gitAutoDeleteWorktreeLimit,
    allowForcePush,
    commitMessagePrompt,
    pullRequestPrompt,
    githubOAuthClientId,
  } = draft.values
  const [githubAuth, setGithubAuth] =
    useState<DesktopGithubAuthStatus | null>(null)
  const [githubLogin, setGithubLogin] =
    useState<DesktopGithubLoginStatus | null>(null)
  const [githubBusy, setGithubBusy] = useState(false)
  useEffect(() => {
    let mounted = true
    void desktopClient.getGithubAuthStatus().then(status => {
      if (mounted) setGithubAuth(status)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!githubLogin || githubLogin.state !== 'awaiting_auth') {
      return
    }
    const timer = window.setInterval(() => {
      void desktopClient.pollGithubLogin().then(status => {
        setGithubLogin(status)
        if (status.auth) {
          setGithubAuth(status.auth)
        }
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [githubLogin])

  const startGithubLogin = async (): Promise<void> => {
    setGithubBusy(true)
    try {
      const status = await desktopClient.startGithubLogin({
        clientId: githubOAuthClientId,
      })
      setGithubLogin(status)
      if (status.auth) {
        setGithubAuth(status.auth)
      }
    } finally {
      setGithubBusy(false)
    }
  }

  const logoutGithub = async (): Promise<void> => {
    setGithubBusy(true)
    try {
      const status = await desktopClient.logoutGithub()
      setGithubAuth(status)
      setGithubLogin(null)
    } finally {
      setGithubBusy(false)
    }
  }

  const githubStatusText = githubAuth?.authenticated
    ? `已登录 ${githubAuth.user?.login ?? 'GitHub'}`
    : !githubOAuthClientId.trim() && githubAuth?.configured === false
      ? '未配置 OAuth Client ID'
      : '未登录'
  const githubClientConfigured = Boolean(githubOAuthClientId.trim()) ||
    githubAuth?.configured === true
  const activeDeviceLogin =
    githubLogin?.state === 'awaiting_auth' && githubLogin.userCode

  const copyGithubCode = async (): Promise<void> => {
    if (!githubLogin?.userCode) return
    await navigator.clipboard.writeText(githubLogin.userCode)
  }

  const openGithubDevicePage = async (): Promise<void> => {
    if (!githubLogin?.verificationUri) return
    await desktopClient.openExternalURL(githubLogin.verificationUri)
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">Git</h2>

        <SettingsSection>
          <SettingsRow
            title="分支前缀"
            description="在 Codex 中创建新分支时使用的前缀"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={gitBranchPrefix}
                placeholder="codex/"
                onChange={event =>
                  draft.setValue('gitBranchPrefix', event.target.value)
                }
              />
            }
          />
          <SettingsRow
            title="拉取请求合并方法"
            description="选择 Codex 合并拉取请求的方法"
            control={
              <SegmentedControl
                value={gitPrMergeMethod}
                options={PR_MERGE_OPTIONS}
                onChange={value => draft.setValue('gitPrMergeMethod', value)}
              />
            }
          />
          <SettingsRow
            title="在侧边栏显示 PR 图标"
            description="在侧边栏的对话行中显示 PR 状态图标"
            control={
              <ToggleSwitch
                checked={gitShowPrIconsInSidebar}
                onChange={value =>
                  draft.setValue('gitShowPrIconsInSidebar', value)
                }
                ariaLabel="在侧边栏显示 PR 图标"
              />
            }
          />
          <SettingsRow
            title="始终强制推送"
            description="从 Codex 推送时使用 --force-with-lease 参数"
            control={
              <ToggleSwitch
                checked={allowForcePush}
                onChange={value => draft.setValue('allowForcePush', value)}
                ariaLabel="始终强制推送"
              />
            }
          />
          <SettingsRow
            title="创建草稿拉取请求"
            description="从 Codex 创建 PR 时默认使用草稿拉取请求"
            control={
              <ToggleSwitch
                checked={gitDraftPullRequest}
                onChange={value =>
                  draft.setValue('gitDraftPullRequest', value)
                }
                ariaLabel="创建草稿拉取请求"
              />
            }
          />
          <SettingsRow
            title="自动删除旧工作树"
            description="推荐大多数用户启用。仅当你需要手动管理旧工作树和磁盘使用空间时，再关闭此功能。"
            control={
              <ToggleSwitch
                checked={gitAutoDeleteWorktree}
                onChange={value =>
                  draft.setValue('gitAutoDeleteWorktree', value)
                }
                ariaLabel="自动删除旧工作树"
              />
            }
          />
          <SettingsRow
            title="自动删除限制"
            description="自动清理较旧工作树前保留的 Codex 工作树数量。Codex 会在删除前为工作树创建快照，因此被清理的工作树应始终可恢复。"
            control={
              <input
                className="settings-input settings-input-narrow"
                type="number"
                min={1}
                step={1}
                value={gitAutoDeleteWorktreeLimit}
                onChange={event => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) {
                    draft.setValue(
                      'gitAutoDeleteWorktreeLimit',
                      Math.max(1, Math.floor(next)),
                    )
                  }
                }}
              />
            }
          />
          <SettingsRow
            title="提交指令"
            description="已添加到提交信息生成提示中"
            control={
              <div className="settings-git-instruction-control">
                <textarea
                  className="settings-textarea"
                  rows={4}
                  value={commitMessagePrompt}
                  placeholder="添加提交消息指引..."
                  onChange={event =>
                    draft.setValue('commitMessagePrompt', event.target.value)
                  }
                />
              </div>
            }
          />
          <SettingsRow
            title="拉取请求指令"
            description="已添加到 PR 标题/描述生成提示中"
            control={
              <div className="settings-git-instruction-control">
                <textarea
                  className="settings-textarea"
                  rows={4}
                  value={pullRequestPrompt}
                  placeholder="添加拉取请求消息指引..."
                  onChange={event =>
                    draft.setValue('pullRequestPrompt', event.target.value)
                  }
                />
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="GitHub 账号"
          description="登录后可在项目选择器中列出并克隆你有权限访问的 GitHub 仓库。"
        >
          {activeDeviceLogin ? (
            <div className="github-device-code-card">
              <div>
                <div className="github-device-code-label">GitHub 设备验证码</div>
                <div className="github-device-code-value">
                  {githubLogin.userCode}
                </div>
                <p>
                  在 GitHub 打开的设备登录页面输入这个验证码，不是 OAuth Client ID。
                </p>
              </div>
              <div className="github-device-code-actions">
                <button
                  className="settings-button"
                  onClick={() => void copyGithubCode()}
                  type="button"
                >
                  复制验证码
                </button>
                <button
                  className="settings-button primary"
                  onClick={() => void openGithubDevicePage()}
                  type="button"
                >
                  打开验证页面
                </button>
              </div>
            </div>
          ) : null}
          <SettingsRow
            title="OAuth Client ID"
            description="GitHub OAuth App 的公开 client_id；需要在 OAuth App 设置里启用 device flow。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={githubOAuthClientId}
                placeholder="Iv1.xxxxxxxxxxxxxxxx"
                onChange={event => {
                  const value = event.target.value
                  draft.setValue('githubOAuthClientId', value)
                  if (value.trim() && githubAuth?.configured === false) {
                    setGithubAuth({
                      configured: true,
                      authenticated: false,
                      user: null,
                    })
                  }
                }}
              />
            }
          />
          <SettingsRow
            title="登录状态"
            description={
              githubLogin?.state === 'awaiting_auth' && githubLogin.userCode
                ? `请在打开的 GitHub 页面输入验证码 ${githubLogin.userCode}`
                : githubAuth?.error ?? 'GitHub token 只保存在本机主进程存储中。'
            }
            control={
              <div className="settings-inline-actions">
                <span className="settings-row-status">{githubStatusText}</span>
                {githubAuth?.authenticated ? (
                  <button
                    className="settings-button"
                    disabled={githubBusy}
                    onClick={() => void logoutGithub()}
                    type="button"
                  >
                    退出
                  </button>
                ) : (
                  <button
                    className="settings-button primary"
                    disabled={githubBusy || !githubClientConfigured}
                    onClick={() => void startGithubLogin()}
                    type="button"
                  >
                    登录 GitHub
                  </button>
                )}
              </div>
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

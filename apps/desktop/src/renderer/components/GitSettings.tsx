import React, { useEffect, useState } from 'react'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from './ToggleSwitch.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { desktopClient } from '../services/desktopClient.js'
import type {
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
} from '../../shared/types.js'

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
    githubOAuthClientId,
    setGithubOAuthClientId,
  } = useDesktopSettings()
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
        <p className="settings-page-desc">
          配置 Codex 风格的分支命名和 Git 工作流提示词。v1 先保存这些偏好，后续可接入提交和 PR 命令。
        </p>

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
                  setGithubOAuthClientId(value)
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
                rows={4}
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
                rows={4}
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

import React, { useEffect, useState } from 'react'
import { ExternalLink, GitFork, RefreshCw, User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { DesktopGithubAuthStatus } from '../../shared/types.js'
import { desktopClient } from '../services/desktopClient.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

export function ProfileSettings(): React.ReactNode {
  const navigate = useNavigate()
  const [githubAuth, setGithubAuth] =
    useState<DesktopGithubAuthStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const loadGithubAuth = async (): Promise<void> => {
    setLoading(true)
    try {
      setGithubAuth(await desktopClient.getGithubAuthStatus())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    setLoading(true)
    void desktopClient.getGithubAuthStatus().then(status => {
      if (mounted) {
        setGithubAuth(status)
        setLoading(false)
      }
    }).catch(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const user = githubAuth?.authenticated ? githubAuth.user : null
  const githubStatus = loading
    ? '正在读取 GitHub 账号...'
    : user
      ? `已连接 @${user.login}`
      : githubAuth?.configured === false
        ? '未配置 GitHub OAuth Client ID'
        : '未连接 GitHub'

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">个人资料</h2>
        <p className="settings-page-desc">
          查看此桌面端当前连接的账号资料。
        </p>

        <SettingsSection
          title="GitHub 账号"
          description="这里展示的是本机已登录的 GitHub 账号；登录和退出仍在 Git 设置页管理。"
          actions={
            <button
              className="settings-button"
              disabled={loading}
              onClick={() => void loadGithubAuth()}
              type="button"
            >
              <RefreshCw />
              刷新
            </button>
          }
        >
          <div className="profile-github-card">
            <div className="profile-github-avatar" aria-hidden="true">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                <User />
              )}
            </div>
            <div className="profile-github-copy">
              <div className="profile-github-name">
                {user?.name || user?.login || 'GitHub'}
              </div>
              <div className="profile-github-meta">{githubStatus}</div>
            </div>
            {user?.htmlUrl ? (
              <button
                className="settings-button"
                onClick={() => void desktopClient.openExternalURL(user.htmlUrl)}
                type="button"
              >
                <ExternalLink />
                打开主页
              </button>
            ) : null}
          </div>
          <SettingsRow
            title="GitHub ID"
            description={user ? String(user.id) : '登录 GitHub 后显示'}
            control={
              user ? (
                <span className="settings-row-status">@{user.login}</span>
              ) : (
                <span className="settings-row-status">未登录</span>
              )
            }
          />
          <SettingsRow
            title="仓库访问"
            description="登录后可在项目选择器中列出并克隆你有权限访问的仓库。"
            control={
              <span className="settings-row-status">
                {user ? '已启用' : '未启用'}
              </span>
            }
          />
          <SettingsRow
            title="记忆同步"
            description="当前版本只保留设置入口，不会上传任何记忆内容。"
            control={
              <span className="settings-row-status">未启用</span>
            }
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            title="登录管理"
            description="前往 Git 设置页登录或退出 GitHub。"
            control={
              <button
                className="settings-button"
                onClick={() => navigate('/settings?tab=git')}
                type="button"
              >
                <GitFork /> Git 设置
              </button>
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import {
  Edit3,
  ExternalLink,
  GitFork,
  Globe,
  Lock,
  Mail,
  MapPin,
  RefreshCw,
  Share2,
  Star,
  User,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopGithubAuthStatus,
  DesktopGithubContributionWeek,
  DesktopGithubProfileOverview,
  DesktopGithubProfileRepository,
} from '../../shared/types.js'
import { desktopClient } from '../services/desktopClient.js'

export function ProfileSettings(): React.ReactNode {
  const navigate = useNavigate()
  const [githubAuth, setGithubAuth] =
    useState<DesktopGithubAuthStatus | null>(null)
  const [githubOverview, setGithubOverview] =
    useState<DesktopGithubProfileOverview | null>(null)
  const [githubOverviewError, setGithubOverviewError] = useState<string | null>(
    null,
  )
  const [statusEditorOpen, setStatusEditorOpen] = useState(false)
  const [statusEmoji, setStatusEmoji] = useState('speech_balloon')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusLimited, setStatusLimited] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadGithubAuth = async (): Promise<void> => {
    setLoading(true)
    try {
      const status = await desktopClient.getGithubAuthStatus()
      setGithubAuth(status)
      if (status.authenticated) {
        const result = await desktopClient.getGithubProfileOverview()
        if (result.ok === false) {
          setGithubOverview(null)
          setGithubOverviewError(result.error)
        } else {
          setGithubOverview(result.overview)
          setGithubOverviewError(null)
        }
      } else {
        setGithubOverview(null)
        setGithubOverviewError(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGithubAuth()
  }, [])

  const user = githubOverview?.user ??
    (githubAuth?.authenticated ? githubAuth.user : null)
  const repositories = githubOverview
    ? (githubOverview.pinnedRepositories.length
        ? githubOverview.pinnedRepositories
        : githubOverview.popularRepositories)
    : []
  const maxContributionCount = useMemo(
    () => maxContribution(githubOverview?.contributions.weeks ?? []),
    [githubOverview],
  )
  const currentStatus = githubOverview?.user.status ?? null

  const openStatusEditor = (): void => {
    setStatusEmoji(statusEmojiName(currentStatus?.emoji) ?? 'speech_balloon')
    setStatusMessage(currentStatus?.message ?? '')
    setStatusLimited(currentStatus?.indicatesLimitedAvailability ?? false)
    setStatusEditorOpen(true)
  }

  const saveStatus = async (): Promise<void> => {
    setStatusBusy(true)
    try {
      const result = await desktopClient.setGithubUserStatus({
        emoji: statusEmoji,
        message: statusMessage,
        limitedAvailability: statusLimited,
        expiresAt: null,
      })
      if (result.ok === false) {
        setGithubOverviewError(result.error)
        return
      }
      setStatusEditorOpen(false)
      await loadGithubAuth()
    } finally {
      setStatusBusy(false)
    }
  }

  const clearStatus = async (): Promise<void> => {
    setStatusBusy(true)
    try {
      const result = await desktopClient.clearGithubUserStatus()
      if (result.ok === false) {
        setGithubOverviewError(result.error)
        return
      }
      setStatusEditorOpen(false)
      await loadGithubAuth()
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="settings-content-area profile-dashboard-area">
      <div className="profile-dashboard">
        <header className="profile-dashboard-header">
          <h2>个人资料</h2>
          <div className="profile-dashboard-actions">
            <button
              className="profile-action-button"
              disabled={!user?.htmlUrl}
              onClick={() => user?.htmlUrl && void desktopClient.openExternalURL(user.htmlUrl)}
              type="button"
            >
              <Share2 />
              分享
            </button>
            <button className="profile-action-button" type="button">
              <Lock />
              私有
            </button>
            <button
              className="profile-action-button"
              disabled={!user?.htmlUrl}
              onClick={() => user?.htmlUrl && void desktopClient.openExternalURL(user.htmlUrl)}
              type="button"
            >
              <Edit3 />
              编辑
            </button>
          </div>
        </header>

        <section className="profile-hero">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar" aria-hidden="true">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <User />}
            </div>
            {user ? (
              <button
                className="profile-avatar-badge"
                title={currentStatus?.message ?? '设置状态'}
                onClick={openStatusEditor}
                type="button"
              >
                {statusEmojiGlyph(currentStatus?.emoji)}
              </button>
            ) : null}
          </div>
          <h1>{user?.name || user?.login || 'GitHub Profile'}</h1>
          <div className="profile-identity">
            {user ? `@${user.login}` : '未连接 GitHub'}
            {githubOverview ? <span>GitHub</span> : null}
          </div>
          {githubOverview?.user.bio ? (
            <p className="profile-bio">{githubOverview.user.bio}</p>
          ) : null}
          {currentStatus?.message ? (
            <div className="profile-status-line">
              <span>{statusEmojiGlyph(currentStatus.emoji)}</span>
              {currentStatus.message}
              {currentStatus.indicatesLimitedAvailability ? (
                <strong>Busy</strong>
              ) : null}
            </div>
          ) : null}
          {githubOverview ? (
            <div className="profile-meta-line">
              <ProfileMeta icon={<User />} value={`${githubOverview.user.followers} followers`} />
              <ProfileMeta icon={<GitFork />} value={`${githubOverview.user.following} following`} />
              <ProfileMeta icon={<MapPin />} value={githubOverview.user.location} />
              <ProfileMeta icon={<Globe />} value={githubOverview.user.websiteUrl} />
              <ProfileMeta icon={<Mail />} value={githubOverview.user.email} />
            </div>
          ) : null}
        </section>

        {githubOverview ? (
          <>
            <section className="profile-stat-strip" aria-label="GitHub 统计">
              <ProfileMetric label="公开仓库" value={githubOverview.user.repositoryCount} />
              <ProfileMetric label="Starred" value={githubOverview.user.starredRepositoryCount} />
              <ProfileMetric label="年度贡献" value={githubOverview.contributions.totalContributions} />
              <ProfileMetric label="Commit 贡献" value={githubOverview.contributions.totalCommitContributions} />
              <ProfileMetric label="私有贡献" value={githubOverview.contributions.restrictedContributionsCount} />
            </section>

            <section className="profile-activity-panel">
              <div className="profile-panel-heading">
                <h3>GitHub 活动</h3>
                <div>
                  <span>每日</span>
                  <span>每周</span>
                  <span>累计</span>
                </div>
              </div>
              <div className="profile-contribution-map">
                <div className="profile-contribution-grid">
                  {githubOverview.contributions.weeks.map((week, weekIndex) => (
                    <div className="profile-contribution-week" key={weekIndex}>
                      {week.days.map(day => (
                        <span
                          className="profile-contribution-day"
                          key={day.date}
                          style={{
                            backgroundColor: contributionColor(
                              day.count,
                              maxContributionCount,
                            ),
                          }}
                          title={`${day.date}: ${day.count} contributions`}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="profile-contribution-months">
                  {monthLabels(githubOverview.contributions.weeks).map(item => (
                    <span key={`${item.label}-${item.index}`}>{item.label}</span>
                  ))}
                </div>
              </div>
            </section>

            <section className="profile-lower-grid">
              <div className="profile-insights">
                <h3>活动洞察</h3>
                <ProfileInsight label="Commit 贡献" value={githubOverview.contributions.totalCommitContributions} />
                <ProfileInsight label="Pull request 贡献" value={githubOverview.contributions.totalPullRequestContributions} />
                <ProfileInsight label="Issue 贡献" value={githubOverview.contributions.totalIssueContributions} />
                <ProfileInsight label="Review 贡献" value={githubOverview.contributions.totalPullRequestReviewContributions} />
                <ProfileInsight label="私有贡献" value={githubOverview.contributions.restrictedContributionsCount} />
              </div>

              <div className="profile-repositories">
                <h3>常用仓库</h3>
                {repositories.slice(0, 5).map(repository => (
                  <ProfileRepositoryRow
                    key={repository.id}
                    repository={repository}
                  />
                ))}
                {repositories.length === 0 ? (
                  <p className="profile-empty-copy">还没有可展示的仓库数据。</p>
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <section className="profile-empty-state">
            <p>
              {loading
                ? '正在读取 GitHub 资料...'
                : githubOverviewError ??
                  '连接 GitHub 后，这里会显示头像、仓库、贡献热力图和活动洞察。'}
            </p>
            <div className="profile-empty-actions">
              <button
                className="settings-button"
                disabled={loading}
                onClick={() => void loadGithubAuth()}
                type="button"
              >
                <RefreshCw />
                刷新
              </button>
              <button
                className="settings-button primary"
                onClick={() => navigate('/settings?tab=git')}
                type="button"
              >
                前往 Git 页
              </button>
            </div>
          </section>
        )}
        {statusEditorOpen ? (
          <div className="profile-status-popover" role="dialog" aria-label="设置 GitHub 状态">
            <div className="profile-status-popover-header">
              <strong>设置 GitHub 状态</strong>
              <button
                onClick={() => setStatusEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <label className="profile-status-field">
              <span>What's happening</span>
              <div>
                <select
                  value={statusEmoji}
                  onChange={event => setStatusEmoji(event.target.value)}
                >
                  <option value="palm_tree">🌴 On vacation</option>
                  <option value="face_with_thermometer">🤒 Out sick</option>
                  <option value="house">🏠 Working from home</option>
                  <option value="dart">🎯 Focusing</option>
                  <option value="speech_balloon">💬 Custom</option>
                </select>
                <input
                  maxLength={80}
                  value={statusMessage}
                  onChange={event => setStatusMessage(event.target.value)}
                  placeholder="What are you up to?"
                />
              </div>
            </label>
            <label className="profile-status-checkbox">
              <input
                type="checkbox"
                checked={statusLimited}
                onChange={event => setStatusLimited(event.target.checked)}
              />
              Busy
            </label>
            <div className="profile-status-actions">
              <button
                className="settings-button"
                disabled={statusBusy}
                onClick={() => void clearStatus()}
                type="button"
              >
                Clear status
              </button>
              <button
                className="settings-button primary"
                disabled={statusBusy || !statusMessage.trim()}
                onClick={() => void saveStatus()}
                type="button"
              >
                Set status
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProfileMeta({
  icon,
  value,
}: {
  icon: React.ReactNode
  value: string | null
}): React.ReactNode {
  if (!value) return null
  return (
    <span>
      {icon}
      {value}
    </span>
  )
}

function ProfileMetric({
  label,
  value,
}: {
  label: string
  value: number
}): React.ReactNode {
  return (
    <div className="profile-metric">
      <strong>{formatCompact(value)}</strong>
      <span>{label}</span>
    </div>
  )
}

function ProfileInsight({
  label,
  value,
}: {
  label: string
  value: number
}): React.ReactNode {
  return (
    <div className="profile-insight-row">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  )
}

function ProfileRepositoryRow({
  repository,
}: {
  repository: DesktopGithubProfileRepository
}): React.ReactNode {
  return (
    <button
      className="profile-repository-row"
      onClick={() => void desktopClient.openExternalURL(repository.url)}
      type="button"
    >
      <span
        className="profile-repository-dot"
        style={{
          backgroundColor:
            repository.primaryLanguage?.color ?? 'var(--c-text-soft)',
        }}
      />
      <span className="profile-repository-name">{repository.fullName}</span>
      <span className="profile-repository-count">
        <Star />
        {repository.stargazerCount.toLocaleString()}
      </span>
    </button>
  )
}

function maxContribution(weeks: DesktopGithubContributionWeek[]): number {
  return Math.max(
    1,
    ...weeks.flatMap(week => week.days.map(day => day.count)),
  )
}

function contributionColor(count: number, max: number): string {
  if (count <= 0) return '#f0f1f3'
  const ratio = count / max
  if (ratio < 0.25) return '#cfe8fb'
  if (ratio < 0.5) return '#8cc8ee'
  if (ratio < 0.75) return '#45a5e5'
  return '#1683d8'
}

function monthLabels(
  weeks: DesktopGithubContributionWeek[],
): Array<{ label: string; index: number }> {
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric' })
  const labels: Array<{ label: string; index: number }> = []
  let lastMonth = ''
  weeks.forEach((week, index) => {
    const day = week.days[0]
    if (!day) return
    const month = formatter.format(new Date(day.date))
    if (month !== lastMonth) {
      labels.push({ label: `${month}月`, index })
      lastMonth = month
    }
  })
  return labels.slice(-12)
}

function formatCompact(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  return value.toLocaleString()
}

function statusEmojiName(value: string | null | undefined): string | null {
  if (!value) return null
  return value.replace(/^:+|:+$/g, '')
}

function statusEmojiGlyph(value: string | null | undefined): string {
  switch (statusEmojiName(value)) {
    case 'palm_tree':
      return '🌴'
    case 'face_with_thermometer':
      return '🤒'
    case 'house':
      return '🏠'
    case 'dart':
      return '🎯'
    case 'speech_balloon':
      return '💬'
    default:
      return value ? '💬' : '☺'
  }
}

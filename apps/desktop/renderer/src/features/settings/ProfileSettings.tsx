import React, { useEffect, useMemo, useState } from 'react'
import {
  Edit3,
  GitFork,
  Globe,
  Mail,
  MapPin,
  RefreshCw,
  Star,
  User,
} from 'lucide-react'
import { SettingsContentArea } from './SettingsContentArea.js'
import { useNavigate } from 'react-router-dom'
import type {
  DesktopGithubAuthStatus,
  DesktopGithubContributionWeek,
  DesktopGithubProfileOverview,
  DesktopGithubProfileRepository,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import {
  SkeletonBlock,
  SkeletonRegion,
} from '../../components/ui/Skeleton.js'
import { SettingsDropdown } from './SettingsDropdown.js'

const STATUS_EMOJI_OPTIONS = [
  { value: 'palm_tree', label: '🌴 On vacation' },
  { value: 'face_with_thermometer', label: '🤒 Out sick' },
  { value: 'house', label: '🏠 Working from home' },
  { value: 'dart', label: '🎯 Focusing' },
  { value: 'speech_balloon', label: '💬 Custom' },
]

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
  const contributionWeeks = githubOverview?.contributions.weeks ?? []
  const currentStatus = githubOverview?.user.status ?? null
  const showInitialSkeleton =
    loading &&
    githubAuth === null &&
    githubOverview === null &&
    githubOverviewError === null

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
    <SettingsContentArea className="profile-dashboard-area">
      <div className="profile-dashboard">
        <header className="profile-dashboard-header">
          <h2>个人资料</h2>
          <div className="profile-dashboard-actions">
            <Button
              disabled={!user?.htmlUrl}
              onClick={() => user?.htmlUrl && void desktopClient.openExternalURL(user.htmlUrl)}
            >
              <Edit3 />
              编辑
            </Button>
            <Button
              disabled={loading}
              onClick={() => void loadGithubAuth()}
              title={loading ? '正在刷新中...' : '刷新'}
            >
              <RefreshCw />
              {loading ? '刷新中...' : '刷新'}
            </Button>

          </div>
        </header>

        {showInitialSkeleton ? (
          <ProfileLoadingSkeleton />
        ) : (
          <>
            <section className="profile-hero">
              <div className="profile-avatar-wrap">
                <div className="profile-avatar" aria-hidden="true">
                  {user?.avatarUrl ? (
                    <RemoteImage
                      alt=""
                      fallback={<User />}
                      src={user.avatarUrl}
                    />
                  ) : (
                    <User />
                  )}
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
                {user ? `@${user.login}` : '未登录 GitHub'}
                {githubOverview ? (
                  <>
                    <span aria-hidden="true" className="profile-identity-separator">·</span>
                    <span className="profile-account-label">GitHub</span>
                  </>
                ) : null}
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
                  <ProfileMetric label="今年贡献" value={githubOverview.contributions.totalContributions} />
                  <ProfileMetric label="Commit 贡献" value={githubOverview.contributions.totalCommitContributions} />
                  <ProfileMetric label="受限贡献" value={githubOverview.contributions.restrictedContributionsCount} />
                </section>

                <section className="profile-activity-panel">
                  <div className="profile-panel-heading">
                    <h3>GitHub 活动</h3>
                  </div>
                  <div className="profile-contribution-map">
                    <div
                      className="profile-contribution-grid"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(contributionWeeks.length, 1)}, minmax(1px, 1fr))`,
                      }}
                    >
                      {contributionWeeks.map((week, weekIndex) => (
                        <div
                          className="profile-contribution-week"
                          key={week.days[0]?.date ?? weekIndex}
                        >
                          {week.days.map(day => (
                            <span
                              className="profile-contribution-day"
                              data-level={contributionLevel(
                                day.count,
                                maxContributionCount,
                              )}
                              key={day.date}
                              title={`${day.date}: ${day.count} contributions`}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="profile-contribution-months">
                      {monthLabels(contributionWeeks).map(item => (
                        <span
                          key={`${item.label}-${item.index}`}
                          style={{
                            left: `${monthLabelOffset(item.index, contributionWeeks.length)}%`,
                          }}
                        >
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="profile-lower-grid">
                  <div className="profile-insights">
                    <h3>活动概览</h3>
                    <ProfileInsight label="Commit 贡献" value={githubOverview.contributions.totalCommitContributions} />
                    <ProfileInsight label="Pull request 贡献" value={githubOverview.contributions.totalPullRequestContributions} />
                    <ProfileInsight label="Issue 贡献" value={githubOverview.contributions.totalIssueContributions} />
                    <ProfileInsight label="Review 贡献" value={githubOverview.contributions.totalPullRequestReviewContributions} />
                    <ProfileInsight label="受限贡献" value={githubOverview.contributions.restrictedContributionsCount} />
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
                      <p className="profile-empty-copy">暂无可显示的数据。</p>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <section className="profile-empty-state">
                <p>
                  {githubOverviewError ??
                    '连接 GitHub 失败，请稍后重试。'
                  }
                </p>
                <div className="profile-empty-actions">
                  <Button
                    onClick={() => void loadGithubAuth()}
                    type="button"
                  >
                    <RefreshCw />
                    刷新
                  </Button>
                  <Button
                    onClick={() => navigate('/settings/git')}
                    type="button"
                  >
                    前往 Git 设置
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
        {statusEditorOpen ? (
          <div className="popover-surface profile-status-popover" role="dialog" aria-label="设置 GitHub 状态">
            <div className="profile-status-popover-header">
              <strong>设置 GitHub 状态</strong>
              <button
                onClick={() => setStatusEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="profile-status-field">
              <span>What's happening</span>
              <div>
                <SettingsDropdown
                  ariaLabel="GitHub 状态 Emoji"
                  options={STATUS_EMOJI_OPTIONS}
                  showSelectedIndicator
                  triggerClassName="profile-status-select"
                  value={statusEmoji}
                  width={240}
                  onChange={setStatusEmoji}
                />
                <input
                  aria-label="GitHub 状态消息"
                  maxLength={80}
                  value={statusMessage}
                  onChange={event => setStatusMessage(event.target.value)}
                  placeholder="What are you up to?"
                />
              </div>
            </div>
            <label className="profile-status-checkbox">
              <input
                type="checkbox"
                checked={statusLimited}
                onChange={event => setStatusLimited(event.target.checked)}
              />
              Busy
            </label>
            <div className="profile-status-actions">
              <Button
                disabled={statusBusy}
                onClick={() => void clearStatus()}
                type="button"
              >
                Clear status
              </Button>
              <Button
                disabled={statusBusy || !statusMessage.trim()}
                onClick={() => void saveStatus()}
                type="button"
              >
                Set status
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsContentArea>
  )
}

function ProfileLoadingSkeleton(): React.ReactNode {
  return (
    <SkeletonRegion
      className="profile-loading"
      label="正在读取 GitHub 资料"
    >
      <section className="profile-loading-hero">
        <SkeletonBlock className="profile-loading-avatar" />
        <SkeletonBlock className="profile-loading-name" />
        <SkeletonBlock className="profile-loading-identity" />
      </section>
      <section className="profile-loading-stats" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        ))}
      </section>
      <section className="profile-loading-activity" aria-hidden="true">
        <SkeletonBlock className="profile-loading-heading" />
        <div className="profile-loading-contributions">
          {Array.from({ length: 84 }, (_, index) => (
            <SkeletonBlock key={index} />
          ))}
        </div>
      </section>
      <section className="profile-loading-lower" aria-hidden="true">
        <div>{Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} />)}</div>
        <div>{Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} />)}</div>
      </section>
    </SkeletonRegion>
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
            repository.primaryLanguage?.color ?? 'var(--color-token-text-secondary)',
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

function contributionLevel(count: number, max: number): number {
  if (count <= 0) return 0
  const ratio = count / max
  if (ratio < 0.25) return 1
  if (ratio < 0.5) return 2
  if (ratio < 0.75) return 3
  return 4
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
      labels.push({ label: `${month}`, index })
      lastMonth = month
    }
  })
  return labels.slice(-12)
}

function monthLabelOffset(index: number, weekCount: number): number {
  if (weekCount <= 1) return 0
  return Math.min(100, Math.max(0, (index / (weekCount - 1)) * 100))
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
      return value ? '💬' : ''
  }
}

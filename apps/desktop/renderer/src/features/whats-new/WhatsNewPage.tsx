import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { MarkdownMessage } from '../markdown/MarkdownMessage.js'
import type { MarkdownDirectiveRegistry } from '../markdown/types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import {
  loadReleaseNotes,
  releaseNotesErrorMessage,
  releaseNotesViewError,
  type ReleaseNotesViewError,
} from './releaseNotesModel.js'
import '../../styles/lazy/whats-new.scss'

const DISABLED_DIRECTIVES: MarkdownDirectiveRegistry = new Map()

export function WhatsNewPage(): React.ReactNode {
  const [result, setResult] =
    useState<RpcResult<'release-notes/list'> | null>(null)
  const [error, setError] = useState<ReleaseNotesViewError | null>(null)
  const [loading, setLoading] = useState(true)

  const request = useCallback(async (refresh = false): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setResult(await loadReleaseNotes(desktopClient, refresh))
    } catch (requestError) {
      setResult(null)
      setError(releaseNotesViewError(requestError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadReleaseNotes(desktopClient)
      .then(next => {
        if (!active) return
        setResult(next)
        setError(null)
      })
      .catch(requestError => {
        if (!active) return
        setResult(null)
        setError(releaseNotesViewError(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="whats-new-page">
      <div className="whats-new-scroll-region">
        <main
          aria-labelledby="whats-new-title"
          className="whats-new-content"
        >
          <header className="whats-new-heading">
            <div className="whats-new-heading-copy">
              <span aria-hidden="true" className="whats-new-heading-icon">
                <Sparkles />
              </span>
              <div>
                <h1 id="whats-new-title">新特性</h1>
                <p>
                  查看 CodePilotX 当前版本及历史版本的 GitHub 更新记录。
                </p>
              </div>
            </div>
          </header>

          {loading ? <ReleaseNotesSkeleton /> : null}
          {!loading && error ? (
            <ReleaseNotesError
              error={error}
              onRetry={() => void request(true)}
            />
          ) : null}
          {!loading && result ? <ReleaseNotesContent result={result} /> : null}
        </main>
      </div>
    </div>
  )
}

function ReleaseNotesContent({
  result,
}: {
  result: RpcResult<'release-notes/list'>
}): React.ReactNode {
  if (!result.currentReleaseFound) {
    return (
      <ReleaseNotesEmpty
        description={`GitHub Releases 中暂时没有与当前安装版本 v${result.currentVersion} 对应的记录。`}
        title="尚未发布当前版本的更新日志"
      />
    )
  }
  if (result.releases.length === 0) {
    return (
      <ReleaseNotesEmpty
        description="GitHub Releases 目前没有可显示的更新记录。"
        title="暂无更新日志"
      />
    )
  }

  return (
    <section aria-label="版本更新记录" className="whats-new-release-list">
      {result.truncated ? (
        <p className="whats-new-notice">
          更新记录较多，当前仅显示最近的一部分历史版本。
        </p>
      ) : null}
      {result.releases.map((release, index) => (
        <ReleaseCard
          current={index === 0}
          key={release.tagName}
          release={release}
        />
      ))}
      <p className="whats-new-source">
        数据来自 GitHub Releases · 最近获取于 {formatDateTime(result.fetchedAt)}
      </p>
    </section>
  )
}

function ReleaseCard({
  current,
  release,
}: {
  current: boolean
  release: RpcResult<'release-notes/list'>['releases'][number]
}): React.ReactNode {
  const canOpenRelease = useMemo(
    () => isSafeHttpsUrl(release.htmlUrl),
    [release.htmlUrl],
  )
  return (
    <details className="whats-new-release" open={current}>
      <summary>
        <span className="whats-new-release-heading">
          <strong>{release.name.trim() || release.tagName}</strong>
          <span className="whats-new-release-badges">
            {current ? <span data-kind="current">当前版本</span> : null}
            {release.prerelease ? <span>预发布</span> : null}
          </span>
        </span>
        <span className="whats-new-release-meta">
          <code>{release.tagName}</code>
          {release.publishedAt ? (
            <time dateTime={release.publishedAt}>
              {formatDate(release.publishedAt)}
            </time>
          ) : null}
        </span>
      </summary>
      <div className="whats-new-release-body">
        {release.body.trim() ? (
          <MarkdownMessage
            allowBasicHtml={false}
            directives={DISABLED_DIRECTIVES}
            externalResourcePolicy={{
              allowExternalLinks: true,
              allowExternalUrl: isSafeHttpsUrl,
              allowRemoteMedia: false,
            }}
            text={release.body}
          />
        ) : (
          <p className="whats-new-empty-body">此版本没有填写更新说明。</p>
        )}
        {canOpenRelease ? (
          <div className="whats-new-release-actions">
            <Button
              onClick={() => {
                void desktopClient.openExternalURL(release.htmlUrl)
              }}
            >
              <ExternalLink size={APP_ICON_SIZE} />
              在 GitHub 查看
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  )
}

function ReleaseNotesError({
  error,
  onRetry,
}: {
  error: ReleaseNotesViewError
  onRetry: () => void
}): React.ReactNode {
  const message = releaseNotesErrorMessage(error)
  return (
    <section aria-live="polite" className="whats-new-state">
      <strong>{message.title}</strong>
      <p>{message.description}</p>
      <Button onClick={onRetry}>
        <RefreshCw size={APP_ICON_SIZE} />
        重试
      </Button>
    </section>
  )
}

function ReleaseNotesEmpty({
  description,
  title,
}: {
  description: string
  title: string
}): React.ReactNode {
  return (
    <section className="whats-new-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </section>
  )
}

function ReleaseNotesSkeleton(): React.ReactNode {
  return (
    <section
      aria-label="正在获取更新日志"
      aria-live="polite"
      className="whats-new-skeleton"
    >
      {[0, 1, 2].map(index => (
        <div className="whats-new-skeleton-card" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </section>
  )
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function formatDate(value: string): string {
  return formatDateValue(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(value: string): string {
  return formatDateValue(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateValue(
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', options).format(timestamp)
}

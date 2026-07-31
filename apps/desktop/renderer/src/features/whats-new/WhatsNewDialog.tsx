import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
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

type Props = {
  open: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
}

export function WhatsNewDialog({
  open,
  restoreFocusElement,
  onOpenChange,
}: Props): React.ReactNode {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [result, setResult] =
    useState<RpcResult<'release-notes/list'> | null>(null)
  const [error, setError] = useState<ReleaseNotesViewError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const request = useCallback(async (refresh = false): Promise<void> => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      setResult(await loadReleaseNotes(desktopClient, refresh))
    } catch (requestError) {
      if (!refresh) setResult(null)
      setError(releaseNotesViewError(requestError))
    } finally {
      if (refresh) setRefreshing(false)
      else setLoading(false)
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop whats-new-dialog-backdrop">
          <Dialog.Content
            className="whats-new-dialog"
            onCloseAutoFocus={event => {
              if (!restoreFocusElement?.isConnected) return
              event.preventDefault()
              restoreFocusElement.focus()
            }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              closeButtonRef.current?.focus()
            }}
          >
            <header className="whats-new-dialog-header">
              <span aria-hidden="true" className="whats-new-heading-icon">
                <Sparkles />
              </span>
              <div className="whats-new-dialog-heading">
                <Dialog.Title className="whats-new-dialog-title">
                  新特性
                </Dialog.Title>
                <Dialog.Description className="whats-new-dialog-description">
                  查看 CodePilotX 当前版本及历史版本的 GitHub 更新记录。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton
                  ref={closeButtonRef}
                  title="关闭新特性"
                  variant="plain"
                >
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            <div className="whats-new-dialog-body">
              {loading ? <ReleaseNotesSkeleton /> : null}
              {!loading && error && !result ? (
                <ReleaseNotesError
                  error={error}
                  onRetry={() => void request(true)}
                />
              ) : null}
              {!loading && result ? (
                <ReleaseNotesContent
                  refreshing={refreshing}
                  result={result}
                  onRefresh={() => void request(true)}
                />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ReleaseNotesContent({
  refreshing,
  result,
  onRefresh,
}: {
  refreshing: boolean
  result: RpcResult<'release-notes/list'>
  onRefresh: () => void
}): React.ReactNode {
  const [selectedTagName, setSelectedTagName] = useState(
    result.releases[0]?.tagName ?? '',
  )
  const detailScrollRef = useRef<HTMLDivElement>(null)

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

  const currentTagName = result.releases[0]?.tagName
  const selectedRelease =
    result.releases.find(release => release.tagName === selectedTagName) ??
    result.releases[0]

  if (!selectedRelease) return null

  return (
    <section
      aria-label="版本更新记录"
      className="whats-new-release-browser"
    >
      <ScrollArea
        aria-label="版本列表"
        className="whats-new-version-scroll"
        contentClassName="whats-new-version-scroll-content"
      >
        {result.source === 'bundled-changelog' ? (
          <div className="whats-new-notice whats-new-fallback-notice">
            <p>
              当前仅显示随应用提供的版本记录，在线历史版本暂时不可用。
            </p>
            <Button loading={refreshing} onClick={onRefresh}>
              {refreshing ? null : <RefreshCw size={APP_ICON_SIZE} />}
              {refreshing ? '正在重试…' : '重试加载历史版本'}
            </Button>
          </div>
        ) : null}
        {result.truncated ? (
          <p className="whats-new-notice">
            更新记录较多，当前仅显示最近的一部分历史版本。
          </p>
        ) : null}
        <ul className="whats-new-version-list">
          {result.releases.map((release, index) => {
            const current = index === 0
            const selected = release.tagName === selectedRelease.tagName
            return (
              <li key={release.tagName}>
                <button
                  aria-pressed={selected}
                  className="whats-new-version-item"
                  data-selected={selected || undefined}
                  type="button"
                  onClick={() => {
                    setSelectedTagName(release.tagName)
                    detailScrollRef.current?.scrollTo({ top: 0 })
                  }}
                >
                  <span className="whats-new-release-heading">
                    <strong>{release.name.trim() || release.tagName}</strong>
                    <ReleaseBadges
                      current={current}
                      prerelease={release.prerelease}
                    />
                  </span>
                  <ReleaseMeta release={release} />
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>

      <ScrollArea
        aria-label="版本更新内容"
        className="whats-new-detail-scroll"
        contentClassName="whats-new-detail-scroll-content"
        viewportRef={detailScrollRef}
      >
        <ReleaseDetails
          current={selectedRelease.tagName === currentTagName}
          fetchedAt={result.fetchedAt}
          release={selectedRelease}
          source={result.source}
        />
      </ScrollArea>
    </section>
  )
}

function ReleaseDetails({
  current,
  fetchedAt,
  release,
  source,
}: {
  current: boolean
  fetchedAt: string
  release: RpcResult<'release-notes/list'>['releases'][number]
  source: RpcResult<'release-notes/list'>['source']
}): React.ReactNode {
  const canOpenRelease = isSafeHttpsUrl(release.htmlUrl)

  return (
    <article className="whats-new-release-details">
      <header className="whats-new-release-details-header">
        <span className="whats-new-release-heading">
          <strong>{release.name.trim() || release.tagName}</strong>
          <ReleaseBadges
            current={current}
            prerelease={release.prerelease}
          />
        </span>
        <ReleaseMeta release={release} />
      </header>
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
      <p className="whats-new-source">
        {source === 'bundled-changelog'
          ? '随 CodePilotX 安装包提供'
          : `数据来自 GitHub Releases · 最近获取于 ${formatDateTime(fetchedAt)}`}
      </p>
    </article>
  )
}

function ReleaseBadges({
  current,
  prerelease,
}: {
  current: boolean
  prerelease: boolean
}): React.ReactNode {
  if (!current && !prerelease) return null

  return (
    <span className="whats-new-release-badges">
      {current ? <span data-kind="current">当前版本</span> : null}
      {prerelease ? <span>预发布</span> : null}
    </span>
  )
}

function ReleaseMeta({
  release,
}: {
  release: RpcResult<'release-notes/list'>['releases'][number]
}): React.ReactNode {
  return (
    <span className="whats-new-release-meta">
      <code>{release.tagName}</code>
      {release.publishedAt ? (
        <time dateTime={release.publishedAt}>
          {formatDate(release.publishedAt)}
        </time>
      ) : null}
    </span>
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

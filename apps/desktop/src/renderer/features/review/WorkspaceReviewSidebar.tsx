import React from 'react'
import {
  CheckCircle2,
  Columns2,
  ExternalLink,
  FileDiff,
  Filter,
  FolderOpen,
  MessageSquarePlus,
  PanelRight,
  RotateCcw,
  Search,
  Send,
  Sliders,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import type {
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewScope,
  DesktopReviewSide,
  DesktopReviewView,
  DesktopSessionStatus,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import { Tooltip } from '../../components/ui/Tooltip.js'

type ReviewFilter = 'all' | 'added' | 'modified' | 'removed'

type CommentAnchor = {
  filePath: string
  side: DesktopReviewSide
  lineNumber: number
  lineContent: string
}

type CommentDraft = CommentAnchor & {
  body: string
}

type ReviewSplitRow = {
  id: string
  left: ReviewCell
  right: ReviewCell
  paired: boolean
}

type ReviewCell = {
  line: DesktopReviewDiffLine | null
  side: DesktopReviewSide
  number: number | null
  content: string
  tone: 'removed' | 'added' | 'context' | 'empty'
}

export function WorkspaceReviewSidebar({
  activeSessionId,
  isRefreshing,
  reviewView,
  sessionStatus,
  workspacePath,
  onClose,
  onOpenWorkspacePath,
  onRefreshDiff,
}: {
  activeSessionId: string | null
  isRefreshing: boolean
  reviewView: DesktopReviewView
  sessionStatus: DesktopSessionStatus
  workspacePath: string | null
  onClose: () => void
  onOpenWorkspacePath: () => void
  onRefreshDiff: () => void
}): React.ReactNode {
  const [scope, setScope] = React.useState<DesktopReviewScope>('unstaged')
  const [reviewDiff, setReviewDiff] = React.useState<Awaited<
    ReturnType<typeof desktopClient.getWorkspaceReviewDiff>
  > | null>(null)
  const [comments, setComments] = React.useState<DesktopReviewComment[]>([])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<ReviewFilter>('all')
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<CommentDraft | null>(null)

  const refreshReviewDiff = React.useCallback(async () => {
    if (!workspacePath) {
      setReviewDiff(null)
      return
    }
    try {
      setError(null)
      const result = await desktopClient.getWorkspaceReviewDiff({
        workspacePath,
        scope,
      })
      setReviewDiff(result)
    } catch (refreshError) {
      setError(errorMessageOf(refreshError))
    }
  }, [scope, workspacePath])

  const refreshComments = React.useCallback(async () => {
    if (!activeSessionId) {
      setComments([])
      return
    }
    try {
      const snapshot = await desktopClient.getSession(activeSessionId)
      setComments(snapshot.reviewComments ?? [])
    } catch (refreshError) {
      setError(errorMessageOf(refreshError))
    }
  }, [activeSessionId])

  React.useEffect(() => {
    void refreshReviewDiff()
  }, [refreshReviewDiff, isRefreshing])

  React.useEffect(() => {
    void refreshComments()
  }, [refreshComments])

  React.useEffect(() => {
    const files = reviewDiff?.files ?? []
    if (files.length === 0) {
      setSelectedPath(null)
      return
    }
    setSelectedPath(current =>
      current && files.some(file => file.path === current)
        ? current
        : files[0]?.path ?? null,
    )
  }, [reviewDiff])

  const files = reviewDiff?.files ?? []
  const visibleFiles = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return files.filter(file => {
      if (query && !file.path.toLowerCase().includes(query)) return false
      if (filter === 'all') return true
      return filterStatusForFile(file) === filter
    })
  }, [files, filter, search])

  React.useEffect(() => {
    if (!selectedPath || visibleFiles.some(file => file.path === selectedPath)) {
      return
    }
    setSelectedPath(visibleFiles[0]?.path ?? null)
  }, [selectedPath, visibleFiles])

  const selectedFile =
    visibleFiles.find(file => file.path === selectedPath) ??
    visibleFiles[0] ??
    null
  const totals = React.useMemo(
    () =>
      files.reduce(
        (summary, file) => ({
          additions: summary.additions + file.additions,
          deletions: summary.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  )
  const { attachedComments, staleComments } = React.useMemo(
    () => attachComments(files, comments),
    [comments, files],
  )
  const openComments = comments.filter(comment => comment.status === 'open')
  const sessionBusy =
    sessionStatus === 'running' || sessionStatus === 'waiting'

  async function applyOperation(
    action: 'stage' | 'unstage' | 'revert',
    target:
      | { type: 'file'; path: string }
      | { type: 'hunk'; path: string; hunkId: string },
  ): Promise<void> {
    if (!workspacePath || pending) return
    setPending(true)
    try {
      const result = await desktopClient.applyWorkspaceReviewOperation({
        workspacePath,
        scope,
        action,
        target,
      })
      if (result.ok === false) {
        setError(result.error)
        return
      }
      setError(null)
      setReviewDiff(result.reviewDiff)
      onRefreshDiff()
    } catch (operationError) {
      setError(errorMessageOf(operationError))
    } finally {
      setPending(false)
    }
  }

  async function saveDraft(): Promise<void> {
    if (!activeSessionId || !draft || !draft.body.trim()) return
    setPending(true)
    try {
      const snapshot = await desktopClient.saveSessionReviewComment({
        sessionId: activeSessionId,
        comment: {
          filePath: draft.filePath,
          side: draft.side,
          lineNumber: draft.lineNumber,
          lineContent: draft.lineContent,
          body: draft.body.trim(),
        },
      })
      setComments(snapshot.reviewComments ?? [])
      setDraft(null)
    } catch (commentError) {
      setError(errorMessageOf(commentError))
    } finally {
      setPending(false)
    }
  }

  async function resolveComment(commentId: string): Promise<void> {
    if (!activeSessionId) return
    const snapshot = await desktopClient.resolveSessionReviewComment({
      sessionId: activeSessionId,
      commentId,
    })
    setComments(snapshot.reviewComments ?? [])
  }

  async function deleteComment(commentId: string): Promise<void> {
    if (!activeSessionId) return
    const snapshot = await desktopClient.deleteSessionReviewComment({
      sessionId: activeSessionId,
      commentId,
    })
    setComments(snapshot.reviewComments ?? [])
  }

  async function sendCommentsToAgent(): Promise<void> {
    if (!activeSessionId || sessionBusy || openComments.length === 0) return
    const body = [
      '请按这些本地行内审查评论修改代码：',
      '',
      ...openComments.map(
        (comment, index) =>
          `${index + 1}. ${comment.filePath}:${comment.lineNumber} (${comment.side})\n` +
          `   行内容：${comment.lineContent || '(空行)'}\n` +
          `   评论：${comment.body}`,
      ),
    ].join('\n')
    await desktopClient.sendUserMessage(activeSessionId, { text: body })
  }

  return (
    <aside className="review-sidebar" aria-label="本地代码审查">
      <div className="review-sidebar-toolbar">
        <div className="review-sidebar-title">
          <div className="review-scope-switch" role="tablist" aria-label="变更范围">
            {(['unstaged', 'staged'] as const).map(nextScope => (
              <button
                aria-selected={scope === nextScope}
                className={scope === nextScope ? 'active' : ''}
                key={nextScope}
                role="tab"
                type="button"
                onClick={() => setScope(nextScope)}
              >
                {nextScope === 'unstaged' ? '未暂存' : '已暂存'}
              </button>
            ))}
          </div>
          <span className="review-sidebar-counts">
            <strong>+{formatPanelNumber(totals.additions)}</strong>
            <em>-{formatPanelNumber(totals.deletions)}</em>
          </span>
        </div>
        <div className="review-sidebar-actions">
          <Tooltip content="把开放评论发给 agent">
            <button
              aria-label="把开放评论发给 agent"
              className="message-action"
              disabled={sessionBusy || openComments.length === 0}
              type="button"
              onClick={() => void sendCommentsToAgent()}
            >
              <Send size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="搜索文件">
            <button
              aria-label="搜索文件"
              className="message-action"
              type="button"
              onClick={() => {
                const value = window.prompt('搜索文件路径', search)
                if (value !== null) setSearch(value)
              }}
            >
              <Search size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content={isRefreshing ? '刷新中...' : '刷新变更'}>
            <button
              aria-label="刷新变更"
              className="message-action"
              disabled={isRefreshing || pending}
              type="button"
              onClick={() => {
                onRefreshDiff()
                void refreshReviewDiff()
              }}
            >
              <RotateCcw size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <Tooltip content="打开工作区">
            <button
              aria-label="打开工作区"
              className="message-action"
              disabled={!workspacePath}
              type="button"
              onClick={onOpenWorkspacePath}
            >
              <FolderOpen size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
          <PopoverMenu
            align="end"
            className="popover-review-filter"
            open={filterMenuOpen}
            sideOffset={4}
            trigger={
              <Tooltip content="筛选">
                <button
                  aria-label="筛选"
                  aria-pressed={filter !== 'all'}
                  className="message-action"
                  type="button"
                >
                  <Filter size={APP_ICON_SIZE} />
                </button>
              </Tooltip>
            }
            onOpenChange={setFilterMenuOpen}
          >
            {(['all', 'added', 'modified', 'removed'] as const).map(value => (
              <PopoverItem
                key={value}
                selected={filter === value}
                withCheck
                onClick={() => {
                  setFilter(value)
                  setFilterMenuOpen(false)
                }}
              >
                {reviewFilterLabel(value)}
              </PopoverItem>
            ))}
          </PopoverMenu>
          <Tooltip
            content={reviewView === 'inline' ? '行内视图' : '分离视图'}
          >
            <button
              aria-label="审阅视图"
              className="message-action"
              type="button"
            >
              {reviewView === 'inline' ? (
                <Sliders size={APP_ICON_SIZE} />
              ) : (
                <Columns2
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              )}
            </button>
          </Tooltip>
          <Tooltip content="关闭右侧边栏">
            <button
              aria-label="关闭右侧边栏"
              className="message-action"
              type="button"
              onClick={onClose}
            >
              <PanelRight size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
      </div>

      {error ? <div className="review-error-state">{error}</div> : null}

      {selectedFile ? (
        <ReviewDiffPreview
          attachedComments={attachedComments}
          draft={draft}
          file={selectedFile}
          pending={pending}
          scope={scope}
          view={reviewView}
          workspacePath={workspacePath}
          onApplyOperation={(action, target) => void applyOperation(action, target)}
          onCreateDraft={setDraft}
          onDeleteComment={commentId => void deleteComment(commentId)}
          onDraftBodyChange={body =>
            setDraft(current => (current ? { ...current, body } : current))
          }
          onResolveComment={commentId => void resolveComment(commentId)}
          onSaveDraft={() => void saveDraft()}
          onCancelDraft={() => setDraft(null)}
        />
      ) : null}

      <div className="review-file-list" role="list">
        {visibleFiles.length > 0 ? (
          visibleFiles.map(file => (
            <button
              className={`review-file-row ${
                file.path === selectedFile?.path ? 'active' : ''
              }`}
              key={file.path}
              title={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
            >
              <span className="review-file-badge">{fileBadge(file.path)}</span>
              <span className="review-file-path">{file.path}</span>
              <span className="review-file-counts">
                <strong>+{formatPanelNumber(file.additions)}</strong>
                <em>-{formatPanelNumber(file.deletions)}</em>
              </span>
            </button>
          ))
        ) : (
          <div className="review-empty-state">
            {files.length === 0
              ? scope === 'staged'
                ? '暂无已暂存变更。'
                : '暂无未暂存变更。'
              : '当前筛选下没有匹配的文件。'}
          </div>
        )}
      </div>

      {staleComments.length > 0 ? (
        <section className="review-stale-comments" aria-label="过期评论">
          <div className="review-stale-title">过期评论</div>
          {staleComments.map(comment => (
            <ReviewComment
              comment={comment}
              key={comment.id}
              stale
              onDelete={() => void deleteComment(comment.id)}
              onResolve={() => void resolveComment(comment.id)}
            />
          ))}
        </section>
      ) : null}
    </aside>
  )
}

function ReviewDiffPreview({
  attachedComments,
  draft,
  file,
  pending,
  scope,
  view,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  pending: boolean
  scope: DesktopReviewScope
  view: DesktopReviewView
  workspacePath: string | null
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target:
      | { type: 'file'; path: string }
      | { type: 'hunk'; path: string; hunkId: string },
  ) => void
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onDraftBodyChange: (body: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: () => void
}): React.ReactNode {
  const allLines = file.hunks.flatMap(hunk => hunk.lines)
  return (
    <section className="review-diff-preview" aria-label={`${file.path} diff`}>
      <div className="review-file-row active preview-header">
        <span className="review-file-badge">{fileBadge(file.path)}</span>
        <span className="review-file-path">{file.path}</span>
        <span className="review-file-counts">
          <strong>+{formatPanelNumber(file.additions)}</strong>
          <em>-{formatPanelNumber(file.deletions)}</em>
        </span>
        <div className="review-file-actions">
          {scope === 'unstaged' ? (
            <Tooltip content="暂存文件">
              <button
                aria-label="暂存文件"
                className="message-action"
                disabled={pending}
                type="button"
                onClick={() =>
                  onApplyOperation('stage', { type: 'file', path: file.path })
                }
              >
                <Upload size={APP_ICON_SIZE} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="取消暂存文件">
              <button
                aria-label="取消暂存文件"
                className="message-action"
                disabled={pending}
                type="button"
                onClick={() =>
                  onApplyOperation('unstage', { type: 'file', path: file.path })
                }
              >
                <Undo2 size={APP_ICON_SIZE} />
              </button>
            </Tooltip>
          )}
          {scope === 'unstaged' ? (
            <Tooltip content={file.isUntracked ? '删除未跟踪文件' : '还原文件'}>
              <button
                aria-label={file.isUntracked ? '删除未跟踪文件' : '还原文件'}
                className="message-action"
                disabled={pending}
                type="button"
                onClick={() =>
                  onApplyOperation('revert', { type: 'file', path: file.path })
                }
              >
                <Trash2 size={APP_ICON_SIZE} />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content="在文件管理器中打开">
            <button
              aria-label="在文件管理器中打开"
              className="message-action review-file-open"
              disabled={!workspacePath}
              type="button"
              onClick={() => {
                if (!workspacePath) return
                void desktopClient.openPathWithDefaultTarget(
                  `${workspacePath.replace(/[\\/]$/, '')}/${file.path}`,
                )
              }}
            >
              <ExternalLink size={APP_ICON_SIZE} />
            </button>
          </Tooltip>
        </div>
      </div>
      {allLines.length > 0 ? (
        view === 'split' ? (
          <ReviewDiffSplit
            attachedComments={attachedComments}
            draft={draft}
            file={file}
            pending={pending}
            scope={scope}
            onApplyOperation={onApplyOperation}
            onCancelDraft={onCancelDraft}
            onCreateDraft={onCreateDraft}
            onDeleteComment={onDeleteComment}
            onDraftBodyChange={onDraftBodyChange}
            onResolveComment={onResolveComment}
            onSaveDraft={onSaveDraft}
          />
        ) : (
          <ReviewDiffInline
            attachedComments={attachedComments}
            draft={draft}
            file={file}
            pending={pending}
            scope={scope}
            onApplyOperation={onApplyOperation}
            onCancelDraft={onCancelDraft}
            onCreateDraft={onCreateDraft}
            onDeleteComment={onDeleteComment}
            onDraftBodyChange={onDraftBodyChange}
            onResolveComment={onResolveComment}
            onSaveDraft={onSaveDraft}
          />
        )
      ) : (
        <div className="review-empty-state">
          {file.isUntracked
            ? '未跟踪文件暂不展示 hunk 预览，可直接暂存或删除。'
            : '此文件没有可用的 hunk 预览。'}
        </div>
      )}
    </section>
  )
}

function ReviewDiffInline({
  attachedComments,
  draft,
  file,
  pending,
  scope,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  return (
    <div className="review-diff-lines review-diff-inline">
      {file.hunks.map(hunk => (
        <React.Fragment key={hunk.id}>
          <ReviewHunkHeader
            file={file}
            hunk={hunk}
            pending={pending}
            scope={scope}
            onApplyOperation={onApplyOperation}
          />
          {hunk.lines.map(line => {
            const side = line.type === 'removed' ? 'left' : 'right'
            const lineNumber = line.type === 'removed' ? line.oldLine : line.newLine
            const anchor = buildAnchor(file.path, side, lineNumber, line.content)
            const comments = anchor
              ? attachedComments.get(commentKey(anchor)) ?? []
              : []
            return (
              <div className={`review-diff-row ${line.type}`} key={line.id}>
                <LineCommentButton
                  anchor={anchor}
                  disabled={!anchor}
                  onCreateDraft={onCreateDraft}
                />
                <span
                  className={`review-diff-line-number ${
                    line.type === 'added'
                      ? 'added'
                      : line.type === 'removed'
                        ? 'removed'
                        : ''
                  }`}
                >
                  {lineNumber ?? ''}
                </span>
                <code className="review-diff-line-content">
                  {line.content || ' '}
                </code>
                <LineComments
                  comments={comments}
                  draft={draft}
                  anchor={anchor}
                  onCancelDraft={onCancelDraft}
                  onDeleteComment={onDeleteComment}
                  onDraftBodyChange={onDraftBodyChange}
                  onResolveComment={onResolveComment}
                  onSaveDraft={onSaveDraft}
                />
              </div>
            )
          })}
        </React.Fragment>
      ))}
    </div>
  )
}

function ReviewDiffSplit({
  attachedComments,
  draft,
  file,
  pending,
  scope,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps): React.ReactNode {
  return (
    <div className="review-diff-lines review-diff-split">
      {file.hunks.map(hunk => (
        <React.Fragment key={hunk.id}>
          <ReviewHunkHeader
            file={file}
            hunk={hunk}
            pending={pending}
            scope={scope}
            onApplyOperation={onApplyOperation}
          />
          {splitDiffLines(hunk.lines).map(row => (
            <div
              className={`review-diff-split-row ${
                row.paired ? 'paired' : 'single'
              }`}
              key={row.id}
            >
              {[row.left, row.right].map(cell => {
                const anchor = buildAnchor(
                  file.path,
                  cell.side,
                  cell.number,
                  cell.content,
                )
                const comments = anchor
                  ? attachedComments.get(commentKey(anchor)) ?? []
                  : []
                return (
                  <div
                    className={`review-diff-side ${cell.tone}`}
                    data-tone={cell.tone}
                    key={cell.side}
                  >
                    <LineCommentButton
                      anchor={anchor}
                      disabled={!anchor}
                      onCreateDraft={onCreateDraft}
                    />
                    <span
                      className={`review-diff-line-number ${
                        cell.tone === 'added'
                          ? 'added'
                          : cell.tone === 'removed'
                            ? 'removed'
                            : ''
                      }`}
                    >
                      {cell.number ?? ''}
                    </span>
                    <code className="review-diff-line-content">
                      {cell.tone === 'empty' ? ' ' : cell.content || ' '}
                    </code>
                    <LineComments
                      comments={comments}
                      draft={draft}
                      anchor={anchor}
                      onCancelDraft={onCancelDraft}
                      onDeleteComment={onDeleteComment}
                      onDraftBodyChange={onDraftBodyChange}
                      onResolveComment={onResolveComment}
                      onSaveDraft={onSaveDraft}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

type ReviewDiffBodyProps = {
  attachedComments: Map<string, DesktopReviewComment[]>
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  pending: boolean
  scope: DesktopReviewScope
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target:
      | { type: 'file'; path: string }
      | { type: 'hunk'; path: string; hunkId: string },
  ) => void
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onDraftBodyChange: (body: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: () => void
}

function ReviewHunkHeader({
  file,
  hunk,
  pending,
  scope,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile
  hunk: DesktopReviewDiffHunk
  pending: boolean
  scope: DesktopReviewScope
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'hunk'; path: string; hunkId: string },
  ) => void
}): React.ReactNode {
  return (
    <div className="review-diff-row hunk">
      <span className="review-diff-line-content">{hunk.header}</span>
      <div className="review-hunk-actions">
        {scope === 'unstaged' ? (
          <>
            <button
              disabled={pending}
              type="button"
              onClick={() =>
                onApplyOperation('stage', {
                  type: 'hunk',
                  path: file.path,
                  hunkId: hunk.id,
                })
              }
            >
              暂存 hunk
            </button>
            <button
              disabled={pending}
              type="button"
              onClick={() =>
                onApplyOperation('revert', {
                  type: 'hunk',
                  path: file.path,
                  hunkId: hunk.id,
                })
              }
            >
              还原
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            type="button"
            onClick={() =>
              onApplyOperation('unstage', {
                type: 'hunk',
                path: file.path,
                hunkId: hunk.id,
              })
            }
          >
            取消暂存
          </button>
        )}
      </div>
    </div>
  )
}

function LineCommentButton({
  anchor,
  disabled,
  onCreateDraft,
}: {
  anchor: CommentAnchor | null
  disabled: boolean
  onCreateDraft: (draft: CommentDraft) => void
}): React.ReactNode {
  return (
    <button
      aria-label="添加行内评论"
      className="review-line-comment-button"
      disabled={disabled || !anchor}
      type="button"
      onClick={() => {
        if (!anchor) return
        onCreateDraft({ ...anchor, body: '' })
      }}
    >
      <MessageSquarePlus size={12} />
    </button>
  )
}

function LineComments({
  anchor,
  comments,
  draft,
  onCancelDraft,
  onDeleteComment,
  onDraftBodyChange,
  onResolveComment,
  onSaveDraft,
}: {
  anchor: CommentAnchor | null
  comments: DesktopReviewComment[]
  draft: CommentDraft | null
  onCancelDraft: () => void
  onDeleteComment: (commentId: string) => void
  onDraftBodyChange: (body: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: () => void
}): React.ReactNode {
  const draftMatches =
    anchor && draft ? commentKey(anchor) === commentKey(draft) : false
  if (comments.length === 0 && !draftMatches) return null
  return (
    <div className="review-line-comments">
      {comments.map(comment => (
        <ReviewComment
          comment={comment}
          key={comment.id}
          onDelete={() => onDeleteComment(comment.id)}
          onResolve={() => onResolveComment(comment.id)}
        />
      ))}
      {draftMatches ? (
        <div className="review-comment draft">
          <textarea
            autoFocus
            placeholder="写下这行的问题或修改建议"
            value={draft?.body ?? ''}
            onChange={event => onDraftBodyChange(event.target.value)}
          />
          <div className="review-comment-actions">
            <button type="button" onClick={onCancelDraft}>
              取消
            </button>
            <button
              disabled={!draft?.body.trim()}
              type="button"
              onClick={onSaveDraft}
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReviewComment({
  comment,
  stale = false,
  onDelete,
  onResolve,
}: {
  comment: DesktopReviewComment
  stale?: boolean
  onDelete: () => void
  onResolve: () => void
}): React.ReactNode {
  return (
    <div className={`review-comment ${comment.status} ${stale ? 'stale' : ''}`}>
      <div className="review-comment-meta">
        <span>
          {comment.filePath}:{comment.lineNumber}
        </span>
        <span>{comment.side === 'left' ? '旧行' : '新行'}</span>
      </div>
      <div className="review-comment-body">{comment.body}</div>
      <div className="review-comment-actions">
        {comment.status === 'open' ? (
          <button type="button" onClick={onResolve}>
            <CheckCircle2 size={12} />
            解决
          </button>
        ) : null}
        <button type="button" onClick={onDelete}>
          <Trash2 size={12} />
          删除
        </button>
      </div>
    </div>
  )
}

function splitDiffLines(lines: DesktopReviewDiffLine[]): ReviewSplitRow[] {
  const rows: ReviewSplitRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    if (line.type === 'removed' && lines[index + 1]?.type === 'added') {
      const next = lines[index + 1]!
      rows.push({
        id: `${line.id}-${next.id}`,
        left: {
          line,
          side: 'left',
          number: line.oldLine,
          content: line.content,
          tone: 'removed',
        },
        right: {
          line: next,
          side: 'right',
          number: next.newLine,
          content: next.content,
          tone: 'added',
        },
        paired: true,
      })
      index += 1
      continue
    }
    if (line.type === 'removed') {
      rows.push({
        id: line.id,
        left: {
          line,
          side: 'left',
          number: line.oldLine,
          content: line.content,
          tone: 'removed',
        },
        right: emptyCell('right'),
        paired: false,
      })
      continue
    }
    if (line.type === 'added') {
      rows.push({
        id: line.id,
        left: emptyCell('left'),
        right: {
          line,
          side: 'right',
          number: line.newLine,
          content: line.content,
          tone: 'added',
        },
        paired: false,
      })
      continue
    }
    rows.push({
      id: line.id,
      left: {
        line,
        side: 'left',
        number: line.oldLine,
        content: line.content,
        tone: 'context',
      },
      right: {
        line,
        side: 'right',
        number: line.newLine,
        content: line.content,
        tone: 'context',
      },
      paired: true,
    })
  }
  return rows
}

function emptyCell(side: DesktopReviewSide): ReviewCell {
  return {
    line: null,
    side,
    number: null,
    content: '',
    tone: 'empty',
  }
}

function attachComments(
  files: DesktopReviewDiffFile[],
  comments: DesktopReviewComment[],
): {
  attachedComments: Map<string, DesktopReviewComment[]>
  staleComments: DesktopReviewComment[]
} {
  const anchors = new Set<string>()
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: 'left',
              lineNumber: line.oldLine,
              lineContent: line.content,
            }),
          )
        }
        if (line.newLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: 'right',
              lineNumber: line.newLine,
              lineContent: line.content,
            }),
          )
        }
      }
    }
  }
  const attachedComments = new Map<string, DesktopReviewComment[]>()
  const staleComments: DesktopReviewComment[] = []
  for (const comment of comments) {
    if (comment.status === 'resolved') continue
    const key = commentKey(comment)
    if (!anchors.has(key)) {
      staleComments.push(comment)
      continue
    }
    attachedComments.set(key, [...(attachedComments.get(key) ?? []), comment])
  }
  return { attachedComments, staleComments }
}

function buildAnchor(
  filePath: string,
  side: DesktopReviewSide,
  lineNumber: number | null,
  lineContent: string,
): CommentAnchor | null {
  if (lineNumber === null) return null
  return { filePath, side, lineNumber, lineContent }
}

function commentKey(anchor: CommentAnchor): string {
  return `${anchor.filePath}\u0000${anchor.side}\u0000${anchor.lineNumber}\u0000${anchor.lineContent}`
}

function filterStatusForFile(file: DesktopReviewDiffFile): ReviewFilter {
  if (file.isUntracked) return 'added'
  const trimmed = file.status.trim()
  if (trimmed.startsWith('A') || trimmed.startsWith('??')) return 'added'
  if (trimmed.startsWith('D')) return 'removed'
  return 'modified'
}

function reviewFilterLabel(filter: ReviewFilter): string {
  switch (filter) {
    case 'added':
      return '新增'
    case 'modified':
      return '修改'
    case 'removed':
      return '删除'
    default:
      return '全部'
  }
}

function fileBadge(path: string): React.ReactNode {
  const ext = path.split('.').pop()?.slice(0, 4).toUpperCase()
  return ext || <FileDiff size={APP_ICON_SIZE} />
}

function formatPanelNumber(value: number): string {
  if (value > 999) return '999+'
  return String(value)
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

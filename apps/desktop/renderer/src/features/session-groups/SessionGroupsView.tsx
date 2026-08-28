import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDiff,
  History,
  MessageSquare,
  MessagesSquare,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { Select, type SelectOption } from '../../components/ui/Select.js'
import { Spinner } from '../../components/ui/Spinner.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopSessionGroup,
  DesktopSessionGroupDetail,
  DesktopSessionGroupStep,
} from '../../services/desktop-client/types.js'
import { cx } from '../../utils/cx.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { FileMutationDiffBody } from '../session/timeline/FileMutationDiffBody.js'
import { SessionGroupEditorDialog } from './SessionGroupEditorDialog.js'
import '../../styles/lazy/session-groups.scss'

function formatGroupTime(timestamp?: number | string | null): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  return date.toLocaleDateString()
}

export function SessionGroupsView(): React.ReactNode {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const [groups, setGroups] = useState<DesktopSessionGroup[]>([])
  const [detail, setDetail] = useState<DesktopSessionGroupDetail | null>(null)
  const [steps, setSteps] = useState<DesktopSessionGroupStep[]>([])
  const [availableSessions, setAvailableSessions] = useState<Array<{ id: string; title: string; workspaceLabel: string }>>([])
  const [sessionToAdd, setSessionToAdd] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const nextGroups = await desktopClient.listSessionGroups()
      setGroups(nextGroups)
      if (groupId) {
        const [nextDetail, nextSteps, activeSessions, archivedSessions] = await Promise.all([
          desktopClient.readSessionGroup(groupId),
          desktopClient.listSessionGroupSteps(groupId),
          desktopClient.listSessions({ archived: false }),
          desktopClient.listSessions({ archived: true }),
        ])
        const sessionItems = [...activeSessions, ...archivedSessions].map(session => session.item)
        const sessions = new Map(sessionItems.map(session => [session.id, session]))
        setAvailableSessions(sessionItems.map(session => ({
          id: session.id,
          title: session.customTitle ?? session.aiTitle ?? session.sessionName ?? session.id,
          workspaceLabel: session.workspaceName || '无项目',
        })))
        setDetail({
          ...nextDetail,
          members: nextDetail.members.map(member => {
            const session = sessions.get(member.threadId)
            return {
              ...member,
              title: session?.customTitle ?? session?.aiTitle ?? session?.sessionName ?? undefined,
              workspaceLabel: session?.workspaceName || undefined,
            }
          }),
        })
        setSteps([...nextSteps].reverse())
      } else {
        setDetail(null)
        setSteps([])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话组加载失败')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return keyword
      ? groups.filter(group => `${group.name} ${group.description}`.toLocaleLowerCase().includes(keyword))
      : groups
  }, [groups, search])

  const memberThreadIds = useMemo(
    () => new Set(detail?.members.map(m => m.threadId) ?? []),
    [detail?.members],
  )

  const sessionSelectOptions: SelectOption[] = useMemo(() => {
    return availableSessions
      .filter(session => !memberThreadIds.has(session.id))
      .map(session => ({
        value: session.id,
        label: session.title,
        detail: session.workspaceLabel,
        icon: <MessageSquare className="session-group-select-icon" size={14} />,
      }))
  }, [availableSessions, memberThreadIds])

  function openCreateDialog(): void {
    setDraftName('')
    setDraftDescription('')
    setEditorMode('create')
  }

  function openEditDialog(): void {
    if (!detail) return
    setDraftName(detail.group.name)
    setDraftDescription(detail.group.description)
    setEditorMode('edit')
  }

  async function saveGroup(): Promise<void> {
    const name = draftName.trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      if (editorMode === 'create') {
        const group = await desktopClient.createSessionGroup({ name, description: draftDescription.trim() })
        setEditorMode(null)
        navigate(`/session-groups/${encodeURIComponent(group.id)}`)
      } else if (editorMode === 'edit' && detail) {
        await desktopClient.updateSessionGroup({
          groupId: detail.group.id,
          version: detail.group.version,
          name,
          description: draftDescription.trim(),
        })
        setEditorMode(null)
        await refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话组保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteGroup(): Promise<void> {
    if (!detail) return
    setSaving(true)
    setError(null)
    try {
      await desktopClient.deleteSessionGroup(detail.group.id, detail.group.version)
      setDeleteDialogOpen(false)
      navigate('/session-groups')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话组删除失败')
    } finally {
      setSaving(false)
    }
  }

  async function addSession(): Promise<void> {
    if (!detail || !sessionToAdd) return
    await desktopClient.setSessionGroupMembership({ threadId: sessionToAdd, groupId: detail.group.id })
    setSessionToAdd('')
    await refresh()
  }

  async function removeSession(threadId: string): Promise<void> {
    await desktopClient.setSessionGroupMembership({ threadId, groupId: null })
    await refresh()
  }

  return (
    <>
      {groupId ? (
        <WorkspaceHeaderItem align="start" id="session-groups.back" order={0} slot="left">
          <Link className="session-groups-back" to="/session-groups">
            <ArrowLeft aria-hidden="true" size={APP_ICON_SIZE} />
            <span>会话组</span>
          </Link>
        </WorkspaceHeaderItem>
      ) : null}
      <WorkspaceHeaderItem align="end" id="session-groups.actions" order={100} slot="right">
        <Button aria-label="新建会话组" color="primary" size="compact" onClick={openCreateDialog}>
          <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <span>新建会话组</span>
        </Button>
      </WorkspaceHeaderItem>
      <SessionGroupEditorDialog
        description={draftDescription}
        mode={editorMode ?? 'create'}
        name={draftName}
        open={editorMode !== null}
        saving={saving}
        onCancel={() => setEditorMode(null)}
        onDescriptionChange={setDraftDescription}
        onNameChange={setDraftName}
        onSubmit={() => void saveGroup()}
      />
      <ConfirmationDialog
        actionDisabled={saving}
        actionLabel={saving ? '删除中…' : '删除组'}
        description="聊天、Turn 和 Diff 不会被删除，但会话组上下文将无法恢复。"
        open={deleteDialogOpen}
        title={`删除“${detail?.group.name ?? ''}”？`}
        tone="danger"
        onAction={() => void deleteGroup()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
      {groupId ? (
        <main aria-live="polite" className="session-group-detail-page">
          {error ? (
            <div className="session-group-detail-message" role="alert">
              <AlertCircle size={APP_ICON_SIZE} />
              <h1>无法打开会话组</h1>
              <p>{error}</p>
              <div>
                <Button color="secondary" size="compact" onClick={() => void refresh()}>
                  <RefreshCw size={APP_ICON_SIZE} />
                  <span>重试</span>
                </Button>
                <Button color="secondary" size="compact" onClick={() => navigate('/session-groups')}>
                  返回会话组
                </Button>
              </div>
            </div>
          ) : null}
          {loading && !detail ? (
            <div className="session-group-loading">
              <Spinner size="medium" />
              <span>正在加载会话组…</span>
            </div>
          ) : null}
          {detail ? (
            <div className="session-group-detail__inner">
              <header className="session-group-detail__header">
                <div className="session-group-detail__info">
                  <span className="chip-semantic accent session-group-eyebrow">
                    <Sparkles size={11} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    共享上下文
                  </span>
                  <h1>{detail.group.name}</h1>
                  <p>{detail.group.description || '这个组暂未设置详细说明。'}</p>
                </div>
                <div className="session-group-actions">
                  <Button color="secondary" size="compact" onClick={openEditDialog}>
                    <Pencil size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>编辑</span>
                  </Button>
                  <Button color="secondary" size="compact" onClick={() => setDeleteDialogOpen(true)}>
                    <Trash2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>删除组</span>
                  </Button>
                </div>
              </header>

              <section className="session-group-section">
                <div className="session-group-section__title-row">
                  <BookOpen size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>当前摘要</h3>
                </div>
                <div className="session-group-digest-card">
                  <p className="session-group-digest">
                    {detail.digest || '完成组内第一个会话步骤后，这里会自动整理目标、决策和修复结论。'}
                  </p>
                </div>
                {detail.contextEntries.length ? (
                  <div className="session-group-context-grid">
                    {detail.contextEntries
                      .filter(entry => entry.status === 'active')
                      .map(entry => (
                        <article className="session-group-context-card" key={entry.id}>
                          <div className="session-group-context-card__header">
                            <span className="chip-semantic accent">{entry.section}</span>
                            <strong>{entry.title}</strong>
                          </div>
                          <p>{entry.content}</p>
                        </article>
                      ))}
                  </div>
                ) : null}
              </section>

              <section className="session-group-section">
                <div className="session-group-section__title-row">
                  <Users size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>成员会话</h3>
                  <span className="session-group-section-count">{detail.members.length}</span>
                </div>
                <div className="session-group-member-add">
                  <div className="session-group-member-select-wrap">
                    <Select
                      ariaLabel="选择已有会话"
                      emptyText="没有可添加的会话"
                      onValueChange={setSessionToAdd}
                      options={sessionSelectOptions}
                      placeholder="选择已有会话并加入组…"
                      searchPlaceholder="搜索会话名称或项目…"
                      searchable
                      value={sessionToAdd}
                    />
                  </div>
                  <Button
                    color="primary"
                    disabled={!sessionToAdd}
                    size="compact"
                    onClick={() => void addSession()}
                  >
                    <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    <span>加入组</span>
                  </Button>
                </div>
                <div className="session-group-members">
                  {detail.members.map(member => (
                    <article className="session-group-member-card" key={member.threadId}>
                      <div className="session-group-member-card__icon">
                        <MessageSquare size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      </div>
                      <Link
                        className="session-group-member-card__body"
                        to={`/threads/${encodeURIComponent(member.threadId)}`}
                      >
                        <span className="session-group-member-card__title">
                          {member.title || member.threadId}
                        </span>
                        <span className="chip-semantic info session-group-member-card__chip">
                          {member.workspaceLabel || '无项目'}
                        </span>
                      </Link>
                      <div className="session-group-member-card__actions">
                        <IconButton
                          aria-label={`移出会话：${member.title || member.threadId}`}
                          color="ghostSecondary"
                          size="toolbar"
                          title="从该组移出"
                          onClick={() => void removeSession(member.threadId)}
                        >
                          <UserMinus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                  {detail.members.length === 0 ? (
                    <p className="session-group-empty-subtle">
                      当前组暂无成员会话，请在上方选择已有会话加入。
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="session-group-section">
                <div className="session-group-section__title-row">
                  <History size={16} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  <h3>步骤时间线</h3>
                  <span className="session-group-section-count">{steps.length}</span>
                </div>
                <div className="session-group-timeline">
                  {steps.map(step => (
                    <SessionGroupStepCard groupId={detail.group.id} key={step.id} step={step} />
                  ))}
                  {steps.length === 0 ? (
                    <p className="session-group-empty-subtle">
                      组内的新会话完成一步后，会自动在此记录决策、修改和验证结果。
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </main>
      ) : (
        <PrimaryPageLayout
          className="session-groups-primary-page"
          description="组织相关会话，共享修复上下文、决策摘要和验证记录。"
          search={(
            <SearchInput
              aria-label="搜索会话组"
              onChange={setSearch}
              placeholder="搜索名称或说明…"
              value={search}
            />
          )}
          title="会话组"
        >
          <main aria-live="polite" className="session-groups-index">
            {error ? (
              <div className="session-group-notice" role="alert">
                <AlertCircle size={APP_ICON_SIZE} />
                <span>{error}</span>
                <Button color="secondary" size="compact" onClick={() => void refresh()}>
                  <RefreshCw size={APP_ICON_SIZE} />
                  <span>重试</span>
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div className="session-group-loading">
                <Spinner size="medium" />
                <span>正在加载会话组…</span>
              </div>
            ) : null}
            {!loading && !error && filtered.length > 0 ? (
              <div className="session-groups-table">
                <div className="session-groups-table__header" aria-hidden="true">
                  <span>会话组</span>
                  <span>项目</span>
                  <span>最近更新</span>
                </div>
                <div className="session-groups-table__rows">
                  {filtered.map(group => (
                    <Link
                      className="session-group-row"
                      key={group.id}
                      to={`/session-groups/${encodeURIComponent(group.id)}`}
                    >
                      <span className="session-group-row__main">
                        <strong>{group.name}</strong>
                        <small>
                          {group.memberCount} 个会话
                          {group.description ? ` · ${group.description}` : ''}
                        </small>
                      </span>
                      <span className="session-group-row__projects">
                        {group.projectLabels.length > 0 ? group.projectLabels.slice(0, 2).join('、') : '无项目'}
                      </span>
                      <span className="session-group-row__updated">
                        <span>{formatGroupTime(group.latestStepAt) || '暂无记录'}</span>
                        <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {!loading && !error && groups.length === 0 ? (
              <div className="session-groups-empty-state">
                <MessagesSquare aria-hidden="true" size={32} strokeWidth={APP_ICON_STROKE_WIDTH} />
                <h2>暂无会话组</h2>
                <p>将相关会话组织在一起，共享上下文并追踪每一步验证。</p>
                <Button color="secondary" onClick={openCreateDialog}>创建新会话组</Button>
              </div>
            ) : null}
            {!loading && !error && groups.length > 0 && filtered.length === 0 ? (
              <div className="session-groups-empty-state">
                <MessagesSquare aria-hidden="true" size={32} strokeWidth={APP_ICON_STROKE_WIDTH} />
                <h2>未找到会话组</h2>
                <p>没有与“{search}”匹配的会话组。</p>
                <Button color="secondary" size="compact" onClick={() => setSearch('')}>清除搜索</Button>
              </div>
            ) : null}
          </main>
        </PrimaryPageLayout>
      )}
    </>
  )
}

function SessionGroupStepCard({
  groupId,
  step,
}: {
  groupId: string
  step: DesktopSessionGroupStep
}): React.ReactNode {
  const [diff, setDiff] = useState<RpcResult<'session-group/step/diff'> | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)

  async function toggleDiff(): Promise<void> {
    const next = !diffOpen
    setDiffOpen(next)
    if (next && !diff) {
      setDiffLoading(true)
      try {
        const diffResult = await desktopClient.readSessionGroupStepDiff({ groupId, stepId: step.id })
        setDiff(diffResult)
      } finally {
        setDiffLoading(false)
      }
    }
  }

  const isFailed =
    step.status === 'failed' ||
    step.status === 'interrupted' ||
    step.status === 'cancelled' ||
    Boolean(step.failure)
  const isCompleted = step.status === 'completed'

  const statusLabel =
    step.status === 'completed'
      ? '已完成'
      : step.status === 'failed'
        ? '失败'
        : step.status === 'interrupted'
          ? '已中断'
          : step.status === 'cancelled'
            ? '已取消'
            : step.status === 'waiting_permission'
              ? '等待权限'
              : '等待提问'

  return (
    <article className="session-group-step" data-status={step.status}>
      <div className="session-group-step__rail">
        <div
          className={cx(
            'session-group-step__node',
            isFailed ? 'is-danger' : isCompleted ? 'is-success' : 'is-accent',
          )}
        >
          {isFailed ? (
            <AlertCircle size={14} strokeWidth={2.2} />
          ) : isCompleted ? (
            <CheckCircle2 size={14} strokeWidth={2.2} />
          ) : (
            <Sparkles size={13} strokeWidth={2} />
          )}
        </div>
        <span className="session-group-step__seq">{step.sequence}</span>
      </div>
      <div className="session-group-step__body">
        <header className="session-group-step__header">
          <div className="session-group-step__meta">
            <div className="session-group-step__title-row">
              <strong className="session-group-step__title">
                {step.sourceThreadTitle || '未命名步骤'}
              </strong>
              <span
                className={cx(
                  'chip-semantic',
                  isFailed ? 'danger' : isCompleted ? 'success' : 'accent',
                )}
              >
                {statusLabel}
              </span>
            </div>
            <div className="session-group-step__submeta">
              <span>{step.workspaceLabel || '默认工作区'}</span>
              <span>·</span>
              <span>Turn {step.sourceTurnId}</span>
            </div>
          </div>
          {step.sourceThreadId ? (
            <Link
              className="session-group-step__link"
              to={`/threads/${encodeURIComponent(step.sourceThreadId)}`}
            >
              <span>打开来源</span>
              <ArrowUpRight size={13} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Link>
          ) : (
            <span className="session-group-step__link session-group-step__link--disabled">
              来源已删除
            </span>
          )}
        </header>

        {step.summary ? <p className="session-group-step__summary">{step.summary}</p> : null}

        {step.checkpoints.length ? (
          <ol className="session-group-step__evidence">
            {step.checkpoints.map(checkpoint => {
              const checkpointLabel =
                checkpoint.status === 'completed'
                  ? '已完成'
                  : checkpoint.status === 'failed'
                    ? '失败'
                    : '进行中'
              return (
                <li key={`${checkpoint.ordinal}:${checkpoint.kind}`}>
                  <span
                    className={cx(
                      'chip-semantic',
                      checkpoint.status === 'completed'
                        ? 'success'
                        : checkpoint.status === 'failed'
                          ? 'danger'
                          : 'info',
                    )}
                  >
                    {checkpointLabel}
                  </span>
                  <span className="session-group-step__checkpoint-text">{checkpoint.summary}</span>
                </li>
              )
            })}
          </ol>
        ) : null}

        {step.validations.length ? (
          <div className="session-group-step__validations">
            {step.validations.map(validation => (
              <div
                className={cx(
                  'session-group-step__validation-item',
                  validation.status === 'passed'
                    ? 'is-passed'
                    : validation.status === 'failed'
                      ? 'is-failed'
                      : 'is-skipped',
                )}
                key={`${validation.name}:${validation.summary}`}
              >
                <div className="session-group-step__validation-header">
                  {validation.status === 'passed' ? (
                    <Check className="u-text-success" size={14} />
                  ) : validation.status === 'failed' ? (
                    <AlertCircle className="u-text-danger" size={14} />
                  ) : (
                    <History className="u-text-meta" size={14} />
                  )}
                  <strong>
                    {validation.status === 'passed'
                      ? '验证通过'
                      : validation.status === 'failed'
                        ? '验证失败'
                        : '验证跳过'}{' '}
                    · {validation.name}
                  </strong>
                </div>
                {validation.summary ? <p>{validation.summary}</p> : null}
              </div>
            ))}
          </div>
        ) : null}

        {step.failure ? (
          <div className="session-group-step__failure" role="alert">
            <div className="session-group-step__failure-title">
              <AlertCircle size={15} />
              <strong>失败阶段：{step.failure.stage}</strong>
            </div>
            <span>{step.failure.message}</span>
          </div>
        ) : null}

        {step.changedFiles.length ? (
          <div className="session-group-step__diff-area">
            <button
              aria-expanded={diffOpen}
              className="session-group-diff-toggle"
              type="button"
              onClick={() => void toggleDiff()}
            >
              <FileDiff size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span>{step.changedFiles.length} 个变更文件</span>
              {diffOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {diffOpen ? (
              <div className="session-group-step__diff">
                {diffLoading ? (
                  <div className="session-group-diff-loading">正在加载 Diff…</div>
                ) : diff ? (
                  diff.files.map(file => (
                    <FileMutationDiffBody
                      diff={{
                        path: file.path,
                        operation: file.operation === 'rename' ? 'update' : file.operation,
                        patch: file.patch,
                        hunks: file.hunks,
                        renderable: file.renderable,
                        tooLargeReason: file.tooLargeReason,
                      }}
                      diffMarkerStyle="color"
                      key={`${file.workspaceLabel}:${file.path}`}
                    />
                  ))
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

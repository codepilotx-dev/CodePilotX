import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, FileDiff, MessagesSquare, Pencil, Plus, Search, Trash2, UserMinus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopSessionGroup,
  DesktopSessionGroupDetail,
  DesktopSessionGroupStep,
} from '../../services/desktop-client/types.js'
import { FileMutationDiffBody } from '../session/timeline/FileMutationDiffBody.js'
import '../../styles/lazy/session-groups.scss'

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
          workspaceLabel: session.workspaceName || '无项目会话',
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

  async function createGroup(): Promise<void> {
    const name = globalThis.prompt('会话组名称')?.trim()
    if (!name) return
    const group = await desktopClient.createSessionGroup({ name })
    navigate(`/session-groups/${encodeURIComponent(group.id)}`)
    await refresh()
  }

  async function deleteGroup(): Promise<void> {
    if (!detail || !globalThis.confirm(`删除“${detail.group.name}”？聊天和 Diff 不会被删除。`)) return
    await desktopClient.deleteSessionGroup(detail.group.id, detail.group.version)
    navigate('/session-groups')
  }

  async function editGroup(): Promise<void> {
    if (!detail) return
    const name = globalThis.prompt('会话组名称', detail.group.name)?.trim()
    if (!name) return
    const description = globalThis.prompt('会话组说明', detail.group.description) ?? detail.group.description
    await desktopClient.updateSessionGroup({ groupId: detail.group.id, version: detail.group.version, name, description })
    await refresh()
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
    <main className="session-groups-view">
      <aside className="session-groups-list" aria-label="会话组列表">
        <header>
          <div><MessagesSquare aria-hidden="true" size={20} /><h1>会话组</h1></div>
          <Button aria-label="新建会话组" size="compact" onClick={() => void createGroup()}><Plus size={APP_ICON_SIZE} />新建</Button>
        </header>
        <label className="session-groups-search">
          <Search aria-hidden="true" size={APP_ICON_SIZE} />
          <input aria-label="搜索会话组" placeholder="搜索名称或说明" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <div className="session-groups-list__items">
          {filtered.map(group => (
            <Link className="session-group-card" data-active={group.id === groupId || undefined} key={group.id} to={`/session-groups/${encodeURIComponent(group.id)}`}>
              <strong>{group.name}</strong>
              <span>{group.memberCount} 个会话 · {group.projectLabels.length} 个项目{group.latestStepAt ? ` · ${new Date(group.latestStepAt).toLocaleString()}` : ''}</span>
              {group.description ? <small>{group.description}</small> : null}
              <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />
            </Link>
          ))}
          {!loading && filtered.length === 0 ? <p className="session-groups-empty">还没有会话组。新建一个，把相关聊天放在一起。</p> : null}
        </div>
      </aside>
      <section className="session-group-detail" aria-live="polite">
        {error ? <div className="session-group-notice" role="alert">{error}<Button size="compact" onClick={() => void refresh()}>重试</Button></div> : null}
        {loading && !detail ? <div className="session-group-notice">正在加载会话组…</div> : null}
        {!loading && !detail && !error ? (
          <div className="session-group-hero"><MessagesSquare aria-hidden="true" size={36} /><h2>让相关会话共享修复脉络</h2><p>选择一个会话组，查看每一步修改、验证、失败位置和后续修复。</p></div>
        ) : null}
        {detail ? (
          <>
            <header className="session-group-detail__header">
              <div><span className="session-group-eyebrow">共享上下文</span><h2>{detail.group.name}</h2><p>{detail.group.description || '这个组还没有说明。'}</p></div>
              <div className="session-group-actions"><Button color="secondary" size="compact" onClick={() => void editGroup()}><Pencil size={APP_ICON_SIZE} />编辑</Button><Button color="secondary" size="compact" onClick={() => void deleteGroup()}><Trash2 size={APP_ICON_SIZE} />删除组</Button></div>
            </header>
            <section className="session-group-section"><h3>当前摘要</h3><p className="session-group-digest">{detail.digest || '完成组内第一个会话步骤后，这里会自动整理目标、决定和修复结论。'}</p>
              {detail.contextEntries.length ? <div className="session-group-context-grid">{detail.contextEntries.filter(entry => entry.status === 'active').map(entry => <article key={entry.id}><small>{entry.section}</small><strong>{entry.title}</strong><p>{entry.content}</p></article>)}</div> : null}
            </section>
            <section className="session-group-section"><h3>成员会话 <span>{detail.members.length}</span></h3><div className="session-group-member-add"><select aria-label="选择已有会话" value={sessionToAdd} onChange={event => setSessionToAdd(event.target.value)}><option value="">添加已有会话…</option>{availableSessions.filter(session => !detail.members.some(member => member.threadId === session.id)).map(session => <option key={session.id} value={session.id}>{session.title} · {session.workspaceLabel}</option>)}</select><Button size="compact" disabled={!sessionToAdd} onClick={() => void addSession()}><Plus size={APP_ICON_SIZE} />添加</Button></div><div className="session-group-members">{detail.members.map(member => <article key={member.threadId}><Link to={`/threads/${encodeURIComponent(member.threadId)}`}><span>{member.title || member.threadId}</span><small>{member.workspaceLabel || '无项目会话'}</small></Link><Button aria-label={`移出会话：${member.title || member.threadId}`} color="secondary" size="compact" onClick={() => void removeSession(member.threadId)}><UserMinus size={APP_ICON_SIZE} /></Button></article>)}</div></section>
            <section className="session-group-section"><h3>步骤时间线 <span>{steps.length}</span></h3><div className="session-group-timeline">{steps.map(step => <SessionGroupStepCard groupId={detail.group.id} key={step.id} step={step} />)}{steps.length === 0 ? <p className="session-groups-empty">组内的新会话完成一步后，会在这里留下可追溯记录。</p> : null}</div></section>
          </>
        ) : null}
      </section>
    </main>
  )
}

function SessionGroupStepCard({ groupId, step }: { groupId: string; step: DesktopSessionGroupStep }): React.ReactNode {
  const [diff, setDiff] = useState<RpcResult<'session-group/step/diff'> | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  async function toggleDiff(): Promise<void> {
    const next = !diffOpen
    setDiffOpen(next)
    if (next && !diff) {
      setDiff(await desktopClient.readSessionGroupStepDiff({ groupId, stepId: step.id }))
    }
  }
  return <article className="session-group-step" data-status={step.status}>
    <div className="session-group-step__rail"><span>{step.sequence}</span></div>
    <div className="session-group-step__body"><header><div><strong>{step.sourceThreadTitle}</strong><small>{step.workspaceLabel} · Turn {step.sourceTurnId} · {step.status}</small></div>{step.sourceThreadId ? <Link to={`/threads/${encodeURIComponent(step.sourceThreadId)}`}>打开来源</Link> : <span>来源已删除</span>}</header><p>{step.summary}</p>
      {step.checkpoints.length ? <ol className="session-group-step__evidence">{step.checkpoints.map(checkpoint => <li key={`${checkpoint.ordinal}:${checkpoint.kind}`}><span>{checkpoint.status}</span>{checkpoint.summary}</li>)}</ol> : null}
      {step.validations.length ? <div className="session-group-step__validations">{step.validations.map(validation => <p key={`${validation.name}:${validation.summary}`}><strong>{validation.status === 'passed' ? '验证通过' : validation.status === 'failed' ? '验证失败' : '验证跳过'} · {validation.name}</strong><span>{validation.summary}</span></p>)}</div> : null}
      {step.failure ? <div className="session-group-step__failure" role="note"><strong>失败阶段：{step.failure.stage}</strong><span>{step.failure.message}</span></div> : null}
      {step.changedFiles.length ? <button className="session-group-diff-toggle" type="button" onClick={() => void toggleDiff()}><FileDiff size={APP_ICON_SIZE} />{step.changedFiles.length} 个变更文件</button> : null}
      {diffOpen && diff ? <div className="session-group-step__diff">{diff.files.map(file => <FileMutationDiffBody diff={{ path: file.path, operation: file.operation === 'rename' ? 'update' : file.operation, patch: file.patch, hunks: file.hunks, renderable: file.renderable, tooLargeReason: file.tooLargeReason }} diffMarkerStyle="color" key={`${file.workspaceLabel}:${file.path}`} />)}</div> : null}
    </div>
  </article>
}

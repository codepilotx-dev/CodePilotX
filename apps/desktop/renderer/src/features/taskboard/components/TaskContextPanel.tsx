import { useCallback, useEffect, useState } from 'react'
import type { TaskContextChange, TaskContextProposal, TaskContextSection, TaskContextSnapshot, TaskContextEntry } from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

const labels: Record<TaskContextSection, string> = { objective: '目标', decision: '决策', risk: '风险', progress: '进展', code_map: '代码地图', validation: '验证', finding: '发现' }

export function TaskContextPanel({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [snapshot, setSnapshot] = useState<TaskContextSnapshot | null>(null)
  const [entries, setEntries] = useState<readonly TaskContextEntry[]>([])
  const [proposal, setProposal] = useState<TaskContextProposal | null>(null)
  const [promotion, setPromotion] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; version: number; title: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!desktopClient.readTaskContext) return
    try { const result = await desktopClient.readTaskContext({ taskId, includeEvidence: false }); setSnapshot(result.snapshot); setEntries(result.entries); setPromotion((await desktopClient.readTaskContextPromotion?.({ taskId }))?.promotion?.status ?? null); setError(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '任务上下文加载失败') }
  }, [taskId])
  useEffect(() => { void load() }, [load])
  useEffect(() => desktopClient.subscribeAgentEventEnvelopes(
    { liveEventTypes: [] },
    events => {
      if (events.some(event => event.type === 'taskboard/context/changed' && event.payload.taskId === taskId)) void load()
    },
  ), [load, taskId])

  const update = async (changes: TaskContextChange[]) => {
    if (!snapshot || !desktopClient.updateTaskContext) return
    setBusy(true)
    try { await desktopClient.updateTaskContext({ taskId, expectedContextRevision: snapshot.contextRevision, changes }); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '任务上下文更新失败'); await load() }
    finally { setBusy(false) }
  }
  const preview = async () => {
    if (!desktopClient.previewTaskContext) return
    setBusy(true); setError(null)
    try { setProposal((await desktopClient.previewTaskContext({ taskId })).proposal) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'AI 更新失败') }
    finally { setBusy(false) }
  }

  return <section className="taskboard-drawer__section task-context-panel">
    <div className="taskboard-drawer__section-heading"><h3>共享上下文 {snapshot?.pendingEvidenceCount ? <span>{snapshot.pendingEvidenceCount} 待整理</span> : null}</h3><Button color="secondary" disabled={readOnly || snapshot?.frozen || busy} loading={busy} size="compact" onClick={() => void preview()}>AI 总结/更新上下文</Button></div>
    {snapshot ? <p className="taskboard-drawer__empty">版本 {snapshot.contextRevision} · Evidence {snapshot.evidenceRevision}{snapshot.frozen ? ' · 已冻结' : ''}{promotion ? ` · 记忆提升 ${promotion}` : ''}</p> : null}
    {error ? <p className="taskboard-dialog__error" role="alert">{error}</p> : null}
    {entries.length ? Object.entries(labels).map(([section, label]) => {
      const values = entries.filter(entry => entry.section === section)
      return values.length ? <div key={section} className="task-context-panel__group"><h4>{label}</h4>{values.map(entry => <article key={entry.id}>{editing?.id === entry.id ? <form onSubmit={event => { event.preventDefault(); void update([{ op: 'replace', entryId: entry.id, expectedEntryVersion: editing.version, title: editing.title.trim(), content: editing.content.trim() }]).then(() => setEditing(null)) }}><input aria-label="上下文标题" maxLength={120} value={editing.title} onChange={event => setEditing({ ...editing, title: event.currentTarget.value })} /><textarea aria-label="上下文内容" maxLength={2_000} rows={4} value={editing.content} onChange={event => setEditing({ ...editing, content: event.currentTarget.value })} /><Button color="ghostSecondary" size="compact" type="button" onClick={() => setEditing(null)}>取消</Button><Button color="secondary" disabled={!editing.title.trim() || !editing.content.trim()} size="compact" type="submit">保存</Button></form> : <><strong>{entry.title}</strong><p>{entry.content}</p><small>已确认 · {entry.sourceKind}{entry.sourceThreadId ? ` · 会话 ${entry.sourceThreadId.slice(0, 8)}` : ''} · v{entry.version}</small>{!readOnly && !snapshot?.frozen ? <><Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => setEditing({ id: entry.id, version: entry.version, title: entry.title, content: entry.content })}>编辑</Button><Button color="ghostSecondary" disabled={busy} size="compact" onClick={() => void update([{ op: 'retire', entryId: entry.id, expectedEntryVersion: entry.version, reason: '用户从任务详情废弃' }])}>废弃</Button></> : null}</>}</article>)}</div> : null
    }) : <p className="taskboard-drawer__empty">暂无已发布上下文；完成的执行结果会先进入待整理证据。</p>}
    {proposal ? <div className="task-context-panel__proposal" role="dialog" aria-label="任务上下文更新预览"><h4>更新预览</h4>{proposal.changes.length ? <ul>{proposal.changes.map((change, index) => <li key={index}>{change.op === 'add' ? `新增 ${labels[change.section]}：${change.title}` : change.op === 'replace' ? `修改：${change.title}` : `废弃条目 ${change.entryId}`}</li>)}</ul> : <p>没有需要应用的变更。</p>}<Button color="ghostSecondary" onClick={() => { void desktopClient.discardTaskContextProposal?.({ proposalId: proposal.id }); setProposal(null) }}>取消</Button><Button color="secondary" disabled={!proposal.changes.length} onClick={() => { setBusy(true); void desktopClient.applyTaskContextProposal?.({ proposalId: proposal.id }).then(() => { setProposal(null); return load() }).catch(cause => { setError(cause instanceof Error ? cause.message : 'Proposal 已过期'); setProposal(null) }).finally(() => setBusy(false)) }}>应用</Button></div> : null}
  </section>
}

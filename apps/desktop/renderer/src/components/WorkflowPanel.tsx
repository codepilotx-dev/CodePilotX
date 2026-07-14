import { Check, Code2, FileDiff, ShieldCheck, TerminalSquare, X } from 'lucide-react'
import type { Proposal } from '../api/agent-client'

export type WorkflowStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'
export interface WorkflowStage { role: 'planner' | 'developer' | 'reviewer'; status: WorkflowStageStatus; detail?: string }

export function WorkflowPanel({ proposals, stages, busy, onReview }: { proposals: readonly Proposal[]; stages: readonly WorkflowStage[]; busy?: boolean; onReview: (id: string, status: 'reviewed' | 'rejected') => void }) {
  return (
    <section className="workflow-panel" aria-label="只读工作流">
      <header><div><h2>只读多 Agent 工作流</h2><p>规划、拟议修改与审查按固定顺序进行；此版本不会写入文件或执行命令。</p></div><span className="readonly-badge">只读</span></header>
      <ol className="workflow-timeline">
        {stages.map((stage, index) => <li key={stage.role} className={`workflow-stage-${stage.status}`}><span className="workflow-step">{index + 1}</span><div><strong>{stage.role === 'planner' ? '规划 Agent' : stage.role === 'developer' ? '开发 Agent' : '审查 Agent'}</strong><small>{stage.detail ?? (stage.status === 'running' ? '正在处理' : stage.status === 'completed' ? '已完成' : stage.status === 'failed' ? '失败' : stage.status === 'interrupted' ? '已中断' : '等待开始')}</small></div></li>)}
      </ol>
      {proposals.length ? <div className="proposal-list">{proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} busy={busy} onReview={onReview} />)}</div> : <p className="proposal-empty">完成任务后，补丁和命令提议会显示在这里。</p>}
    </section>
  )
}

function ProposalCard({ proposal, busy, onReview }: { proposal: Proposal; busy?: boolean; onReview: (id: string, status: 'reviewed' | 'rejected') => void }) {
  const pending = proposal.status === 'pending'
  return <article className="proposal-card">
    <header><span className="proposal-icon">{proposal.type === 'patch' ? <FileDiff size={16} /> : <TerminalSquare size={16} />}</span><div><strong>{proposal.type === 'patch' ? proposal.path ?? '拟议补丁' : '拟议命令'}</strong><small>{proposal.reason ?? '等待审阅'}</small></div><span className={`proposal-status proposal-status-${proposal.status}`}>{proposal.status === 'reviewed' ? '已审阅' : proposal.status === 'rejected' ? '已拒绝' : '待审阅'}</span></header>
    {proposal.type === 'patch' ? <pre className="proposal-diff"><code>{formatPatch(proposal)}</code></pre> : <pre className="proposal-command"><code>{[proposal.cwd ? `$ cd ${proposal.cwd}` : null, proposal.command].filter(Boolean).join('\n')}</code></pre>}
    {proposal.review ? <div className="proposal-review"><ShieldCheck size={15} />{proposal.review}</div> : null}
    {pending ? <footer><button disabled={busy} onClick={() => onReview(proposal.id, 'rejected')}><X size={14} />拒绝</button><button className="proposal-review-button" disabled={busy} onClick={() => onReview(proposal.id, 'reviewed')}><Check size={14} />标记已审阅</button></footer> : null}
  </article>
}

function formatPatch(proposal: Proposal): string {
  const before = proposal.before ?? ''
  const after = proposal.after ?? ''
  return `--- ${proposal.path ?? '文件'}\n+++ ${proposal.path ?? '文件'}\n${before ? `- ${before}` : ''}${before && after ? '\n' : ''}${after ? `+ ${after}` : ''}`
}

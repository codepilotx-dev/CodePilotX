import type { PermissionRequest } from '@codepilotx/shared'
import { Ban, CircleStop, ShieldAlert, ThumbsUp } from 'lucide-react'

export function PermissionSheet({ request, onReply }: {
  request: PermissionRequest
  onReply: (decision: 'allow-once' | 'deny' | 'stop') => void
}) {
  return (
    <section className="permission-sheet" aria-label="工具权限确认">
      <header><ShieldAlert size={18} /><strong>需要你的确认</strong><span className={`risk-badge risk-${request.risk}`}>{request.risk} 风险</span></header>
      <div className="permission-tool">{request.tool}</div>
      {request.command ? <pre>{request.command}</pre> : null}
      {request.paths.length ? <div className="permission-paths">{request.paths.join('\n')}</div> : null}
      <p>{request.reason}</p>
      <footer>
        <button onClick={() => onReply('deny')}><Ban size={14} />拒绝</button>
        <button onClick={() => onReply('stop')}><CircleStop size={14} />停止任务</button>
        <button className="permission-allow" onClick={() => onReply('allow-once')}><ThumbsUp size={14} />允许一次</button>
      </footer>
    </section>
  )
}

import type React from 'react'

type Props = {
  workspaceName: string
  branchName: string
}

export function ContextStrip({
  workspaceName,
  branchName,
}: Props): React.ReactNode {
  return (
    <div className="context-strip">
      <span>{workspaceName}</span>
      <span>本地模式</span>
      <span>{branchName}</span>
    </div>
  )
}

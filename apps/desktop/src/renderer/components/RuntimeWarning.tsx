import type React from 'react'
import { AlertCircle } from 'lucide-react'

export function RuntimeWarning(): React.ReactNode {
  return (
    <div className="global-warning">
      <AlertCircle size={16} />
      <span>
        桌面端 agent 运行时缺失，发送消息前请先执行
        `bun run desktop:agent:build`。
      </span>
    </div>
  )
}

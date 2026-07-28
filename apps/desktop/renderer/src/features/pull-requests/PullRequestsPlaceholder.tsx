import type React from 'react'
import { GitPullRequest } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'

export function PullRequestsPlaceholder(): React.ReactNode {
  return (
    <main className="pull-requests-placeholder">
      <header className="pull-requests-placeholder__header">
        <h1>拉取请求</h1>
      </header>

      <section
        aria-labelledby="pull-requests-empty-title"
        className="pull-requests-placeholder__empty"
      >
        <span aria-hidden="true" className="pull-requests-placeholder__icon">
          <GitPullRequest
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </span>
        <h2 id="pull-requests-empty-title">拉取请求收件箱正在开发中</h2>
        <p>你仍然可以新建任务来检查、修改或评审当前工作区的代码。</p>
        <Link className="pull-requests-placeholder__action" to="/new">
          新建任务
        </Link>
      </section>
    </main>
  )
}

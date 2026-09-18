import type React from 'react'
import { GitPullRequest } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'

export function PullRequestsPlaceholder(): React.ReactNode {
  return (
    <PrimaryPageLayout
      bodyClassName="pull-requests-placeholder__body"
      className="pull-requests-placeholder"
      description="集中查看和处理当前工作区的拉取请求。"
      title="拉取请求"
    >
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
        <p>你仍然可以新建对话来检查、修改或评审当前工作区的代码。</p>
        <Link className="pull-requests-placeholder__action" to="/new">
          新建对话
        </Link>
      </section>
    </PrimaryPageLayout>
  )
}

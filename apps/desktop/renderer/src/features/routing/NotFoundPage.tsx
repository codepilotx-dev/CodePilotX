import type React from 'react'
import { Link } from 'react-router-dom'

export function NotFoundPage(): React.ReactNode {
  return (
    <main className="not-found-page">
      <span>404</span>
      <h1>这个页面不存在</h1>
      <p>旧版路由已经停止支持，请从新的工作区入口继续。</p>
      <Link to="/new">返回新建会话</Link>
    </main>
  )
}

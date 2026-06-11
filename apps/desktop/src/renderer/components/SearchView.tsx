import type React from 'react'
import { Search } from 'lucide-react'
import { useSearchContext } from '../context/SearchContext.js'
import { sessionDisplayTitle } from '../uiTypes.js'

export function SearchView(): React.ReactNode {
  const {
    query,
    workspaces,
    sessions,
    onQueryChange,
    onOpenWorkspace,
    onSelectSession,
  } = useSearchContext()

  return (
    <section className="utility-view">
      <div className="utility-view-header">
        <span className="section-label">搜索</span>
        <h1>查找项目与对话</h1>
        <p>搜索当前内存中的最近项目、会话名称和会话时间。</p>
      </div>
      <label className="search-input-row">
        <Search size={16} />
        <input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="搜索项目名、会话名或时间"
        />
      </label>
      <div className="utility-grid">
        <section className="utility-card">
          <h2>项目</h2>
          {workspaces.length === 0 ? (
            <p className="muted-copy">没有匹配的项目。</p>
          ) : (
            workspaces.map(workspace => (
              <button
                className="search-result-row"
                key={workspace.path}
                onClick={() => onOpenWorkspace(workspace)}
                type="button"
              >
                <span>{workspace.name}</span>
                <small>{workspace.branchName ?? '未检测到 Git 分支'}</small>
              </button>
            ))
          )}
        </section>
        <section className="utility-card">
          <h2>对话</h2>
          {sessions.length === 0 ? (
            <p className="muted-copy">没有匹配的对话。</p>
          ) : (
            sessions.map(session => (
              <button
                className="search-result-row"
                key={session.id}
                onClick={() => onSelectSession(session)}
                type="button"
              >
                <span>{sessionDisplayTitle(session)}</span>
                <small>
                  {session.workspaceName} · {session.createdAt}
                </small>
              </button>
            ))
          )}
        </section>
      </div>
    </section>
  )
}

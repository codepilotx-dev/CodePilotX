import type React from 'react'
import { Search } from 'lucide-react'
import { staticSearchResults } from '../fixtures'

export function StaticSearchView(): React.ReactNode {
  return (
    <section className="utility-view">
      <header className="utility-view-header">
        <h1>搜索</h1>
        <p>静态索引用于验证搜索页面布局。</p>
      </header>
      <label className="search-input-row">
        <Search size={18} />
        <input value="renderer static ui" readOnly aria-label="搜索" />
      </label>
      <div className="utility-grid">
        {staticSearchResults.map(result => (
          <button className="search-result-row" key={result.id} type="button">
            <span>{result.title}</span>
            <small>{result.path}</small>
            <small>{result.excerpt}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

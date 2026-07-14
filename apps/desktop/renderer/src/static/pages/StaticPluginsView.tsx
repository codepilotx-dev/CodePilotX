import type React from 'react'
import { Filter, MoreHorizontal, Search, Sparkles } from 'lucide-react'
import { staticPlugins } from '../fixtures'

export function StaticPluginsView(): React.ReactNode {
  return (
    <section className="plugins-view">
      <div className="plugins-toolbar">
        <div className="plugins-tabs">
          <button className="plugins-tab is-active" type="button">市场</button>
          <button className="plugins-tab" type="button">已安装</button>
        </div>
        <div className="plugins-actions">
          <button className="plugins-button" type="button" disabled><MoreHorizontal size={16} /></button>
        </div>
      </div>
      <header className="plugins-hero-header">
        <h1>插件</h1>
      </header>
      <div className="plugins-search-row">
        <label className="plugins-search">
          <Search size={17} />
          <input value="static ui" readOnly aria-label="搜索插件" />
        </label>
        <button className="plugins-filter" type="button" disabled><Filter size={15} />分类</button>
        <button className="plugins-button is-primary" type="button" disabled>安装</button>
      </div>
      <section className="plugins-hero">
        <div className="plugins-hero-content">
          <p className="plugins-hero-pill"><Sparkles size={16} />静态插件市场</p>
          <span className="plugins-hero-command">$ plugin install browser</span>
        </div>
      </section>
      <section className="plugins-section">
        <div className="plugins-section-header">
          <h2>精选</h2>
        </div>
        <div className="plugins-grid">
          {staticPlugins.map(plugin => (
            <article className="plugins-card" key={plugin.id}>
              <div className="plugins-card-header">
                <strong>{plugin.name}</strong>
                <span>{plugin.category}</span>
              </div>
              <p>{plugin.summary}</p>
              <button className="plugins-card-action" type="button" disabled>
                {plugin.enabled ? '已启用' : '启用'}
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

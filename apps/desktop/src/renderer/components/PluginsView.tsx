import type React from 'react'

export function PluginsView(): React.ReactNode {
  return (
    <section className="utility-view">
      <div className="utility-view-header">
        <span className="section-label">插件</span>
        <h1>插件中心</h1>
        <p>这里将承接桌面端插件的浏览、启用和配置。</p>
      </div>
      <div className="utility-card placeholder-card">
        <h2>暂未接入插件后端</h2>
        <p>后续可以展示已安装插件、推荐插件以及每个插件的权限范围。</p>
      </div>
    </section>
  )
}

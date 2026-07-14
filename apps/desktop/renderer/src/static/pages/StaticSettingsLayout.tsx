import type React from 'react'
import { useState } from 'react'
import { ChevronLeft, Search, Settings2 } from 'lucide-react'
import { staticSettingsSections } from '../fixtures'
import { useDesktopTheme } from '../../features/theme/themeContext'

export function StaticSettingsLayout(): React.ReactNode {
  const [active, setActive] = useState(staticSettingsSections[0])
  const theme = useDesktopTheme()

  return (
    <div className="settings-page">
      <div className="app-body">
        <aside className="desktop-sidebar settings-sidebar-layout" style={{ '--sidebar-current-width': '276px' } as React.CSSProperties}>
          <div className="sidebar-layout">
            <div className="settings-nav-scroll-area">
              <div className="settings-nav-scroll-content">
                <div className="settings-nav-header">
                  <button className="settings-back-btn" type="button"><ChevronLeft size={15} />返回</button>
                  <label className="settings-nav-search">
                    <Search className="settings-nav-search-icon" size={16} />
                    <input value="" placeholder="搜索设置" readOnly />
                  </label>
                </div>
                <nav className="settings-nav-menu" aria-label="设置导航">
                  <div className="settings-nav-group">
                    <div className="settings-nav-group-title-row">
                      <Settings2 className="settings-nav-icon" size={15} />
                      <h2 className="settings-nav-group-title">桌面</h2>
                      <span />
                    </div>
                    <div className="settings-nav-group-items">
                      {staticSettingsSections.map(section => (
                        <button
                          className={`settings-nav-item sidebar-row${active === section ? ' active' : ''}`}
                          key={section}
                          onClick={() => setActive(section)}
                          type="button"
                        >
                          <span className="sidebar-row-leading" />
                          <span className="sidebar-row-main">{section}</span>
                          <span className="sidebar-row-trailing" />
                        </button>
                      ))}
                    </div>
                  </div>
                </nav>
              </div>
            </div>
          </div>
        </aside>

        <main className="settings-content-scroll-area">
          <div className="settings-content-scroll-content">
            <div className="settings-content-inner">
              <header className="settings-page-header">
                <h1 className="settings-page-title">{active}</h1>
                <p className="settings-page-desc">静态设置页面用于验证源 UI 的布局、卡片、表单和导航状态。</p>
              </header>

              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-header-copy">
                    <h2 className="settings-section-title">外观</h2>
                    <p className="settings-section-desc">主题切换只影响本地 CSS data attribute。</p>
                  </div>
                  <div className="settings-section-header-actions">
                    <button className="plugins-button" type="button" onClick={() => theme.setMode(theme.mode === 'dark' ? 'light' : 'dark')}>
                      {theme.mode === 'dark' ? '浅色' : '深色'}
                    </button>
                  </div>
                </div>
                <div className="settings-card">
                  <StaticSettingsRow label="界面模式" value={theme.mode === 'dark' ? '深色' : '浅色'} />
                  <StaticSettingsRow label="字体" value="MiSans / system-ui" />
                  <StaticSettingsRow label="动效" value="标准" />
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <div className="settings-section-header-copy">
                    <h2 className="settings-section-title">连接</h2>
                    <p className="settings-section-desc">第一版静态 UI 不读取或保存任何凭据。</p>
                  </div>
                </div>
                <div className="settings-card">
                  <StaticSettingsRow label="默认模型" value="GPT-5.6 Sol" />
                  <StaticSettingsRow label="Provider" value="OpenAI Compatible" />
                  <StaticSettingsRow label="MCP" value="静态列表" />
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function StaticSettingsRow({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <h3 className="settings-row-title">{label}</h3>
        <p className="settings-row-desc">{value}</p>
      </div>
      <div className="settings-row-control">
        <button className="plugins-button" type="button" disabled>编辑</button>
      </div>
    </div>
  )
}

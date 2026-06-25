import type React from 'react'
import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { desktopClient } from '../services/desktopClient.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { APP_ICON_SIZE } from './ui/iconTokens.js'
import { SettingsSection } from './SettingsSection.js'

export function BrowserSettings(): React.ReactNode {
  const { browserAllowedSites, setBrowserAllowedSites } = useDesktopSettings()

  useEffect(() => {
    void desktopClient
      .getBrowserState()
      .then(state => setBrowserAllowedSites(state.allowedSites))
      .catch(() => undefined)
  }, [setBrowserAllowedSites])

  async function clearAllowedSites(): Promise<void> {
    const nextState = await desktopClient.clearBrowserAllowedSites()
    setBrowserAllowedSites(nextState.allowedSites)
  }

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">浏览器</h2>
        <p className="settings-page-desc">
          在桌面线程中预览本地开发页面、文件预览和无需登录的公开页面。需要登录态、扩展或已有标签页时，请使用常规浏览器。
        </p>

        <SettingsSection
          title="内置浏览器"
          description="浏览器内容在隔离的会话中运行，不继承你的常规浏览器 Cookie、扩展或登录状态。"
        >
          <div className="browser-settings-info">
            <span>支持 http、https 和 file URL。</span>
            <span>批注会先插入输入框，由你确认后再发送。</span>
            <span>本版不启用 Browser Use 或 Developer Mode。</span>
          </div>
        </SettingsSection>

        <SettingsSection
          title="允许的网站"
          description={
            browserAllowedSites.length
              ? `已记录 ${browserAllowedSites.length} 个浏览器预览来源。`
              : '暂无已记录的网站。'
          }
          actions={
            <button
              className="settings-button danger"
              disabled={browserAllowedSites.length === 0}
              type="button"
              onClick={() => void clearAllowedSites()}
            >
              <Trash2 size={APP_ICON_SIZE} />
              <span>清空</span>
            </button>
          }
        >
          {browserAllowedSites.length ? (
            <div className="browser-allowed-sites">
              {browserAllowedSites.map(site => (
                <span className="settings-chip" key={site}>
                  {site}
                </span>
              ))}
            </div>
          ) : (
            <p className="settings-empty-state">打开页面后会在这里记录来源。</p>
          )}
        </SettingsSection>
      </div>
    </div>
  )
}

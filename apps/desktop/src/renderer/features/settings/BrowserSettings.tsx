import type React from 'react'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { desktopClient } from '../../services/desktopClient.js'
import type { DesktopBrowserSitePermission } from '../../../shared/types.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js';

export function BrowserSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { browserAllowedSites, setBrowserAllowedSites, draft } = settings
  const [sitePermissions, setSitePermissions] = useState<
    DesktopBrowserSitePermission[]
  >([])

  useEffect(() => {
    void desktopClient
      .getBrowserState()
      .then(state => {
        setBrowserAllowedSites(state.allowedSites)
        setSitePermissions(state.sitePermissions)
      })
      .catch(() => undefined)
  }, [setBrowserAllowedSites])

  async function clearAllowedSites(): Promise<void> {
    const nextState = await desktopClient.clearBrowserAllowedSites()
    setBrowserAllowedSites(nextState.allowedSites)
    setSitePermissions(nextState.sitePermissions)
    draft.setValue('browserAllowedSites', nextState.allowedSites)
  }

  return (
    <SettingsContentArea className="">
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
            <span>Browser Use 通过插件页的 Browser 入口启用。</span>
            <span>Developer Mode 暂不可用。</span>
          </div>
        </SettingsSection>

        <SettingsSection
          title="站点权限"
          description={
            sitePermissions.length
              ? `已记录 ${sitePermissions.length} 个 Browser Use 站点权限。`
              : '暂无站点权限。'
          }
          actions={
            <button
              className="settings-button danger"
              disabled={sitePermissions.length === 0 && browserAllowedSites.length === 0}
              type="button"
              onClick={() => void clearAllowedSites()}
            >
              <Trash2 size={APP_ICON_SIZE} />
              <span>清空</span>
            </button>
          }
        >
          {sitePermissions.length ? (
            <div className="browser-allowed-sites">
              {sitePermissions.map(site => (
                <span className="settings-chip" key={site.origin}>
                  {site.origin} · {site.decision === 'allow' ? '允许' : '拒绝'}
                </span>
              ))}
            </div>
          ) : (
            <p className="settings-empty-state">Browser Use 请求站点后会在这里记录权限。</p>
          )}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

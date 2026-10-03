import type React from 'react'
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { desktopBrowserClient } from '../../services/desktop-client/desktop-browser-client.js'
import type { DesktopBrowserSitePermission } from '../../../shared/types.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'

export function BrowserSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { browserAllowedSites, setBrowserAllowedSites, draft } = settings
  const [sitePermissions, setSitePermissions] = useState<DesktopBrowserSitePermission[]>([])

  useEffect(() => {
    if (!desktopBrowserClient.available) return
    void desktopBrowserClient
      .getBrowserState()
      .then((state) => {
        setBrowserAllowedSites(state.allowedSites)
        setSitePermissions(state.sitePermissions)
      })
      .catch(() => undefined)
  }, [setBrowserAllowedSites])

  async function clearAllowedSites(): Promise<void> {
    const nextState = await desktopBrowserClient.clearBrowserAllowedSites()
    setBrowserAllowedSites(nextState.allowedSites)
    setSitePermissions(nextState.sitePermissions)
    draft.setValue('browserAllowedSites', nextState.allowedSites)
    draft.setValue('browserSitePermissions', nextState.sitePermissions)
  }

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">浏览器</h2>
          <p className="settings-page-desc">
            在工作台管理多个网页，并让 Agent 在后台完成常用浏览器操作。
          </p>
        </div>

        <SettingsSection
          title="内置浏览器"
          description="浏览器内容在隔离的会话中运行，保留内置浏览器登录状态，不继承常规浏览器的 Cookie 或扩展。"
        >
          <div className="browser-settings-info">
            <span>支持 HTTP 和 HTTPS URL；本地文件继续使用文件预览。</span>
            <span>批注会先插入输入框，由你确认后再发送。</span>
            <span>Agent 使用浏览器前需获得站点授权；人工标签可在工具栏交给当前聊天。</span>
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
            <Button
              color="danger"
              disabled={sitePermissions.length === 0 && browserAllowedSites.length === 0}
              type="button"
              onClick={() => void clearAllowedSites()}
            >
              <Trash2 size={APP_ICON_SIZE} />
              <span>清空</span>
            </Button>
          }
        >
          {sitePermissions.length ? (
            <div className="browser-allowed-sites">
              {sitePermissions.map((site) => (
                <span className="settings-chip" key={site.origin}>
                  {site.origin} · {site.decision === 'allow' ? '允许' : '拒绝'}
                  <Button
                    color="secondary"
                    onClick={() =>
                      void desktopBrowserClient
                        .setPermission(site.origin, 'remove')
                        .then(setSitePermissions)
                    }
                  >
                    撤销
                  </Button>
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

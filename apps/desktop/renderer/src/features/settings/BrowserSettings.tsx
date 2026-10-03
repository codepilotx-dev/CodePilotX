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
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'

export function BrowserSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const { browserAllowedSites, setBrowserAllowedSites, draft } = settings
  const [sitePermissions, setSitePermissions] = useState<DesktopBrowserSitePermission[]>([])
  const [downloadMode, setDownloadMode] = useState<'downloads' | 'ask'>('downloads')
  const [downloadLoaded, setDownloadLoaded] = useState(false)
  const [downloadSaving, setDownloadSaving] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => {
    if (!desktopBrowserClient.available) return
    let disposed = false
    void desktopBrowserClient
      .data({ action: 'preferences' })
      .then((result) => {
        if (disposed) return
        if (result.preferences) {
          setDownloadMode(result.preferences.downloadSaveMode)
          setDownloadLoaded(true)
        }
      })
      .catch(() => {
        if (!disposed) setDownloadError('下载设置暂时不可用')
      })
    return () => {
      disposed = true
    }
  }, [])
  async function saveDownloadMode(ask: boolean): Promise<void> {
    setDownloadSaving(true)
    setDownloadError('')
    try {
      const result = await desktopBrowserClient.data({
        action: 'preferences',
        downloadSaveMode: ask ? 'ask' : 'downloads',
      })
      if (result.preferences) setDownloadMode(result.preferences.downloadSaveMode)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '下载设置未保存')
    } finally {
      setDownloadSaving(false)
    }
  }

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
            <span>在 AI 对话中指定网页即可让 Agent 接管标签；首次使用站点仍需授权。</span>
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
        <SettingsSection title="下载" description="默认保存到系统下载目录，重名文件自动编号。">
          <SettingsRow
            title="每次询问保存位置"
            description="开启后使用系统另存为窗口。"
            control={
              <ToggleSwitch
                ariaLabel="每次询问保存位置"
                checked={downloadMode === 'ask'}
                disabled={!downloadLoaded || downloadSaving}
                onChange={(ask) => void saveDownloadMode(ask)}
              />
            }
          />
          {downloadError ? <p role="status">{downloadError}</p> : null}
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

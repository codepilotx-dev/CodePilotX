import React, { useEffect, useState } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { APP_ICON_SIZE } from './ui/iconTokens.js'
import { desktopClient } from '../services/desktopClient.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { PERMISSION_MODE_OPTIONS } from '../features/settings/settingsStorage.js'
import type {
  DesktopRuntimeStatus,
  DesktopSandboxMode,
} from '../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { ToggleSwitch } from './ToggleSwitch.js'

const SANDBOX_MODE_OPTIONS: Array<{
  value: DesktopSandboxMode
  label: string
}> = [
  { value: 'read-only', label: '只读' },
  { value: 'workspace-write', label: '工作区写入' },
  { value: 'full-access', label: '完全访问' },
  { value: 'danger-full-access', label: '危险完全访问' },
]

function LearnMoreLink() {
  return (
    <a
      className="settings-row-link"
      href="#"
      onClick={event => event.preventDefault()}
    >
      了解更多
    </a>
  )
}

function extractVersionLabel(status: DesktopRuntimeStatus | null): string {
  if (!status) return '—'
  const executable = status.agentExecutablePath
  const versionMatch = /codex[-_]([0-9][\w.\-]+)/i.exec(executable)
  if (versionMatch) return versionMatch[1] ?? '—'
  return '—'
}

export function ConfigSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(
    null,
  )
  const [openingConfig, setOpeningConfig] = useState(false)

  useEffect(() => {
    let mounted = true
    void desktopClient
      .getRuntimeStatus()
      .then(status => {
        if (mounted) setRuntimeStatus(status)
      })
      .catch(() => {
        if (mounted) setRuntimeStatus(null)
      })
    return () => {
      mounted = false
    }
  }, [])

  const handleOpenConfigFile = async (): Promise<void> => {
    if (openingConfig) return
    setOpeningConfig(true)
    try {
      await desktopClient.openConfigFile()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`无法打开 config.toml：${message}`)
    } finally {
      setOpeningConfig(false)
    }
  }

  const handleDiagnose = (): void => {
    window.alert('诊断已记录（占位）。')
  }

  const handleReinstall = (): void => {
    const confirmed = window.confirm(
      '将删除本地捆绑包并重新下载。确认继续吗？',
    )
    if (!confirmed) return
    window.alert('重置并重新安装（占位）。')
  }

  const versionLabel = extractVersionLabel(runtimeStatus)

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">配置</h2>
        <p className="settings-page-desc">
          配置审批策略和沙盒设置。
          <LearnMoreLink />
        </p>

        <SettingsSection
          title="自定义 config.toml 设置"
          actions={
            <div className="settings-inline-actions">
              <SettingsDropdown
                value="user"
                ariaLabel="用户配置"
                options={[{ value: 'user', label: '用户配置' }]}
                onChange={() => {}}
              />
              <button
                className="settings-button"
                disabled={openingConfig}
                onClick={() => void handleOpenConfigFile()}
                type="button"
              >
                <Search size={APP_ICON_SIZE} />
                打开 config.toml
              </button>
            </div>
          }
        >
          <SettingsRow
            title="批准策略"
            description="选择 Codex 何时请求批准"
            control={
              <SettingsDropdown
                ariaLabel="批准策略"
                value={settings.permissionMode}
                options={PERMISSION_MODE_OPTIONS.map(option => ({
                  value: option.value,
                  label: option.label,
                  detail: option.detail,
                }))}
                onChange={value =>
                  settings.setPermissionMode(
                    value as typeof settings.permissionMode,
                  )
                }
              />
            }
          />
          <SettingsRow
            title="沙盒设置"
            description="选择 Codex 的命令执行权限"
            control={
              <SettingsDropdown
                ariaLabel="沙盒设置"
                value={settings.sandboxMode}
                options={SANDBOX_MODE_OPTIONS}
                onChange={value =>
                  settings.setSandboxMode(value as DesktopSandboxMode)
                }
              />
            }
          />
          <SettingsRow
            title="允许网络访问"
            description="当沙盒设置为工作区写入时允许网络访问"
            control={
              <ToggleSwitch
                ariaLabel="允许网络访问"
                checked={settings.allowNetworkAccess}
                onChange={settings.setAllowNetworkAccess}
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="工作空间依赖项">
          <SettingsRow
            title="当前版本"
            control={
              <span className="settings-row-status settings-version-value">
                {versionLabel}
              </span>
            }
          />
          <SettingsRow
            title="Codex 依赖项"
            description="允许 Codex 安装并提供随附的 Node.js 和 Python 工具"
            control={
              <ToggleSwitch
                ariaLabel="Codex 依赖项"
                checked={settings.installCodexDependencies}
                onChange={settings.setInstallCodexDependencies}
              />
            }
          />
          <SettingsRow
            title="诊断 Codex 工作空间中的问题"
            description="检查当前捆绑包并记录诊断日志"
            control={
              <button
                className="settings-button"
                onClick={handleDiagnose}
                type="button"
              >
                <Search size={APP_ICON_SIZE} />
                诊断
              </button>
            }
          />
          <SettingsRow
            title="重置并安装工作空间"
            description="删除本地捆绑包，重新下载后重新加载工具"
            control={
              <button
                className="settings-button"
                onClick={handleReinstall}
                type="button"
              >
                <RotateCcw size={APP_ICON_SIZE} />
                重新安装
              </button>
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}
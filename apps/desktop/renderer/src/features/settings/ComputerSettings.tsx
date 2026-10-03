import type React from 'react'
import { Trash2 } from 'lucide-react'
import { useComputerSettings } from './useComputerSettings.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { SettingsSection } from './SettingsSection.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Button } from '../../components/ui/Button.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'

export function ComputerSettings(): React.ReactNode {
  const { state, busy, error, applications, sessionAppCount, update, discover, clear } = useComputerSettings()

  return (
    <SettingsContentArea className="">
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">电脑控制</h2>
          <p className="settings-page-desc">
            让 Agent 读取已运行应用的界面并执行点击、输入和滚动。默认关闭，且始终按应用单独授权。
          </p>
        </div>

        <SettingsSection
          title="电脑控制"
          description="开启后 Agent 才能发现应用。首次读取或操作需要应用授权，截图会进入聊天，必要时可能切到前台。完全访问（never）不会弹出授权框，请在下方手动授权，或在聊天权限中切换到允许询问的模式。"
        >
          <SettingsRow
            title="启用电脑控制"
            description={
              !state.enabled
                ? '开启后自动启动 Windows 原生运行时。'
                : state.available
                ? 'Windows 原生运行时已就绪。'
                : 'Windows 原生运行时正在启动；若持续未就绪，请检查构建产物或重启桌面应用。'
            }
            control={
              <ToggleSwitch
                ariaLabel="启用电脑控制"
                checked={state.enabled}
                disabled={busy}
                onChange={(enabled) => void update({ enabled })}
              />
            }
          />
          {state.enabled && !state.available ? (
            <p role="status">原生运行时未就绪，应用发现与控制暂不可用。</p>
          ) : null}
          {error ? <p role="status">{error}</p> : null}
        </SettingsSection>

        <SettingsSection
          title="应用授权"
          description={
            state.permissions.length
              ? `已记录 ${state.permissions.length} 个应用。${
                  sessionAppCount ? `其中 ${sessionAppCount} 个只在当前聊天有效。` : ''
                }`
              : '点击发现已运行应用，然后选择始终允许或始终拒绝。发现只读取应用识别信息。'
          }
          actions={
            <>
            <Button
              color="secondary"
              disabled={busy || !state.enabled || !state.available || state.ownerTurnId !== null}
              onClick={() => void discover()}
            >发现已运行应用</Button>
            <Button
              color="danger"
              disabled={busy || state.permissions.length === 0}
              type="button"
              onClick={() => void clear()}
            >
              <Trash2 size={APP_ICON_SIZE} />
              <span>清空</span>
            </Button>
            </>
          }
        >
          {applications.size ? (
            <div className="browser-allowed-sites">
              {[...applications.values()].map((permission) => (
                <span className="settings-chip" key={permission.appId}>
                  {permission.name} ·{' '}
                  {permission.decision === 'allow'
                    ? '始终允许'
                    : permission.decision === 'deny'
                      ? '始终拒绝'
                      : state.permissions.some((entry) => entry.appId === permission.appId)
                        ? '仅本次聊天'
                        : '尚未授权'}
                  <Button
                    color="secondary"
                    disabled={busy || permission.decision === 'allow'}
                    onClick={() => void update({ appId: permission.appId, decision: 'allow' })}
                  >
                    始终允许
                  </Button>
                  <Button
                    color="secondary"
                    disabled={busy || permission.decision === 'deny'}
                    onClick={() => void update({ appId: permission.appId, decision: 'deny' })}
                  >
                    始终拒绝
                  </Button>
                  <Button
                    color="secondary"
                    disabled={busy || !state.permissions.some((entry) => entry.appId === permission.appId)}
                    onClick={() => void update({ appId: permission.appId, decision: 'remove' })}
                  >
                    撤销
                  </Button>
                </span>
              ))}
            </div>
          ) : (
            <p className="settings-empty-state">先开启电脑控制，再发现已运行应用以手动授权。</p>
          )}
        </SettingsSection>

        <SettingsSection
          title="控制范围"
          description="首版只控制已运行的应用：不启动应用、不截取整个桌面、不录屏、不读写剪贴板。"
        >
          <p className="settings-empty-state">
            操作默认在后台进行；只有后台明确不可用时才短暂切到前台。同一时间只有一个聊天能控制电脑。
          </p>
        </SettingsSection>
      </div>
    </SettingsContentArea>
  )
}

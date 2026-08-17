import React, { useEffect, useMemo, useState } from 'react'
import { FolderOpen, PackagePlus, Power, ShieldAlert, Trash2 } from 'lucide-react'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { Button } from '../../../components/ui/Button.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'

/**
 * H2 人工确认的信任文案：插件是完全受信任的本机代码，不是安全沙箱。
 * 展示于：安装前、enable 前、digest 变化后、System Profile 应用前。
 */
export const PLUGIN_TRUST_NOTICE =
  '此插件是完全受信任的本机代码，可使用当前 Windows 用户权限访问文件、网络和进程。独立进程只提供故障隔离，不是安全沙箱。'

type PluginSummary = RpcResult<'plugin/list'>['plugins'][number]

export function InstalledPluginsSection({
  onError,
  onNotice,
}: {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}): React.ReactNode {
  const [plugins, setPlugins] = useState<PluginSummary[] | undefined>()
  const [developerMode, setDeveloperMode] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [pendingUninstall, setPendingUninstall] = useState<PluginSummary | null>(null)
  const [trustDialog, setTrustDialog] = useState<PluginSummary | null>(null)
  const [applyProfileDialog, setApplyProfileDialog] = useState<PluginSummary | null>(null)

  const load = async () => {
    try {
      const [list, config] = await Promise.all([
        desktopClient.listPlugins(),
        desktopClient.readConfig({ includeLayers: false }),
      ])
      const pluginsSection = (config.config.plugins ?? {}) as Record<string, unknown>
      setPlugins([...list.plugins])
      setDeveloperMode(pluginsSection.developerMode === true)
    } catch (error) {
      setPlugins([])
      onError(error instanceof Error ? error.message : '插件列表读取失败。')
    }
  }

  useEffect(() => {
    void load()
    const unsubscribe = desktopClient.subscribeAgentEventEnvelopes({
      liveEventTypes: AGENT_LIVE_EVENT_FILTERS.plugins,
    }, async events => {
      if (events.length > 0) await load()
    })
    return () => unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setBusyFor = (key: string, value: boolean) => {
    setBusy(current => ({ ...current, [key]: value }))
  }

  const toggleDeveloperMode = async (enabled: boolean) => {
    setDeveloperMode(enabled)
    try {
      await desktopClient.writeConfigBatch({
        edits: [{ keyPath: ['plugins', 'developerMode'], value: enabled }],
      })
      onNotice?.(enabled ? '已开启 Developer Mode。' : '已关闭 Developer Mode。')
    } catch (error) {
      setDeveloperMode(!enabled)
      onError(error instanceof Error ? error.message : 'Developer Mode 更新失败。')
    }
  }

  const installPackage = async () => {
    if (typeof window === 'undefined' || !window.codePilotXDesktop?.pickPluginPackageFile) {
      onError('当前运行环境不支持选择插件包文件。')
      return
    }
    setBusyFor('install', true)
    try {
      const pick = await window.codePilotXDesktop.pickPluginPackageFile()
      if (pick.canceled || !pick.path) return
      const result = await desktopClient.installPluginPackage({
        packagePath: pick.path,
        operationId: crypto.randomUUID(),
      })
      onNotice?.(`插件 ${result.pluginId} 已安装（未启用）。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '插件安装失败。')
    } finally {
      setBusyFor('install', false)
    }
  }

  const linkDirectory = async () => {
    if (typeof window === 'undefined' || !window.codePilotXDesktop?.pickPluginDirectory) {
      onError('当前运行环境不支持选择目录。')
      return
    }
    setBusyFor('link', true)
    try {
      const pick = await window.codePilotXDesktop.pickPluginDirectory()
      if (pick.canceled || !pick.path) return
      const result = await desktopClient.linkPluginDirectory({
        directoryPath: pick.path,
        operationId: crypto.randomUUID(),
      })
      onNotice?.(`插件 ${result.pluginId} 已链接（未启用）。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '开发目录链接失败。')
    } finally {
      setBusyFor('link', false)
    }
  }

  const togglePlugin = async (plugin: PluginSummary, enabled: boolean) => {
    const key = `toggle:${plugin.pluginId}`
    setBusyFor(key, true)
    try {
      if (enabled && !pluginTrusted(plugin)) {
        // digest 变化后必须先确认信任（信任文案 + 权限确认）。
        setTrustDialog(plugin)
        return
      }
      if (enabled) {
        await desktopClient.enablePlugin({
          pluginId: plugin.pluginId,
          scope: 'global',
          operationId: crypto.randomUUID(),
        })
      } else {
        await desktopClient.disablePlugin({
          pluginId: plugin.pluginId,
          scope: 'global',
          operationId: crypto.randomUUID(),
          force: false,
        })
      }
      onNotice?.(`${plugin.displayName} 已${enabled ? '启用' : '禁用'}。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : `${plugin.displayName} 状态更新失败。`)
    } finally {
      setBusyFor(key, false)
    }
  }

  const confirmTrust = async () => {
    if (!trustDialog) return
    const plugin = trustDialog
    setTrustDialog(null)
    const key = `trust:${plugin.pluginId}`
    setBusyFor(key, true)
    try {
      await desktopClient.updatePluginGrants({
        pluginId: plugin.pluginId,
        grants: [{ permissionId: '__digest__', granted: true }],
        operationId: crypto.randomUUID(),
      })
      await desktopClient.enablePlugin({
        pluginId: plugin.pluginId,
        scope: 'global',
        operationId: crypto.randomUUID(),
      })
      onNotice?.(`${plugin.displayName} 已确认信任并启用。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '信任确认失败。')
    } finally {
      setBusyFor(key, false)
    }
  }

  const uninstall = async () => {
    if (!pendingUninstall) return
    const plugin = pendingUninstall
    setPendingUninstall(null)
    const key = `uninstall:${plugin.pluginId}`
    setBusyFor(key, true)
    try {
      await desktopClient.uninstallPlugin({
        pluginId: plugin.pluginId,
        operationId: crypto.randomUUID(),
      })
      onNotice?.(`${plugin.displayName} 已卸载（配置、KV 与凭据保留）。`)
    } catch (error) {
      onError(error instanceof Error ? error.message : '插件卸载失败。')
    } finally {
      setBusyFor(key, false)
    }
  }

  const applySystemProfile = async () => {
    if (!applyProfileDialog) return
    const plugin = applyProfileDialog
    setApplyProfileDialog(null)
    const key = `profile:${plugin.pluginId}`
    setBusyFor(key, true)
    try {
      const staged = await desktopClient.profileStagePlugin({
        pluginId: plugin.pluginId,
        config: {},
        operationId: crypto.randomUUID(),
      })
      await desktopClient.profileApplyOnRestart({
        generationId: staged.generationId,
        operationId: crypto.randomUUID(),
      })
      if (typeof window !== 'undefined' && window.codePilotXDesktop?.restartApp) {
        await window.codePilotXDesktop.restartApp()
        return
      }
      onNotice?.('System Profile 已排定，重启后生效。')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'System Profile 应用失败。')
    } finally {
      setBusyFor(key, false)
    }
  }

  const rows = useMemo(() => plugins ?? [], [plugins])

  return (
    <section aria-label="已安装插件" className="tw:mt-6 tw:grid tw:gap-3">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <div className="tw:grid tw:gap-1">
          <h3 className="tw:m-0 tw:text-sm tw:font-[var(--font-weight-label)] tw:text-app-text">已安装插件</h3>
          <p className="tw:m-0 tw:text-xs tw:text-app-text-soft">
            {developerMode
              ? 'Developer Mode 已开启：可以启用 process/System 插件。'
              : 'Developer Mode 默认关闭：process/System 插件需要先开启。'}
          </p>
        </div>
        <div className="tw:flex tw:items-center tw:gap-4">
          <label className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-app-text">
            <ToggleSwitch
              ariaLabel="Developer Mode"
              checked={developerMode}
              onChange={value => void toggleDeveloperMode(value)}
            />
            Developer Mode
          </label>
          <div className="tw:flex tw:items-center tw:gap-2">
            <Button color="secondary" disabled={busy.link} loading={busy.link} onClick={() => void linkDirectory()}>
              <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              链接开发目录
            </Button>
            <Button color="primary" disabled={busy.install} loading={busy.install} onClick={() => void installPackage()}>
              <PackagePlus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              安装插件包
            </Button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="tw:grid tw:min-h-32 tw:place-items-center tw:rounded-md tw:border tw:border-dashed tw:border-app-border tw:px-6 tw:text-center tw:text-sm tw:text-app-text-soft">
          尚未安装插件。安装前请确认：{PLUGIN_TRUST_NOTICE}
        </div>
      ) : (
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1 tw:p-0">
          {rows.map(plugin => (
            <li
              className="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-md tw:border tw:border-app-border tw:bg-app-panel tw:px-3 tw:py-2.5"
              key={plugin.pluginId}
            >
              <div className="tw:min-w-0 tw:grid tw:gap-0.5">
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <span className="tw:truncate tw:text-sm tw:font-[var(--font-weight-label)] tw:text-app-text">{plugin.displayName}</span>
                  <span className="tw:text-xs tw:text-app-text-soft">v{plugin.version}</span>
                  <span className="tw:text-xs tw:text-app-text-soft">{plugin.publisher}</span>
                </div>
                <p className="tw:m-0 tw:truncate tw:text-xs tw:text-app-text-soft">
                  {plugin.description} · {plugin.runtimeKind} · {plugin.runtimeStatus}
                  {plugin.source === 'linked-directory' ? ' · 开发目录' : ''}
                </p>
                {!pluginTrusted(plugin) ? (
                  <p className="tw:m-0 tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-[color:var(--color-warning)]">
                    <ShieldAlert aria-hidden="true" size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    当前 digest 未确认信任，启用前需要确认。
                  </p>
                ) : null}
              </div>
              <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                {plugin.tier === 'system' ? (
                  <Button
                    color="secondary"
                    disabled={Boolean(busy[`profile:${plugin.pluginId}`])}
                    loading={Boolean(busy[`profile:${plugin.pluginId}`])}
                    title="应用为自定义运行时 Profile（重启生效）"
                    onClick={() => setApplyProfileDialog(plugin)}
                  >
                    <Power aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    应用为 Profile
                  </Button>
                ) : null}
                <Button
                  color="danger"
                  aria-label={`卸载 ${plugin.displayName}`}
                  disabled={Boolean(busy[`uninstall:${plugin.pluginId}`])}
                  title="卸载（保留配置、KV 与凭据）"
                  onClick={() => setPendingUninstall(plugin)}
                >
                  <Trash2 aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </Button>
                <ToggleSwitch
                  ariaLabel={`${plugin.displayName} 启用状态`}
                  checked={plugin.enabledGlobal}
                  disabled={Boolean(busy[`toggle:${plugin.pluginId}`])}
                  onChange={enabled => void togglePlugin(plugin, enabled)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={Boolean(trustDialog)}
        title="确认信任此插件？"
        description={trustDialog ? PLUGIN_TRUST_NOTICE : undefined}
        actionLabel="确认信任并启用"
        tone="danger"
        onCancel={() => setTrustDialog(null)}
        onAction={() => void confirmTrust()}
      />

      <ConfirmationDialog
        open={Boolean(applyProfileDialog)}
        title={`应用 ${applyProfileDialog?.displayName ?? ''} 为自定义运行时 Profile？`}
        description={
          applyProfileDialog
            ? 'System Profile 插件在 Agent 进程内运行，可以替换权限、模型、Agent Loop 与持久化等业务服务并改变默认安全语义。应用后将重启应用并持续显示“自定义运行时 Profile”。' + PLUGIN_TRUST_NOTICE
            : undefined
        }
        actionLabel="应用并重启"
        tone="danger"
        onCancel={() => setApplyProfileDialog(null)}
        onAction={() => void applySystemProfile()}
      />

      <ConfirmationDialog
        open={Boolean(pendingUninstall)}
        title={`卸载 ${pendingUninstall?.displayName ?? ''}？`}
        description="将删除插件包文件与启用状态；配置、KV 与凭据数据会保留。"
        actionLabel="卸载"
        tone="danger"
        onCancel={() => setPendingUninstall(null)}
        onAction={() => void uninstall()}
      />
    </section>
  )
}

function pluginTrusted(plugin: PluginSummary): boolean {
  return plugin.trustedDigest === true || plugin.runtimeStatus === 'active'
}

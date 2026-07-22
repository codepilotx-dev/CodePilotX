import React from 'react'
import { Download, RotateCcw } from 'lucide-react'
import type {
  ToolingID,
  ToolingPreference,
  ToolingStatus,
} from '@codepilotx/agent-protocol'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { Button } from '../../components/ui/Button.js'
import { desktopClient } from '../../services/desktopClient.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

type Props = {
  onError: (message: string) => void
  onNotice?: (message: string) => void
}

const TOOL_LABELS: Record<ToolingID, string> = {
  'git-bash': 'Git Bash',
  ripgrep: 'ripgrep',
}

const PHASE_LABELS: Record<ToolingStatus['phase'], string> = {
  idle: '未安装',
  detecting: '正在检测',
  downloading: '正在下载',
  installing: '正在安装',
  ready: '可用',
  error: '失败',
  'cleanup-pending': '等待清理',
}

const SOURCE_OPTIONS = [
  {
    value: 'managed',
    label: 'CodePilotX 托管版',
    detail: '首次使用时下载固定版本，由 CodePilotX 管理',
  },
  {
    value: 'system',
    label: '本机版',
    detail: '仅使用本机已安装并通过校验的工具',
  },
]

export function ToolingSettings({ onError, onNotice }: Props): React.ReactNode {
  const [statuses, setStatuses] = React.useState<readonly ToolingStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busyTool, setBusyTool] = React.useState<ToolingID | null>(null)

  const replaceStatus = React.useCallback((next: ToolingStatus): void => {
    setStatuses(current => {
      const existing = current.findIndex(status => status.id === next.id)
      if (existing < 0) return [...current, next]
      const copy = [...current]
      copy[existing] = next
      return copy
    })
  }, [])

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      setStatuses(await desktopClient.listTooling())
    } catch (error) {
      onError(errorMessage(error, '无法读取工具链状态。'))
    } finally {
      setLoading(false)
    }
  }, [onError])

  React.useEffect(() => {
    let active = true
    void desktopClient.listTooling()
      .then(next => {
        if (active) setStatuses(next)
      })
      .catch(error => {
        if (active) onError(errorMessage(error, '无法读取工具链状态。'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = desktopClient.onToolingUpdated(status => {
      if (active) replaceStatus(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [onError, replaceStatus])

  const changePreference = async (
    status: ToolingStatus,
    preference: ToolingPreference,
  ): Promise<void> => {
    if (preference === status.preference || busyTool) return
    if (
      preference === 'system' &&
      status.managed.installed &&
      !window.confirm(
        `切换到本机版会删除 CodePilotX 托管的 ${TOOL_LABELS[status.id]}。确认继续吗？`,
      )
    ) {
      return
    }
    setBusyTool(status.id)
    try {
      replaceStatus(await desktopClient.setToolingPreference(status.id, preference))
      onNotice?.(`${TOOL_LABELS[status.id]} 已切换为${preference === 'managed' ? '托管版' : '本机版'}。`)
    } catch (error) {
      onError(errorMessage(error, `无法切换 ${TOOL_LABELS[status.id]} 来源。`))
      await refresh()
    } finally {
      setBusyTool(null)
    }
  }

  const install = async (status: ToolingStatus): Promise<void> => {
    if (busyTool) return
    setBusyTool(status.id)
    try {
      replaceStatus(await desktopClient.installTooling(status.id, status.managed.installed))
      onNotice?.(`${TOOL_LABELS[status.id]} 托管版已安装。`)
    } catch (error) {
      onError(errorMessage(error, `${TOOL_LABELS[status.id]} 安装失败。`))
      await refresh()
    } finally {
      setBusyTool(null)
    }
  }

  return (
    <SettingsContentArea>
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">工具链</h2>
          <p className="settings-page-desc">
            分别选择 Git Bash 和 ripgrep 的运行来源。托管版只在首次使用或主动安装时下载，不会自动检查更新。
          </p>
        </div>

        {loading ? <p className="settings-page-desc">正在读取工具链状态…</p> : null}
        {statuses.map(status => (
          <ToolingSection
            busy={busyTool === status.id}
            key={status.id}
            onInstall={() => void install(status)}
            onPreferenceChange={preference => void changePreference(status, preference)}
            status={status}
          />
        ))}
      </div>
    </SettingsContentArea>
  )
}

function ToolingSection({
  busy,
  onInstall,
  onPreferenceChange,
  status,
}: {
  busy: boolean
  onInstall: () => void
  onPreferenceChange: (preference: ToolingPreference) => void
  status: ToolingStatus
}): React.ReactNode {
  const installing = status.phase === 'downloading' || status.phase === 'installing'
  const activeLabel = status.activeSource === 'managed'
    ? 'CodePilotX 托管版'
    : status.activeSource === 'system'
      ? '本机版'
      : '当前不可用'

  return (
    <SettingsSection
      title={TOOL_LABELS[status.id]}
      description={status.id === 'git-bash'
        ? '用于执行 Bash 命令，仅识别 Git for Windows 的 Git Bash。'
        : '用于 Glob 和 Grep 文件搜索。'}
    >
      <SettingsRow
        title="工具来源"
        description={status.preference === 'system' && !status.system.available
          ? '未检测到有效的本机工具；当前不会回退到托管版。'
          : 'Git Bash 与 ripgrep 的来源可以独立设置。'}
        control={
          <SettingsDropdown
            ariaLabel={`${TOOL_LABELS[status.id]} 工具来源`}
            onChange={value => {
              if (!busy) onPreferenceChange(value as ToolingPreference)
            }}
            options={SOURCE_OPTIONS}
            value={status.preference}
            width={260}
          />
        }
      />
      <SettingsRow
        title="当前状态"
        description={status.error?.message ?? progressDescription(status)}
        control={<span className="settings-row-status">{PHASE_LABELS[status.phase]}</span>}
      />
      <SettingsRow
        title="实际来源"
        description={resolvedPath(status)}
        control={<span className="settings-row-status">{activeLabel}</span>}
      />
      <SettingsRow
        title="版本"
        description={`固定版本：${status.pinnedVersion}；托管版：${status.managed.version ?? '未安装'}；本机版：${status.system.version ?? '未检测到'}`}
      />
      {status.preference === 'managed' ? (
        <SettingsRow
          title={status.managed.installed ? '重新安装托管版' : '安装托管版'}
          description={status.managed.installed
            ? '重新下载并校验固定版本；失败时保留当前有效安装。'
            : '从官方发布源下载代码内固定的版本。'}
          control={
            <Button disabled={busy || installing} onClick={onInstall} type="button">
              {status.managed.installed
                ? <RotateCcw size={APP_ICON_SIZE} />
                : <Download size={APP_ICON_SIZE} />}
              {installing ? '处理中…' : status.managed.installed ? '重新安装' : '安装托管版'}
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  )
}

function progressDescription(status: ToolingStatus): string {
  const progress = status.progress
  if (!progress) {
    if (status.phase === 'cleanup-pending') return '文件正在使用，CodePilotX 会在下次启动时继续清理。'
    return status.phase === 'idle' ? '尚未解析可用工具。' : '工具状态已更新。'
  }
  const received = formatBytes(progress.receivedBytes)
  return progress.totalBytes === undefined
    ? `已下载 ${received}`
    : `已下载 ${received} / ${formatBytes(progress.totalBytes)}`
}

function resolvedPath(status: ToolingStatus): string {
  if (status.activeSource === 'system') return status.system.path ?? '本机路径不可用'
  if (status.activeSource === 'managed') return `~/.codepilotx/tooling/${status.id}/${status.managed.version ?? status.pinnedVersion}`
  return '没有可执行文件路径'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

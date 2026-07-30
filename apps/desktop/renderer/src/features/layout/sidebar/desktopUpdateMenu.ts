import type {
  DesktopUpdateIpcBridge,
  DesktopUpdateStatus,
} from '@codepilotx/shared/desktop-update-ipc'

export type DesktopUpdateMenuModel = {
  action: 'check' | 'download' | 'quit-and-install'
  disabled: boolean
  icon: 'download' | 'refresh'
  label: string
}

export function startDesktopUpdateMonitoring(
  bridge: DesktopUpdateIpcBridge,
  listener: (status: DesktopUpdateStatus) => void,
): () => void {
  const unsubscribe = bridge.onUpdateStatusChange(listener)
  void bridge.checkForUpdates().catch(() => {
    listener({
      phase: 'error',
      message: '检查更新失败，请稍后重试',
    })
  })
  return unsubscribe
}

export function buildDesktopUpdateMenuModel(
  status: DesktopUpdateStatus | null,
): DesktopUpdateMenuModel {
  switch (status?.phase) {
    case 'available':
      return {
        action: 'download',
        disabled: false,
        icon: 'download',
        label: `下载 v${status.version}`,
      }
    case 'downloading':
      return {
        action: 'download',
        disabled: true,
        icon: 'download',
        label: `下载中 ${Math.round(status.percent)}%`,
      }
    case 'downloaded':
      return {
        action: 'quit-and-install',
        disabled: false,
        icon: 'download',
        label: '重启安装',
      }
    case 'checking':
      return {
        action: 'check',
        disabled: true,
        icon: 'refresh',
        label: '正在检查更新',
      }
    default:
      return {
        action: 'check',
        disabled: false,
        icon: 'refresh',
        label: '检查更新',
      }
  }
}

export async function runDesktopUpdateMenuAction(
  bridge: DesktopUpdateIpcBridge,
  action: DesktopUpdateMenuModel['action'],
): Promise<void> {
  if (action === 'download') {
    await bridge.downloadUpdate()
    return
  }
  if (action === 'quit-and-install') {
    await bridge.quitAndInstall()
    return
  }
  await bridge.checkForUpdates()
}

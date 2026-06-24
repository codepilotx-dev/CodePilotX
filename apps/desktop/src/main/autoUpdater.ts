import * as electronUpdater from 'electron-updater'
import type { DesktopUpdateStatus } from '../shared/types.js'

const FEED_URL = process.env.CODEPILOTX_UPDATE_FEED_URL ?? ''
const autoUpdater = electronUpdater.autoUpdater

export type DesktopAutoUpdater = {
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
}

export let desktopAutoUpdater: DesktopAutoUpdater | null = null

export function createDesktopAutoUpdater(options: {
  onStatusChange: (status: DesktopUpdateStatus) => void
}): void {
  if (!FEED_URL) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: FEED_URL,
  })

  autoUpdater.on('update-available', (info) => {
    options.onStatusChange({ phase: 'available', version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    options.onStatusChange({ phase: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', () => {
    options.onStatusChange({ phase: 'downloaded' })
  })

  autoUpdater.on('error', (err) => {
    options.onStatusChange({ phase: 'error', message: err.message })
  })

  autoUpdater.on('update-not-available', () => {
    options.onStatusChange({ phase: 'no-update' })
  })

  autoUpdater.checkForUpdates().catch(() => {
    // 后台检查失败，静默忽略
  })

  desktopAutoUpdater = {
    checkForUpdates: async () => {
      options.onStatusChange({ phase: 'checking' })
      await autoUpdater.checkForUpdates()
    },
    downloadUpdate: async () => {
      await autoUpdater.downloadUpdate()
    },
    quitAndInstall: () => {
      autoUpdater.quitAndInstall()
    },
  }
}

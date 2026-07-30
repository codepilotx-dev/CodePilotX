import { describe, expect, test } from 'bun:test'
import type {
  DesktopUpdateIpcBridge,
  DesktopUpdateStatus,
} from '@codepilotx/shared/desktop-update-ipc'
import {
  buildDesktopUpdateMenuModel,
  runDesktopUpdateMenuAction,
  startDesktopUpdateMonitoring,
} from '../src/features/layout/sidebar/desktopUpdateMenu'

describe('桌面更新菜单', () => {
  test('先订阅状态，再发起首次检查', () => {
    const calls: string[] = []
    const bridge = createBridge(calls)

    const unsubscribe = startDesktopUpdateMonitoring(bridge, () => {})

    expect(calls).toEqual(['subscribe', 'check'])
    unsubscribe()
    expect(calls).toEqual(['subscribe', 'check', 'unsubscribe'])
  })

  test('状态映射为检查、下载和重启安装动作', async () => {
    expect(buildDesktopUpdateMenuModel(null)).toMatchObject({
      action: 'check',
      disabled: false,
      label: '检查更新',
    })
    expect(
      buildDesktopUpdateMenuModel({
        phase: 'available',
        version: '0.2.0-beta.5',
      }),
    ).toMatchObject({
      action: 'download',
      disabled: false,
      label: '下载 v0.2.0-beta.5',
    })
    expect(
      buildDesktopUpdateMenuModel({ phase: 'downloading', percent: 42.5 }),
    ).toMatchObject({
      action: 'download',
      disabled: true,
      label: '下载中 43%',
    })
    expect(
      buildDesktopUpdateMenuModel({ phase: 'downloaded' }),
    ).toMatchObject({
      action: 'quit-and-install',
      disabled: false,
      label: '重启安装',
    })

    const calls: string[] = []
    const bridge = createBridge(calls)
    await runDesktopUpdateMenuAction(bridge, 'check')
    await runDesktopUpdateMenuAction(bridge, 'download')
    await runDesktopUpdateMenuAction(bridge, 'quit-and-install')
    expect(calls).toEqual(['check', 'download', 'install'])
  })
})

function createBridge(calls: string[]): DesktopUpdateIpcBridge {
  return {
    checkForUpdates: async () => {
      calls.push('check')
    },
    downloadUpdate: async () => {
      calls.push('download')
    },
    quitAndInstall: async () => {
      calls.push('install')
    },
    onUpdateStatusChange: (
      _listener: (status: DesktopUpdateStatus) => void,
    ) => {
      calls.push('subscribe')
      return () => {
        calls.push('unsubscribe')
      }
    },
  }
}

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rendererRoot = resolve(import.meta.dir, '..')

function readRendererFile(path: string): string {
  return readFileSync(resolve(rendererRoot, path), 'utf8')
}

describe('workbench chrome contract', () => {
  test('synchronizes the rendered title bar with the native overlay', () => {
    const provider = readRendererFile(
      'src/features/theme/DesktopThemeProvider.tsx',
    )
    const preloadContract = readRendererFile('src/global.d.ts')

    expect(provider).toContain("querySelector<HTMLElement>('.desktop-menubar')")
    expect(provider).toContain('getBoundingClientRect().height')
    expect(provider).toContain('new ResizeObserver(sync)')
    expect(provider).toContain('lastPayloadRef.current')
    expect(preloadContract).toContain('DesktopAppearanceIpcBridge')
  })

  test('keeps application chrome separate from the workspace toolbar', () => {
    const chrome = readRendererFile('src/styles/features/layout-chrome.scss')
    const workspaceHeader = readRendererFile(
      'src/styles/features/_layout-workspace-header.scss',
    )
    const layout = readRendererFile('src/features/layout/shell/DesktopLayout.tsx')

    expect(chrome).toContain(
      '--desktop-titlebar-height: var(--application-menubar-height)',
    )
    expect(chrome).toContain('--cpx-sys-color-workbench-titlebar-bg')
    expect(workspaceHeader).toContain('height: var(--workspace-header-height)')
    expect(workspaceHeader).toContain('position: absolute')
    expect(workspaceHeader).toContain('background: transparent')
    expect(workspaceHeader).not.toContain('--cpx-sys-color-workbench-titlebar-bg')
    expect(layout).toContain('<DesktopWorkspaceHeader')
    expect(layout).toContain('desktop-main-route__header-spacer')
  })

  test('keeps route content out of the application menu bar', () => {
    const menuBar = readRendererFile('src/features/layout/MenuBar.tsx')
    const windowControlsIndex = menuBar.indexOf('<WindowControls')

    expect(menuBar).not.toContain('workspaceHeader')
    expect(menuBar).not.toContain('menubar-workspace-header')
    expect(windowControlsIndex).toBeGreaterThan(menuBar.indexOf('</Menubar.Root>'))
    for (const label of ['文件', '编辑', '查看', '窗口', '帮助']) {
      expect(menuBar).toContain(`label="${label}"`)
    }
  })
})

describe('workbench resize commit contract', () => {
  test('commits panel ratios synchronously without layout-state feedback', () => {
    const controller = readRendererFile(
      'src/features/layout/shell/useWorkbenchShellController.ts',
    )
    const responsiveSyncStart = controller.indexOf(
      'if (workspaceSize.width <= 0 || workspaceSize.height <= 0) return',
    )
    const responsiveSyncEnd = controller.indexOf(
      "void import('./workbenchLayoutStorage.js')",
      responsiveSyncStart,
    )
    const responsiveSync = controller.slice(
      responsiveSyncStart,
      responsiveSyncEnd,
    )

    expect(controller).not.toContain('startTransition')
    expect(controller).toContain('setRightDockWidthRatio(nextRatio)')
    expect(controller).toContain('setBottomPanelHeightRatio(nextRatio)')
    expect(responsiveSync).toContain('responsiveRightDockWidth')
    expect(responsiveSync).toContain('responsiveBottomPanelHeight')
    expect(responsiveSync).not.toContain('workbenchLayoutState,')
  })
})
